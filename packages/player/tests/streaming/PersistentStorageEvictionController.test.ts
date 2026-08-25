import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersistentStorageEvictionController, PersistentStorageBudgetExceededError } from '../../src/streaming/PersistentStorageEvictionController';
import { PersistentChunkCache, PersistentChunkEntry, PersistentChunkMetadata } from '../../src/streaming/PersistentChunkCache';
import { StreamingObservability } from '../../src/streaming/StreamingObservability';

class MockDelegateCache implements PersistentChunkCache {
    public entries = new Map<string, PersistentChunkEntry>();
    public sequence = 0;
    public deleteShouldFail = false;
    public putShouldFailWithQuota = false;
    
    async get(cacheKey: string) {
        const entry = this.entries.get(cacheKey);
        if (entry) {
            this.sequence++;
            entry.lastAccessSequence = this.sequence;
            return { ...entry, data: entry.data.slice(0) }; // fake read
        }
        return null;
    }
    
    async put(entry: PersistentChunkEntry) {
        if (this.putShouldFailWithQuota) {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
        }
        this.sequence++;
        entry.lastAccessSequence = this.sequence;
        this.entries.set(entry.cacheKey, { ...entry, data: entry.data.slice(0) });
    }
    
    async delete(cacheKey: string) {
        if (this.deleteShouldFail) {
            throw new Error('Mock delete failure');
        }
        this.entries.delete(cacheKey);
    }
    
    async clearPrefix(cdnBaseUrlPrefix: string) {
        for (const [key, val] of this.entries.entries()) {
            if (val.cdnBaseUrl.startsWith(cdnBaseUrlPrefix)) {
                this.entries.delete(key);
            }
        }
    }
    
    async enumerateMetadata() {
        return Array.from(this.entries.values()).map(e => ({
            cacheKey: e.cacheKey,
            cdnBaseUrl: e.cdnBaseUrl,
            chunkId: e.chunkId,
            sha256: e.sha256,
            size: e.size,
            lastAccessSequence: e.lastAccessSequence!
        }));
    }
}

