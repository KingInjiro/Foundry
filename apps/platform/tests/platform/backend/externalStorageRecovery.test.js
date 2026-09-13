import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';
import { createSingleHostBackup, verifySingleHostBackup, restoreSingleHostBackup } from '../../../src/platform/backend/recovery/SingleHostRecovery.js';
import { rehearseSingleHostBackup } from '../../../src/platform/backend/recovery/SingleHostRehearsal.js';
import { checkSqliteStorageIntegrity, readOnlyExternalStorage } from '../../../src/platform/backend/recovery/ExternalStorageRecovery.js';
import { controlledR2 } from '../../helpers/controlledR2.mjs';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture({ published = true } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-r2-recovery-'));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    const r2 = await controlledR2();
    cleanups.push(() => r2.close());
    const dataDirectory = path.join(root, 'data');
    fs.mkdirSync(dataDirectory);
    const databasePath = path.join(dataDirectory, 'platform.db');
    const db = new LocalSqliteProvider(databasePath);
    try {
        if (published) {
            await db.createUser({ uid: 'owner', email: '', displayName: 'Owner', avatarUrl: '', role: 'DEVELOPER', createdAt: 1, updatedAt: 1 });
            await db.createGame({ id: 'game', ownerUid: 'owner', title: 'Remote game', description: '', storageMode: 'platform', currentState: 'PUBLISHED', createdAt: 2, updatedAt: 2 });
            await db.createGameVersion({ id: 'version', gameId: 'game', version: '1.0.0', runtime: 'web', format: 'web-game', entry: 'index.html', status: 'PUBLISHED', createdAt: 3 });
            await db.updateGameVersionRuntimeUrl('version', '/api/cdn/games/game/versions/version/extracted');
            await db.createUploadSession({ id: 'upload', ownerUid: 'owner', gameId: 'game', versionId: 'version', storageProvider: 'r2', objectKey: 'games/game/versions/version/package.zip', expectedSize: 4, expectedContentType: 'application/zip', status: 'CLEANED', expiresAt: 100, createdAt: 3 });
            await r2.storage.uploadBuffer('games/game/versions/version/extracted/index.html', Buffer.from('<h1>Remote restored game</h1>'), 'text/html');
            await r2.storage.uploadBuffer('games/game/versions/version/extracted/data.bin', Buffer.from('remote bytes'), 'application/octet-stream');
        }
    } finally { await db.close(); }
    const backupDirectory = path.join(root, 'backup');
    return { root, dataDirectory, databasePath, backupDirectory, ...r2 };
}

