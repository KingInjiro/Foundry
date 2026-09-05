import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { restoreSqliteBackup } from '../src/platform/backend/database/SqliteRecovery.js';
import { LocalSqliteProvider } from '../src/platform/backend/database/LocalSqliteProvider.js';
import { LocalDiskStorageProvider } from '../src/platform/backend/storage/LocalDiskStorageProvider.js';
import { createApp } from '../src/platform/backend/server/app.js';

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
}

const backup = argument('--backup');
if (!backup) throw new Error('Usage: npm run db:rehearse -- --backup /absolute/path/foundry-backup.db');

const rehearsalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-restore-rehearsal-'));
const targetPath = path.join(rehearsalRoot, 'restored.db');
let database;
let server;
try {
    const restore = restoreSqliteBackup({ backupPath: path.resolve(backup), targetPath });
    database = new LocalSqliteProvider(targetPath);
    const storage = new LocalDiskStorageProvider(path.join(rehearsalRoot, 'storage'), '/unused');
    const jobs = {
        registerHandler() {},
        async enqueue() { throw new Error('Rehearsal queue does not accept mutations.'); },
        async getStatus() { return { mode: 'rehearsal', queued: 0, running: 0, retrying: 0, failed: 0 }; },
        async stop() {}
    };
    const app = createApp(database, storage, jobs);
    server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const address = server.address();
    const [health, ready] = await Promise.all([
        fetch(`http://127.0.0.1:${address.port}/api/health`),
        fetch(`http://127.0.0.1:${address.port}/api/ready`)
    ]);
    if (!health.ok || !ready.ok) throw new Error(`Restored server probes failed: health=${health.status}, ready=${ready.status}`);
    const games = await database.listGames();
    console.log(JSON.stringify({
        operation: 'sqlite_restore_rehearsal',
        status: 'PASS',
        health: health.status,
        ready: ready.status,
        restoredGameRows: games.length,
        verification: restore.restored
    }, null, 2));
} finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (database) await database.close();
    fs.rmSync(rehearsalRoot, { recursive: true, force: true });
}
