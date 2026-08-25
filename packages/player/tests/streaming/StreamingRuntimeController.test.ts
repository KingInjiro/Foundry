import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamingRuntimeController } from '../../src/streaming/StreamingRuntimeController';
import { ChunkFetcher } from '../../src/streaming/ChunkFetcher';
import { MemoryBudgetManager } from '../../src/streaming/MemoryBudgetManager';
import { StreamingRuntimeManifest } from '../../src/streaming/StreamingManifestLoader';

describe('StreamingRuntimeController', () => {
    let mockManifest: StreamingRuntimeManifest;
    let mockFetcher: any;
    let mockMemoryManager: any;
    let controller: StreamingRuntimeController;

    beforeEach(() => {
        mockManifest = {
            schemaVersion: 1,
            runtime: { entry: 'chunk-entry' },
            chunks: new Map([
                ['chunk-entry', { id: 'chunk-entry', url: 'entry.bin', size: 100, hash: 'h1', dependencies: [], priority: 'high', preload: false }],
                ['chunk-pre', { id: 'chunk-pre', url: 'pre.bin', size: 100, hash: 'h2', dependencies: [], priority: 'low', preload: true }],
                ['chunk-opt', { id: 'chunk-opt', url: 'opt.bin', size: 100, hash: 'h3', dependencies: [], priority: 'low', preload: false }]
            ]),
            dependencies: new Map()
        } as unknown as StreamingRuntimeManifest;

        mockFetcher = {
            fetchChunk: vi.fn().mockImplementation(async (id) => ({ id, data: new ArrayBuffer(100), size: 100, sha256: 'mock' }))
        };

        mockMemoryManager = {
            insert: vi.fn(),
            getSnapshot: vi.fn().mockReturnValue({ maxMemoryBytes: 1000, currentMemoryBytes: 0 })
        };

        controller = new StreamingRuntimeController(mockManifest, mockFetcher as unknown as ChunkFetcher, mockMemoryManager as unknown as MemoryBudgetManager);
    });

    it('initializes and requests the entry chunk', async () => {
        expect(controller.getStatus().state).toBe('CREATED');
        await controller.initialize();
        await new Promise(r => setTimeout(r, 10)); // let background preloads settle
        
        expect(controller.getStatus().state).toBe('READY');
        expect(mockFetcher.fetchChunk).toHaveBeenCalledWith('chunk-entry', expect.anything());
        // Since we await, the preload chunk-pre also finishes
        expect(mockMemoryManager.insert).toHaveBeenCalledTimes(2);
        
        // Assert chunk-entry was inserted
        const calls = mockMemoryManager.insert.mock.calls.map((c: any) => c[0].id);
        expect(calls).toContain('chunk-entry');
        expect(calls).toContain('chunk-pre');
    });

    it('starts background preload for chunks marked with preload: true', async () => {
        await controller.initialize();
        
        await new Promise(r => setTimeout(r, 10));
        
        expect(mockFetcher.fetchChunk).toHaveBeenCalledWith('chunk-pre', expect.anything());
        expect(mockFetcher.fetchChunk).not.toHaveBeenCalledWith('chunk-opt', expect.anything());
    });

    it('can request chunks explicitly', async () => {
        await controller.initialize();
        await new Promise(r => setTimeout(r, 10)); // clear background preloads
        
        mockFetcher.fetchChunk.mockClear();
        mockMemoryManager.insert.mockClear();
        
        await controller.requestChunk('chunk-opt');
        
        expect(mockFetcher.fetchChunk).toHaveBeenCalledWith('chunk-opt', expect.anything());
        expect(mockMemoryManager.insert).toHaveBeenCalledTimes(1);
    });

    it('deduplicates simultaneous requests for the same chunk', async () => {
        await controller.initialize();
        await new Promise(r => setTimeout(r, 10)); // clear background preloads
        
        mockFetcher.fetchChunk.mockClear();
        mockMemoryManager.insert.mockClear();

        // Slow down fetcher
        let resolveFetch: any;
        mockFetcher.fetchChunk.mockImplementationOnce(() => new Promise(r => { resolveFetch = r; }));
        
        const p1 = controller.requestChunk('chunk-opt');
        const p2 = controller.requestChunk('chunk-opt');
        
        resolveFetch({ id: 'chunk-opt', data: new ArrayBuffer(100), size: 100, sha256: 'mock' });
        await Promise.all([p1, p2]);
        
        const fetchCalls = mockFetcher.fetchChunk.mock.calls.filter((c: any) => c[0] === 'chunk-opt');
        expect(fetchCalls.length).toBe(1); // excluding initialize
        expect(mockMemoryManager.insert).toHaveBeenCalledTimes(1);
    });

    it('disposes correctly', async () => {
        controller.dispose();
        expect(controller.getStatus().state).toBe('DISPOSED');
        
        await expect(controller.initialize()).rejects.toThrow();
        await expect(controller.requestChunk('chunk-opt')).rejects.toThrow();
    });

    it('records failed chunks on fetch failure', async () => {
        await controller.initialize();
        await new Promise(r => setTimeout(r, 10));
        
        mockFetcher.fetchChunk.mockRejectedValueOnce(new Error('Network Error'));
        
        await expect(controller.requestChunk('chunk-opt')).rejects.toThrow('Network Error');
        
        expect(controller.getStatus().failedChunkCount).toBe(1);
    });
});
