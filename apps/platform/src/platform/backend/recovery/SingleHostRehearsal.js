import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { LocalSqliteProvider } from '../database/LocalSqliteProvider.js';
import { LocalDiskStorageProvider } from '../storage/LocalDiskStorageProvider.js';
import { checkStorageIntegrity } from '../storage/StorageIntegrityChecker.js';
import { restoreSingleHostBackup } from './SingleHostRecovery.js';

const REHEARSAL_SESSION_SECRET = 'single-host-rehearsal-session-secret-not-used-by-production';
const REHEARSAL_STORAGE_SECRET = 'single-host-rehearsal-storage-secret-not-used-by-production';

function rehearsalJobs() {
    return {
        registerHandler() {},
        async enqueue() { throw new Error('Restore rehearsal does not accept mutations.'); },
        async getStatus() { return { mode: 'rehearsal', queued: 0, running: 0, retrying: 0, failed: 0, stopping: false }; },
        async stop() {}
    };
}

export async function rehearseSingleHostBackup({ backupDirectory }) {
    const rehearsalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-single-host-rehearsal-'));
    const targetDataDirectory = path.join(rehearsalRoot, 'data');
    let database;
    let server;
    try {
        const restore = await restoreSingleHostBackup({ backupDirectory, targetDataDirectory });
        database = new LocalSqliteProvider(path.join(targetDataDirectory, 'platform.db'));
        const storage = new LocalDiskStorageProvider(
            path.join(targetDataDirectory, 'objects'),
            '/api/storage/upload',
            { uploadSigningSecret: REHEARSAL_STORAGE_SECRET }
        );
        const app = createApp(database, storage, rehearsalJobs(), {
            runtimeConfig: {
                deploymentMode: 'single-host',
                production: false,
                publicBaseUrl: 'http://127.0.0.1'
            },
            localAuthOptions: {
                sessionSecret: REHEARSAL_SESSION_SECRET,
                secureCookies: false
            }
        });
        server = await new Promise(resolve => {
            const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
        });
        const address = server.address();
        const origin = `http://127.0.0.1:${address.port}`;
        const [health, ready, integrity] = await Promise.all([
            fetch(`${origin}/api/health`),
            fetch(`${origin}/api/ready`),
            checkStorageIntegrity(database, storage)
        ]);
        if (!health.ok || !ready.ok) {
            throw new Error(`Restored server probes failed: health=${health.status}, ready=${ready.status}`);
        }
        if (integrity.status !== 'PASS') {
            throw new Error(`Restored storage integrity failed with ${integrity.counts.missingOrInvalid} issue(s).`);
        }

        const published = database.db.prepare(`
            SELECT g.id AS gameId, v.id AS versionId, v.entry, v.runtimeUrl
            FROM game_versions v
            JOIN games g ON g.id = v.gameId
            WHERE v.status = 'PUBLISHED' AND COALESCE(g.moderationState, 'ACTIVE') = 'ACTIVE'
              AND v.entry IS NOT NULL AND v.runtimeUrl IS NOT NULL
            ORDER BY COALESCE(v.publishedAt, v.createdAt) DESC
            LIMIT 1
        `).get();
        let publishedAsset = { status: 'NOT_APPLICABLE', reason: 'NO_PUBLISHED_FIXTURE' };
        if (published) {
            const expectedRuntimeUrl = `/api/cdn/games/${published.gameId}/versions/${published.versionId}/extracted`;
            if (published.runtimeUrl !== expectedRuntimeUrl) throw new Error('Restored published fixture has an invalid runtime URL.');
            const response = await fetch(`${origin}${expectedRuntimeUrl}/${published.entry}`);
            if (!response.ok || Number(response.headers.get('content-length') || 0) <= 0) {
                throw new Error(`Restored published fixture was not deliverable: HTTP ${response.status}.`);
            }
            publishedAsset = {
                status: 'PASS',
                gameId: published.gameId,
                versionId: published.versionId,
                entry: published.entry,
                httpStatus: response.status,
                contentLength: Number(response.headers.get('content-length'))
            };
        }

        const healthPayload = await health.json();
        const readyPayload = await ready.json();
        return {
            status: 'PASS',
            restore: {
                databaseSha256: restore.database.sha256,
                objectCount: restore.objects.count,
                objectBytes: restore.objects.totalBytes
            },
            health: { httpStatus: health.status, deploymentMode: healthPayload.data.deploymentMode },
            readiness: { httpStatus: ready.status, checks: readyPayload.data.checks },
            storageIntegrity: integrity,
            publishedAsset
        };
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (database) await database.close();
        fs.rmSync(rehearsalRoot, { recursive: true, force: true });
    }
}
