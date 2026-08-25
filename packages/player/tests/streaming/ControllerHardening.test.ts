import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamingRuntimeController } from '../../src/streaming/StreamingRuntimeController';
import { MemoryBudgetManager } from '../../src/streaming/MemoryBudgetManager';
import { StreamingRuntimeManifest } from '../../src/streaming/StreamingManifestLoader';
import { ChunkFetchAbortedError } from '../../src/streaming/ChunkFetcher';

describe('StreamingRuntimeController Hardening', () => {
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
                ['chunk-A', { id: 'chunk-A', url: 'a.bin', size: 10, hash: 'hA', dependencies: [], priority: 'high', preload: false }]
            ]),
            dependencies: new Map()
        } as unknown as StreamingRuntimeManifest;

        mockFetcher = {
            fetchChunk: vi.fn().mockImplementation(async (id, options) => {
                return new Promise((resolve, reject) => {
                    if (options?.signal?.aborted) return reject(new ChunkFetchAbortedError('aborted'));
                    options?.signal?.addEventListener('abort', () => reject(new ChunkFetchAbortedError('aborted')));
                    // simulate async delay
                    setTimeout(() => resolve({ id, data: new ArrayBuffer(10), size: 10, sha256: 'mock' }), 10);
                });
            })
        };

        mockMemoryManager = {
            insert: vi.fn(),
            acquire: vi.fn(),
            getSnapshot: vi.fn().mockReturnValue({ maxMemoryBytes: 1000, currentMemoryBytes: 0 })
        };

        controller = new StreamingRuntimeController(
            mockManifest, 
            mockFetcher as any, 
            mockMemoryManager as any
        );
    });

    it('prevents multiple initialize calls', async () => {
        await controller.initialize();
        await expect(controller.initialize()).rejects.toThrow('Controller can only be initialized once');
    });

    it('rejects new requests if disposed', async () => {
        await controller.initialize();
        controller.dispose();
        await expect(controller.requestChunk('chunk-A')).rejects.toThrow('Controller is disposed');
    });

    it('makes dispose idempotent', async () => {
        await controller.initialize();
        controller.dispose();
        expect(() => controller.dispose()).not.toThrow();
        expect(controller.getStatus().state).toBe('DISPOSED');
    });

    it('aborts active requests on dispose', async () => {
        await controller.initialize();
        
        const req = controller.requestChunk('chunk-A');
        controller.dispose();
        
        await expect(req).rejects.toThrow('aborted'); // ChunkFetcher should reject with this
        expect(mockMemoryManager.insert).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'chunk-A' }));
    });

    it('does not insert into memory if disposed during fetch', async () => {
        await controller.initialize();
        
        mockFetcher.fetchChunk = vi.fn().mockImplementation(async (id, options) => {
            return new Promise((resolve) => {
                setTimeout(() => resolve({ id, data: new ArrayBuffer(10), size: 10, sha256: 'mock' }), 10);
            }); // Does not respect abort signal
        });

        const req = controller.requestChunk('chunk-A');
        controller.dispose(); // State becomes DISPOSING / DISPOSED
        
        await expect(req).rejects.toThrow('Controller is disposed');
        expect(mockMemoryManager.insert).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'chunk-A' }));
    });

    it('handles shared dependency deduplication correctly', async () => {
        await controller.initialize();

        mockFetcher.fetchChunk.mockClear();
        mockMemoryManager.insert.mockClear();

        const req1 = controller.requestChunk('chunk-A');
        const req2 = controller.requestChunk('chunk-A');
        const req3 = controller.requestChunk('chunk-A');
        
        await Promise.all([req1, req2, req3]);
        
        expect(mockFetcher.fetchChunk).toHaveBeenCalledTimes(1);
        expect(mockMemoryManager.insert).toHaveBeenCalledTimes(1);
    });
});
