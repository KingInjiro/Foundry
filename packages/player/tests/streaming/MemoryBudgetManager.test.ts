import { describe, it, expect } from 'vitest';
import { MemoryBudgetManager, ChunkMemoryBudgetExceededError } from '../../src/streaming/MemoryBudgetManager';
import { FetchedChunk } from '../../src/streaming/ChunkFetcher';

function createChunk(id: string, size: number, hash = 'sha256-abc'): FetchedChunk {
    return {
        id,
        data: new ArrayBuffer(size),
        size,
        sha256: hash
    };
}

describe('MemoryBudgetManager', () => {
    describe('Configuration', () => {
        it('throws if maxMemoryBytes is invalid', () => {
            expect(() => new MemoryBudgetManager({ maxMemoryBytes: 0 })).toThrow();
            expect(() => new MemoryBudgetManager({ maxMemoryBytes: -100 })).toThrow();
            expect(() => new MemoryBudgetManager({ maxMemoryBytes: Infinity })).toThrow();
            expect(() => new MemoryBudgetManager({ maxMemoryBytes: NaN })).toThrow();
        });
    });

    describe('Basic insertion', () => {
        it('inserts valid FetchedChunk and updates snapshot', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 100 });
            manager.insert(createChunk('A', 40));
            
            const snap = manager.getSnapshot();
            expect(snap.currentMemoryBytes).toBe(40);
            expect(snap.entryCount).toBe(1);
            expect(snap.availableMemoryBytes).toBe(60);

            const handle = manager.acquire('A');
            expect(handle.id).toBe('A');
            expect(handle.size).toBe(40);
        });

        it('throws if FetchedChunk is invalid', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 100 });
            expect(() => manager.insert({} as any)).toThrow();
            expect(() => manager.insert({ id: 'A', data: new ArrayBuffer(10), size: 20, sha256: 'hash' })).toThrow();
        });
    });

    describe('Exact budget', () => {
        it('does not evict if exact budget is reached', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 100 });
            manager.insert(createChunk('A', 60));
            manager.insert(createChunk('B', 40));
            
            const snap = manager.getSnapshot();
            expect(snap.currentMemoryBytes).toBe(100);
            expect(snap.entryCount).toBe(2);
        });
    });

    describe('LRU eviction', () => {
        it('evicts least recently used chunk', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 100 });
            manager.insert(createChunk('A', 40));
            manager.insert(createChunk('B', 40));
            
            manager.acquire('A').release(); // makes A more recently used than B

            manager.insert(createChunk('C', 40));
            
            const snap = manager.getSnapshot();
            expect(snap.currentMemoryBytes).toBe(80);
            expect(snap.entryCount).toBe(2);
            
            expect(() => manager.acquire('B')).toThrow(); // B should be evicted
            expect(manager.acquire('A')).toBeDefined();
            expect(manager.acquire('C')).toBeDefined();
        });
    });

    describe('Active chunk protection', () => {
        it('does not evict active chunks', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 100 });
            manager.insert(createChunk('A', 40));
            manager.insert(createChunk('B', 40));
            
            const handleA = manager.acquire('A'); // A is now active
            
            manager.insert(createChunk('C', 60)); // needs 60, currently have 20 free. Need to free 40.
            
            expect(() => manager.acquire('B')).toThrow(); // B evicted
            expect(manager.getSnapshot().currentMemoryBytes).toBe(100);
            
            handleA.release();
        });

        it('throws ChunkMemoryBudgetExceededError if all chunks are active and cannot fit', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 100 });
            manager.insert(createChunk('A', 40));
            manager.insert(createChunk('B', 40));
            
            const handleA = manager.acquire('A');
            const handleB = manager.acquire('B');
            
            expect(() => manager.insert(createChunk('C', 60))).toThrow(ChunkMemoryBudgetExceededError);
            
            // State should remain uncorrupted
            expect(manager.getSnapshot().currentMemoryBytes).toBe(80);
            expect(manager.getSnapshot().entryCount).toBe(2);
            
            handleA.release();
            handleB.release();
        });
    });

    describe('Oversized chunk', () => {
        it('throws if chunk size > maxMemoryBytes', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 100 });
            expect(() => manager.insert(createChunk('A', 120))).toThrow(ChunkMemoryBudgetExceededError);
            expect(manager.getSnapshot().currentMemoryBytes).toBe(0);
        });
    });

    describe('Release behavior', () => {
        it('allows chunk to be evicted after release', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 100 });
            manager.insert(createChunk('A', 60));
            const handle = manager.acquire('A');
            
            handle.release();
            
            // Does not evict immediately
            expect(manager.getSnapshot().entryCount).toBe(1);
            
            // Evicts when space is needed
            manager.insert(createChunk('B', 60));
            expect(manager.getSnapshot().entryCount).toBe(1);
            expect(() => manager.acquire('A')).toThrow();
        });

        it('ignores double release (idempotent)', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 100 });
            manager.insert(createChunk('A', 60));
            const handle = manager.acquire('A');
            
            handle.release();
            handle.release(); // Should not decrement to -1
            
            const handle2 = manager.acquire('A');
            expect(manager.getSnapshot().entryCount).toBe(1);
            
            expect(() => manager.insert(createChunk('B', 60))).toThrow(ChunkMemoryBudgetExceededError); // A is active, cannot insert
        });
    });

    describe('Access updates LRU', () => {
        it('updates LRU state on acquire', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 100 });
            manager.insert(createChunk('A', 40));
            manager.insert(createChunk('B', 40));
            
            const handle = manager.acquire('A');
            handle.release();
            
            manager.insert(createChunk('C', 40));
            
            expect(() => manager.acquire('B')).toThrow(); // B should be evicted
        });
    });

    describe('Duplicate insertion', () => {
        it('does not double count memory for identical chunk', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 100 });
            const chunk = createChunk('A', 40);
            manager.insert(chunk);
            manager.insert(chunk);
            
            expect(manager.getSnapshot().currentMemoryBytes).toBe(40);
            expect(manager.getSnapshot().entryCount).toBe(1);
        });

        it('throws for identical ID but different hash', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 100 });
            manager.insert(createChunk('A', 40, 'hash1'));
            expect(() => manager.insert(createChunk('A', 40, 'hash2'))).toThrow();
        });
    });

    describe('Failed insertion atomicity', () => {
        it('does not partially mutate store on failed insertion', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 100 });
            manager.insert(createChunk('A', 40));
            manager.insert(createChunk('B', 40));
            
            const handle = manager.acquire('A'); // A active
            
            try {
                manager.insert(createChunk('C', 80));
            } catch (e) {}
            
            const snap = manager.getSnapshot();
            expect(snap.currentMemoryBytes).toBe(80); // C wasn't inserted, B wasn't evicted
            expect(snap.entryCount).toBe(2);
            expect(manager.acquire('B')).toBeDefined(); // B should still be there
            
            handle.release();
        });
    });

    describe('Deterministic eviction', () => {
        it('breaks ties using chunk ID', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 100 });
            
            // Mock sequence to create tie
            (manager as any).accessSequence = 10;
            manager.insert(createChunk('B', 40)); // access = 11
            
            (manager as any).accessSequence = 10; // reset
            manager.insert(createChunk('A', 40)); // access = 11
            
            manager.insert(createChunk('C', 40)); // forces eviction
            
            // Since A and B have same access sequence, tie-breaker is ID lexical order.
            // 'A' < 'B', so 'A' should be evicted first.
            expect(() => manager.acquire('A')).toThrow();
            expect(manager.acquire('B')).toBeDefined();
        });
    });

    describe('Memory Accounting Invariants', () => {
        it('satisfies invariant 1-9', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 100 });
            expect(manager.getSnapshot().currentMemoryBytes).toBeGreaterThanOrEqual(0); // inv 2
            
            manager.insert(createChunk('A', 40));
            manager.insert(createChunk('B', 60));
            expect(manager.getSnapshot().currentMemoryBytes).toBe(100); // inv 1, inv 3
            
            const handle = manager.acquire('B');
            
            expect(() => manager.insert(createChunk('C', 70))).toThrow(); // fail insert
            expect(manager.getSnapshot().currentMemoryBytes).toBe(100); // inv 7, inv 8
            
            handle.release();
            handle.release(); // inv 6
            
            manager.insert(createChunk('C', 70)); // Evicts A (40) and B (60). Installs C (70).
            expect(manager.getSnapshot().currentMemoryBytes).toBe(70); // inv 4
            
            manager.insert(createChunk('C', 70)); // Duplicate
            expect(manager.getSnapshot().currentMemoryBytes).toBe(70); // inv 9
        });
    });
});
