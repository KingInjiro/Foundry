import http from 'node:http';
import crypto from 'node:crypto';
import { R2StorageProvider } from '../../src/platform/backend/storage/R2StorageProvider.js';
import { r2TestEnvironment } from './r2TestEnvironment.mjs';

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const unxml = value => value.replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();

function validPresignedPut(url, headers, env) {
    const credential = url.searchParams.get('X-Amz-Credential')?.split('/');
    const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders')?.split(';');
    const date = url.searchParams.get('X-Amz-Date');
    if (!credential || credential[0] !== env.R2_ACCESS_KEY_ID || !signedHeaders?.includes('content-type')
        || !signedHeaders.includes('host') || !/^\d{8}T\d{6}Z$/.test(date || '')) return false;
    const timestamp = Date.parse(date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
    const expiry = Number(url.searchParams.get('X-Amz-Expires'));
    if (!Number.isInteger(expiry) || expiry < 60 || expiry > 3600 || Date.now() > timestamp + expiry * 1000) return false;
    const query = [...url.searchParams].filter(([key]) => key !== 'X-Amz-Signature')
        .map(([key, value]) => [encode(key), encode(value)]).sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0)
        .map(([key, value]) => `${key}=${value}`).join('&');
    const canonical = ['PUT', url.pathname, query,
        signedHeaders.map(key => `${key}:${String(headers[key] || '').trim().replace(/\s+/g, ' ')}\n`).join(''),
        signedHeaders.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
    const scope = credential.slice(1).join('/');
    const key = hmac(hmac(hmac(hmac(`AWS4${env.R2_SECRET_ACCESS_KEY}`, credential[1]), credential[2]), credential[3]), 'aws4_request');
    const signature = hmac(key, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${digest(canonical)}`).toString('hex');
    return signature === url.searchParams.get('X-Amz-Signature');
}

// Real HTTP + SDK serialization, pagination, Range and signed browser PUT.
// Test-only transport redirects the trusted R2 hostname to this loopback server.
export function r2RequestHandler(origin) {
    return {
        async handle(request, { abortSignal } = {}) {
            const query = Object.entries(request.query || {}).flatMap(([key, value]) =>
                (Array.isArray(value) ? value : [value]).map(item => `${encode(key)}=${encode(item ?? '')}`)).join('&');
            return new Promise((resolve, reject) => {
                const req = http.request(`${origin}${request.path}${query ? `?${query}` : ''}`, {
                    method: request.method, headers: { ...request.headers, host: request.hostname }, signal: abortSignal
                }, response => resolve({ response: { statusCode: response.statusCode, headers: response.headers, body: response } }));
                req.on('error', reject);
                if (request.body?.pipe) request.body.pipe(req);
                else req.end(request.body);
            });
        },
        destroy() {}
    };
}

export async function controlledR2() {
    const env = r2TestEnvironment();
    const objects = new Map();
    const requests = [];
    let unavailable = false;
    let denyReads = false;
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, `https://${req.headers.host}`);
            let key = decodeURIComponent(url.pathname.slice(1));
            if (key === env.R2_BUCKET_NAME) key = '';
            else if (key.startsWith(`${env.R2_BUCKET_NAME}/`)) key = key.slice(env.R2_BUCKET_NAME.length + 1);
            requests.push({ method: req.method, key, range: req.headers.range || null, list: url.searchParams.has('list-type') });
            res.setHeader('content-type', 'application/xml');
            if (unavailable) { res.writeHead(503); res.end('<Error><Code>ServiceUnavailable</Code></Error>'); return; }
            if (req.method === 'HEAD' && !key) { res.writeHead(200); res.end(); return; }
            if (req.method === 'GET' && url.searchParams.has('list-type')) {
                const prefix = url.searchParams.get('prefix');
                if (!prefix) throw new Error('Test transport forbids bucket-root listing.');
                const entries = [...objects].filter(([name]) => name.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b));
                const start = Number(url.searchParams.get('continuation-token') || 0);
                const page = entries.slice(start, start + 2);
                const truncated = start + page.length < entries.length;
                res.end(`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${start + page.length}</NextContinuationToken>` : ''}${page.map(([name, object]) => `<Contents><Key>${xml(name)}</Key><Size>${object.body.length}</Size><ETag>${xml(object.etag)}</ETag></Contents>`).join('')}</ListBucketResult>`);
                return;
            }
            if (req.method === 'GET' || req.method === 'HEAD') {
                const object = objects.get(key);
                if (!object) { res.writeHead(404); res.end('<Error><Code>NoSuchKey</Code></Error>'); return; }
                if (denyReads && req.method === 'GET') { res.writeHead(403); res.end('<Error><Code>AccessDenied</Code></Error>'); return; }
                const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
                const body = range ? object.body.subarray(Number(range[1]), Number(range[2]) + 1) : object.body;
                res.setHeader('content-type', object.contentType);
                res.setHeader('content-length', body.length);
                res.setHeader('etag', object.etag);
                if (range) res.setHeader('content-range', `bytes ${range[1]}-${Math.min(Number(range[2]), object.body.length - 1)}/${object.body.length}`);
                res.writeHead(range ? 206 : 200); res.end(req.method === 'HEAD' ? undefined : body); return;
            }
            if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); res.end(); return; }
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
                size += chunk.length;
                if (size > 8 * 1024 * 1024) throw new Error('Test fixture upload exceeds its bounded transport limit.');
                chunks.push(chunk);
            }
            const body = Buffer.concat(chunks);
            if (req.method === 'POST' && url.searchParams.has('delete')) {
                for (const match of body.toString().matchAll(/<Key>(.*?)<\/Key>/g)) objects.delete(unxml(match[1]));
                res.end('<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>'); return;
            }
            if (req.method === 'PUT') {
                if (url.searchParams.has('X-Amz-Signature') && !validPresignedPut(url, req.headers, env)) {
                    res.writeHead(403); res.end('<Error><Code>SignatureDoesNotMatch</Code></Error>'); return;
                }
                if (!url.searchParams.has('X-Amz-Signature') && !req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')) throw new Error('Unsigned SDK request');
                const etag = `"${crypto.createHash('md5').update(body).digest('hex')}"`;
                objects.set(key, { body, contentType: req.headers['content-type'] || 'application/octet-stream', etag });
                res.setHeader('etag', etag); res.writeHead(200); res.end(); return;
            }
            res.writeHead(405); res.end();
        } catch {
            res.writeHead(500); res.end('<Error><Code>TestTransportFailure</Code></Error>');
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const storage = new R2StorageProvider({ env });
    storage.client.config.requestHandler = r2RequestHandler(origin);
    // Keep outage tests deterministic; production SDK retry policy is untouched.
    storage.client.config.maxAttempts = async () => 1;
    return {
        env, storage, objects, requests, origin,
        setUnavailable(value) { unavailable = value; },
        setDenyReads(value) { denyReads = value; },
        async putSigned(uploadUrl, body, contentType = 'application/zip') {
            const url = new URL(uploadUrl);
            return fetch(`${origin}${url.pathname}${url.search}`, { method: 'PUT', body, headers: { host: url.host, 'content-type': contentType } });
        },
        async close() { storage.client.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    };
}
