import { PersistentChunkCache, PersistentChunkEntry, PersistentChunkMetadata } from './PersistentChunkCache';
import { StreamingObservability } from './StreamingObservability';

export class PersistentStorageBudgetExceededError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PersistentStorageBudgetExceededError';
    }
}

export interface PersistentStorageEvictionOptions {
    maxPersistentBytes: number;
    observability?: StreamingObservability;
}

export class PersistentStorageEvictionController implements PersistentChunkCache {
    private delegate: PersistentChunkCache;
    private maxPersistentBytes: number;
    private observability: StreamingObservability;
    
    private metadata = new Map<string, PersistentChunkMetadata>();
    private trackedPersistentBytes: number = 0;
    private initialized: boolean = false;
    private isDisposed: boolean = false;
    
    // Concurrency queue
    private currentMutation: Promise<void> = Promise.resolve();

    constructor(delegate: PersistentChunkCache, options: PersistentStorageEvictionOptions) {
        this.delegate = delegate;
        this.maxPersistentBytes = options.maxPersistentBytes;
        this.observability = options.observability || new StreamingObservability();
    }
    
    private async ensureInitialized(): Promise<void> {
        if (this.initialized) return;
        
        const entries = await this.delegate.enumerateMetadata();
        for (const meta of entries) {
            this.metadata.set(meta.cacheKey, meta);
            this.trackedPersistentBytes += meta.size;
        }
        this.initialized = true;
    }

    public async get(cacheKey: string): Promise<PersistentChunkEntry | null> {
        if (this.isDisposed) return null;
        await this.ensureInitialized();
        
        const entry = await this.delegate.get(cacheKey);
        if (entry && this.metadata.has(cacheKey)) {
            // Update sequence in memory if delegate returned it (it does)
            if (entry.lastAccessSequence !== undefined) {
                this.metadata.get(cacheKey)!.lastAccessSequence = entry.lastAccessSequence;
            }
        }
        return entry;
    }

    public async put(entry: PersistentChunkEntry): Promise<void> {
        if (this.isDisposed) return;
        
        this.currentMutation = this.currentMutation.then(async () => {
            if (this.isDisposed) return;
            await this.ensureInitialized();

            if (entry.size > this.maxPersistentBytes) {
                this.observability.emit('PERSISTENT_STORAGE_BUDGET_EXCEEDED', { cacheKey: entry.cacheKey, size: entry.size });
                throw new PersistentStorageBudgetExceededError(`Entry size ${entry.size} exceeds maximum budget of ${this.maxPersistentBytes}`);
            }

            let existingSize = 0;
            const existing = this.metadata.get(entry.cacheKey);
            if (existing) {
                existingSize = existing.size;
            }

            let bytesToFree = (this.trackedPersistentBytes + entry.size - existingSize) - this.maxPersistentBytes;

            if (bytesToFree > 0) {
                this.observability.emit('PERSISTENT_STORAGE_EVICTION_START', { bytesNeeded: bytesToFree });

                // Identify candidates
                // We want to prefer evicting from other versions/games if we knew the active version.
                // But the interface doesn't give us the "active version".
                // We rely purely on LRU and lexical tie break.
                const candidates = Array.from(this.metadata.values())
                    .filter(m => m.cacheKey !== entry.cacheKey)
                    .sort((a, b) => {
                        if (a.lastAccessSequence !== b.lastAccessSequence) {
                            return a.lastAccessSequence - b.lastAccessSequence;
                        }
                        return a.cacheKey.localeCompare(b.cacheKey);
                    });

                let freedBytes = 0;
                const victims: string[] = [];
                
                for (const candidate of candidates) {
                    victims.push(candidate.cacheKey);
                    freedBytes += candidate.size;
                    if (freedBytes >= bytesToFree) break;
                }

                for (const cacheKey of victims) {
                    if (this.isDisposed) return;
                    try {
                        this.observability.emit('PERSISTENT_STORAGE_EVICTION', { cacheKey });
                        await this.delegate.delete(cacheKey);
                        
                        // Commit accounting
                        const victimMeta = this.metadata.get(cacheKey)!;
                        this.trackedPersistentBytes -= victimMeta.size;
                        this.metadata.delete(cacheKey);
                    } catch (e) {
                        this.observability.emit('PERSISTENT_STORAGE_DELETE_FAILURE', { cacheKey, reason: String(e) });
                        throw e; // Abort eviction on failure
                    }
                }
                this.observability.emit('PERSISTENT_STORAGE_EVICTION_COMPLETE', { freedBytes });
            }

            if (this.isDisposed) return;
            
            // Delegate put
            try {
                await this.delegate.put(entry);
                
                // Commit accounting
                if (!existing) {
                    this.trackedPersistentBytes += entry.size;
                } else {
                    this.trackedPersistentBytes += (entry.size - existing.size);
                }
                
                this.metadata.set(entry.cacheKey, {
                    cacheKey: entry.cacheKey,
                    cdnBaseUrl: entry.cdnBaseUrl,
                    chunkId: entry.chunkId,
                    sha256: entry.sha256,
                    size: entry.size,
                    // IndexedDB delegate should have set this on the entry
                    lastAccessSequence: entry.lastAccessSequence || 0
                });
            } catch (e) {
                // If it's a quota failure, observability is already handled by delegate.
                // We just propagate it and don't update accounting.
                throw e;
            }
        }).catch(e => {
            // Unhandled rejections in the mutation chain should not crash the app, 
            // but we need to pass them back if possible.
            // Wait, this is returned from put(), so the caller awaits it.
            throw e; 
        });
        
        return this.currentMutation;
    }

    public async delete(cacheKey: string): Promise<void> {
        if (this.isDisposed) return;
        
        this.currentMutation = this.currentMutation.then(async () => {
            if (this.isDisposed) return;
            await this.ensureInitialized();
            
            await this.delegate.delete(cacheKey);
            
            const existing = this.metadata.get(cacheKey);
            if (existing) {
                this.trackedPersistentBytes -= existing.size;
                this.metadata.delete(cacheKey);
            }
        });
        return this.currentMutation;
    }

    public async clearPrefix(cdnBaseUrlPrefix: string): Promise<void> {
        if (this.isDisposed) return;
        
        this.currentMutation = this.currentMutation.then(async () => {
            if (this.isDisposed) return;
            await this.ensureInitialized();
            
            await this.delegate.clearPrefix(cdnBaseUrlPrefix);
            
            // Re-calculate local metadata to stay in sync
            for (const [key, meta] of Array.from(this.metadata.entries() as any) as any) {
                if (meta.cdnBaseUrl.startsWith(cdnBaseUrlPrefix)) {
                    this.trackedPersistentBytes -= meta.size;
                    this.metadata.delete(key);
                }
            }
        });
        return this.currentMutation;
    }

    public async enumerateMetadata(): Promise<PersistentChunkMetadata[]> {
        await this.ensureInitialized();
        return Array.from(this.metadata.values());
    }
    
    public dispose(): void {
        this.isDisposed = true;
    }
    
    public getTrackedPersistentBytes(): number {
        return this.trackedPersistentBytes;
    }
}
