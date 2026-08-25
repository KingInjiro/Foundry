import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingManifestLoader } from '../../src/streaming/StreamingManifestLoader';
import { StreamingRuntimeController } from '../../src/streaming/StreamingRuntimeController';
import { ChunkFetcher } from '../../src/streaming/ChunkFetcher';
import { MemoryBudgetManager } from '../../src/streaming/MemoryBudgetManager';
import { StreamingEngineBridge } from '../../src/streaming/EngineBridge';
import { IndexedDBPersistentChunkCache } from '../../src/streaming/IndexedDBPersistentChunkCache';
import { StreamingObservability } from '../../src/streaming/StreamingObservability';
import 'fake-indexeddb/auto';

describe('Phase 3L - Persistent Cache Integration', () => {
    let fetchMock: any;
    let binaries: Record<string, { buffer: ArrayBuffer, hash: string, size: number }>;

    async function createMockBinary(content: string) {
        const buffer = new TextEncoder().encode(content).buffer;
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return { buffer, hash: `sha256-${hashHex}`, size: buffer.byteLength };
    }

    beforeEach(async () => {
        binaries = {
            A: await createMockBinary('chunk-A-data-entry-persistent-test')
        };

        const manifestJson = {
            schemaVersion: 1,
            runtime: { entry: 'chunk-A' },
            chunks: [
                { id: 'chunk-A', url: 'a.bin', size: binaries.A.size, hash: binaries.A.hash, dependencies: [], priority: 'critical', preload: false }
            ]
        };

        fetchMock = vi.fn().mockImplementation(async (url: string) => {
            if (url === 'https://cdn.example.com/manifest.json') {
                return {
                    ok: true,
                    text: async () => JSON.stringify(manifestJson)
                };
            }
            if (url === 'https://cdn.example.com/a.bin') {
                return {
                    ok: true,
                    status: 200,
                    arrayBuffer: async () => binaries.A.buffer.slice(0)
                };
            }
            return { ok: false, status: 404 };
        });

        global.fetch = fetchMock as any;
    });

    afterEach(async () => {
        vi.restoreAllMocks();
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

    it('should fetch from network in session 1, then hit persistent cache in session 2', async () => {
        let events1: any[] = [];
        let events2: any[] = [];
        const obs1 = new StreamingObservability({ emit: e => events1.push(e) });
        const obs2 = new StreamingObservability({ emit: e => events2.push(e) });
        
        // --- Session 1 ---
        const cache1 = new IndexedDBPersistentChunkCache(obs1);
        const loader1 = new StreamingManifestLoader(obs1);
        const manifest1 = await loader1.load('https://cdn.example.com/manifest.json');
        
        const fetcher1 = new ChunkFetcher(manifest1, 'https://cdn.example.com', 4, obs1, cache1);
        const budget1 = new MemoryBudgetManager({ maxMemoryBytes: 10 * 1024 * 1024, observability: obs1 });
        const controller1 = new StreamingRuntimeController(manifest1, fetcher1, budget1, obs1);
        const bridge1 = new StreamingEngineBridge(controller1, budget1, new Map([['a.bin', 'chunk-A']]));
        
        await controller1.initialize();
        const handle1 = await bridge1.requestChunk('a.bin');
        
        // Wait a tiny bit for the async write to persistent cache to complete, since we didn't await it in ChunkFetcher
        await new Promise(r => setTimeout(r, 50));
        
        expect(handle1.data.byteLength).toBe(binaries.A.size);
        
        // Verify session 1 went to network
        expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/a.bin', expect.any(Object));
        expect(events1).toContainEqual(expect.objectContaining({ type: 'PERSISTENT_CACHE_MISS' }));
        expect(events1).toContainEqual(expect.objectContaining({ type: 'PERSISTENT_CACHE_WRITE' }));
        
        fetchMock.mockClear();
        await controller1.dispose();

        // --- Session 2 ---
        // Manually close the db promise to avoid sharing connection across tests/sessions cleanly if needed,
        // although we can just re-instantiate it.
        if ((cache1 as any).dbPromise) {
            (await (cache1 as any).dbPromise).close();
        }

        const cache2 = new IndexedDBPersistentChunkCache(obs2);
        const fetcher2 = new ChunkFetcher(manifest1, 'https://cdn.example.com', 4, obs2, cache2);
        const budget2 = new MemoryBudgetManager({ maxMemoryBytes: 10 * 1024 * 1024, observability: obs2 });
        const controller2 = new StreamingRuntimeController(manifest1, fetcher2, budget2, obs2);
        const bridge2 = new StreamingEngineBridge(controller2, budget2, new Map([['a.bin', 'chunk-A']]));
        
        await controller2.initialize();
        const handle2 = await bridge2.requestChunk('a.bin');
        
        expect(handle2.data.byteLength).toBe(binaries.A.size);
        
        // Verify session 2 did NOT go to network for a.bin
        expect(fetchMock).not.toHaveBeenCalledWith('https://cdn.example.com/a.bin', expect.any(Object));
        expect(events2).toContainEqual(expect.objectContaining({ type: 'PERSISTENT_CACHE_HIT' }));
        
        await controller2.dispose();
        if ((cache2 as any).dbPromise) {
            (await (cache2 as any).dbPromise).close();
        }
    });
});
