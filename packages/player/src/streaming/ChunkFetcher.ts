import { PersistentChunkCache, PersistentChunkEntry } from './PersistentChunkCache';
import { StreamingObservability } from './StreamingObservability';
import { StreamingRuntimeManifest } from './StreamingManifestLoader';

export class ChunkFetchNetworkError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ChunkFetchNetworkError';
    }
}

export class ChunkFetchHttpError extends Error {
    public status: number;
    constructor(status: number, message: string) {
        super(message);
        this.name = 'ChunkFetchHttpError';
        this.status = status;
    }
}

export class ChunkFetchAbortedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ChunkFetchAbortedError';
    }
}

export class ChunkIntegrityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ChunkIntegrityError';
    }
}

export class ChunkNotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ChunkNotFoundError';
    }
}

export interface FetchedChunk {
    id: string;
    data: ArrayBuffer;
    size: number;
    sha256: string;
}

export interface FetchChunkOptions {
    signal?: AbortSignal;
    timeout?: number;
    context?: 'foreground' | 'background';
}

type QueueTask = {
    priority: number;
    execute: () => Promise<void>;
};

class ConcurrencyQueue {
    private maxConcurrent: number;
    private active = 0;
    private waiting: QueueTask[] = [];

    constructor(maxConcurrent: number) {
        this.maxConcurrent = maxConcurrent;
    }

    async enqueue<T>(priority: number, fn: () => Promise<T>, signal?: AbortSignal, abortErrorFactory?: () => Error): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (signal?.aborted) {
                return reject(abortErrorFactory ? abortErrorFactory() : new Error('Aborted'));
            }

            let taskAbort: () => void;
                
            const cleanup = () => {
                if (signal && taskAbort) signal.removeEventListener('abort', taskAbort);
            };
                
            const origResolve = resolve;
            resolve = (val) => { cleanup(); origResolve(val); };
            const origReject = reject;
            reject = (err) => { cleanup(); origReject(err); };

            const task: QueueTask = {
                priority,
                execute: async () => {
                    this.active++;
                    try {
                        const result = await fn();
                        resolve(result);
                    } catch (err) {
                        reject(err);
                    } finally {
                        this.active--;
                        this.pump();
                    }
                }
            };

            taskAbort = () => {
                const idx = this.waiting.indexOf(task);
                if (idx !== -1) {
                    this.waiting.splice(idx, 1);
                    reject(abortErrorFactory ? abortErrorFactory() : new Error('Aborted'));
                }
            };

            if (signal) {
                signal.addEventListener('abort', taskAbort);
            }

            this.waiting.push(task);
            this.waiting.sort((a, b) => a.priority - b.priority);
            this.pump();
        });
    }

    private pump() {
        if (this.active < this.maxConcurrent && this.waiting.length > 0) {
            const task = this.waiting.pop();
            if (task) {
                task.execute();
            }
        }
    }
}

export class ChunkFetcher {
    private manifest: StreamingRuntimeManifest;
    private cdnBaseUrl: string;
    private queue: ConcurrencyQueue;
       
    private sessionCache = new Map<string, Promise<FetchedChunk>>();
    private taskControllers = new Map<string, AbortController>();
    private taskSubscribers = new Map<string, Set<any>>();

    constructor(
        manifest: StreamingRuntimeManifest, 
        cdnBaseUrl: string,
        maxConcurrentDownloads = 4,
        private observability: StreamingObservability = new StreamingObservability(),
        private persistentCache?: PersistentChunkCache
    ) {
        this.manifest = manifest;
        this.cdnBaseUrl = cdnBaseUrl.replace(/\/+$/, '');
        this.queue = new ConcurrencyQueue(maxConcurrentDownloads);
    }

    public async fetchChunk(id: string, options?: FetchChunkOptions): Promise<FetchedChunk> {
        this.observability.emit('CHUNK_REQUEST_START', { chunkId: id });
        const startTime = performance.now();
        try {
            const chunk = await this.doFetchChunkWithCache(id, options);
            this.observability.emit('CHUNK_REQUEST_SUCCESS', { 
                chunkId: id, 
                byteSize: chunk.size,
                durationMs: performance.now() - startTime 
            });
            return chunk;
        } catch (err: any) {
            if (err.name === 'ChunkFetchAbortedError') {
                this.observability.emit('CHUNK_REQUEST_ABORTED', { chunkId: id, durationMs: performance.now() - startTime });
            } else if (err.name === 'ChunkFetchTimeoutError' || err.message?.includes('timed out')) {
                this.observability.emit('CHUNK_REQUEST_TIMEOUT', { chunkId: id, durationMs: performance.now() - startTime });
            } else if (err.name === 'ChunkIntegrityError') {
                this.observability.emit('CHUNK_INTEGRITY_FAILURE', { chunkId: id, durationMs: performance.now() - startTime });
            } else {
                const category = err.name === 'ChunkFetchNetworkError' ? 'NETWORK' :
                                 err.name === 'ChunkFetchHttpError' ? 'HTTP' : 'UNKNOWN';
                this.observability.emit('CHUNK_REQUEST_FAILURE', { 
                    chunkId: id, 
                    category, 
                    status: err.status,
                    durationMs: performance.now() - startTime 
                });
            }
            throw err;
        }
    }