describe('single-host R2 backup/integrity/restore', () => {
    it('verifies an external inventory, restores only SQLite, and rehearses a published asset with read-only remote access', async () => {
        const f = await fixture();
        const backup = await createSingleHostBackup({ dataDirectory: f.dataDirectory, outputDirectory: f.backupDirectory, storage: f.storage });
        expect(backup.format).toBe('foundry-single-host-external-backup-v2');
        expect(backup.objects).toMatchObject({ count: 2, remoteObjectsIncluded: false });
        expect(backup.manifest.objects.storage).toEqual({ provider: 'r2', endpoint: f.env.R2_ENDPOINT, bucket: f.env.R2_BUCKET_NAME, prefix: f.env.R2_OBJECT_PREFIX });
        expect(fs.readdirSync(f.backupDirectory).sort()).toEqual(['manifest.json', 'platform.db']);
        expect(JSON.stringify(backup)).not.toContain(f.env.R2_SECRET_ACCESS_KEY);
        expect(JSON.stringify(backup)).not.toContain(f.env.R2_ACCESS_KEY_ID);
        const reads = f.requests.filter(request => request.method === 'GET' && !request.list);
        expect(reads.length).toBeGreaterThan(0);
        expect(reads.every(request => request.range === 'bytes=0-0')).toBe(true);
        const before = [...f.objects].map(([key, object]) => [key, object.etag]);
        const offset = f.requests.length;
        const restored = await restoreSingleHostBackup({ backupDirectory: f.backupDirectory, targetDataDirectory: path.join(f.root, 'restored'), storage: f.storage });
        expect(restored.objects.remoteObjectsIncluded).toBe(false);
        expect(fs.readdirSync(path.join(f.root, 'restored'))).toEqual(['platform.db']);
        const rehearsal = await rehearseSingleHostBackup({ backupDirectory: f.backupDirectory, storage: f.storage });
        expect(rehearsal).toMatchObject({ status: 'PASS', readiness: { httpStatus: 200 }, storageIntegrity: { status: 'PASS' }, publishedAsset: { status: 'PASS', httpStatus: 200 }, restore: { remoteObjectsIncluded: false } });
        expect(f.requests.slice(offset).every(request => ['HEAD', 'GET'].includes(request.method))).toBe(true);
        expect([...f.objects].map(([key, object]) => [key, object.etag])).toEqual(before);
        const readonly = readOnlyExternalStorage(f.storage);
        await expect(readonly.uploadBuffer('games/x', Buffer.from('bad'))).rejects.toThrow('cannot mutate');
        await expect(readonly.deletePrefix('games/')).rejects.toThrow('cannot mutate');
    });

    it('supports fresh empty R2 backups without inventing a fixture', async () => {
        const f = await fixture({ published: false });
        await createSingleHostBackup({ dataDirectory: f.dataDirectory, outputDirectory: f.backupDirectory, storage: f.storage });
        const rehearsal = await rehearseSingleHostBackup({ backupDirectory: f.backupDirectory, storage: f.storage });
        expect(rehearsal.status).toBe('PASS');
        expect(rehearsal.publishedAsset.status).toBe('NOT_APPLICABLE');
    });

    it('rejects missing, changed, unreadable remote bytes and wrong storage before creating a restore target', async () => {
        const f = await fixture();
        await createSingleHostBackup({ dataDirectory: f.dataDirectory, outputDirectory: f.backupDirectory, storage: f.storage });
        await expect(verifySingleHostBackup(f.backupDirectory)).rejects.toThrow('configured R2');
        const prefix = f.storage.objectPrefix;
        f.storage.objectPrefix = 'other-installation';
        await expect(verifySingleHostBackup(f.backupDirectory, { storage: f.storage })).rejects.toThrow('binding');
        f.storage.objectPrefix = prefix;
        f.setDenyReads(true);
        await expect(verifySingleHostBackup(f.backupDirectory, { storage: f.storage })).rejects.toMatchObject({ code: 'R2_STORAGE_FAILED' });
        f.setDenyReads(false);
        const [key, original] = [...f.objects][0];
        f.objects.set(key, { ...original, etag: 'changed' });
        await expect(verifySingleHostBackup(f.backupDirectory, { storage: f.storage })).rejects.toThrow('changed');
        f.objects.delete(key);
        const target = path.join(f.root, 'missing-restore');
        await expect(restoreSingleHostBackup({ backupDirectory: f.backupDirectory, targetDataDirectory: target, storage: f.storage })).rejects.toMatchObject({ name: 'NotFound' });
        expect(fs.existsSync(target)).toBe(false);
        expect(fs.readdirSync(f.root).some(name => name.endsWith('.partial'))).toBe(false);
    });

    it('rejects storage provider switches and cleans partial backups after remote failure', async () => {
        const f = await fixture();
        const db = new LocalSqliteProvider(f.databasePath);
        db.db.prepare("UPDATE upload_sessions SET storageProvider = 'local-disk'").run();
        await db.close();
        const integrity = await checkSqliteStorageIntegrity(f.databasePath, f.storage);
        expect(integrity.status).toBe('FAIL');
        expect(integrity.issues).toContainEqual(expect.objectContaining({ code: 'STORAGE_PROVIDER_MISMATCH' }));
        await expect(createSingleHostBackup({ dataDirectory: f.dataDirectory, outputDirectory: f.backupDirectory, storage: f.storage })).rejects.toThrow('integrity failed');
        expect(fs.existsSync(f.backupDirectory)).toBe(false);
        expect(fs.readdirSync(f.root).some(name => name.endsWith('.partial'))).toBe(false);
    });
});
