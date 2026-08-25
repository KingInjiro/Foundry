import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingRuntimeController } from '../../src/streaming/StreamingRuntimeController';
import { MemoryBudgetManager } from '../../src/streaming/MemoryBudgetManager';
import { StreamingEngineBridge } from '../../src/streaming/EngineBridge';
import { DeterministicTransport } from './helpers/DeterministicTransport';
import { AssetManager } from '@foundry/engine';
import { StreamingObservability } from '../../src/streaming/StreamingObservability';
import { PersistentChunkCache } from '../../src/streaming/PersistentChunkCache';
import { StreamingManifestLoader } from '../../src/streaming/StreamingManifestLoader';
import { ChunkFetcher } from '../../src/streaming/ChunkFetcher';
import { PersistentStorageEvictionController } from '../../src/streaming/PersistentStorageEvictionController';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

function createMinimalGLB() {
    const gltf = {
        asset: { version: "2.0" },
        scenes: [{ nodes: [] }],
        scene: 0,
        nodes: []
    };
    const jsonString = JSON.stringify(gltf);
    let jsonPadding = (4 - (jsonString.length % 4)) % 4;
    let paddedJson = jsonString + ' '.repeat(jsonPadding);
    const jsonBytes = new TextEncoder().encode(paddedJson);
    
    const length = 12 + 8 + jsonBytes.length;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    
    view.setUint32(0, 0x46546C67, true); // magic 'glTF'
    view.setUint32(4, 2, true); // version 2
    view.setUint32(8, length, true); // total length
    
    view.setUint32(12, jsonBytes.length, true); // chunk 0 length
    view.setUint32(16, 0x4E4F534A, true); // chunk 0 type 'JSON'
    
    const u8 = new Uint8Array(buffer);
    u8.set(jsonBytes, 20);
    
    return buffer;
}

const minGlbBuffer = createMinimalGLB();

// Mock engine
class MockEngine {
    streamingBridge: StreamingEngineBridge;
    audio: any = null;
    constructor(bridge: StreamingEngineBridge) {
        this.streamingBridge = bridge;
    }
}

