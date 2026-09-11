import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureSqliteConnection, LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';
import { createSqliteBackup, restoreSqliteBackup, verifySqliteDatabase } from '../../../src/platform/backend/database/SqliteRecovery.js';

const roots = [];

function tempRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-recovery-test-'));
    roots.push(root);
    return root;
}

afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('SQLite backup and restore', () => {
    it('does not reissue the persistent WAL mode change for an already-WAL database', () => {
        const database = {
            exec: vi.fn(),
            prepare: vi.fn(() => ({ get: () => ({ journal_mode: 'wal' }) }))
        };

        configureSqliteConnection(database, '/var/lib/foundry/platform.db');

        expect(database.prepare).toHaveBeenCalledWith('PRAGMA journal_mode;');
        expect(database.exec).toHaveBeenCalledWith('PRAGMA synchronous = NORMAL;');
        expect(database.exec.mock.calls.flat().join('\n')).not.toContain('journal_mode = WAL');
    });

    it('captures committed WAL content, verifies it, and restores readable application data', async () => {
        const root = tempRoot();
        const livePath = path.join(root, 'live.db');
        const backupPath = path.join(root, 'backup.db');
        const restoredPath = path.join(root, 'restored.db');
        const live = new LocalSqliteProvider(livePath);
        await live.createUser({
            uid: 'owner', email: 'owner@example.test', displayName: 'Owner', avatarUrl: '',
            role: 'DEVELOPER', createdAt: 1, updatedAt: 1
        });
        await live.createGame({
            id: 'game-one', ownerUid: 'owner', title: 'Recoverable Game', description: '',
            storageMode: 'platform', currentState: 'DRAFT', createdAt: 2, updatedAt: 2
        });

        const backup = createSqliteBackup({ sourcePath: livePath, outputPath: backupPath });
        expect(backup.quickCheck).toBe('ok');
        expect(backup.foreignKeyViolations).toBe(0);
        expect(backup.rowCounts.games).toBe(1);
        expect(backup.schemaMigrations.map(item => item.version)).toEqual([4, 5, 6, 7, 8, 9]);

        const result = restoreSqliteBackup({ backupPath, targetPath: restoredPath });
        expect(result.backup.sha256).toBe(backup.sha256);
        expect(result.restored.quickCheck).toBe('ok');
        const restored = new LocalSqliteProvider(restoredPath);
        expect((await restored.getGame('game-one')).title).toBe('Recoverable Game');
        await restored.close();
        await live.close();
    });

    it('never overwrites an existing backup or restore target', async () => {
        const root = tempRoot();
        const livePath = path.join(root, 'live.db');
        const backupPath = path.join(root, 'backup.db');
        const targetPath = path.join(root, 'target.db');
        const live = new LocalSqliteProvider(livePath);
        createSqliteBackup({ sourcePath: livePath, outputPath: backupPath });
        expect(() => createSqliteBackup({ sourcePath: livePath, outputPath: backupPath })).toThrow('never overwritten');
        fs.writeFileSync(targetPath, 'operator-owned-content');
        expect(() => restoreSqliteBackup({ backupPath, targetPath })).toThrow('never overwrites');
        expect(fs.readFileSync(targetPath, 'utf8')).toBe('operator-owned-content');
        await live.close();
    });

    it('rejects corrupt backup files before creating a restore target', () => {
        const root = tempRoot();
        const corrupt = path.join(root, 'corrupt.db');
        const target = path.join(root, 'target.db');
        fs.writeFileSync(corrupt, 'not sqlite');
        expect(() => verifySqliteDatabase(corrupt)).toThrow();
        expect(() => restoreSqliteBackup({ backupPath: corrupt, targetPath: target })).toThrow();
        expect(fs.existsSync(target)).toBe(false);
    });
});
