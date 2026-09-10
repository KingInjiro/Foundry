import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

// Test-only provider transport. Real RSA signatures and the production Google
// SDK verifier run; only outbound HTTP is replaced. Never imported by runtime.
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
export const TEST_GOOGLE_CLIENT_ID = 'foundry-test.apps.googleusercontent.com';

export function mockGoogleClient({ clientId = TEST_GOOGLE_CLIENT_ID, redirectUri, clientSecret = crypto.randomBytes(32).toString('hex') } = {}) {
    const codes = new Map();
    let exchanges = 0;
    const client = new OAuth2Client({ clientId, clientSecret, redirectUri });
    const issueCode = ({ nonce, challenge, claims = {}, header = {}, privateKey = keys.privateKey } = {}) => {
        const now = Math.floor(Date.now() / 1000);
        const payload = { iss: 'https://accounts.google.com', aud: clientId, sub: 'google-subject-1', iat: now, exp: now + 3600, nonce, ...claims };
        const body = [JSON.stringify({ alg: 'RS256', kid: 'test-key', ...header }), JSON.stringify(payload)]
            .map(value => Buffer.from(value).toString('base64url')).join('.');
        const token = `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`;
        const code = crypto.randomBytes(32).toString('base64url');
        codes.set(code, { token, challenge });
        return { code, token };
    };
    client.transporter.request = async options => {
        if (String(options.url) === 'https://www.googleapis.com/oauth2/v1/certs') {
            return { data: { 'test-key': keys.publicKey.export({ type: 'spki', format: 'pem' }) }, headers: new Headers({ 'cache-control': 'max-age=3600' }) };
        }
        if (String(options.url) !== 'https://oauth2.googleapis.com/token') throw new Error('Unexpected Google endpoint');
        exchanges += 1;
        const values = options.data;
        const issued = codes.get(values.get('code'));
        codes.delete(values.get('code'));
        if (!issued || values.get('client_id') !== clientId || values.get('client_secret') !== clientSecret
            || values.get('redirect_uri') !== redirectUri || values.get('grant_type') !== 'authorization_code'
            || (issued.challenge && crypto.createHash('sha256').update(values.get('code_verifier') || '').digest('base64url') !== issued.challenge)) {
            throw new Error(`Rejected test exchange ${values.get('code')}`);
        }
        return { data: { id_token: issued.token }, headers: new Headers() };
    };
    return { client, clientId, clientSecret, issueCode, exchanges: () => exchanges };
}
