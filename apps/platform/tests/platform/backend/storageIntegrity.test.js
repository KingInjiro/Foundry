import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';
import { LocalDiskStorageProvider } from '../../../src/platform/backend/storage/LocalDiskStorageProvider.js';
import { checkStorageIntegrity } from '../../../src/platform/backend/storage/StorageIntegrityChecker.js';

const roots = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

describe('DB and object-storage integrity', () => {
    it('checks required runtime objects, reports orphans, and never deletes them', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-integrity-'));
        roots.push(root);
        const db = new LocalSqliteProvider(path.join(root, 'platform.db'));
        const storage = new LocalDiskStorageProvider(path.join(root, 'storage'));
        const now = Date.now();
        await db.createUser({ uid: 'owner', email: '', displayName: 'Owner', avatarUrl: '', role: 'DEVELOPER', createdAt: now, updatedAt: now });
        await db.createGame({ id: 'game', ownerUid: 'owner', title: 'Game', description: '', storageMode: 'platform', currentState: 'PUBLISHED', createdAt: now, updatedAt: now });
        await db.createGameVersion({ id: 'version', gameId: 'game', version: '1.0.0', runtime: 'foundry', format: 'foundry-game', entry: 'index.html', status: 'PUBLISHED', createdAt: now });
        await db.updateGameVersionMetadata('version', {
            runtimeUrl: '/api/cdn/games/game/versions/version/extracted',
            streamingManifestPath: 'streaming-manifest.json',
            publishedAt: now
        });
        await storage.uploadBuffer('games/game/versions/version/extracted/index.html', Buffer.from('ready'));
        await storage.uploadBuffer('games/game/versions/version/extracted/streaming-manifest.json', Buffer.from('{}'));
        await storage.uploadBuffer('games/orphan/unused.bin', Buffer.from('orphan'));

        const healthy = await checkStorageIntegrity(db, storage);
        expect(healthy.status).toBe('PASS');
        expect(healthy.orphanCandidates).toEqual([expect.objectContaining({ key: 'games/orphan/unused.bin' })]);
        expect(fs.existsSync(path.join(root, 'storage/games/orphan/unused.bin'))).toBe(true);

        await storage.deleteObject('games/game/versions/version/extracted/index.html');
        const broken = await checkStorageIntegrity(db, storage);
        expect(broken.status).toBe('FAIL');
        expect(broken.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_STORAGE_OBJECT', kind: 'runtime-entry' }));
        await db.close();
    });
});
