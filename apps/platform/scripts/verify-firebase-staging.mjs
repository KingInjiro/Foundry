import crypto from 'node:crypto';

const CONFIRMATION = 'I_UNDERSTAND_THIS_CREATES_AND_DELETES_A_FIRESTORE_TEST_DOCUMENT';
const baseUrl = String(process.env.STAGING_BASE_URL || '').replace(/\/+$/, '');
const ownerToken = process.env.STAGING_FIREBASE_OWNER_TOKEN;
const foreignToken = process.env.STAGING_FIREBASE_FOREIGN_TOKEN;
const projectId = process.env.FIREBASE_PROJECT_ID;
const databaseId = process.env.FIRESTORE_DATABASE_ID;
const documentId = `staging-verification-${crypto.randomUUID()}`;

function decodeToken(token) {
    try {
        return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    } catch {
        throw new Error('A staging Firebase token is not a decodable JWT.');
    }
}

function assertInputs() {
    if (process.env.FIREBASE_STAGING_RULES_CONFIRM !== CONFIRMATION) throw new Error(`Set FIREBASE_STAGING_RULES_CONFIRM=${CONFIRMATION}.`);
    let target;
    try { target = new URL(baseUrl); } catch { throw new Error('STAGING_BASE_URL must be an exact HTTP(S) origin.'); }
    if (target.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(target.hostname)) throw new Error('STAGING_BASE_URL must use HTTPS.');
    if (target.username || target.password || target.pathname !== '/' || target.search || target.hash || baseUrl !== target.origin) {
        throw new Error('STAGING_BASE_URL must be an exact origin without credentials, path, or query.');
    }
    if (!ownerToken || !foreignToken || ownerToken === foreignToken) throw new Error('Two distinct staging Firebase ID tokens are required.');
    if (!projectId || !databaseId) throw new Error('FIREBASE_PROJECT_ID and FIRESTORE_DATABASE_ID are required.');
    const owner = decodeToken(ownerToken);
    const foreign = decodeToken(foreignToken);
    if (owner.aud !== projectId || foreign.aud !== projectId) throw new Error('Firebase token audience does not match FIREBASE_PROJECT_ID.');
    if (!owner.sub || !foreign.sub || owner.sub === foreign.sub) throw new Error('Firebase tokens must represent distinct users.');
    if (Number(owner.exp) * 1000 <= Date.now() || Number(foreign.exp) * 1000 <= Date.now()) throw new Error('A staging Firebase token is expired.');
    return { owner, foreign };
}

async function call(url, { token, method = 'GET', body } = {}) {
    return fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(body && { 'Content-Type': 'application/json' })
        },
        ...(body && { body: JSON.stringify(body) })
    });
}

const { owner, foreign } = assertInputs();
const collectionUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/projects`;
const documentUrl = `${collectionUrl}/${encodeURIComponent(documentId)}`;
const now = new Date().toISOString();
const validDocument = uid => ({ fields: {
    ownerUid: { stringValue: uid },
    files: { arrayValue: { values: [{ stringValue: 'staging-verification' }] } },
    createdAt: { timestampValue: now },
    updatedAt: { timestampValue: now }
} });
let created = false;
const checks = [];

try {
    const platformAuth = await call(`${baseUrl}/api/auth/me`, { token: ownerToken });
    if (!platformAuth.ok) throw new Error(`Platform token verification failed with HTTP ${platformAuth.status}.`);
    const platformPayload = await platformAuth.json();
    if (platformPayload?.data?.uid !== owner.sub) throw new Error('Platform identity did not match the Firebase token subject.');
    checks.push('platform_token_verification');

    const list = await call(`${collectionUrl}?pageSize=1`, { token: ownerToken });
    if (list.status !== 403) throw new Error(`Firestore collection listing must be denied; received HTTP ${list.status}.`);
    checks.push('collection_list_denied');

    const create = await call(`${collectionUrl}?documentId=${encodeURIComponent(documentId)}`, { token: ownerToken, method: 'POST', body: validDocument(owner.sub) });
    if (!create.ok) throw new Error(`Owner create failed with HTTP ${create.status}: ${(await create.text()).slice(0, 500)}`);
    created = true;
    checks.push('owner_create');

    const ownRead = await call(documentUrl, { token: ownerToken });
    if (!ownRead.ok) throw new Error(`Owner read failed with HTTP ${ownRead.status}.`);
    checks.push('owner_read');

    const foreignRead = await call(documentUrl, { token: foreignToken });
    if (foreignRead.status !== 403) throw new Error(`Foreign read must be denied; received HTTP ${foreignRead.status}.`);
    checks.push('foreign_read_denied');

    const ownerRewrite = await call(documentUrl, { token: ownerToken, method: 'PATCH', body: validDocument(foreign.sub) });
    if (ownerRewrite.status !== 403) throw new Error(`Owner UID rewrite must be denied; received HTTP ${ownerRewrite.status}.`);
    checks.push('owner_rewrite_denied');

    const malformed = await call(documentUrl, { token: ownerToken, method: 'PATCH', body: { fields: { ownerUid: { stringValue: owner.sub } } } });
    if (malformed.status !== 403) throw new Error(`Malformed project write must be denied; received HTTP ${malformed.status}.`);
    checks.push('malformed_write_denied');

    const deletion = await call(documentUrl, { token: ownerToken, method: 'DELETE' });
    if (!deletion.ok) throw new Error(`Owner cleanup failed with HTTP ${deletion.status}.`);
    created = false;
    checks.push('owner_delete');

    console.log(JSON.stringify({ status: 'PASS', projectId, databaseId, checks }, null, 2));
} finally {
    if (created) await call(documentUrl, { token: ownerToken, method: 'DELETE' }).catch(() => {});
}
