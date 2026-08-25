import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexedDBPersistentChunkCache } from '../../src/streaming/IndexedDBPersistentChunkCache';
import { PersistentChunkEntry } from '../../src/streaming/PersistentChunkCache';
import { StreamingObservability } from '../../src/streaming/StreamingObservability';
import 'fake-indexeddb/auto';

describe('IndexedDBPersistentChunkCache', () => {
    let cache: IndexedDBPersistentChunkCache;
    let observability: StreamingObservability;
    let events: any[] = [];

    beforeEach(async () => {
        observability = new StreamingObservability({
            emit: (event) => events.push({ event: event.type, data: event.metadata })
        });
        cache = new IndexedDBPersistentChunkCache(observability);
        events = [];
    });

    afterEach(async () => {
        // Close db if open
        if ((cache as any).dbPromise) {
            const db = await (cache as any).dbPromise;
            db.close();
        }
        // Clear IDB state between tests
        const dbs = await (indexedDB as any).databases();
        for (const db of dbs) {
            await new Promise((resolve) => {
                const req = indexedDB.deleteDatabase(db.name);
                req.onsuccess = resolve;
                req.onerror = resolve;
                req.onblocked = resolve;
            });
        }
    });

    it('should return null for missing entry', async () => {
        const result = await cache.get('nonexistent');
        expect(result).toBeNull();
        expect(events).toContainEqual(expect.objectContaining({ event: 'PERSISTENT_CACHE_MISS', data: { cacheKey: 'nonexistent' } }));
    });

    it('should store and retrieve an entry', async () => {
        const entry: PersistentChunkEntry = {
            cacheKey: 'test-key',
            cdnBaseUrl: 'https://cdn.example.com',
            chunkId: 'chunk1',
            sha256: 'sha256-abcdef',
            size: 10,
            data: new ArrayBuffer(10)
        };

        await cache.put(entry);
        expect(events).toContainEqual(expect.objectContaining({ event: 'PERSISTENT_CACHE_WRITE' }));

        const result = await cache.get('test-key');
        expect(result).not.toBeNull();
        expect(result?.cacheKey).toBe('test-key');
        expect(events).toContainEqual(expect.objectContaining({ event: 'PERSISTENT_CACHE_HIT' }));
    });

    it('should delete an entry', async () => {
        const entry: PersistentChunkEntry = {
            cacheKey: 'test-key',
            cdnBaseUrl: 'https://cdn.example.com',
            chunkId: 'chunk1',
            sha256: 'sha256-abcdef',
            size: 10,
            data: new ArrayBuffer(10)
        };

        await cache.put(entry);
        await cache.delete('test-key');
        expect(events).toContainEqual(expect.objectContaining({ event: 'PERSISTENT_CACHE_DELETE' }));

        const result = await cache.get('test-key');
        expect(result).toBeNull();
    });

    it('should clear entries by prefix', async () => {
        await cache.put({ cacheKey: 'v1|chunk1', cdnBaseUrl: 'v1', chunkId: '1', sha256: 'a', size: 1, data: new ArrayBuffer(1) });
        await cache.put({ cacheKey: 'v1|chunk2', cdnBaseUrl: 'v1', chunkId: '2', sha256: 'b', size: 1, data: new ArrayBuffer(1) });
        await cache.put({ cacheKey: 'v2|chunk1', cdnBaseUrl: 'v2', chunkId: '1', sha256: 'c', size: 1, data: new ArrayBuffer(1) });

        await cache.clearPrefix('v1');
        
        expect(await cache.get('v1|chunk1')).toBeNull();
        expect(await cache.get('v1|chunk2')).toBeNull();
        expect(await cache.get('v2|chunk1')).not.toBeNull();
        
        expect(events).toContainEqual(expect.objectContaining({ event: 'PERSISTENT_CACHE_CLEAR_PREFIX', data: { prefix: 'v1' } }));
    });
});
