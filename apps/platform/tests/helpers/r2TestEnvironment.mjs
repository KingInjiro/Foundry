import { randomBytes } from 'node:crypto';

// Ephemeral test credentials, generated only in tests; never release payload.
export function r2TestEnvironment() {
    const account = '0123456789abcdef0123456789abcdef';
    return {
        R2_ACCOUNT_ID: account,
        R2_ACCESS_KEY_ID: randomBytes(16).toString('hex'),
        R2_SECRET_ACCESS_KEY: randomBytes(32).toString('hex'),
        R2_BUCKET_NAME: 'foundry-test',
        R2_ENDPOINT: `https://${account}.r2.cloudflarestorage.com`,
        R2_UPLOAD_URL_TTL_SECONDS: '900',
        R2_DOWNLOAD_URL_TTL_SECONDS: '120',
        R2_DIRECT_DOWNLOADS: 'false'
    };
}
