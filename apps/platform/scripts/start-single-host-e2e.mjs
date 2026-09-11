import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configuredTestRoot = process.env.SINGLE_HOST_E2E_ROOT;
const testRoot = configuredTestRoot ? path.resolve(configuredTestRoot) : path.join(platformRoot, '.single-host-e2e');
const dataDirectory = path.join(testRoot, 'data');
const tlsDirectory = path.join(testRoot, 'tls');
const internalPort = 3442;
const publicPort = 3443;
const publicOrigin = `https://127.0.0.1:${publicPort}`;

if (configuredTestRoot) {
    const stat = fs.statSync(testRoot, { throwIfNoEntry: false });
    if (!path.isAbsolute(configuredTestRoot) || !stat?.isDirectory() || fs.readdirSync(testRoot).length !== 0) {
        throw new Error('SINGLE_HOST_E2E_ROOT must be an existing empty absolute directory created for this run.');
    }
} else {
    fs.rmSync(testRoot, { recursive: true, force: true });
}
fs.mkdirSync(path.join(dataDirectory, 'objects', '.tmp'), { recursive: true });
fs.mkdirSync(path.join(dataDirectory, 'backups'), { recursive: true });
fs.mkdirSync(tlsDirectory, { recursive: true });
const keyPath = path.join(tlsDirectory, 'key.pem');
const certificatePath = path.join(tlsDirectory, 'certificate.pem');
execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
    '-keyout', keyPath,
    '-out', certificatePath
], { stdio: 'ignore' });

const backendEnvironment = {
    ...process.env,
    NODE_ENV: 'production',
    FOUNDRY_DEPLOYMENT_MODE: 'single-host',
    PLATFORM_PUBLIC_BASE_URL: publicOrigin,
    PLATFORM_CLIENT_BUILD_PROFILE: path.join(platformRoot, 'dist', 'client', 'deployment-profile.json'),
    HOST: '127.0.0.1',
    PORT: String(internalPort),
    TRUST_PROXY_HOPS: '1',
    ENABLE_HSTS: 'true',
    CORS_ALLOWED_ORIGINS: '',
    FOUNDRY_DATA_DIR: dataDirectory,
    PLATFORM_DB_PATH: path.join(dataDirectory, 'platform.db'),
    LOCAL_AUTH_SESSION_SECRET: 'single-host-browser-session-secret-for-production-e2e',
    LOCAL_AUTH_SESSION_TTL_SECONDS: '3600',
    GOOGLE_OAUTH_CLIENT_ID: 'foundry-test.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: crypto.randomBytes(32).toString('hex'),
    LOCAL_STORAGE_SIGNING_SECRET: 'single-host-browser-storage-secret-for-production-e2e',
    LOCAL_STORAGE_UPLOAD_URL_TTL_SECONDS: '300',
    JOB_MODE: 'async',
    JOB_WORKER_ID: 'single-host-browser-e2e-1',
    JOB_LEASE_MS: '5000',
    MAX_JOB_ATTEMPTS: '3',
    MAX_PUBLISH_ATTEMPTS: '3',
    UPLOAD_CLEANUP_INTERVAL_MS: '900000',
    E2E_MODE: 'false',
    SINGLE_HOST_TEST_MODE: 'false',
    LOCAL_DEV_MODE: 'false',
    AUTH_DEV_BYPASS: 'false',
    ALLOW_UNREADY_STARTUP: 'false',
    SHUTDOWN_GRACE_MS: '30000',
    LOG_LEVEL: 'info',
    TEST_JSON_LOGS: 'true'
};

const backend = spawn(process.execPath, ['--import', './tests/helpers/googleOAuthE2E.mjs', 'dist/server.cjs'], {
    cwd: platformRoot,
    env: backendEnvironment,
    stdio: ['ignore', 'inherit', 'inherit']
});

const proxy = https.createServer({
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certificatePath)
}, (request, response) => {
    const forwardedFor = request.socket.remoteAddress || '127.0.0.1';
    const upstream = http.request({
        hostname: '127.0.0.1',
        port: internalPort,
        path: request.url,
        method: request.method,
        headers: {
            ...request.headers,
            'x-forwarded-for': forwardedFor,
            'x-forwarded-proto': 'https',
            'x-forwarded-host': request.headers.host
        }
    }, upstreamResponse => {
        response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
    });
    upstream.on('error', error => {
        if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
        response.end(`Foundry upstream unavailable: ${error.code || 'ERROR'}`);
    });
    request.pipe(upstream);
});

await new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(publicPort, '127.0.0.1', resolve);
});
console.log(JSON.stringify({ event: 'single_host_e2e_proxy_started', publicOrigin, internalPort }));

let stopping = false;
const stop = async signal => {
    if (stopping) return;
    stopping = true;
    await new Promise(resolve => proxy.close(resolve));
    if (backend.exitCode === null) backend.kill('SIGTERM');
    await new Promise(resolve => backend.exitCode !== null ? resolve() : backend.once('close', resolve));
    console.log(JSON.stringify({ event: 'single_host_e2e_stopped', signal }));
};
process.once('SIGTERM', () => { void stop('SIGTERM').then(() => process.exit(0)); });
process.once('SIGINT', () => { void stop('SIGINT').then(() => process.exit(0)); });
backend.once('exit', code => {
    if (!stopping) {
        console.error(`Foundry production backend exited unexpectedly (${code}).`);
        void stop('BACKEND_EXIT').then(() => process.exit(code || 1));
    }
});

await new Promise(() => {});