describe('PersistentStorageEvictionController', () => {
    let delegate: MockDelegateCache;
    let controller: PersistentStorageEvictionController;
    let events: any[] = [];
    
    beforeEach(() => {
        delegate = new MockDelegateCache();
        events = [];
        const obs = new StreamingObservability({ emit: e => events.push(e) });
        controller = new PersistentStorageEvictionController(delegate, { maxPersistentBytes: 100, observability: obs });
    });
    
    function makeEntry(id: string, size: number, prefix: string = 'v1'): PersistentChunkEntry {
        return {
            cacheKey: `${prefix}|${id}`,
            cdnBaseUrl: prefix,
            chunkId: id,
            sha256: 'abc',
            size,
            data: new ArrayBuffer(size)
        };
    }
    
    it('should allow inserts within budget and track bytes', async () => {
        await controller.put(makeEntry('1', 40));
        await controller.put(makeEntry('2', 50));
        
        expect(controller.getTrackedPersistentBytes()).toBe(90);
        expect(delegate.entries.size).toBe(2);
    });
    
    it('should evict oldest entries (LRU) when budget is exceeded', async () => {
        await controller.put(makeEntry('A', 40));
        await controller.put(makeEntry('B', 40));
        
        // Access A to make it newer than B
        await controller.get('v1|A');
        
        // Insert C (40), requires eviction (120 > 100)
        // B is oldest now
        await controller.put(makeEntry('C', 40));
        
        expect(controller.getTrackedPersistentBytes()).toBe(80);
        expect(delegate.entries.has('v1|B')).toBe(false);
        expect(delegate.entries.has('v1|A')).toBe(true);
        expect(delegate.entries.has('v1|C')).toBe(true);
        
        expect(events).toContainEqual(expect.objectContaining({ type: 'PERSISTENT_STORAGE_EVICTION', metadata: { cacheKey: 'v1|B' } }));
    });
    
    it('should use deterministic lexical tie-breaking for equal recency', async () => {
        // Pre-populate delegate with identical sequences
        delegate.entries.set('v1|Y', { ...makeEntry('Y', 40), lastAccessSequence: 1 });
        delegate.entries.set('v1|X', { ...makeEntry('X', 40), lastAccessSequence: 1 });
        delegate.entries.set('v1|Z', { ...makeEntry('Z', 40), lastAccessSequence: 1 });
        
        // Insert forces eviction of 60 bytes (120 + 40 = 160 > 100 => free 60 => need 2 victims)
        // Lexical order of victims: X, Y, Z
        await controller.put(makeEntry('NEW', 40));
        
        expect(delegate.entries.has('v1|X')).toBe(false);
        expect(delegate.entries.has('v1|Y')).toBe(false);
        expect(delegate.entries.has('v1|Z')).toBe(true);
        expect(delegate.entries.has('v1|NEW')).toBe(true);
    });
    
    it('should reject oversized entries deterministically without mutating accounting', async () => {
        await expect(controller.put(makeEntry('BIG', 150))).rejects.toThrow(PersistentStorageBudgetExceededError);
        expect(controller.getTrackedPersistentBytes()).toBe(0);
        expect(delegate.entries.size).toBe(0);
        expect(events).toContainEqual(expect.objectContaining({ type: 'PERSISTENT_STORAGE_BUDGET_EXCEEDED' }));
    });
    
    it('should correctly handle multi-version isolation on clearPrefix', async () => {
        await controller.put(makeEntry('A', 30, 'v1'));
        await controller.put(makeEntry('B', 30, 'v2'));
        
        await controller.clearPrefix('v1');
        
        expect(controller.getTrackedPersistentBytes()).toBe(30);
        expect(delegate.entries.has('v1|A')).toBe(false);
        expect(delegate.entries.has('v2|B')).toBe(true);
    });
    
    it('should handle concurrent mutations safely', async () => {
        const p1 = controller.put(makeEntry('A', 40));
        const p2 = controller.put(makeEntry('B', 40));
        const p3 = controller.put(makeEntry('C', 40));
        
        await Promise.all([p1, p2, p3]);
        
        // 120 bytes inserted, budget 100. One should be evicted.
        expect(controller.getTrackedPersistentBytes()).toBe(80);
        expect(delegate.entries.size).toBe(2);
    });
    
    it('should abort eviction and not corrupt accounting if delegate delete fails', async () => {
        await controller.put(makeEntry('A', 60));
        
        delegate.deleteShouldFail = true;
        
        await expect(controller.put(makeEntry('B', 60))).rejects.toThrow('Mock delete failure');
        
        expect(controller.getTrackedPersistentBytes()).toBe(60); // A remains, B was not inserted
        expect(delegate.entries.has('v1|A')).toBe(true);
        expect(delegate.entries.has('v1|B')).toBe(false);
        expect(events).toContainEqual(expect.objectContaining({ type: 'PERSISTENT_STORAGE_DELETE_FAILURE' }));
    });
    
    it('should handle QuotaExceededError from delegate without corrupting accounting', async () => {
        await controller.put(makeEntry('A', 50)); // Takes 50/100
        
        delegate.putShouldFailWithQuota = true;
        
        // B is 50, fits in budget perfectly, so no eviction occurs. But delegate throws.
        let error;
        try {
            await controller.put(makeEntry('B', 50));
        } catch (e) {
            error = e;
        }
        
        expect(error.name).toBe('QuotaExceededError');
        expect(controller.getTrackedPersistentBytes()).toBe(50); // A remains
        expect(delegate.entries.has('v1|B')).toBe(false);
    });
    
    it('should not mutate state if disposed', async () => {
        controller.dispose();
        await controller.put(makeEntry('A', 40));
        expect(controller.getTrackedPersistentBytes()).toBe(0);
        expect(delegate.entries.size).toBe(0);
    });
});
