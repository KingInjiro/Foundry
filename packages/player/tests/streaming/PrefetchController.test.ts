import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrefetchController } from '../../src/streaming/PrefetchController';
import { MemoryBudgetManager } from '../../src/streaming/MemoryBudgetManager';
import { StreamingObservability } from '../../src/streaming/StreamingObservability';
import { StreamingRuntimeManifest } from '../../src/streaming/StreamingManifestLoader';

describe('PrefetchController', () => {
    let memoryManager: MemoryBudgetManager;
    let events: any[] = [];
    let observability: StreamingObservability;
    
    beforeEach(() => {
        events = [];
        observability = new StreamingObservability({ emit: e => events.push(e) });
        memoryManager = new MemoryBudgetManager({ maxMemoryBytes: 1000, observability });
    });
    
    function createManifest(chunks: any[], entry: string = 'entry'): StreamingRuntimeManifest {
        const chunkMap = new Map();
        const deps = new Map();
        for (const c of chunks) {
            chunkMap.set(c.id, { id: c.id, url: c.id, size: c.size, hash: 'hash', dependencies: c.deps || [], priority: c.priority || 'medium', preload: !!c.preload });
            deps.set(c.id, c.deps || []);
        }
        return {
            schemaVersion: 1,
            runtime: { entry },
            chunks: chunkMap,
            dependencies: deps
        };
    }
    
    it('should select explicit preload candidates and their dependencies', async () => {
        const manifest = createManifest([
            { id: 'A', size: 10, preload: true, deps: ['B'] },
            { id: 'B', size: 10, preload: false, deps: ['D'] },
            { id: 'C', size: 10, preload: false }, // unrelated
            { id: 'D', size: 10, preload: false }
        ]);
        
        let requested: string[] = [];
        let fetchResolvers: any[] = [];
        
        const delegate = vi.fn().mockImplementation(async (id, opts) => {
            requested.push(id);
            expect(opts.context).toBe('background');
            return new Promise(resolve => fetchResolvers.push(resolve));
        });
        
        const controller = new PrefetchController(manifest, memoryManager, delegate, { observability, maxConcurrentPrefetches: 2 });
        await controller.start();
        
        // Due to depth sorting, D (depth 0) should be first, B (1) second, A (2) third.
        // Wait, candidates: A, B, D.
        // Let's see actual sort: Priority is equal. Preload: A has preload: true, B,D have false.
        // A is preload=true (pl=1), B/D is preload=false (pl=0).
        // A goes before B and D due to explicit preload preference!
        // Then B and D: D is depth 0, B is depth 1. D goes before B.
        // Actual expected sequence: A, D, B (assuming maxConcurrent=2)
        
        expect(requested.length).toBe(2);
        
        // Resolve first two
        fetchResolvers.forEach(r => r());
        fetchResolvers = [];
        
        // Need to wait a tick for the promise chain to pump
        await new Promise(r => setTimeout(r, 10));
        
        expect(requested.length).toBe(3);
        expect(requested).not.toContain('C');
        
        // Resolve last
        fetchResolvers.forEach(r => r());
        await new Promise(r => setTimeout(r, 0));
        
        expect(events).toContainEqual(expect.objectContaining({ type: 'PREFETCH_CYCLE_COMPLETE' }));
    });
    
    it('should respect concurrency limits', async () => {
        const manifest = createManifest([
            { id: '1', size: 10, preload: true },
            { id: '2', size: 10, preload: true },
            { id: '3', size: 10, preload: true }
        ]);
        
        let pending = 0;
        const delegate = vi.fn().mockImplementation(async () => {
            pending++;
            return new Promise(r => setTimeout(() => { pending--; r(); }, 10));
        });
        
        const controller = new PrefetchController(manifest, memoryManager, delegate, { observability, maxConcurrentPrefetches: 2 });
        controller.start();
        
        expect(pending).toBe(2);
        await new Promise(r => setTimeout(r, 15));
        
        // Should have fetched all 3 eventually
        expect(delegate).toHaveBeenCalledTimes(3);
    });
    
    it('should pause when memory budget is insufficient', async () => {
        memoryManager = new MemoryBudgetManager({ maxMemoryBytes: 15, observability });
        
        const manifest = createManifest([
            { id: '1', size: 10, preload: true },
            { id: '2', size: 10, preload: true } // Needs 10 more, only 5 left
        ]);
        
        const delegate = vi.fn().mockImplementation(async (id) => {
            memoryManager.insert({ id, data: new ArrayBuffer(10), size: 10, sha256: 'abc' });
        });
        
        const controller = new PrefetchController(manifest, memoryManager, delegate, { observability, maxConcurrentPrefetches: 1 });
        await controller.start();
        
        // Wait a tick
        await new Promise(r => setTimeout(r, 10));
        
        expect(delegate).toHaveBeenCalledTimes(1);
        expect(events).toContainEqual(expect.objectContaining({ type: 'PREFETCH_PAUSED', metadata: expect.objectContaining({ reason: 'insufficient_memory' }) }));
    });
    
    it('should safely cancel and stop scheduling', async () => {
        const manifest = createManifest([
            { id: '1', size: 10, preload: true },
            { id: '2', size: 10, preload: true }
        ]);
        
        const delegate = vi.fn().mockImplementation(async () => new Promise(r => setTimeout(r, 10)));
        
        const controller = new PrefetchController(manifest, memoryManager, delegate, { observability, maxConcurrentPrefetches: 1 });
        controller.start();
        
        controller.cancelAll();
        
        await new Promise(r => setTimeout(r, 20));
        
        expect(delegate).toHaveBeenCalledTimes(1); // 2 was never started
        expect(events).toContainEqual(expect.objectContaining({ type: 'PREFETCH_CANCELLED' }));
    });
    
    it('should sort by priority', async () => {
        const manifest = createManifest([
            { id: 'low', size: 10, preload: true, priority: 'low' },
            { id: 'high', size: 10, preload: true, priority: 'high' },
            { id: 'critical', size: 10, preload: true, priority: 'critical' }
        ]);
        
        let requested: string[] = [];
        const delegate = vi.fn().mockImplementation(async (id) => { requested.push(id); });
        
        const controller = new PrefetchController(manifest, memoryManager, delegate, { observability, maxConcurrentPrefetches: 3 });
        await controller.start();
        
        // Wait a tick for the promises to chain up and fetch remaining, since maxConcurrent might be bound by unknown=1 default in node if we didn't patch options well
        // Wait, maxConcurrentPrefetches: 3 was passed! Why didn't it work?
        // Because options.maxConcurrentPrefetches is 3, so maxConcurrentUnknown is 3. It should have fetched 3.
        await new Promise(r => setTimeout(r, 10));
        expect(requested).toEqual(['critical', 'high', 'low']);
    });
});
