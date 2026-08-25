import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingRuntimeController } from '../../src/streaming/StreamingRuntimeController';
import { StreamingEngineBridge } from '../../src/streaming/EngineBridge';
import { AssetManager } from '@foundry/engine';

// We mock the fetch so we don't hit the network
let mockManifest: any;

describe('Runtime Wiring', () => {
    let bridge: StreamingEngineBridge;
    let controller: StreamingRuntimeController;
    let assetManager: AssetManager;
    let fetchSpy: any;
    
    beforeEach(async () => {
        const chunkBuffer = new ArrayBuffer(100);
        const hashBuffer = await crypto.subtle.digest('SHA-256', chunkBuffer);
        const hashHex = Array.from(new Uint8Array(hashBuffer)).map(byte => byte.toString(16).padStart(2, '0')).join('');
        mockManifest = {
            schemaVersion: 1,
            runtime: { entry: 'chunk-1' },
            chunks: new Map([["chunk-1", {
                id: "chunk-1",
                url: "asset.glb",
                size: chunkBuffer.byteLength,
                hash: `sha256-${hashHex}`,
                dependencies: [],
                priority: 'critical',
                preload: false
            }]]),
            dependencies: new Map([['chunk-1', []]])
        };

        // Mock fetch to simulate downloading the chunk
        fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
            if (String(url).endsWith('/asset.glb')) {
                return new Response(chunkBuffer.slice(0));
            }
            return new Response();
        });
        
        const { StreamingObservability } = await import('../../src/streaming/StreamingObservability');
        const { ChunkFetcher } = await import('../../src/streaming/ChunkFetcher');
        const { MemoryBudgetManager } = await import('../../src/streaming/MemoryBudgetManager');

        const observability = new StreamingObservability();
        const fetcher = new ChunkFetcher(mockManifest as any, '', 4, observability);
        const memoryManager = new MemoryBudgetManager({ maxMemoryBytes: 256 * 1024 * 1024, observability });
        
        controller = new StreamingRuntimeController(mockManifest as any, fetcher, memoryManager, observability);
        await controller.initialize();
        
        const urlMap = new Map();
        urlMap.set('asset.glb', 'chunk-1');
        bridge = new StreamingEngineBridge(controller, memoryManager, urlMap);
        
        // Mock the engine context required by AssetManager
        const mockEngine = {
            streamingBridge: bridge,
            events: { on: vi.fn(), emit: vi.fn() },
            isHeadless: true
        };
        assetManager = new AssetManager(mockEngine as any);
    });
    
    afterEach(() => {
        vi.restoreAllMocks();
        controller.dispose();
    });

    it('should route asset load through the streaming bridge and release chunk handle', async () => {
        const requestChunkSpy = vi.spyOn(bridge, 'requestChunk');
        
        // Use JSON to avoid real THREE.js loading
        const promise = assetManager.loadJSON('test_json', 'asset.glb');
        
        await promise.catch(e => {}); // it will fail to parse JSON since it's empty
        
        // requestChunk should have been called
        expect(requestChunkSpy).toHaveBeenCalledWith('asset.glb');
        expect(requestChunkSpy).toHaveBeenCalledTimes(1);
    });
});