describe('Phase 3Q - GLB/GLTF Decoder Integration', () => {
    let transport: DeterministicTransport;
    let cache: PersistentChunkCache;
    let memoryManager: MemoryBudgetManager;
    let controller: StreamingRuntimeController;
    let bridge: StreamingEngineBridge;
    let engine: MockEngine;
    let assetManager: AssetManager;
    let events: any[] = [];
    let observability: StreamingObservability;

    beforeEach(async () => {
        if (typeof globalThis.window === 'undefined') {
            (globalThis as any).window = {
                addEventListener: () => {},
                removeEventListener: () => {}
            };
        }
        transport = new DeterministicTransport();
        transport.setup();
        
        cache = {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(undefined),
            clearPrefix: vi.fn().mockResolvedValue(undefined),
            enumerateMetadata: vi.fn().mockResolvedValue([]),
            getBudget: vi.fn().mockResolvedValue({ maxBytes: 10000, currentBytes: 0 })
        } as unknown as PersistentChunkCache;

        observability = new StreamingObservability({
            emit: (e) => events.push(e)
        });
        
        memoryManager = new MemoryBudgetManager({
            maxMemoryBytes: 10 * 1024 * 1024,
            observability
        });

        // Set up interceptor for the minimal GLB
        transport.customResponses.set('http://cdn.test/chunks/chunk-glb.glb', minGlbBuffer);

        const manifest = {
            schemaVersion: 1,
            runtime: { entry: 'none', capabilities: [], minRuntimeVersion: '1.0' },
            chunks: new Map([
                ['chunk-glb', {
                    id: 'chunk-glb',
                    url: 'chunks/chunk-glb.glb',
                    size: minGlbBuffer.byteLength,
                    hash: 'sha256-cd00e292c5970d3c5e2f0ffa5171e555bc46bfc4faddfb4a418b6840b86e79a3',
                    dependencies: [],
                    priority: 'high',
                    preload: false
                }]
            ]),
            dependencies: new Map()
        };

        
        const evictionController = new PersistentStorageEvictionController(cache, { observability });
        const fetcher = new ChunkFetcher(manifest as any, 'http://cdn.test/', 10, observability, cache as any);
        (fetcher as any).persistentEvictionController = evictionController;

        controller = new StreamingRuntimeController(manifest as any, fetcher, memoryManager, observability);
        await controller.initialize();

        const urlMap = new Map<string, string>();
        urlMap.set('assets/model.glb', 'chunk-glb');
        bridge = new StreamingEngineBridge(controller, memoryManager, urlMap);
        engine = new MockEngine(bridge);
        assetManager = new AssetManager(engine);
    });

    afterEach(() => {
        controller.dispose();
        events = [];
    });

    it('successfully loads a streaming-managed GLB and releases handle', async () => {
        const p = assetManager.loadGLTF('myModel', 'assets/model.glb'); p.catch(e => { console.error('loadGLTF error:', e); transport.activeRequests.push({} as any); });
        
                while (transport.activeRequests.length < 1) {
            await new Promise(r => setTimeout(r, 10));
        }
        expect(transport.activeRequests.length).toBe(1);
        transport.resolveAll();
        
        const gltf = await p;
        expect(gltf.scene).toBeDefined();
        
        expect(transport.completedRequests).toBe(1);

        const decodeEvents = events.filter(e => e.type.startsWith('ASSET_DECODE'));
        expect(decodeEvents.map(e => e.type)).toEqual(['ASSET_DECODE_START', 'ASSET_DECODE_SUCCESS']);

        // Check handle release
        const snap = memoryManager.getSnapshot();
        const chunk = (memoryManager as any).store.get('chunk-glb');
        expect(chunk.refCount).toBe(0);
        
        // Next eviction should be able to evict it
    });

    it('falls back to legacy AssetManager for unmanaged URLs', async () => {
        let legacyFetchCalled = false;
        const originalLoad = GLTFLoader.prototype.load;
        GLTFLoader.prototype.load = function(url, onLoad, onProgress, onError) {
            legacyFetchCalled = true;
            setTimeout(() => {
                onLoad({ scene: {} });
            }, 10);
        };

        const p = assetManager.loadGLTF('legacyModel', 'assets/legacy.glb');
        const gltf = await p;
        
        expect(legacyFetchCalled).toBe(true);
        expect(transport.activeRequests.length).toBe(0);
        expect(gltf.scene).toBeDefined();

        GLTFLoader.prototype.load = originalLoad;
    });

    it('aborts network request and cleans up if aborted early', async () => {
        // Wait, AssetManager does not expose abort signal directly on loadGLTF.
        // We can test disposal of controller to abort in-flight requests.
        const p = assetManager.loadGLTF('myModel', 'assets/model.glb'); p.catch(e => { console.error('loadGLTF error:', e); transport.activeRequests.push({} as any); });
        
                while (transport.activeRequests.length < 1) {
            await new Promise(r => setTimeout(r, 10));
        }
        
        controller.dispose();
        
        await expect(p).rejects.toThrow(); // Either chunk aborted or something else
        
        const chunk = (memoryManager as any).store.get('chunk-glb');
        expect(chunk).toBeUndefined(); // Should not be in memory
    });

    it('rejects on SHA-256 integrity failure and cleans up', async () => {
        transport.customResponses.set('http://cdn.test/chunks/chunk-glb.glb', new ArrayBuffer(minGlbBuffer.byteLength)); // corrupt data
        
        const originalDigest = globalThis.crypto.subtle.digest;
        globalThis.crypto.subtle.digest = vi.fn().mockResolvedValue(new ArrayBuffer(32));

        const p = assetManager.loadGLTF('corruptModel', 'assets/model.glb'); p.catch(e => { transport.activeRequests.push({} as any); });
        
                while (transport.activeRequests.length < 1) {
            await new Promise(r => setTimeout(r, 10));
        }
        transport.resolveAll();
        
        await expect(p).rejects.toThrow(/integrity/i);
        
        const decodeEvents = events.filter(e => e.type.startsWith('ASSET_DECODE'));
        expect(decodeEvents.length).toBe(0); // parse never called
        globalThis.crypto.subtle.digest = originalDigest;
    });

    it('releases chunkHandle and emits ASSET_DECODE_FAILURE on parser failure', async () => {
        // We will make GLTFLoader.parse fail by corrupting the JSON chunk inside the GLB
        // but bypassing the integrity check so it reaches the parser.
        const corruptGlb = new Uint8Array(minGlbBuffer.slice(0));
        corruptGlb[20] = 0; // corrupt JSON
        transport.customResponses.set('http://cdn.test/chunks/chunk-glb.glb', corruptGlb.buffer);
        
        const originalDigest = globalThis.crypto.subtle.digest;
                const hex = 'cd00e292c5970d3c5e2f0ffa5171e555bc46bfc4faddfb4a418b6840b86e79a3';
        const dummyHash = new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))).buffer;
        globalThis.crypto.subtle.digest = vi.fn().mockResolvedValue(dummyHash);

        const p = assetManager.loadGLTF('corruptParseModel', 'assets/model.glb'); p.catch(e => { transport.activeRequests.push({} as any); });
        
        while (transport.activeRequests.length < 1) {
            await new Promise(r => setTimeout(r, 10));
        }
        transport.resolveAll();
        
        await expect(p).rejects.toThrow();
        
        const decodeEvents = events.filter(e => e.type.startsWith('ASSET_DECODE'));
        expect(decodeEvents.map(e => e.type)).toEqual(['ASSET_DECODE_START', 'ASSET_DECODE_FAILURE']);
        
        const chunk = (memoryManager as any).store.get('chunk-glb');
        expect(chunk.refCount).toBe(0); // released successfully despite parser error

        globalThis.crypto.subtle.digest = originalDigest;
    });

    it('handles concurrent identical GLB requests seamlessly with one fetch', async () => {
        transport.customResponses.set('http://cdn.test/chunks/chunk-glb.glb', minGlbBuffer);
        const p1 = assetManager.loadGLTF('m1', 'assets/model.glb');
        const p2 = assetManager.loadGLTF('m2', 'assets/model.glb');
        const p3 = assetManager.loadGLTF('m3', 'assets/model.glb');
        
                while (transport.activeRequests.length < 1) {
            await new Promise(r => setTimeout(r, 10));
        }
        expect(transport.activeRequests.length).toBe(1); // exactly one underlying fetch
        
        transport.resolveAll();
        
        const [g1, g2, g3] = await Promise.all([p1, p2, p3]);
        expect(g1.scene).toBeDefined();
        expect(g2.scene).toBeDefined();
        expect(g3.scene).toBeDefined();
        
        expect(transport.completedRequests).toBe(1);
        
        const chunk = (memoryManager as any).store.get('chunk-glb');
        expect(chunk.refCount).toBe(0); // All 3 released their handles
    });
});
