import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';
import {
    createSingleHostBackup,
    restoreSingleHostBackup,
    verifySingleHostBackup
} from '../../../src/platform/backend/recovery/SingleHostRecovery.js';
import { rehearseSingleHostBackup } from '../../../src/platform/backend/recovery/SingleHostRehearsal.js';

const roots = [];

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-single-host-recovery-'));
    roots.push(root);
    const dataDirectory = path.join(root, 'data');
    fs.mkdirSync(path.join(dataDirectory, 'objects', '.tmp'), { recursive: true });
    fs.mkdirSync(path.join(dataDirectory, 'backups'), { recursive: true });
    return { root, dataDirectory };
}

afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('coordinated single-host backup and restore', () => {
    it('rehearses a valid fresh-install backup without inventing a published fixture', async () => {
        const { dataDirectory } = fixture();
        const database = new LocalSqliteProvider(path.join(dataDirectory, 'platform.db'));
        await database.close();

        const backupDirectory = path.join(dataDirectory, 'backups', 'fresh-install-backup');
        await createSingleHostBackup({ dataDirectory, outputDirectory: backupDirectory });
        const rehearsal = await rehearseSingleHostBackup({ backupDirectory });

        expect(rehearsal.status).toBe('PASS');
        expect(rehearsal.health).toEqual({ httpStatus: 200, deploymentMode: 'single-host' });
        expect(rehearsal.readiness.httpStatus).toBe(200);
        expect(rehearsal.storageIntegrity.status).toBe('PASS');
        expect(rehearsal.publishedAsset).toEqual({
            status: 'NOT_APPLICABLE',
            reason: 'NO_PUBLISHED_FIXTURE'
        });
    });

    it('backs up SQLite plus objects with hashes and restores an isolated portable data root', async () => {
        const { dataDirectory } = fixture();
        const database = new LocalSqliteProvider(path.join(dataDirectory, 'platform.db'));
        await database.createUser({
            uid: 'backup-owner', email: '', displayName: 'Backup Owner', avatarUrl: '',
            role: 'DEVELOPER', createdAt: 1, updatedAt: 1
        });
        await database.createGame({
            id: 'backup-game', ownerUid: 'backup-owner', title: 'Backup Game', description: '',
            storageMode: 'platform', currentState: 'DRAFT', createdAt: 2, updatedAt: 2
        });
        fs.mkdirSync(path.join(dataDirectory, 'objects', 'games', 'backup-game'), { recursive: true });
        fs.writeFileSync(path.join(dataDirectory, 'objects', 'games', 'backup-game', 'index.html'), '<h1>ready</h1>');
        fs.writeFileSync(path.join(dataDirectory, 'objects', '.tmp', 'ignored.partial'), 'partial');

        const outputDirectory = path.join(dataDirectory, 'backups', 'foundry-backup-test');
        const backup = await createSingleHostBackup({
            dataDirectory,
            outputDirectory,
            applicationVersion: '0.1.0',
            releaseId: 'test-release'
        });
        expect(backup.status).toBe('PASS');
        expect(backup.database.quickCheck).toBe('ok');
        expect(backup.manifest.database.schemaMigrations.at(-1).version).toBe(8);
        expect(backup.objects).toEqual({ count: 1, totalBytes: 14 });
        expect(backup.manifest.objects.files[0]).toMatchObject({
            key: 'games/backup-game/index.html',
            sizeBytes: 14
        });
        expect(fs.existsSync(path.join(outputDirectory, 'objects', '.tmp'))).toBe(false);
        expect(JSON.stringify(backup.manifest)).not.toContain('single-host-session-secret-for-integration-tests');

        const restoredDirectory = path.join(path.dirname(dataDirectory), 'restored');
        const restored = await restoreSingleHostBackup({ backupDirectory: outputDirectory, targetDataDirectory: restoredDirectory });
        expect(restored.status).toBe('PASS');
        expect(fs.readFileSync(path.join(restoredDirectory, 'objects', 'games', 'backup-game', 'index.html'), 'utf8')).toBe('<h1>ready</h1>');
        expect(fs.statSync(path.join(restoredDirectory, 'objects', '.tmp')).isDirectory()).toBe(true);
        const restoredDb = new LocalSqliteProvider(path.join(restoredDirectory, 'platform.db'));
        expect((await restoredDb.getGame('backup-game')).ownerUid).toBe('backup-owner');
        await restoredDb.close();
        await database.close();
    });

    it('detects tampered bytes and never overwrites backup or restore targets', async () => {
        const { dataDirectory } = fixture();
        const database = new LocalSqliteProvider(path.join(dataDirectory, 'platform.db'));
        fs.mkdirSync(path.join(dataDirectory, 'objects', 'games'), { recursive: true });
        fs.writeFileSync(path.join(dataDirectory, 'objects', 'games', 'one.bin'), 'known-bytes');
        const outputDirectory = path.join(dataDirectory, 'backups', 'backup');
        await createSingleHostBackup({ dataDirectory, outputDirectory });
        await expect(createSingleHostBackup({ dataDirectory, outputDirectory })).rejects.toThrow('never overwritten');

        fs.writeFileSync(path.join(outputDirectory, 'objects', 'games', 'one.bin'), 'corrupt-data');
        await expect(verifySingleHostBackup(outputDirectory)).rejects.toThrow('verification failed');
        const restoreTarget = path.join(path.dirname(dataDirectory), 'restore-target');
        fs.mkdirSync(restoreTarget);
        await expect(restoreSingleHostBackup({ backupDirectory: outputDirectory, targetDataDirectory: restoreTarget }))
            .rejects.toThrow('never overwrites');
        await database.close();
    });

    it('refuses symbolic links in the source object tree', async () => {
        const { root, dataDirectory } = fixture();
        const database = new LocalSqliteProvider(path.join(dataDirectory, 'platform.db'));
        const outside = path.join(root, 'outside.bin');
        fs.writeFileSync(outside, 'outside');
        fs.mkdirSync(path.join(dataDirectory, 'objects', 'games'), { recursive: true });
        fs.symlinkSync(outside, path.join(dataDirectory, 'objects', 'games', 'escape.bin'));
        await expect(createSingleHostBackup({
            dataDirectory,
            outputDirectory: path.join(dataDirectory, 'backups', 'backup')
        })).rejects.toThrow('Symbolic links are forbidden');
        await database.close();
    });

    it('boots an isolated restored server and serves a published fixture through the CDN gate', async () => {
        const { dataDirectory } = fixture();
        const database = new LocalSqliteProvider(path.join(dataDirectory, 'platform.db'));
        await database.createUser({
            uid: 'published-owner', email: '', displayName: 'Published Owner', avatarUrl: '',
            role: 'DEVELOPER', createdAt: 1, updatedAt: 1
        });
        await database.createGame({
            id: 'published-game', ownerUid: 'published-owner', title: 'Published Fixture', description: '',
            storageMode: 'platform', currentState: 'PUBLISHED', createdAt: 2, updatedAt: 2
        });
        await database.createGameVersion({
            id: 'published-version', gameId: 'published-game', version: '1.0.0', runtime: 'web',
            format: 'web-game', entry: 'index.html', status: 'PUBLISHED', createdAt: 3
        });
        await database.updateGameVersionRuntimeUrl(
            'published-version',
            '/api/cdn/games/published-game/versions/published-version/extracted'
        );
        const objectPath = path.join(
            dataDirectory,
            'objects',
            'games',
            'published-game',
            'versions',
            'published-version',
            'extracted',
            'index.html'
        );
        fs.mkdirSync(path.dirname(objectPath), { recursive: true });
        fs.writeFileSync(objectPath, '<!doctype html><title>Restored</title>');
        await database.close();

        const backupDirectory = path.join(dataDirectory, 'backups', 'rehearsal-backup');
        await createSingleHostBackup({ dataDirectory, outputDirectory: backupDirectory });
        const rehearsal = await rehearseSingleHostBackup({ backupDirectory });
        expect(rehearsal.status).toBe('PASS');
        expect(rehearsal.health).toEqual({ httpStatus: 200, deploymentMode: 'single-host' });
        expect(rehearsal.readiness.httpStatus).toBe(200);
        expect(rehearsal.readiness.checks).toEqual({ database: true, storage: true, jobs: true, auth: true });
        expect(rehearsal.storageIntegrity.status).toBe('PASS');
        expect(rehearsal.publishedAsset).toMatchObject({
            status: 'PASS',
            gameId: 'published-game',
            versionId: 'published-version',
            httpStatus: 200
        });
    });
});
