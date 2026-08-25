import { describe, it, expect, vi } from 'vitest';
import { StreamingEngineBridge } from '../../src/streaming/EngineBridge';
import { MemoryBudgetManager, ChunkHandle } from '../../src/streaming/MemoryBudgetManager';
import { StreamingRuntimeController } from '../../src/streaming/StreamingRuntimeController';

describe('StreamingEngineBridge', () => {
    it('returns a ChunkHandle for a known URL after requesting via controller', async () => {
        const mockHandle = { release: vi.fn() } as unknown as ChunkHandle;
        const mockMemoryManager = {
            acquire: vi.fn().mockReturnValue(mockHandle)
        } as unknown as MemoryBudgetManager;
        
        const mockController = {
            requestChunk: vi.fn().mockResolvedValue(undefined)
        } as unknown as StreamingRuntimeController;
        
        const urlMap = new Map([['assets/hero.gltf', 'chunk-hero']]);
        const bridge = new StreamingEngineBridge(mockController, mockMemoryManager, urlMap);
        
        expect(bridge.hasUrl('assets/hero.gltf')).toBe(true);
        expect(bridge.hasUrl('assets/unknown.png')).toBe(false);
        
        const result = await bridge.requestChunk('assets/hero.gltf');
        
        expect(mockController.requestChunk).toHaveBeenCalledWith('chunk-hero');
        expect(mockMemoryManager.acquire).toHaveBeenCalledWith('chunk-hero');
        expect(result).toBe(mockHandle);
    });

    it('throws error if requesting an unmanaged URL', async () => {
        const mockMemoryManager = {} as unknown as MemoryBudgetManager;
        const mockController = {} as unknown as StreamingRuntimeController;
        const bridge = new StreamingEngineBridge(mockController, mockMemoryManager, new Map());
        
        await expect(bridge.requestChunk('assets/unknown.png')).rejects.toThrow('URL not managed');
    });

    it('resolves relative and absolute forms against the published runtime URL', async () => {
        const mockHandle = { release: vi.fn() } as unknown as ChunkHandle;
        const mockMemoryManager = { acquire: vi.fn().mockReturnValue(mockHandle) } as unknown as MemoryBudgetManager;
        const mockController = { requestChunk: vi.fn().mockResolvedValue(undefined) } as unknown as StreamingRuntimeController;
        const bridge = new StreamingEngineBridge(
            mockController,
            mockMemoryManager,
            new Map([['assets/hero.gltf', 'chunk-hero']]),
            2,
            'https://foundry.test/api/cdn/game/extracted/'
        );

        expect(bridge.hasUrl('./assets/hero.gltf')).toBe(true);
        expect(bridge.hasUrl('https://foundry.test/api/cdn/game/extracted/assets/hero.gltf')).toBe(true);
        await bridge.requestChunk('./assets/hero.gltf');
        expect(mockController.requestChunk).toHaveBeenCalledWith('chunk-hero');
    });

    it('releases one decoder slot when memory acquisition fails', async () => {
        const mockMemoryManager = { acquire: vi.fn(() => { throw new Error('missing from memory'); }) } as unknown as MemoryBudgetManager;
        const mockController = { requestChunk: vi.fn().mockResolvedValue(undefined) } as unknown as StreamingRuntimeController;
        const bridge = new StreamingEngineBridge(mockController, mockMemoryManager, new Map([['asset.bin', 'chunk']]), 1);
        const notify = vi.spyOn((bridge as any).decoderQueue, 'notifyDecodeFinished');

        await expect(bridge.requestChunk('asset.bin')).rejects.toThrow('missing from memory');
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('advances the decoder queue only once when a handle is released repeatedly', async () => {
        const originalRelease = vi.fn();
        const mockHandle = { release: originalRelease } as unknown as ChunkHandle;
        const mockMemoryManager = { acquire: vi.fn().mockReturnValue(mockHandle) } as unknown as MemoryBudgetManager;
        const mockController = { requestChunk: vi.fn().mockResolvedValue(undefined) } as unknown as StreamingRuntimeController;
        const bridge = new StreamingEngineBridge(mockController, mockMemoryManager, new Map([['asset.bin', 'chunk']]), 1);
        const notify = vi.spyOn((bridge as any).decoderQueue, 'notifyDecodeFinished');

        const handle = await bridge.requestChunk('asset.bin');
        handle.release();
        handle.release();

        expect(notify).toHaveBeenCalledTimes(1);
        expect(originalRelease).toHaveBeenCalledTimes(2);
    });
});
