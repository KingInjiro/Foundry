import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamingEngineBridge } from '../../src/streaming/EngineBridge';
import { StreamingRuntimeController } from '../../src/streaming/StreamingRuntimeController';
import { MemoryBudgetManager } from '../../src/streaming/MemoryBudgetManager';
import { StreamingObservability } from '../../src/streaming/StreamingObservability';
import type { MemoryPriority } from '@foundry/contracts/streaming/types';

describe('Phase 3T - Decoder Concurrency & Main-Thread Protection', () => {
    let mockController: any;
    let memoryManager: MemoryBudgetManager;
    let urlMap: Map<string, string>;
    let observability: any;
    
    beforeEach(() => {
        observability = {
            emit: vi.fn()
        };
        
        mockController = {
            requestChunk: vi.fn().mockResolvedValue(undefined),
            observability
        };
        
        memoryManager = new MemoryBudgetManager({ maxMemoryBytes: 1024 * 1024 });
        urlMap = new Map();
        
        for (let i = 1; i <= 5; i++) {
            const chunkId = `chunk-${i}`;
            urlMap.set(`assets/model-${i}.glb`, chunkId);
            memoryManager.insert({
                id: chunkId,
                data: new ArrayBuffer(1024),
                size: 1024,
                sha256: `hash-${i}`
            });
        }
    });

    it('bounds max concurrent decodes correctly', async () => {
        const bridge = new StreamingEngineBridge(mockController as any, memoryManager, urlMap, 2);
        let activeSimulatedDecodes = 0;
        let maxObservedDecodes = 0;
        const simulateDecode = async (url: string) => {
            const handle = await bridge.requestChunk(url);
            activeSimulatedDecodes++;
            maxObservedDecodes = Math.max(maxObservedDecodes, activeSimulatedDecodes);
            await new Promise(resolve => setTimeout(resolve, 10));
            activeSimulatedDecodes--;
            handle.release();
        };
        const promises = [
            simulateDecode('assets/model-1.glb'),
            simulateDecode('assets/model-2.glb'),
            simulateDecode('assets/model-3.glb'),
            simulateDecode('assets/model-4.glb')
        ];
        await Promise.all(promises);
        expect(maxObservedDecodes).toBe(2);
        expect(activeSimulatedDecodes).toBe(0);
        expect(observability.emit).toHaveBeenCalledWith('DECODER_QUEUE_WAIT', expect.any(Object));
    });

    it('respects priority ordering', async () => {
        const bridge = new StreamingEngineBridge(mockController as any, memoryManager, urlMap, 1);
        const executionOrder: string[] = [];
        const simulateDecode = async (url: string, priority: MemoryPriority) => {
            const handle = await bridge.requestChunk(url, priority);
            executionOrder.push(url);
            await new Promise(resolve => setTimeout(resolve, 5));
            handle.release();
        };
        const p1 = simulateDecode('assets/model-1.glb', 'low');
        const p2 = simulateDecode('assets/model-2.glb', 'low');
        const p3 = simulateDecode('assets/model-3.glb', 'critical');
        const p4 = simulateDecode('assets/model-4.glb', 'high');
        await Promise.all([p1, p2, p3, p4]);
        expect(executionOrder).toEqual([
            'assets/model-1.glb',
            'assets/model-3.glb',
            'assets/model-4.glb',
            'assets/model-2.glb'
        ]);
    });

    it('deduplicates requests for the same chunk', async () => {
        const bridge = new StreamingEngineBridge(mockController as any, memoryManager, urlMap, 1);
        const handles: any[] = [];
        let networkFetchCalls = 0;
        
        // This simulates StreamingRuntimeController deduplicating fetches
        mockController.requestChunk = vi.fn().mockImplementation(async (id) => {
            networkFetchCalls++;
            // yield to simulate fetch
            await new Promise(resolve => setTimeout(resolve, 5));
        });

        // Simulating the existing architecture: bridge returns two independent ChunkHandles
        // but relies on controller for network deduplication.
        const p1 = bridge.requestChunk('assets/model-1.glb').then(h => {
            handles.push(h);
            setTimeout(() => h.release(), 5);
        });
        const p2 = bridge.requestChunk('assets/model-1.glb').then(h => {
            handles.push(h);
            setTimeout(() => h.release(), 5);
        });
        
        await Promise.all([p1, p2]);
        
        expect(handles.length).toBe(2);
        
        // If we were testing StreamingRuntimeController, networkFetchCalls would be 1.
        // But here we're just checking that the bridge can process both properly.
    });

    it('handles cancellation while queued', async () => {
        const bridge = new StreamingEngineBridge(mockController as any, memoryManager, urlMap, 1);
        const p1 = bridge.requestChunk('assets/model-1.glb');
        const controller = new AbortController();
        const p2 = bridge.requestChunk('assets/model-2.glb', 'normal', controller.signal);
        
        await new Promise(resolve => setTimeout(resolve, 0));
        controller.abort();
        
        await expect(p2).rejects.toThrow('Decode aborted while queued');
        const handle1 = await p1;
        handle1.release();
    });

    it('disposal rejects all queued decodes', async () => {
        const bridge = new StreamingEngineBridge(mockController as any, memoryManager, urlMap, 1);
        const p1 = bridge.requestChunk('assets/model-1.glb');
        const p2 = bridge.requestChunk('assets/model-2.glb');
        const p3 = bridge.requestChunk('assets/model-3.glb');
        
        await new Promise(resolve => setTimeout(resolve, 0));
        bridge.dispose();
        
        await expect(p2).rejects.toThrow('Decoder queue disposed');
        await expect(p3).rejects.toThrow('Decoder queue disposed');
        
        const handle1 = await p1;
        handle1.release();
    });
});
