import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingManifestLoader } from '../../src/streaming/StreamingManifestLoader';
import { StreamingRuntimeController } from '../../src/streaming/StreamingRuntimeController';
import { ChunkFetcher } from '../../src/streaming/ChunkFetcher';
import { MemoryBudgetManager } from '../../src/streaming/MemoryBudgetManager';
import { StreamingEngineBridge } from '../../src/streaming/EngineBridge';
import { IndexedDBPersistentChunkCache } from '../../src/streaming/IndexedDBPersistentChunkCache';
import { PersistentStorageEvictionController } from '../../src/streaming/PersistentStorageEvictionController';
import { StreamingObservability } from '../../src/streaming/StreamingObservability';
import 'fake-indexeddb/auto';

describe('Phase 3M - Eviction Controller Integration', () => {
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
            A: await createMockBinary('chunk-A-data-entry-persistent-test-1'),
            B: await createMockBinary('chunk-B-data-entry-persistent-test-2'),
            C: await createMockBinary('chunk-C-data-entry-persistent-test-3')
        };

        const manifestJson = {
            schemaVersion: 1,
            runtime: { entry: 'chunk-A' },
            chunks: [
                { id: 'chunk-A', url: 'a.bin', size: binaries.A.size, hash: binaries.A.hash, dependencies: [], priority: 'critical', preload: false },
                { id: 'chunk-B', url: 'b.bin', size: binaries.B.size, hash: binaries.B.hash, dependencies: [], priority: 'critical', preload: false },
                { id: 'chunk-C', url: 'c.bin', size: binaries.C.size, hash: binaries.C.hash, dependencies: [], priority: 'critical', preload: false }
            ]
        };

        fetchMock = vi.fn().mockImplementation(async (url: string) => {
            if (url === 'https://cdn.example.com/manifest.json') {
                return {
                    ok: true,
                    text: async () => JSON.stringify(manifestJson)
                };
            }
            if (url === 'https://cdn.example.com/a.bin') return { ok: true, status: 200, arrayBuffer: async () => binaries.A.buffer.slice(0) };
            if (url === 'https://cdn.example.com/b.bin') return { ok: true, status: 200, arrayBuffer: async () => binaries.B.buffer.slice(0) };
            if (url === 'https://cdn.example.com/c.bin') return { ok: true, status: 200, arrayBuffer: async () => binaries.C.buffer.slice(0) };
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

    it('should evict older chunks from persistent storage when budget is exceeded', async () => {
        let events: any[] = [];
        const obs = new StreamingObservability({ emit: e => events.push(e) });
        
        const idbCache = new IndexedDBPersistentChunkCache(obs);
        // Budget is slightly less than 3 chunks (A + B + C = ~114 bytes)
        // Set budget to 100 bytes, enough for 2 chunks but not 3.
        const evictionController = new PersistentStorageEvictionController(idbCache, { maxPersistentBytes: 100, observability: obs });
        
        const loader = new StreamingManifestLoader(obs);
        const manifest = await loader.load('https://cdn.example.com/manifest.json');
        
        const fetcher = new ChunkFetcher(manifest, 'https://cdn.example.com', 4, obs, evictionController);
        const budget = new MemoryBudgetManager({ maxMemoryBytes: 10 * 1024 * 1024, observability: obs });
        const controller = new StreamingRuntimeController(manifest, fetcher, budget, obs);
        const bridge = new StreamingEngineBridge(controller, budget, new Map([
            ['a.bin', 'chunk-A'],
            ['b.bin', 'chunk-B'],
            ['c.bin', 'chunk-C']
        ]));
        
        await controller.initialize();
        
        const h1 = await bridge.requestChunk('a.bin'); h1.release();
        await new Promise(r => setTimeout(r, 50));
        
        const h2 = await bridge.requestChunk('b.bin'); h2.release();
        await new Promise(r => setTimeout(r, 50));
        
        // A and B are now in cache. Total size ~ 76 bytes. Fits in 100.
        expect(evictionController.getTrackedPersistentBytes()).toBeLessThanOrEqual(100);
        
        // Request C. A is the oldest. It should be evicted from persistent cache.
        const h3 = await bridge.requestChunk('c.bin'); h3.release();
        await new Promise(r => setTimeout(r, 50));
        
        expect(evictionController.getTrackedPersistentBytes()).toBeLessThanOrEqual(100);
        
        // Verify eviction event fired
        expect(events).toContainEqual(expect.objectContaining({ type: 'PERSISTENT_STORAGE_EVICTION', metadata: expect.objectContaining({ cacheKey: expect.stringContaining('chunk-A') }) }));
        
        await controller.dispose();
        evictionController.dispose();
    });
});
