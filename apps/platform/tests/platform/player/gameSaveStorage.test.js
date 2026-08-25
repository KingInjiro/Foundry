import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
    GameSaveStorage,
    createGameSaveKey
} from '../../../src/platform/player/gameSaveStorage.js';

function createStorage(options = {}) {
    return new GameSaveStorage({
        indexedDBFactory: new IDBFactory(),
        dbName: `FoundryPlatformSaves-${crypto.randomUUID()}`,
        ...options
    });
}

describe('GameSaveStorage', () => {
    it('round-trips a save and isolates it by viewer and published version', async () => {
        const storage = createStorage();
        const firstKey = createGameSaveKey({ viewerId: 'user-a', gameId: 'game-1', versionId: 'version-1' });
        const otherViewerKey = createGameSaveKey({ viewerId: 'user-b', gameId: 'game-1', versionId: 'version-1' });
        const otherVersionKey = createGameSaveKey({ viewerId: 'user-a', gameId: 'game-1', versionId: 'version-2' });

        await storage.save(firstKey, '{"checkpoint":3}');

        expect(await storage.load(firstKey)).toBe('{"checkpoint":3}');
        expect(await storage.load(otherViewerKey)).toBeNull();
        expect(await storage.load(otherVersionKey)).toBeNull();
        await storage.close();
    });

    it('serializes concurrent writes so the newest autosave wins', async () => {
        const storage = createStorage();
        const key = createGameSaveKey({ viewerId: 'guest', gameId: 'game-1', versionId: 'version-1' });

        await Promise.all([
            storage.save(key, 'older'),
            storage.save(key, 'newer')
        ]);

        expect(await storage.load(key)).toBe('newer');
        await storage.close();
    });

    it('uses UTF-8 byte limits and supports explicit removal', async () => {
        const storage = createStorage({ maxBytes: 6 });
        const key = createGameSaveKey({ viewerId: 'guest', gameId: 'game-1', versionId: 'version-1' });

        await storage.save(key, '€€');
        expect(await storage.load(key)).toBe('€€');
        await expect(storage.save(key, '€€€')).rejects.toThrow('6-byte limit');
        await storage.remove(key);
        expect(await storage.load(key)).toBeNull();
        await storage.close();
    });

    it('fails safely when IndexedDB is unavailable', async () => {
        const storage = new GameSaveStorage({ indexedDBFactory: null });
        const key = createGameSaveKey({ viewerId: 'guest', gameId: 'game-1', versionId: 'version-1' });
        await expect(storage.load(key)).rejects.toThrow('unavailable');
    });
});
