import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IndexedDBPersistentChunkCache } from '../../src/streaming/IndexedDBPersistentChunkCache';
import { PersistentStorageEvictionController } from '../../src/streaming/PersistentStorageEvictionController';
import { ChunkFetcher } from '../../src/streaming/ChunkFetcher';
import { MemoryBudgetManager } from '../../src/streaming/MemoryBudgetManager';
import { StreamingRuntimeController } from '../../src/streaming/StreamingRuntimeController';
import { StreamingObservability } from '../../src/streaming/StreamingObservability';
import { StreamingRuntimeManifest } from '../../src/streaming/StreamingManifestLoader';
import 'fake-indexeddb/auto';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import crypto from 'crypto';

if (!globalThis.crypto) {
    globalThis.crypto = crypto.webcrypto as any;
}

const mockManifest: StreamingRuntimeManifest = {
    version: "1.0",
    dependencies: new Map(),
    chunks: new Map([
        ['chunk-1', { id: 'chunk-1', byteOffset: 0, size: 23, hash: 'sha256-hash1', dependencies: [] }]
    ]),
    assets: new Map([
        ['asset-1', { id: 'asset-1', chunkId: 'chunk-1', type: 'gltf', byteOffset: 0, size: 23 }]
    ])
};

describe('Phase 3X - Production Persistent Wiring', () => {
    beforeEach(() => {
        const req = indexedDB.deleteDatabase('FoundryStreamingCache');
        return new Promise((resolve) => {
            req.onsuccess = resolve;
            req.onerror = resolve;
        });
    });

    it('demonstrates fresh session hit and NO network transport after cold boot', async () => {
        // Setup SHA-256 for chunk-1
        const dataStr = 'chunk-1 data goes here!';
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(dataStr).buffer;
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        const actualHash = `sha256-${hashHex}`;
        mockManifest.chunks.get('chunk-1')!.hash = actualHash;

        // Mock fetch for transport
        let fetchCalls = 0;
        globalThis.fetch = vi.fn().mockImplementation(async (url) => {
            fetchCalls++;
            return {
                ok: true,
                arrayBuffer: async () => dataBuffer.slice(0)
            };
        });

        // --- SESSION 1 ---
        const obs1 = new StreamingObservability();
        const cache1 = new IndexedDBPersistentChunkCache(obs1);
        const eviction1 = new PersistentStorageEvictionController(cache1, { maxPersistentBytes: 10 * 1024 * 1024 });
        const fetcher1 = new ChunkFetcher(mockManifest, 'https://cdn.example.com', 4, obs1, eviction1);
        const memory1 = new MemoryBudgetManager({ maxMemoryBytes: 10 * 1024 * 1024, observability: obs1 });
        const controller1 = new StreamingRuntimeController(mockManifest, fetcher1, memory1, obs1);

        const handle1 = await controller1.requestChunk('chunk-1');
        
        
        // Wait for asynchronous persistent cache write to complete
        // The fetcher writes asynchronously to persistent cache
        await new Promise(r => setTimeout(r, 50)); 
        
        controller1.dispose();
        
        expect(fetchCalls).toBe(1); // One fetch on session 1

        // --- SESSION 2 ---
        let hitEventReceived = false;
        const obs2 = new StreamingObservability({ emit: (e) => { if(e.type === 'PERSISTENT_CACHE_HIT') hitEventReceived = true; } });
        
        const cache2 = new IndexedDBPersistentChunkCache(obs2);
        const eviction2 = new PersistentStorageEvictionController(cache2, { maxPersistentBytes: 10 * 1024 * 1024 });
        const fetcher2 = new ChunkFetcher(mockManifest, 'https://cdn.example.com', 4, obs2, eviction2);
        const memory2 = new MemoryBudgetManager({ maxMemoryBytes: 10 * 1024 * 1024, observability: obs2 });
        const controller2 = new StreamingRuntimeController(mockManifest, fetcher2, memory2, obs2);

        const handle2 = await controller2.requestChunk('chunk-1');
        
        
        controller2.dispose();

        // fetchCalls should STILL be 1! NO additional transport requests!
        expect(fetchCalls).toBe(1);
        expect(hitEventReceived).toBe(true);
    });
});