import { StreamingObservability } from './StreamingObservability';
import { FetchedChunk } from './ChunkFetcher';

export class ChunkMemoryBudgetExceededError extends Error {
    public requestedSize: number;
    public maxMemoryBytes: number;
    public chunkId: string;

    constructor(message: string, requestedSize: number, maxMemoryBytes: number, chunkId: string) {
        super(message);
        this.name = 'ChunkMemoryBudgetExceededError';
        this.requestedSize = requestedSize;
        this.maxMemoryBytes = maxMemoryBytes;
        this.chunkId = chunkId;
    }
}

export interface MemoryBudgetOptions {
    maxMemoryBytes: number;
    observability?: StreamingObservability;
}

export interface MemoryBudgetSnapshot {
    currentMemoryBytes: number;
    maxMemoryBytes: number;
    availableMemoryBytes: number;
    entryCount: number;
}

interface ManagedChunk {
    id: string;
    data: ArrayBuffer;
    size: number;
    sha256: string;
    lastAccess: number;
    refCount: number;
}

export class ChunkHandle {
    private chunk: ManagedChunk;
    private manager: MemoryBudgetManager;
    private released = false;

    constructor(chunk: ManagedChunk, manager: MemoryBudgetManager) {
        this.chunk = chunk;
        this.manager = manager;
    }

    public get id(): string { return this.chunk.id; }
    public get data(): ArrayBuffer { return this.chunk.data; }
    public get size(): number { return this.chunk.size; }
    public get sha256(): string { return this.chunk.sha256; }

    public release(): void {
        if (!this.released) {
            this.released = true;
            this.manager.releaseChunk(this.chunk.id);
        }
    }
}

export class MemoryBudgetManager {
    private maxMemoryBytes: number;
    private currentMemoryBytes: number = 0;
    private observability: StreamingObservability;
    
    private store: Map<string, ManagedChunk> = new Map();
    private accessSequence: number = 0;

    constructor(options: MemoryBudgetOptions) {
        this.observability = options.observability || new StreamingObservability();
        if (!Number.isFinite(options.maxMemoryBytes) || !Number.isInteger(options.maxMemoryBytes) || options.maxMemoryBytes <= 0) {
            throw new Error('maxMemoryBytes must be a finite positive integer');
        }
        this.maxMemoryBytes = options.maxMemoryBytes;
    }

    public insert(chunk: FetchedChunk): void {
        if (!chunk || !chunk.id || !chunk.data || !(chunk.data instanceof ArrayBuffer) || typeof chunk.size !== 'number' || chunk.size < 0 || !Number.isFinite(chunk.size) || chunk.size !== chunk.data.byteLength) {
            throw new Error('Invalid FetchedChunk provided to insert');
        }

        if (chunk.size > this.maxMemoryBytes) {
            this.observability.emit('MEMORY_BUDGET_EXCEEDED', {
                requestedBytes: chunk.size,
                currentMemoryBytes: this.currentMemoryBytes,
                maxMemoryBytes: this.maxMemoryBytes
            });
            throw new ChunkMemoryBudgetExceededError(
                `Chunk ${chunk.id} size (${chunk.size}) exceeds total memory budget (${this.maxMemoryBytes})`,
                chunk.size,
                this.maxMemoryBytes,
                chunk.id
            );
        }

        const existing = this.store.get(chunk.id);
        
        if (existing) {
            if (existing.sha256 !== chunk.sha256) {
                throw new Error(`Chunk ${chunk.id} is already inserted with a different hash`);
            }
            this.accessSequence++;
            existing.lastAccess = this.accessSequence;
            return;
        }

        const requiredMemory = chunk.size;
        const toEvict: string[] = [];
        let projectedMemory = this.currentMemoryBytes;

        if (projectedMemory + requiredMemory > this.maxMemoryBytes) {
            const eligible = Array.from(this.store.values()).filter(c => c.refCount === 0);
            
            eligible.sort((a, b) => {
                if (a.lastAccess !== b.lastAccess) {
                    return a.lastAccess - b.lastAccess;
                }
                return a.id.localeCompare(b.id);
            });

            for (const c of eligible) {
                toEvict.push(c.id);
                projectedMemory -= c.size;
                if (projectedMemory + requiredMemory <= this.maxMemoryBytes) {
                    break;
                }
            }

            if (projectedMemory + requiredMemory > this.maxMemoryBytes) {
                this.observability.emit('MEMORY_BUDGET_EXCEEDED', {
                    requestedBytes: requiredMemory,
                    currentMemoryBytes: this.currentMemoryBytes,
                    maxMemoryBytes: this.maxMemoryBytes
                });
                throw new ChunkMemoryBudgetExceededError(
                    `Cannot free enough memory to insert chunk ${chunk.id} (needs ${requiredMemory} bytes, ${projectedMemory} bytes remain actively used out of ${this.maxMemoryBytes})`,
                    requiredMemory,
                    this.maxMemoryBytes,
                    chunk.id
                );
            }
        }

        for (const id of toEvict) {
            const c = this.store.get(id);
            if (c) {
                this.currentMemoryBytes -= c.size;
                this.store.delete(id);
                this.observability.emit('MEMORY_EVICTION', {
                    evictedChunkId: id,
                    evictedBytes: c.size,
                    currentMemoryBytes: this.currentMemoryBytes
                });
            }
        }

        this.accessSequence++;
        this.store.set(chunk.id, {
            id: chunk.id,
            data: chunk.data,
            size: chunk.size,
            sha256: chunk.sha256,
            lastAccess: this.accessSequence,
            refCount: 0
        });
        this.currentMemoryBytes += chunk.size;
        this.observability.emit('MEMORY_INSERT', {
            chunkId: chunk.id,
            byteSize: chunk.size,
            currentMemoryBytes: this.currentMemoryBytes,
            maxMemoryBytes: this.maxMemoryBytes
        });
    }

    public acquire(chunkId: string): ChunkHandle {
        const chunk = this.store.get(chunkId);
        if (!chunk) {
            throw new Error(`Chunk ${chunkId} not found in memory`);
        }
        
        this.accessSequence++;
        chunk.lastAccess = this.accessSequence;
        chunk.refCount++;
        
        return new ChunkHandle(chunk, this);
    }
    
    /** @internal called by ChunkHandle.release() */
    public releaseChunk(chunkId: string): void {
        const chunk = this.store.get(chunkId);
        if (chunk) {
            if (chunk.refCount > 0) {
                chunk.refCount--;
            }
        }
    }

    public getSnapshot(): MemoryBudgetSnapshot {
        return {
            currentMemoryBytes: this.currentMemoryBytes,
            maxMemoryBytes: this.maxMemoryBytes,
            availableMemoryBytes: this.maxMemoryBytes - this.currentMemoryBytes,
            entryCount: this.store.size
        };
    }
}
