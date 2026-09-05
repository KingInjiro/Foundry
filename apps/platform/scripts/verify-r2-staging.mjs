import crypto from 'node:crypto';
import { R2StorageProvider } from '../src/platform/backend/storage/R2StorageProvider.js';

const CONFIRMATION = 'I_UNDERSTAND_THIS_WRITES_AND_DELETES_TEST_OBJECTS';
const prefix = String(process.env.R2_STAGING_TEST_PREFIX || '').replace(/^\/+|\/+$/g, '');
const origin = process.env.R2_STAGING_CORS_ORIGIN;

function requireStagingInputs() {
    if (process.env.R2_STAGING_VERIFY_CONFIRM !== CONFIRMATION) throw new Error(`Set R2_STAGING_VERIFY_CONFIRM=${CONFIRMATION}.`);
    if (!/^staging-verification\/[a-zA-Z0-9._/-]{1,120}$/.test(prefix) || prefix.includes('..')) {
        throw new Error('R2_STAGING_TEST_PREFIX must be an isolated staging-verification/... namespace.');
    }
    let parsedOrigin;
    try { parsedOrigin = new URL(origin); } catch { /* Report the normalized validation error below. */ }
    if (
        !parsedOrigin
        || parsedOrigin.protocol !== 'https:'
        || parsedOrigin.username
        || parsedOrigin.password
        || parsedOrigin.pathname !== '/'
        || parsedOrigin.search
        || parsedOrigin.hash
        || origin !== parsedOrigin.origin
    ) throw new Error('R2_STAGING_CORS_ORIGIN must be the exact HTTPS staging origin without credentials, path, query, or trailing slash.');
}

async function streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

requireStagingInputs();
const storage = new R2StorageProvider();
if (!storage.isConfigured) throw new Error('R2 credentials are not configured.');

const objectKey = `${prefix}/${crypto.randomUUID()}.bin`;
const body = Buffer.from(`foundry-r2-staging-${crypto.randomUUID()}`);
let uploaded = false;
const checks = [];
try {
    const { uploadUrl } = await storage.createUploadSession(objectKey, 'application/octet-stream');
    const signedUploadTtl = Number(new URL(uploadUrl).searchParams.get('X-Amz-Expires'));
    if (signedUploadTtl !== storage.uploadUrlTtlSeconds) throw new Error('Signed upload TTL does not match R2_UPLOAD_URL_TTL_SECONDS.');
    checks.push('signed_upload_ttl');
    const preflight = await fetch(uploadUrl, {
        method: 'OPTIONS',
        headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'PUT',
            'Access-Control-Request-Headers': 'content-type'
        }
    });
    const allowedOrigin = preflight.headers.get('access-control-allow-origin');
    if (!preflight.ok || !['*', origin].includes(allowedOrigin)) {
        throw new Error(`R2 CORS preflight failed (${preflight.status}, allow-origin=${allowedOrigin || 'missing'}).`);
    }
    checks.push('cors_preflight');

    const upload = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body });
    if (!upload.ok) throw new Error(`Signed upload failed with HTTP ${upload.status}.`);
    uploaded = true;
    checks.push('signed_upload');

    const metadata = await storage.getObjectMetadata(objectKey);
    if (Number(metadata.contentLength) !== body.length || metadata.contentType !== 'application/octet-stream') {
        throw new Error('R2 HEAD metadata did not match uploaded content.');
    }
    checks.push('head_metadata');

    const full = await streamToBuffer(await storage.getDownloadStream(objectKey));
    if (!full.equals(body)) throw new Error('R2 full download content mismatch.');
    checks.push('full_download');

    const ranged = await streamToBuffer(await storage.getDownloadStream(objectKey, { start: 2, end: 7 }));
    if (!ranged.equals(body.subarray(2, 8))) throw new Error('R2 range download content mismatch.');
    checks.push('range_download');

    const signedGet = await storage.createDownloadUrl(objectKey, { expiresIn: 30 });
    const signedResponse = await fetch(signedGet);
    if (!signedResponse.ok || !Buffer.from(await signedResponse.arrayBuffer()).equals(body)) {
        throw new Error(`Signed GET failed with HTTP ${signedResponse.status}.`);
    }
    checks.push('signed_get');

    const listed = await storage.listObjects(`${prefix}/`);
    if (!listed.some(object => object.key === objectKey)) throw new Error('Uploaded object was missing from prefix listing.');
    checks.push('prefix_listing');

    await storage.deleteObject(objectKey);
    uploaded = false;
    try {
        await storage.getObjectMetadata(objectKey);
        throw new Error('Deleted object still exists.');
    } catch (error) {
        if (error.message === 'Deleted object still exists.') throw error;
        if (error?.name !== 'NotFound' && error?.$metadata?.httpStatusCode !== 404) throw error;
    }
    checks.push('delete_confirmed');
    console.log(JSON.stringify({ status: 'PASS', provider: 'r2', objectPrefix: `${prefix}/`, checks }, null, 2));
} finally {
    if (uploaded) await storage.deleteObject(objectKey).catch(() => {});
}
