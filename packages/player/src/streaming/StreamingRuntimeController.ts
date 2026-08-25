import { StreamingObservability } from './StreamingObservability';
import { StreamingRuntimeManifest } from './StreamingManifestLoader';
import { ChunkFetcher, FetchedChunk } from './ChunkFetcher';
import { MemoryBudgetManager } from './MemoryBudgetManager';
import { PrefetchController } from './PrefetchController';

export type StreamingRuntimeState = 'CREATED' | 'INITIALIZING' | 'READY' | 'DISPOSING' | 'DISPOSED';

export interface StreamingRuntimeStatus {
    state: StreamingRuntimeState;
    loadedChunkCount: number;
    loadingChunkCount: number;
    failedChunkCount: number;
    preloadTotal: number;
    preloadCompleted: number;
}

export class StreamingRuntimeController {
    private observability: StreamingObservability;
    private manifest: StreamingRuntimeManifest;
    private fetcher: ChunkFetcher;
    private memoryManager: MemoryBudgetManager;
    private _state: StreamingRuntimeState = 'CREATED';
    
    private requestedChunks = new Set<string>();
    private loadingChunks = new Set<string>();
    private loadedChunks = new Set<string>();
    private failedChunks = new Set<string>();
    
    private inFlightRequests = new Map<string, Promise<void>>();
    private abortController = new AbortController();
    private prefetchController: PrefetchController;

    constructor(
        manifest: StreamingRuntimeManifest,
        fetcher: ChunkFetcher,
        memoryManager: MemoryBudgetManager,
        observability: StreamingObservability = new StreamingObservability(),
        options?: { maxConcurrentPrefetches?: number }
    ) {
        this.observability = observability;
        this.manifest = manifest;
        this.fetcher = fetcher;
        this.memoryManager = memoryManager;
        this.prefetchController = new PrefetchController(manifest, memoryManager, (chunkId, opts) => this.requestChunk(chunkId, opts), { observability, maxConcurrentPrefetches: options?.maxConcurrentPrefetches });
    }

    public async initialize(): Promise<void> {
        if (this._state !== 'CREATED') {
            throw new Error('Controller can only be initialized once');
        }
        this._state = 'INITIALIZING';
        this.observability.emit('CONTROLLER_INITIALIZE_START');
        const startTime = performance.now();
        
        try {
            const entryChunkId = this.manifest.runtime?.entry;
            const bootstrapPromises: Promise<void>[] = [];
            
            if (entryChunkId && this.manifest.chunks.has(entryChunkId)) {
                bootstrapPromises.push(this.requestChunk(entryChunkId));
            }
            
            await Promise.all(bootstrapPromises);
            
            if (this._state as any === 'DISPOSED') return;
            this._state = 'READY';
            this.observability.emit('CONTROLLER_READY', { durationMs: performance.now() - startTime });
            
            this.prefetchController.start();
        } catch (err) {
            this._state = 'DISPOSED';
            this.observability.emit('CONTROLLER_INITIALIZE_FAILURE', { durationMs: performance.now() - startTime });
            throw err;
        }
    }
    
    

    public async requestChunk(chunkId: string, options?: { context?: 'foreground' | 'background' }): Promise<void> {
        if ((this._state as StreamingRuntimeState) === 'DISPOSED' || (this._state as StreamingRuntimeState) === 'DISPOSING') {
            throw new Error('Controller is disposed');
        }
        
        if (this.loadedChunks.has(chunkId)) {
            return;
        }
        
        if (this.inFlightRequests.has(chunkId)) {
            return this.inFlightRequests.get(chunkId)!;
        }
        
        const promise = this.doRequestChunk(chunkId, options);
        this.inFlightRequests.set(chunkId, promise);
        
        try {
            await promise;
        } finally {
            this.inFlightRequests.delete(chunkId);
        }
    }
    
    private async doRequestChunk(chunkId: string, options?: { context?: 'foreground' | 'background' }): Promise<void> {
        if (!this.manifest.chunks.has(chunkId)) {
            throw new Error(`Chunk ${chunkId} not found in manifest.`);
        }

        const deps = this.manifest.dependencies.get(chunkId) || [];
        if (deps.length > 0) {
            this.observability.emit('DEPENDENCY_RESOLUTION_START', { chunkId, dependencyCount: deps.length });
            await Promise.all(deps.map(depId => this.requestChunk(depId, options)));
            this.observability.emit('DEPENDENCY_RESOLUTION_COMPLETE', { chunkId, dependencyCount: deps.length });
        }

        if ((this._state as StreamingRuntimeState) === 'DISPOSED' || (this._state as StreamingRuntimeState) === 'DISPOSING') {
            throw new Error('Controller is disposed');
        }

        this.requestedChunks.add(chunkId);
        this.loadingChunks.add(chunkId);
        
        try {
            const fetchedChunk = await this.fetcher.fetchChunk(chunkId, { signal: this.abortController.signal, context: options?.context || 'foreground' });
            
            // Race condition check: controller might have been disposed while fetching
            if (this._state === 'DISPOSED' || this._state === 'DISPOSING') {
                throw new Error('Controller is disposed');
            }
            
            this.memoryManager.insert(fetchedChunk);
            
            this.loadedChunks.add(chunkId);
            this.failedChunks.delete(chunkId);
        } catch (err) {
            if ((this._state as StreamingRuntimeState) !== 'DISPOSING' && (this._state as StreamingRuntimeState) !== 'DISPOSED') {
                this.failedChunks.add(chunkId);
            }
            throw err;
        } finally {
            this.loadingChunks.delete(chunkId);
        }
    }

    public getStatus(): StreamingRuntimeStatus {
        let preloadTotal = 0;
        let preloadCompleted = 0;
        
        for (const [id, chunk] of Array.from(this.manifest.chunks.entries())) {
            if (chunk.preload || id === this.manifest.runtime?.entry) {
                preloadTotal++;
                if (this.loadedChunks.has(id)) {
                    preloadCompleted++;
                }
            }
        }
        
        return {
            state: this._state,
            loadedChunkCount: this.loadedChunks.size,
            loadingChunkCount: this.loadingChunks.size,
            failedChunkCount: this.failedChunks.size,
            preloadTotal,
            preloadCompleted
        };
    }

    public dispose(): void {
        if (this._state === 'DISPOSED' || this._state === 'DISPOSING') {
            return;
        }
        this.observability.emit('CONTROLLER_DISPOSE_START');
        this._state = 'DISPOSING';
        this.abortController.abort();
        if (this.prefetchController) this.prefetchController.dispose();
        this.inFlightRequests.clear();
        this.loadingChunks.clear();
        // requestedChunks and loadedChunks remain for introspection, but no new ones
        this._state = 'DISPOSED';
        this.observability.emit('CONTROLLER_DISPOSED');
    }
}
