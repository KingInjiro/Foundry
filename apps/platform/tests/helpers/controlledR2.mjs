import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { crc32 } from 'node:zlib';
import { R2StorageProvider } from '../../src/platform/backend/storage/R2StorageProvider.js';
import { r2TestEnvironment } from './r2TestEnvironment.mjs';

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const unxml = value => value.replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();

function validPresignedPut(url, headers, env, now = Date.now()) {
    const credential = url.searchParams.get('X-Amz-Credential')?.split('/');
    const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders')?.split(';');
    const date = url.searchParams.get('X-Amz-Date');
    if (!credential || credential[0] !== env.R2_ACCESS_KEY_ID || !signedHeaders?.includes('content-type')
        || !signedHeaders.includes('host') || !/^\d{8}T\d{6}Z$/.test(date || '')) return false;
    const timestamp = Date.parse(date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
    const expiry = Number(url.searchParams.get('X-Amz-Expires'));
    if (!Number.isInteger(expiry) || expiry < 60 || expiry > 3600 || now > timestamp + expiry * 1000) return false;
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

function validSdkSignature(method, url, headers, env) {
    const auth = /^AWS4-HMAC-SHA256 Credential=([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(headers.authorization || '');
    if (!auth) return false;
    const credential = auth[1].split('/');
    if (credential[0] !== env.R2_ACCESS_KEY_ID) return false;
    const query = [...url.searchParams].map(([key, value]) => [encode(key), encode(value)])
        .sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0)
        .map(([key, value]) => `${key}=${value}`).join('&');
    const canonical = [method, url.pathname, query,
        auth[2].split(';').map(key => `${key}:${String(headers[key] || '').trim().replace(/\s+/g, ' ')}\n`).join(''),
        auth[2], headers['x-amz-content-sha256'] || digest('')].join('\n');
    const key = hmac(hmac(hmac(hmac(`AWS4${env.R2_SECRET_ACCESS_KEY}`, credential[1]), credential[2]), credential[3]), 'aws4_request');
    return hmac(key, `AWS4-HMAC-SHA256\n${headers['x-amz-date']}\n${credential.slice(1).join('/')}\n${digest(canonical)}`).toString('hex') === auth[3];
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

export async function controlledR2({ browserProxyPort } = {}) {
    const env = r2TestEnvironment();
    const objects = new Map();
    const requests = [];
    let unavailable = false;
    let denyReads = false;
    let denyDeletes = false;
    let nowOffset = 0;
    let allowedOrigin;
    const handler = async (req, res) => {
        try {
            const url = new URL(req.url, `https://${req.headers.host}`);
            let key = decodeURIComponent(url.pathname.slice(1));
            if (key === env.R2_BUCKET_NAME) key = '';
            else if (key.startsWith(`${env.R2_BUCKET_NAME}/`)) key = key.slice(env.R2_BUCKET_NAME.length + 1);
            requests.push({ method: req.method, host: req.headers.host, key, range: req.headers.range || null,
                origin: req.headers.origin, requestedMethod: req.headers['access-control-request-method'],
                requestedHeaders: req.headers['access-control-request-headers'], cookie: req.headers.cookie,
                list: url.searchParams.has('list-type') });
            res.setHeader('content-type', 'application/xml');
            if (req.headers.origin) {
                if (req.headers.origin !== allowedOrigin) { res.writeHead(403); res.end(); return; }
                res.setHeader('access-control-allow-origin', allowedOrigin);
                res.setHeader('vary', 'Origin');
                res.setHeader('access-control-allow-methods', 'PUT');
                res.setHeader('access-control-allow-headers', 'Content-Type');
                if (req.method === 'OPTIONS') {
                    const headers = (req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(h => h.trim()).filter(Boolean);
                    if (req.headers['access-control-request-method'] !== 'PUT' || headers.some(h => h !== 'content-type')) {
                        res.writeHead(403); res.end(); return;
                    }
                    res.writeHead(204); res.end(); return;
                }
            }
            if (unavailable) { res.writeHead(503); res.end('<Error><Code>ServiceUnavailable</Code></Error>'); return; }
            const signedPut = req.method === 'PUT' && url.searchParams.has('X-Amz-Signature');
            if (!(signedPut ? validPresignedPut(url, req.headers, env, Date.now() + nowOffset) : validSdkSignature(req.method, url, req.headers, env))) {
                res.writeHead(403); res.end('<Error><Code>AccessDenied</Code></Error>'); return;
            }
            if (req.method === 'HEAD' && !key) { res.writeHead(200); res.end(); return; }
            if (req.method === 'GET' && url.searchParams.has('list-type')) {
                const prefix = url.searchParams.get('prefix');
                if (!prefix) throw new Error('Test transport forbids bucket-root listing.');
                const after = Buffer.from(url.searchParams.get('continuation-token') || '', 'base64url').toString();
                const entries = [...objects].filter(([name]) => name.startsWith(prefix) && name > after).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
                const page = entries.slice(0, 2);
                const truncated = page.length < entries.length;
                const token = truncated ? Buffer.from(page.at(-1)[0]).toString('base64url') : '';
                res.end(`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${token}</NextContinuationToken>` : ''}${page.map(([name, object]) => `<Contents><Key>${xml(name)}</Key><Size>${object.body.length}</Size><ETag>${xml(object.etag)}</ETag></Contents>`).join('')}</ListBucketResult>`);
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
            if (denyDeletes && (req.method === 'DELETE' || (req.method === 'POST' && url.searchParams.has('delete')))) {
                res.writeHead(503); res.end('<Error><Code>ServiceUnavailable</Code></Error>'); return;
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
                const checksum = url.searchParams.get('x-amz-checksum-crc32') || req.headers['x-amz-checksum-crc32'];
                const actual = Buffer.alloc(4);
                actual.writeUInt32BE(crc32(body));
                if (checksum && checksum !== actual.toString('base64')) {
                    res.writeHead(400); res.end('<Error><Code>BadDigest</Code></Error>'); return;
                }
                const etag = `"${crypto.createHash('md5').update(body).digest('hex')}"`;
                objects.set(key, { body, contentType: req.headers['content-type'] || 'application/octet-stream', etag });
                res.setHeader('etag', etag); res.writeHead(200); res.end(); return;
            }
            res.writeHead(405); res.end();
        } catch {
            res.writeHead(500); res.end('<Error><Code>TestTransportFailure</Code></Error>');
        }
    };
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const storage = new R2StorageProvider({ env });
    storage.client.config.requestHandler = r2RequestHandler(origin);
    // Keep outage tests deterministic; production SDK retry policy is untouched.
    storage.client.config.maxAttempts = async () => 1;
    let tlsServer, browserProxy, tlsRoot;
    const sockets = new Set();
    if (browserProxyPort !== undefined) {
        tlsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-r2-tls-'));
        const host = new URL(env.R2_ENDPOINT).hostname;
        const key = path.join(tlsRoot, 'key.pem'), cert = path.join(tlsRoot, 'cert.pem');
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-subj', `/CN=${host}`, '-addext', `subjectAltName=DNS:${host},DNS:${env.R2_BUCKET_NAME}.${host}`,
            '-keyout', key, '-out', cert], { stdio: 'ignore' });
        tlsServer = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, handler);
        await new Promise(resolve => tlsServer.listen(0, '127.0.0.1', resolve));
        // A real CONNECT tunnel keeps Chromium's TLS, CSP, CORS and preflight
        // stack intact. Only these two synthetic R2 hosts may reach loopback S3.
        browserProxy = http.createServer((_req, res) => { res.writeHead(403); res.end(); });
        browserProxy.on('connect', (req, client, head) => {
            if (![`${host}:443`, `${env.R2_BUCKET_NAME}.${host}:443`].includes(req.url)) { client.destroy(); return; }
            const upstream = net.connect(tlsServer.address().port, '127.0.0.1', () => {
                client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                if (head.length) upstream.write(head);
                client.pipe(upstream); upstream.pipe(client);
            });
            for (const socket of [client, upstream]) { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); }
            client.on('error', () => upstream.destroy()); upstream.on('error', () => client.destroy());
            client.on('close', () => upstream.destroy());
        });
        await new Promise((resolve, reject) => { browserProxy.once('error', reject); browserProxy.listen(browserProxyPort, '127.0.0.1', resolve); });
    }
    const forwardRequest = async (urlString, { method, headers, body } = {}) => {
        const url = new URL(urlString);
        const { response } = await r2RequestHandler(origin).handle({
            hostname: url.hostname, path: url.pathname, query: Object.fromEntries(url.searchParams), method, headers, body
        });
        const chunks = [];
        for await (const chunk of response.body) chunks.push(chunk);
        return { status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) };
    };
    return {
        env, storage, objects, requests, origin, forwardRequest,
        setUnavailable(value) { unavailable = value; },
        setDenyReads(value) { denyReads = value; },
        setDenyDeletes(value) { denyDeletes = value; },
        setClockOffset(value) { nowOffset = value; },
        setAllowedOrigin(value) { allowedOrigin = value; },
        async putSigned(uploadUrl, body, contentType = 'application/zip') {
            return forwardRequest(uploadUrl, { method: 'PUT', body, headers: { 'content-type': contentType } });
        },
        async close() {
            storage.client.destroy();
            for (const socket of sockets) socket.destroy();
            for (const service of [browserProxy, tlsServer, server]) if (service) {
                service.closeAllConnections(); await new Promise(resolve => service.close(resolve));
            }
            if (tlsRoot) fs.rmSync(tlsRoot, { recursive: true, force: true });
        }
    };
}
