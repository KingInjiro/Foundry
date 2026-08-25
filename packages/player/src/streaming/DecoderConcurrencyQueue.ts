import { ChunkHandle } from './MemoryBudgetManager';
import type { MemoryPriority } from '@foundry/contracts/streaming/types';

const PRIORITY_SCORES: Record<MemoryPriority, number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3
};

interface QueuedDecode {
    chunkId: string;
    priority: MemoryPriority;
    resolve: () => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    abortHandler?: () => void;
}

export class DecoderConcurrencyQueue {
    private maxConcurrent: number;
    private activeDecodes: number = 0;
    private queue: QueuedDecode[] = [];
    private isDisposed = false;

    constructor(maxConcurrent: number = 2) {
        this.maxConcurrent = maxConcurrent;
    }

    public get activeCount(): number {
        return this.activeDecodes;
    }

    public async waitForTurn(chunkId: string, priority: MemoryPriority = 'medium', signal?: AbortSignal): Promise<void> {
        if (this.isDisposed) {
            throw new Error('Decoder queue is disposed');
        }

        const promise = new Promise<void>((resolve, reject) => {
            if (signal?.aborted) {
                return reject(new Error('Decode aborted before queuing'));
            }

            const item: QueuedDecode = {
                chunkId,
                priority,
                resolve,
                reject,
                signal
            };

            if (signal) {
                item.abortHandler = () => {
                    const idx = this.queue.indexOf(item);
                    if (idx !== -1) {
                        this.queue.splice(idx, 1);
                        reject(new Error('Decode aborted while queued'));
                    }
                };
                signal.addEventListener('abort', item.abortHandler);
            }

            this.queue.push(item);
            this.pump();
        });

        await promise;
    }

    public notifyDecodeFinished(): void {
        this.activeDecodes = Math.max(0, this.activeDecodes - 1);
        this.pump();
    }

    private pump(): void {
        if (this.isDisposed) return;
        
        while (this.activeDecodes < this.maxConcurrent && this.queue.length > 0) {
            // Sort to ensure highest priority is taken first
            this.queue.sort((a, b) => PRIORITY_SCORES[b.priority] - PRIORITY_SCORES[a.priority]);
            
            const next = this.queue.shift()!;
            
            if (next.signal && next.abortHandler) {
                next.signal.removeEventListener('abort', next.abortHandler);
            }
            
            this.activeDecodes++;
            next.resolve();
        }
    }

    public dispose(): void {
        this.isDisposed = true;
        for (const item of this.queue) {
            if (item.signal && item.abortHandler) {
                item.signal.removeEventListener('abort', item.abortHandler);
            }
            item.reject(new Error('Decoder queue disposed'));
        }
        this.queue = [];
    }
}