    private async doFetchChunkWithCache(id: string, options?: FetchChunkOptions): Promise<FetchedChunk> {
        if (!this.manifest.chunks.has(id)) {
            throw new ChunkNotFoundError(`Chunk ${id} not found in manifest.`);
        }

        if (options?.signal?.aborted) {
            throw new ChunkFetchAbortedError(`Fetch for ${id} aborted`);
        }

        let inFlight = this.sessionCache.get(id);
        if (!inFlight) {
            const controller = new AbortController();
            this.taskControllers.set(id, controller);
            this.taskSubscribers.set(id, new Set());

            inFlight = this.doFetchChunk(id, controller.signal, options).finally(() => {
                this.taskControllers.delete(id); 
                this.sessionCache.delete(id);
                this.taskSubscribers.delete(id);
            });
            this.sessionCache.set(id, inFlight);
        }

        const subscribers = this.taskSubscribers.get(id);
        const subscriberId = Symbol();
        if (subscribers) {
            subscribers.add(subscriberId);
        }

        return new Promise<FetchedChunk>((resolve, reject) => {
            const onExternalAbort = () => {
                if (subscribers) {
                    subscribers.delete(subscriberId);
                    if (subscribers.size === 0) {
                        const controller = this.taskControllers.get(id);
                        if (controller) {
                            controller.abort();
                        }
                    }
                }
                reject(new ChunkFetchAbortedError(`Fetch for ${id} aborted`));
            };

            if (options?.signal?.aborted) {
                onExternalAbort();
                return;
            }

            if (options?.signal) {
                options.signal.addEventListener('abort', onExternalAbort);
            }

            inFlight.then(chunk => {
                resolve(chunk);
            }).catch(err => {
                if (this.sessionCache.get(id) === inFlight) {
                    this.sessionCache.delete(id);
                }
                reject(err);
            }).finally(() => {
                if (options?.signal) {
                    options.signal.removeEventListener('abort', onExternalAbort);
                }
                if (subscribers) {
                    subscribers.delete(subscriberId);
                }
            });
        });
    }

