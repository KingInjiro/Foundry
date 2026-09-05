import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingManifestLoader } from '../../src/streaming/StreamingManifestLoader';
import { StreamingRuntimeController } from '../../src/streaming/StreamingRuntimeController';
import { ChunkFetcher } from '../../src/streaming/ChunkFetcher';
import { MemoryBudgetManager } from '../../src/streaming/MemoryBudgetManager';
import { IndexedDBPersistentChunkCache } from '../../src/streaming/IndexedDBPersistentChunkCache';
import { StreamingObservability } from '../../src/streaming/StreamingObservability';
import 'fake-indexeddb/auto';

describe('Phase 3N - Prefetch Integration', () => {
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
            entry: await createMockBinary('entry-data'),
            A: await createMockBinary('chunk-A-data'),
            B: await createMockBinary('chunk-B-data'),
            C: await createMockBinary('chunk-C-data')
        };

        const manifestJson = {
            schemaVersion: 1,
            runtime: { entry: 'entry' },
            chunks: [
                { id: 'entry', url: 'entry.bin', size: binaries.entry.size, hash: binaries.entry.hash, dependencies: [], priority: 'critical', preload: false },
                { id: 'chunk-A', url: 'a.bin', size: binaries.A.size, hash: binaries.A.hash, dependencies: [{ chunkId: 'chunk-B', required: true }], priority: 'high', preload: true },
                { id: 'chunk-B', url: 'b.bin', size: binaries.B.size, hash: binaries.B.hash, dependencies: [], priority: 'medium', preload: false },
                { id: 'chunk-C', url: 'c.bin', size: binaries.C.size, hash: binaries.C.hash, dependencies: [], priority: 'low', preload: false }
            ]
        };

        fetchMock = vi.fn().mockImplementation(async (url: string) => {
            if (url === 'https://cdn.example.com/manifest.json') {
                return { ok: true, text: async () => JSON.stringify(manifestJson) };
            }
            if (url === 'https://cdn.example.com/entry.bin') return { ok: true, status: 200, arrayBuffer: async () => binaries.entry.buffer.slice(0) };
            if (url === 'https://cdn.example.com/a.bin') return { ok: true, status: 200, arrayBuffer: async () => binaries.A.buffer.slice(0) };
            if (url === 'https://cdn.example.com/b.bin') return { ok: true, status: 200, arrayBuffer: async () => binaries.B.buffer.slice(0) };
            if (url === 'https://cdn.example.com/c.bin') return { ok: true, status: 200, arrayBuffer: async () => binaries.C.buffer.slice(0) };
            return { ok: false, status: 404 };
        });

        global.fetch = fetchMock as any;
    });

    afterEach(async () => {
        vi.restoreAllMocks();
    });

    it('should prefetch candidates and dependencies in background during initialization', async () => {
        let events: any[] = [];
        const obs = new StreamingObservability({ emit: e => events.push(e) });
        
        const loader = new StreamingManifestLoader(obs);
        const manifest = await loader.load('https://cdn.example.com/manifest.json');
        
        const idb = new IndexedDBPersistentChunkCache(obs);
        const fetcher = new ChunkFetcher(manifest, 'https://cdn.example.com', 4, obs, idb);
        const budget = new MemoryBudgetManager({ maxMemoryBytes: 10 * 1024 * 1024, observability: obs });
        const controller = new StreamingRuntimeController(manifest, fetcher, budget, obs);
        
        try {
            await controller.initialize();

            // Entry is foreground work, while A and its dependency B are
            // intentionally scheduled in the background. Synchronize on the
            // observable completion condition instead of guessing a wall-clock
            // delay that becomes flaky when workspace tests run concurrently.
            await vi.waitFor(() => {
                expect(controller.getStatus().loadedChunkCount).toBe(3);
            }, { timeout: 2_000, interval: 10 });

            // Verify C wasn't fetched (not preloaded, not a dependency)
            expect(fetchMock).not.toHaveBeenCalledWith('https://cdn.example.com/c.bin', expect.anything());
        } finally {
            await controller.dispose();
        }
    });
});
