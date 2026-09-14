import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// A separate compiled production process, with no Google preload/credentials
// and no auth bypass. Its disposable client files model extracted ZIP mtimes.
export async function startProductionSpaServer({ r2 = null } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-production-spa-'));
    const data = path.join(root, 'data');
    const logs = [];
    let backend;
    let backendExited;
    let proxy;
    const close = async () => {
        if (proxy?.listening) {
            proxy.closeAllConnections();
            await new Promise((resolve, reject) => proxy.close(error => error ? reject(error) : resolve()));
        }
        if (backend && backend.exitCode === null && backend.signalCode === null) backend.kill('SIGTERM');
        await backendExited;
        fs.rmSync(root, { recursive: true, force: true });
    };
    try {
        fs.cpSync(path.join(platformRoot, 'dist'), path.join(root, 'dist'), { recursive: true });
        fs.symlinkSync(path.resolve(platformRoot, '../../node_modules'), path.join(root, 'node_modules'), 'dir');
        fs.mkdirSync(path.join(data, 'objects', '.tmp'), { recursive: true });
        fs.mkdirSync(path.join(data, 'backups'), { recursive: true });
        const archiveDate = new Date('1980-01-01T00:00:00.000Z');
        for (const name of ['index.html', 'sandbox.html', 'generic-sandbox.html']) {
            fs.utimesSync(path.join(root, 'dist/client', name), archiveDate, archiveDate);
        }
        const index = fs.readFileSync(path.join(root, 'dist/client/index.html'), 'utf8');
        const legacyEtag = `W/"${Buffer.byteLength(index).toString(16)}-${archiveDate.getTime().toString(16)}"`;
        const key = path.join(root, 'key.pem');
        const cert = path.join(root, 'cert.pem');
        execFileSync('openssl', [
            'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
            '-keyout', key, '-out', cert
        ], { stdio: 'ignore' });
        // The existing single-host/Google fixtures use 3442/3443/3445. Tests
        // run sequentially; this isolated backend uses a separate loopback port.
        const internalPort = 3446;
        proxy = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (request, response) => {
            const upstream = http.request({
                hostname: '127.0.0.1', port: internalPort, path: request.url, method: request.method,
                headers: { ...request.headers, 'x-forwarded-proto': 'https', 'x-forwarded-for': '127.0.0.1', 'x-forwarded-host': request.headers.host }
            }, result => {
                response.writeHead(result.statusCode, result.headers);
                result.pipe(response);
            });
            upstream.on('error', error => {
                if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
                response.end(`Production SPA upstream failed: ${error.code}`);
            });
            request.pipe(upstream);
        });
        await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
        const origin = `https://127.0.0.1:${proxy.address().port}`;
        const env = {
            ...process.env,
            NODE_ENV: 'production', FOUNDRY_DEPLOYMENT_MODE: 'single-host',
            PLATFORM_PUBLIC_BASE_URL: origin,
            PLATFORM_CLIENT_BUILD_PROFILE: path.join(root, 'dist/client/deployment-profile.json'),
            HOST: '127.0.0.1', PORT: String(internalPort), TRUST_PROXY_HOPS: '1', ENABLE_HSTS: 'true',
            FOUNDRY_DATA_DIR: data, PLATFORM_DB_PATH: path.join(data, 'platform.db'),
            LOCAL_AUTH_SESSION_SECRET: randomBytes(48).toString('hex'),
            LOCAL_STORAGE_SIGNING_SECRET: randomBytes(48).toString('hex'),
            JOB_MODE: 'async', TEST_JSON_LOGS: 'true',
            E2E_MODE: 'false', SINGLE_HOST_TEST_MODE: 'false', LOCAL_DEV_MODE: 'false',
            AUTH_DEV_BYPASS: 'false', ALLOW_UNREADY_STARTUP: 'false'
        };
        env.FOUNDRY_STORAGE_PROVIDER = r2 ? 'r2' : 'local-disk';
        if (r2) Object.assign(env, r2.env, { FOUNDRY_TEST_R2_ORIGIN: r2.origin });
        delete env.GOOGLE_OAUTH_CLIENT_ID;
        delete env.GOOGLE_OAUTH_CLIENT_SECRET;
        delete env.NODE_OPTIONS;
        const startBackend = async () => {
            let startupOutput = '';
            const preload = r2 ? ['--import', fileURLToPath(new URL('./r2E2E.mjs', import.meta.url))] : [];
            backend = spawn(process.execPath, [...preload, 'dist/server.cjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
            backendExited = new Promise(resolve => { backend.once('exit', resolve); backend.once('error', resolve); });
            await new Promise((resolve, reject) => {
                backend.once('error', reject);
                backend.once('exit', code => reject(new Error(`Production SPA backend exited (${code}): ${logs.join('')}`)));
                backend.stderr.on('data', chunk => logs.push(String(chunk)));
                backend.stdout.on('data', chunk => {
                    logs.push(String(chunk));
                    startupOutput += String(chunk);
                    if (startupOutput.includes('"event":"server_started"')) resolve();
                });
            });
        };
        const stopBackend = async () => {
            if (backend && backend.exitCode === null && backend.signalCode === null) backend.kill('SIGTERM');
            await backendExited;
        };
        await startBackend();
        return { origin, index, legacyEtag, lastModified: archiveDate.toUTCString(), close, data, logs, stopBackend,
            async restart() { await stopBackend(); await startBackend(); } };
    } catch (error) {
        await close();
        throw error;
    }
}
