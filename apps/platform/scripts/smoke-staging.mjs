import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CONFIRMATION = 'I_UNDERSTAND_THIS_CREATES_AND_DELETES_STAGING_CONTENT';
const baseUrl = String(process.env.STAGING_BASE_URL || '').replace(/\/+$/, '');
const developerToken = process.env.STAGING_DEVELOPER_TOKEN;
const moderatorToken = process.env.STAGING_MODERATOR_TOKEN;
const packagePath = process.env.STAGING_TEST_PACKAGE ? path.resolve(process.env.STAGING_TEST_PACKAGE) : '';
const testId = crypto.randomUUID().slice(0, 8);
const title = `[foundry-staging-smoke] ${testId}`;
const checks = [];
let gameId = null;

function assertInputs() {
    if (process.env.STAGING_SMOKE_CONFIRM !== CONFIRMATION) throw new Error(`Set STAGING_SMOKE_CONFIRM=${CONFIRMATION}.`);
    let url;
    try { url = new URL(baseUrl); } catch { throw new Error('STAGING_BASE_URL must be an exact HTTP(S) origin.'); }
    const stagingHost = /(^|[.-])staging([.-]|$)/i.test(url.hostname) || ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('STAGING_BASE_URL must use HTTPS.');
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || baseUrl !== url.origin) {
        throw new Error('STAGING_BASE_URL must be an exact origin without credentials, path, or query.');
    }
    if (!stagingHost && process.env.STAGING_ALLOW_NON_STAGING_HOST !== 'I_ACCEPT_THE_PRODUCTION_RISK') {
        throw new Error('Target hostname is not recognizably staging; explicit STAGING_ALLOW_NON_STAGING_HOST acknowledgement is required.');
    }
    if (!developerToken || !moderatorToken || developerToken === moderatorToken) throw new Error('Separate STAGING_DEVELOPER_TOKEN and STAGING_MODERATOR_TOKEN values are required.');
    if (!fs.statSync(packagePath, { throwIfNoEntry: false })?.isFile()) throw new Error('STAGING_TEST_PACKAGE must point to a valid test ZIP.');
}

async function request(relativePath, { token, method = 'GET', body, headers = {}, expected = [200] } = {}) {
    const response = await fetch(`${baseUrl}${relativePath}`, {
        method,
        headers: {
            ...(token && { Authorization: `Bearer ${token}` }),
            ...(body !== undefined && { 'Content-Type': 'application/json' }),
            ...headers
        },
        ...(body !== undefined && { body: JSON.stringify(body) })
    });
    if (!expected.includes(response.status)) {
        const text = (await response.text()).slice(0, 1000);
        throw new Error(`${method} ${relativePath} returned ${response.status}: ${text}`);
    }
    const contentType = response.headers.get('content-type') || '';
    return { response, payload: contentType.includes('json') ? await response.json() : null };
}

