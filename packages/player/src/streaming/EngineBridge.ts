import { MemoryBudgetManager, ChunkHandle } from './MemoryBudgetManager';
import { StreamingRuntimeController } from './StreamingRuntimeController';
import { DecoderConcurrencyQueue } from './DecoderConcurrencyQueue';
import type { MemoryPriority } from '@foundry/contracts/streaming/types';

/**
 * Phase 3F & 3T: Orchestrated Engine Bridge
 * 
 * Provides a generic boundary for the Engine to request verified binary chunks
 * from the Platform's streaming infrastructure. It coordinates with the 
 * StreamingRuntimeController to ensure chunks are fetched and inserted into
 * MemoryBudgetManager before the Engine acquires them.
 * 
 * Implements Decoder Concurrency to protect the main thread from multiple simultaneous
 * heavy CPU parses (e.g., GLB parsing).
 */
export class StreamingEngineBridge {
    private controller: StreamingRuntimeController;
    private memoryManager: MemoryBudgetManager;
    private urlMap: Map<string, string>;
    private decoderQueue: DecoderConcurrencyQueue;
    private baseUrl: string;

    constructor(
        controller: StreamingRuntimeController,
        memoryManager: MemoryBudgetManager, 
        urlMap: Map<string, string> = new Map(),
        maxConcurrentDecodes: number = 2,
        baseUrl: string = ''
    ) {
        this.controller = controller;
        this.memoryManager = memoryManager;
        this.baseUrl = baseUrl;
        this.urlMap = new Map(urlMap);
        if (this.baseUrl) {
            for (const [url, chunkId] of urlMap.entries()) {
                const canonicalUrl = this.canonicalizeUrl(url);
                if (canonicalUrl) this.urlMap.set(canonicalUrl, chunkId);
            }
        }
        this.decoderQueue = new DecoderConcurrencyQueue(maxConcurrentDecodes);
    }

    private canonicalizeUrl(url: string): string | null {
        if (!this.baseUrl) return null;
        try {
            return new URL(url, this.baseUrl).href;
        } catch {
            return null;
        }
    }

    private resolveChunkId(url: string): string | undefined {
        const directMatch = this.urlMap.get(url);
        if (directMatch) return directMatch;
        const canonicalUrl = this.canonicalizeUrl(url);
        return canonicalUrl ? this.urlMap.get(canonicalUrl) : undefined;
    }

    /** Checks if a URL is managed by the streaming manifest */
    public hasUrl(url: string): boolean {
        return Boolean(this.resolveChunkId(url));
    }

    public emitObservabilityEvent(type: any, metadata?: any): void {
        (this.controller as any).observability?.emit(type, metadata);
    }

    /** 
     * Requests the ChunkHandle for a given URL.
     * The Engine takes ownership of the returned ChunkHandle and MUST call `release()`
     * when the decoded asset is destroyed or if decode fails.
     */
    public async requestChunk(url: string, priority: MemoryPriority = 'medium', signal?: AbortSignal): Promise<ChunkHandle> {
        const chunkId = this.resolveChunkId(url);
        if (!chunkId) {
            throw new Error(`URL not managed by streaming platform: ${url}`);
        }
        
        // 1. Trigger the controller to ensure it is fetched and inserted into MemoryManager
        await this.controller.requestChunk(chunkId);
        
        // 2. Wait in decoder queue (bounds CPU concurrency)
        this.emitObservabilityEvent('DECODER_QUEUE_WAIT', { chunkId, url, priority });
        const waitStart = performance.now();
        
        await this.decoderQueue.waitForTurn(chunkId, priority, signal);
        
        const queueWaitMs = performance.now() - waitStart;
        if (queueWaitMs > 50) { // Only emit if there was actual wait time
            this.emitObservabilityEvent('DECODER_QUEUE_SATURATED', { chunkId, url, queueWaitMs });
        }
        
        let decodeSlotHeld = true;
        const finishDecode = () => {
            if (!decodeSlotHeld) return;
            decodeSlotHeld = false;
            this.decoderQueue.notifyDecodeFinished();
        };

        // 3. Acquire memory handle. If acquisition fails, release the decoder slot.
        let handle: ChunkHandle;
        try {
            handle = this.memoryManager.acquire(chunkId);
        } catch (error) {
            finishDecode();
            throw error;
        }
        
        // 4. Wrap the handle to detect when decode finishes and advance queue
        const originalRelease = handle.release.bind(handle);
        handle.release = () => {
            try {
                originalRelease();
            } finally {
                finishDecode();
            }
        };
        
        return handle;
    }
    
    public dispose(): void {
        this.decoderQueue.dispose();
    }
}