    private async doFetchChunk(id: string, signal: AbortSignal, options?: FetchChunkOptions): Promise<FetchedChunk> {
        const chunkDef = this.manifest.chunks.get(id)!;
        
        if (this.persistentCache) {
            const cacheKey = `${this.cdnBaseUrl}|${id}|${chunkDef.hash}`;
            try {
                const cachedEntry = await this.persistentCache.get(cacheKey);
                if (cachedEntry) {
                    // Validate metadata
                    if (cachedEntry.chunkId === id && cachedEntry.sha256 === chunkDef.hash && cachedEntry.size === chunkDef.size && cachedEntry.cdnBaseUrl === this.cdnBaseUrl) {
                        // Verify SHA-256
                        const hashBuffer = await crypto.subtle.digest('SHA-256', cachedEntry.data);
                        const hashArray = Array.from(new Uint8Array(hashBuffer));
                        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                        const actualHash = `sha256-${hashHex}`;
                        
                        if (actualHash === chunkDef.hash) {
                            return {
                                id,
                                data: cachedEntry.data,
                                size: cachedEntry.size,
                                sha256: actualHash
                            };
                        } else {
                            // Corrupted cache
                            this.observability.emit('PERSISTENT_CACHE_CORRUPTION', { cacheKey, expected: chunkDef.hash, got: actualHash });
                            await this.persistentCache.delete(cacheKey);
                        }
                    } else {
                        // Metadata mismatch
                        this.observability.emit('PERSISTENT_CACHE_CORRUPTION', { cacheKey, reason: 'metadata mismatch' });
                        await this.persistentCache.delete(cacheKey);
                    }
                }
            } catch (e) {
                // Ignore persistent cache read errors, fallback to network
            }
        }
        
        // 1. Resolve and fetch dependencies first
        // Moved to StreamingRuntimeController

        if (signal.aborted) {
            throw new ChunkFetchAbortedError(`Fetch for ${id} aborted`);
        }

        // 2. Queue for concurrency slot
        const priorityScore = this.getPriorityScore(chunkDef.priority, options?.context || 'foreground');
        const abortFactory = () => new ChunkFetchAbortedError(`Fetch for ${id} aborted`);
        
        const queueWaitStart = performance.now();
        this.observability.emit('QUEUE_WAIT', { chunkId: id });
        return await this.queue.enqueue(priorityScore, async () => {
            const queueWaitMs = performance.now() - queueWaitStart;
            this.observability.emit('QUEUE_DISPATCH', { chunkId: id, queueWaitMs });
            if ((this.queue as any).active === (this.queue as any).maxConcurrent && !(this.queue as any).saturated) {
                (this.queue as any).saturated = true;
                this.observability.emit('QUEUE_SATURATED', { 
                    activeDownloads: (this.queue as any).active,
                    maxConcurrentDownloads: (this.queue as any).maxConcurrent
                });
            } else if ((this.queue as any).active < (this.queue as any).maxConcurrent) {
                (this.queue as any).saturated = false;
            }
            if (signal.aborted) {
                throw new ChunkFetchAbortedError(`Fetch for ${id} aborted`);
            }

            const fetchController = new AbortController();
            const onParentAbort = () => fetchController.abort();
            signal.addEventListener('abort', onParentAbort);
            
            let timer: ReturnType<typeof setTimeout> | null = null;
            if (options?.timeout) {
                timer = setTimeout(() => fetchController.abort(new Error('TIMEOUT')), options.timeout);
            }

            try {
                const chunkUrl = `${this.cdnBaseUrl}/${chunkDef.url}`;
                let response: Response;
                
                try {
                    response = await fetch(chunkUrl, {
                        method: 'GET',
                        credentials: 'omit',
                        cache: 'force-cache', // Transport cache: reuse immutable chunk responses
                        signal: fetchController.signal
                    });
                } catch (e: any) {
                    if (fetchController.signal.aborted) {
                        if (fetchController.signal.reason?.message === 'TIMEOUT' || e?.message === 'TIMEOUT' || e?.name === 'TimeoutError') {
                            throw new ChunkFetchNetworkError(`Fetch for ${id} timed out`);
                        }
                        throw new ChunkFetchAbortedError(`Fetch for ${id} aborted`);
                    }
                    throw new ChunkFetchNetworkError(`Network error while fetching ${id}: ${e instanceof Error ? e.message : String(e)}`);
                }

                if (!response.ok) {
                    if (response.status === 404) throw new ChunkFetchHttpError(response.status, `Chunk ${id} not found on CDN`);
                    throw new ChunkFetchHttpError(response.status, `HTTP error ${response.status} while fetching ${id}`);
                }

                let buffer: ArrayBuffer;
                try {
                    buffer = await response.arrayBuffer();
                } catch (e: any) {
                    if (fetchController.signal.aborted) {
                        throw new ChunkFetchAbortedError(`Fetch for ${id} aborted during read`);
                    }
                    throw new ChunkFetchNetworkError(`Failed to read body for ${id}: ${e instanceof Error ? e.message : String(e)}`);
                }

                if (buffer.byteLength !== chunkDef.size) {
                    throw new ChunkIntegrityError(`Chunk ${id} size check failed. Expected ${chunkDef.size} bytes, got ${buffer.byteLength}`);
                }

                const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                const actualHash = `sha256-${hashHex}`;

                if (actualHash !== chunkDef.hash) {
                    throw new ChunkIntegrityError(`Chunk ${id} integrity check failed. Expected ${chunkDef.hash}, got ${actualHash}`);
                }

                const fetchedChunk = {
                    id,
                    data: buffer,
                    size: buffer.byteLength,
                    sha256: actualHash
                };
                
                if (this.persistentCache) {
                    const cacheKey = `${this.cdnBaseUrl}|${id}|${chunkDef.hash}`;
                    // Write asynchronously, do not wait for it to finish, wait, the instructions say "Only persist a chunk AFTER ... successful integrity validation ... persistent cache write. If persistent cache writing fails ... The chunk itself must still be usable."
                    // Let's await it but catch errors so it doesn't fail the fetch
                    try {
                        // We must copy the buffer because we are handing it off? ArrayBuffer is transferable, but IDB structured clone copies it.
                        await this.persistentCache.put({
                            cacheKey,
                            cdnBaseUrl: this.cdnBaseUrl,
                            chunkId: id,
                            sha256: actualHash,
                            size: buffer.byteLength,
                            data: buffer.slice(0) // Safe copy for IDB
                        });
                    } catch (e) {
                        // Ignore write error, chunk is still valid
                    }
                }

                return fetchedChunk;

            } finally {
                signal.removeEventListener('abort', onParentAbort);
                if (timer) clearTimeout(timer);
            }
        }, signal, abortFactory);
    }

    private getPriorityScore(priority: string, context: 'foreground' | 'background'): number {
        let score = 0;
        switch (priority) {
            case 'critical': score = 3; break;
            case 'high': score = 2; break;
            case 'medium': score = 1; break;
            case 'low': score = 0; break;
            default: score = 0; break;
        }
        if (context === 'background') {
            score -= 10;
        }
        return score;
    }
}