async function poll(label, operation, predicate, { timeoutMs = 90_000, intervalMs = 1_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let value;
    while (Date.now() < deadline) {
        value = await operation();
        if (predicate(value)) return value;
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error(`${label} timed out. Last value: ${JSON.stringify(value)}`);
}

async function cleanup() {
    if (!gameId) return true;
    try {
        const deletion = await request(`/api/games/${encodeURIComponent(gameId)}`, {
            token: developerToken,
            method: 'DELETE',
            body: { confirmTitle: title },
            expected: [200, 202, 404, 409]
        });
        if (deletion.response.status !== 404) {
            await poll('cleanup job', async () => {
                const result = await request(`/api/games/${encodeURIComponent(gameId)}`, {
                    token: developerToken,
                    expected: [200, 404]
                });
                return result.response.status;
            }, status => status === 404, { timeoutMs: 90_000, intervalMs: 1_000 });
        }
        gameId = null;
        return true;
    } catch (error) {
        console.error(JSON.stringify({ event: 'staging_smoke_cleanup_failed', gameId, message: error.message }));
        return false;
    }
}

assertInputs();
try {
    const health = await request('/api/health');
    if (health.payload?.data?.status !== 'ok') throw new Error('Health endpoint did not report ok.');
    checks.push('health');
    const ready = await request('/api/ready');
    if (ready.payload?.data?.status !== 'ready') throw new Error('Readiness endpoint did not report ready.');
    checks.push('readiness');

    const me = await request('/api/auth/me', { token: developerToken });
    if (!me.payload?.data?.uid) throw new Error('Developer Firebase token was not accepted.');
    const moderator = await request('/api/auth/me', { token: moderatorToken });
    if (!['ADMIN', 'MODERATOR'].includes(moderator.payload?.data?.role)) throw new Error('Moderator token is not provisioned with an operator role.');
    if (moderator.payload?.data?.uid === me.payload?.data?.uid) throw new Error('Staging developer and moderator tokens must represent distinct users.');
    checks.push('firebase_auth_and_roles');

    const created = await request('/api/games', { token: developerToken, method: 'POST', body: { title, description: `Disposable staging verification ${testId}` } });
    gameId = created.payload?.data?.id;
    if (!gameId) throw new Error('Game creation returned no ID.');
    checks.push('create_project');

    const packageBuffer = fs.readFileSync(packagePath);
    const session = await request(`/api/games/${encodeURIComponent(gameId)}/versions`, {
        token: developerToken,
        method: 'POST',
        body: { expectedSize: packageBuffer.length }
    });
    const { uploadUrl, sessionId, versionId } = session.payload?.data || {};
    if (!uploadUrl || !sessionId || !versionId) throw new Error('Upload session response was incomplete.');
    const uploaded = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: packageBuffer });
    if (!uploaded.ok) throw new Error(`Signed package upload returned ${uploaded.status}.`);
    checks.push('signed_upload');

    const completed = await request(`/api/uploads/${encodeURIComponent(sessionId)}/complete`, { token: developerToken, method: 'POST', body: {}, expected: [200] });
    if (completed.payload?.data?.status !== 'READY') throw new Error(`Server validation did not reach READY: ${JSON.stringify(completed.payload)}`);
    checks.push('server_validation_ready');

    await request(`/api/games/${encodeURIComponent(gameId)}/versions/${encodeURIComponent(versionId)}/publish`, { token: developerToken, method: 'POST', body: {}, expected: [200, 202] });
    const published = await poll('publish job', async () => {
        const versions = await request(`/api/games/${encodeURIComponent(gameId)}/versions`, { token: developerToken });
        return versions.payload?.data?.find(version => version.id === versionId);
    }, version => version?.status === 'PUBLISHED');
    checks.push('publish_job');

    const catalog = await request(`/api/catalog/games?q=${encodeURIComponent(title)}`);
    if (!catalog.payload?.data?.some(game => game.gameId === gameId)) throw new Error('Published game was absent from catalog.');
    checks.push('catalog_visibility');

    const entryPath = `${published.runtimeUrl}/${published.entry}`;
    const head = await request(entryPath, { method: 'HEAD', expected: [200] });
    if (!head.response.headers.get('content-type')) throw new Error('CDN HEAD omitted Content-Type.');
    if (!/\bno-cache\b/i.test(head.response.headers.get('cache-control') || '')) throw new Error('CDN asset did not require moderation-aware cache revalidation.');
    const range = await request(entryPath, { headers: { Range: 'bytes=0-15' }, expected: [206] });
    if (!range.response.headers.get('content-range')) throw new Error('CDN Range response omitted Content-Range.');
    checks.push('cdn_head_and_range');
    await request(`/player/game/${encodeURIComponent(gameId)}`);
    await request(entryPath);
    checks.push('play_bootstrap');

    await request(`/api/games/${encodeURIComponent(gameId)}/unpublish`, { token: developerToken, method: 'POST', body: {} });
    const hiddenCatalog = await request(`/api/catalog/games/${encodeURIComponent(gameId)}`, { expected: [404] });
    if (hiddenCatalog.payload?.error?.code !== 'NOT_PUBLISHED') throw new Error('Unpublished game remained public.');
    checks.push('unpublish_gate');

    await request(`/api/games/${encodeURIComponent(gameId)}/versions/${encodeURIComponent(versionId)}/activate`, { token: developerToken, method: 'POST', body: {} });
    await request(`/api/catalog/games/${encodeURIComponent(gameId)}`);
    checks.push('release_restore');

    const report = await request(`/api/games/${encodeURIComponent(gameId)}/reports`, {
        token: developerToken,
        method: 'POST',
        body: { category: 'BROKEN', reason: `Disposable staging moderation verification for ${testId}.` },
        expected: [201]
    });
    const reportId = report.payload?.data?.id;
    await request(`/api/moderation/reports/${encodeURIComponent(reportId)}`, {
        token: moderatorToken,
        method: 'PATCH',
        body: { status: 'RESOLVED', moderationState: 'HIDDEN', resolution: `Staging smoke action for disposable project ${testId}.` }
    });
    await request(entryPath, { method: 'HEAD', expected: [404] });
    checks.push('moderation_and_cdn_gate');

    if (!await cleanup()) throw new Error('Staging content cleanup was not confirmed.');
    checks.push('cleanup_confirmed');
    console.log(JSON.stringify({ status: 'PASS', target: new URL(baseUrl).origin, namespace: title, checks }, null, 2));
} catch (error) {
    await cleanup();
    console.error(JSON.stringify({ status: 'FAIL', target: baseUrl, namespace: title, checks, message: error.message }, null, 2));
    process.exitCode = 1;
}
