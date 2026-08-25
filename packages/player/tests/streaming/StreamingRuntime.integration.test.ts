import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingManifestLoader } from '../../src/streaming/StreamingManifestLoader';
import { StreamingRuntimeController } from '../../src/streaming/StreamingRuntimeController';
import { ChunkFetcher, ChunkIntegrityError, ChunkFetchAbortedError } from '../../src/streaming/ChunkFetcher';
import { MemoryBudgetManager, ChunkMemoryBudgetExceededError } from '../../src/streaming/MemoryBudgetManager';
import { StreamingEngineBridge } from '../../src/streaming/EngineBridge';

describe('End-to-End Streaming Runtime Verification', () => {
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
            A: await createMockBinary('chunk-A-data-entry'),
            B: await createMockBinary('chunk-B-data-dep-of-A'),
            C: await createMockBinary('chunk-C-data-dep-of-A'),
            D: await createMockBinary('chunk-D-data-dep-of-B'),
            E: await createMockBinary('chunk-E-data-unrelated'),
            F: await createMockBinary('chunk-F-data-preload'),
            X: await createMockBinary('chunk-X-20-bytes-12345'),
            Y: await createMockBinary('chunk-Y-20-bytes-12345'),
            Z: await createMockBinary('chunk-Z-20-bytes-12345')
        };

        const manifestJson = {
            schemaVersion: 1,
            runtime: { entry: 'chunk-A' },
            chunks: [
                { id: 'chunk-A', url: 'a.bin', size: binaries.A.size, hash: binaries.A.hash, dependencies: [{chunkId: 'chunk-B', required: true}, {chunkId: 'chunk-C', required: true}], priority: 'critical', preload: false },
                { id: 'chunk-B', url: 'b.bin', size: binaries.B.size, hash: binaries.B.hash, dependencies: [{chunkId: 'chunk-D', required: true}], priority: 'high', preload: false },
                { id: 'chunk-C', url: 'c.bin', size: binaries.C.size, hash: binaries.C.hash, dependencies: [], priority: 'high', preload: false },
                { id: 'chunk-D', url: 'd.bin', size: binaries.D.size, hash: binaries.D.hash, dependencies: [], priority: 'medium', preload: false },
                { id: 'chunk-E', url: 'e.bin', size: binaries.E.size, hash: binaries.E.hash, dependencies: [], priority: 'low', preload: false },
                { id: 'chunk-F', url: 'f.bin', size: binaries.F.size, hash: binaries.F.hash, dependencies: [], priority: 'low', preload: true }
            ]
        };

        fetchMock = vi.fn().mockImplementation(async (url: string) => {
            if (url.endsWith('manifest.json')) {
                return { 
                    ok: true, 
                    json: async () => manifestJson,
                    text: async () => JSON.stringify(manifestJson)
                };
            }
            const idMap: Record<string, string> = {
                'a.bin': 'A', 'b.bin': 'B', 'c.bin': 'C', 'd.bin': 'D', 'e.bin': 'E', 'f.bin': 'F'
            };
            const key = url.split('/').pop()!;
            const binId = idMap[key];
            
            if (!binId) return { ok: false, status: 404 };
            
            return {
                ok: true,
                status: 200,
                arrayBuffer: async () => binaries[binId].buffer.slice(0)
            };
        });
        global.fetch = fetchMock;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // 1. Dependency Closure, Preload, and Shared Dependency
    it('verifies manifest load, dependency closure, and preload', async () => {
        const loader = new StreamingManifestLoader();
        const manifest = await loader.load('https://cdn.example.com/manifest.json');
        
        const fetcher = new ChunkFetcher(manifest, 'https://cdn.example.com');
        const memoryManager = new MemoryBudgetManager({ maxMemoryBytes: 1024 * 1024 });
        const controller = new StreamingRuntimeController(manifest, fetcher, memoryManager);

        await controller.initialize();
        
        // wait for background tasks
        await new Promise(r => setTimeout(r, 50));

        const status = controller.getStatus();
        expect(status.state).toBe('READY');
        
        // Loaded: A, B, C, D, F
        expect(status.loadedChunkCount).toBe(5);
        expect(status.failedChunkCount).toBe(0);
        
        const fetchedUrls = fetchMock.mock.calls.map((c: any) => c[0]);
        expect(fetchedUrls).toContain('https://cdn.example.com/a.bin');
        expect(fetchedUrls).toContain('https://cdn.example.com/b.bin');
        expect(fetchedUrls).toContain('https://cdn.example.com/c.bin');
        expect(fetchedUrls).toContain('https://cdn.example.com/d.bin');
        expect(fetchedUrls).toContain('https://cdn.example.com/f.bin');
        expect(fetchedUrls).not.toContain('https://cdn.example.com/e.bin');
        
        // Test deduplication and Shared Dependency
        // If we request C (which is already loaded as a dependency of A), it should return immediately without fetching again
        await controller.requestChunk('chunk-C');
        const cRequests = fetchMock.mock.calls.filter((c: any) => c[0].endsWith('c.bin'));
        expect(cRequests.length).toBe(1);
    });

    // 2. Integrity Test
    it('verifies ChunkIntegrityError on corrupted payload and protects memory', async () => {
        const loader = new StreamingManifestLoader();
        const manifest = await loader.load('https://cdn.example.com/manifest.json');
        const fetcher = new ChunkFetcher(manifest, 'https://cdn.example.com');
        const memoryManager = new MemoryBudgetManager({ maxMemoryBytes: 1024 * 1024 });
        const controller = new StreamingRuntimeController(manifest, fetcher, memoryManager);
        await controller.initialize();

        fetchMock.mockImplementation(async (url: string, init?: any) => {
            if (url.endsWith('e.bin')) {
                const badBuffer = new TextEncoder().encode('corrupted data').buffer;
                return { ok: true, status: 200, arrayBuffer: async () => badBuffer };
            }
            return { ok: false, status: 404 };
        });

        await expect(controller.requestChunk('chunk-E')).rejects.toThrow(ChunkIntegrityError);

        const status = controller.getStatus();
        expect(status.failedChunkCount).toBe(1);
        
        expect(() => memoryManager.acquire('chunk-E')).toThrow('Chunk chunk-E not found in memory');
    });

    // 3. Memory Ownership and Engine Bridge Test
    it('verifies end-to-end memory ownership via EngineBridge', async () => {
        const loader = new StreamingManifestLoader();
        const manifest = await loader.load('https://cdn.example.com/manifest.json');
        const fetcher = new ChunkFetcher(manifest, 'https://cdn.example.com');
        const memoryManager = new MemoryBudgetManager({ maxMemoryBytes: 1024 * 1024 });
        const controller = new StreamingRuntimeController(manifest, fetcher, memoryManager);
        
        const urlMap = new Map([['assets/model.gltf', 'chunk-E']]);
        const bridge = new StreamingEngineBridge(controller, memoryManager, urlMap);
        
        await controller.initialize();

        const handle = await bridge.requestChunk('assets/model.gltf');
        
        expect(handle.id).toBe('chunk-E');
        expect(handle.data.byteLength).toBe(binaries.E.size);
        
        const snapshot1 = memoryManager.getSnapshot();
        
        handle.release();
        
        const snapshot2 = memoryManager.getSnapshot();
        expect(snapshot1.currentMemoryBytes).toBe(snapshot2.currentMemoryBytes);
    });

    // 4. Eviction Test
    it('verifies LRU eviction and memory budget bounds', async () => {
        const smallManifestJson = {
            schemaVersion: 1,
            runtime: { entry: 'chunk-X' },
            chunks: [
                { id: 'chunk-X', url: 'x.bin', size: binaries.X.size, hash: binaries.X.hash, dependencies: [], priority: 'low', preload: false },
                { id: 'chunk-Y', url: 'y.bin', size: binaries.Y.size, hash: binaries.Y.hash, dependencies: [], priority: 'low', preload: false },
                { id: 'chunk-Z', url: 'z.bin', size: binaries.Z.size, hash: binaries.Z.hash, dependencies: [], priority: 'low', preload: false }
            ]
        };
        fetchMock.mockImplementation(async (url: string) => {
            if (url.endsWith('manifest2.json')) {
                return { 
                    ok: true, 
                    json: async () => smallManifestJson,
                    text: async () => JSON.stringify(smallManifestJson)
                };
            }
            const key = url.split('/').pop()!;
            const binId = {'x.bin':'X', 'y.bin':'Y', 'z.bin':'Z'}[key];
            return { ok: true, status: 200, arrayBuffer: async () => binaries[binId!].buffer.slice(0) };
        });

        const loader = new StreamingManifestLoader();
        const manifest = await loader.load('https://cdn.example.com/manifest2.json');
        const fetcher = new ChunkFetcher(manifest, 'https://cdn.example.com');
        
        const memoryManager = new MemoryBudgetManager({ maxMemoryBytes: 50 });
        const controller = new StreamingRuntimeController(manifest, fetcher, memoryManager);
        await controller.initialize(); // loads X (20 bytes).
        
        const urlMap = new Map([['x', 'chunk-X'], ['y', 'chunk-Y'], ['z', 'chunk-Z']]);
        const bridge = new StreamingEngineBridge(controller, memoryManager, urlMap);
        
        const handleX = await bridge.requestChunk('x');
        const handleY = await bridge.requestChunk('y');
        
        // X(20) + Y(20) = 40. Z(20) will exceed 50. X and Y are locked!
        await expect(bridge.requestChunk('z')).rejects.toThrow(ChunkMemoryBudgetExceededError);
        
        // Release X
        handleX.release();
        
        // Try Z again
        const handleZ = await bridge.requestChunk('z');
        expect(handleZ.id).toBe('chunk-Z');
        
        const snap = memoryManager.getSnapshot();
        expect(snap.currentMemoryBytes).toBe(44); // Y and Z
    });

    // 5. Controller Failure and Retry (Timeout/Abort)
    it('verifies network failure allows retry and cleans up in-flight state', async () => {
        const loader = new StreamingManifestLoader();
        const manifest = await loader.load('https://cdn.example.com/manifest.json');
        const fetcher = new ChunkFetcher(manifest, 'https://cdn.example.com');
        const memoryManager = new MemoryBudgetManager({ maxMemoryBytes: 1024 * 1024 });
        const controller = new StreamingRuntimeController(manifest, fetcher, memoryManager);
        await controller.initialize();

        let callCount = 0;
        fetchMock.mockImplementation(async (url: string) => {
            if (url.endsWith('e.bin')) {
                callCount++;
                if (callCount === 1) throw new Error('Simulated Network Timeout');
                return { ok: true, status: 200, arrayBuffer: async () => binaries.E.buffer.slice(0) };
            }
            return { ok: false, status: 404 };
        });

        await expect(controller.requestChunk('chunk-E')).rejects.toThrow('Network error while fetching chunk-E: Simulated Network Timeout');
        expect(controller.getStatus().failedChunkCount).toBe(1);

        await controller.requestChunk('chunk-E'); // retry
        expect(controller.getStatus().failedChunkCount).toBe(0); // cleared on success
        expect(memoryManager.acquire('chunk-E').id).toBe('chunk-E');
    });
    
    // 6. Abort via Dispose Test
    it('verifies controller disposal prevents new requests and aborts in-flight', async () => {
        const loader = new StreamingManifestLoader();
        const manifest = await loader.load('https://cdn.example.com/manifest.json');
        const fetcher = new ChunkFetcher(manifest, 'https://cdn.example.com');
        const memoryManager = new MemoryBudgetManager({ maxMemoryBytes: 1024 * 1024 });
        const controller = new StreamingRuntimeController(manifest, fetcher, memoryManager);
        await controller.initialize();

        fetchMock.mockImplementation(async (url: string) => {
            if (url.endsWith('e.bin')) return new Promise((_, reject) => {
                if (init?.signal) {
                    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
                }
            });
            return { ok: false, status: 404 };
        });

        const promise = controller.requestChunk('chunk-E');
        controller.dispose();
        
        await expect(promise).rejects.toThrow(ChunkFetchAbortedError);
        await expect(controller.requestChunk('chunk-E')).rejects.toThrow('Controller is disposed');
    });
});
