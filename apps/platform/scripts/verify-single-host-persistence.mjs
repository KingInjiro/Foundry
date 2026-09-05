import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LocalSqliteProvider } from '../src/platform/backend/database/LocalSqliteProvider.js';
import { LocalDiskStorageProvider } from '../src/platform/backend/storage/LocalDiskStorageProvider.js';
import { checkStorageIntegrity } from '../src/platform/backend/storage/StorageIntegrityChecker.js';
import { createSingleHostBackup } from '../src/platform/backend/recovery/SingleHostRecovery.js';
import { rehearseSingleHostBackup } from '../src/platform/backend/recovery/SingleHostRehearsal.js';

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = process.env.SINGLE_HOST_E2E_ROOT
    ? path.resolve(process.env.SINGLE_HOST_E2E_ROOT)
    : path.join(platformRoot, '.single-host-e2e');
const dataDirectory = path.join(testRoot, 'data');
const databasePath = path.join(dataDirectory, 'platform.db');
const port = 3444;
const logs = [];
const child = spawn(process.execPath, ['dist/server.cjs'], {
    cwd: platformRoot,
    env: {
        ...process.env,
        NODE_ENV: 'production',
        FOUNDRY_DEPLOYMENT_MODE: 'single-host',
        PLATFORM_PUBLIC_BASE_URL: 'https://127.0.0.1:3443',
        PLATFORM_CLIENT_BUILD_PROFILE: path.join(platformRoot, 'dist', 'client', 'deployment-profile.json'),
        HOST: '127.0.0.1',
        PORT: String(port),
        TRUST_PROXY_HOPS: '0',
        ENABLE_HSTS: 'false',
        CORS_ALLOWED_ORIGINS: '',
        FOUNDRY_DATA_DIR: dataDirectory,
        PLATFORM_DB_PATH: databasePath,
        LOCAL_AUTH_SESSION_SECRET: 'single-host-browser-session-secret-for-production-e2e',
        LOCAL_AUTH_SESSION_TTL_SECONDS: '3600',
        LOCAL_STORAGE_SIGNING_SECRET: 'single-host-browser-storage-secret-for-production-e2e',
        LOCAL_STORAGE_UPLOAD_URL_TTL_SECONDS: '300',
        JOB_MODE: 'async',
        JOB_WORKER_ID: 'single-host-restart-e2e-1',
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
    },
    stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', chunk => logs.push(String(chunk)));
child.stderr.on('data', chunk => logs.push(String(chunk)));

async function waitReady() {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`Restarted server exited early (${child.exitCode}).`);
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/ready`);
            if (response.ok) return response;
        } catch {
            // Still starting.
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Restarted single-host server did not become ready.');
}

let restartEvidence;
try {
    const ready = await waitReady();
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    const catalog = await fetch(`http://127.0.0.1:${port}/api/catalog/games?limit=100`);
    const games = (await catalog.json()).data;
    const published = games.find(game => game.name === 'Generic E2E');
    if (!published) throw new Error('Published browser fixture did not survive server restart.');
    const details = await fetch(`http://127.0.0.1:${port}/api/catalog/games/${published.gameId}`);
    const game = (await details.json()).data;
    const entryUrl = `${game.storageRef.location}/${game.entry}`;
    const range = await fetch(`http://127.0.0.1:${port}${entryUrl}`, { headers: { Range: 'bytes=0-8' } });
    if (range.status !== 206 || !range.headers.get('content-range')) throw new Error(`Restarted CDN Range returned ${range.status}.`);
    restartEvidence = {
        health: health.status,
        ready: ready.status,
        deploymentMode: (await health.json()).data.deploymentMode,
        catalogGameId: published.gameId,
        rangeStatus: range.status,
        contentRange: range.headers.get('content-range')
    };
} finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('close', resolve));
}
if (!logs.join('').includes('"event":"server_stopped"')) {
    throw new Error(`Restarted server did not complete graceful shutdown.\n${logs.join('')}`);
}

const database = new LocalSqliteProvider(databasePath);
const storage = new LocalDiskStorageProvider(path.join(dataDirectory, 'objects'), '/unused', {
    uploadSigningSecret: 'single-host-browser-storage-secret-for-production-e2e'
});
const integrity = await checkStorageIntegrity(database, storage);
await database.close();
if (integrity.status !== 'PASS') throw new Error(`Persisted storage integrity failed: ${JSON.stringify(integrity.issues)}`);

const backupDirectory = path.join(dataDirectory, 'backups', 'foundry-backup-single-host-acceptance');
const backup = await createSingleHostBackup({
    dataDirectory,
    outputDirectory: backupDirectory,
    applicationVersion: '0.1.0',
    releaseId: 'single-host-acceptance'
});
const rehearsal = await rehearseSingleHostBackup({ backupDirectory });
console.log(JSON.stringify({
    status: 'PASS',
    operation: 'single_host_restart_backup_restore_acceptance',
    restart: restartEvidence,
    storageIntegrity: integrity.counts,
    backup: { databaseSha256: backup.database.sha256, objectCount: backup.objects.count, objectBytes: backup.objects.totalBytes },
    rehearsal: {
        health: rehearsal.health,
        readiness: rehearsal.readiness,
        publishedAsset: rehearsal.publishedAsset
    }
}, null, 2));
