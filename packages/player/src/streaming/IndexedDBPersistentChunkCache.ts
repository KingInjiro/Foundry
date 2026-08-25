import { StreamingObservability } from './StreamingObservability';
import { PersistentChunkCache, PersistentChunkEntry, PersistentChunkMetadata } from './PersistentChunkCache';

const DB_NAME = 'FoundryStreamingCache';
const DB_VERSION = 2; // Incremented for chunks_metadata
const STORE_NAME = 'chunks';
const METADATA_STORE_NAME = 'chunks_metadata';

export class IndexedDBPersistentChunkCache implements PersistentChunkCache {
    private dbPromise: Promise<IDBDatabase> | null = null;
    private observability: StreamingObservability;
    private accessSequence: number = 0;
    private sequenceInitialized: boolean = false;

    constructor(observability: StreamingObservability = new StreamingObservability()) {
        this.observability = observability;
    }

    private getDb(): Promise<IDBDatabase> {
        if (!this.dbPromise) {
            this.dbPromise = new Promise((resolve, reject) => {
                if (typeof indexedDB === 'undefined') {
                    return reject(new Error('IndexedDB is not available'));
                }

                const request = indexedDB.open(DB_NAME, DB_VERSION);

                request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
                    const db = (event.target as IDBOpenDBRequest).result;
                    const transaction = (event.target as IDBOpenDBRequest).transaction;

                    if (event.oldVersion < 1) {
                        const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
                        store.createIndex('cdnBaseUrl', 'cdnBaseUrl', { unique: false });
                    }

                    if (event.oldVersion < 2) {
                        const metadataStore = db.createObjectStore(METADATA_STORE_NAME, { keyPath: 'cacheKey' });
                        metadataStore.createIndex('cdnBaseUrl', 'cdnBaseUrl', { unique: false });

                        // Migrate existing
                        if (transaction) {
                            const chunksStore = transaction.objectStore(STORE_NAME);
                            chunksStore.openCursor().onsuccess = (e) => {
                                const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
                                if (cursor) {
                                    const value = cursor.value;
                                    metadataStore.put({
                                        cacheKey: value.cacheKey,
                                        cdnBaseUrl: value.cdnBaseUrl,
                                        chunkId: value.chunkId,
                                        sha256: value.sha256,
                                        size: value.size,
                                        lastAccessSequence: 0
                                    });
                                    cursor.continue();
                                }
                            };
                        }
                    }
                };

                request.onsuccess = (event: Event) => {
                    resolve((event.target as IDBOpenDBRequest).result);
                };

                request.onerror = (event: Event) => {
                    reject(new Error(`Failed to open IndexedDB: ${(event.target as IDBOpenDBRequest).error?.message}`));
                };
            });
        }
        return this.dbPromise;
    }

    private async initializeSequence(db: IDBDatabase): Promise<void> {
        if (this.sequenceInitialized) return;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(METADATA_STORE_NAME, 'readonly');
            const store = transaction.objectStore(METADATA_STORE_NAME);
            const request = store.openCursor(null, 'prev'); // get highest key? No, this gets highest cacheKey. 
            // Wait, to get highest sequence, we'd need an index. But we can just scan them all since we'll scan anyway.
            // But we can just scan metadata fast.
            let maxSeq = 0;
            const cursorReq = store.openCursor();
            cursorReq.onsuccess = (e) => {
                const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
                if (cursor) {
                    if (cursor.value.lastAccessSequence > maxSeq) {
                        maxSeq = cursor.value.lastAccessSequence;
                    }
                    cursor.continue();
                } else {
                    this.accessSequence = maxSeq;
                    this.sequenceInitialized = true;
                    resolve();
                }
            };
            cursorReq.onerror = () => reject(cursorReq.error);
        });
    }

    public async get(cacheKey: string): Promise<PersistentChunkEntry | null> {
        try {
            const db = await this.getDb();
            await this.initializeSequence(db);
            
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORE_NAME, METADATA_STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const metadataStore = transaction.objectStore(METADATA_STORE_NAME);
                
                const request = store.get(cacheKey);
                request.onsuccess = () => {
                    if (request.result) {
                        this.accessSequence++;
                        const entry = request.result as PersistentChunkEntry;
                        entry.lastAccessSequence = this.accessSequence;
                        
                        // Update metadata
                        metadataStore.get(cacheKey).onsuccess = (e) => {
                            const meta = (e.target as IDBRequest).result as PersistentChunkMetadata;
                            if (meta) {
                                meta.lastAccessSequence = this.accessSequence;
                                metadataStore.put(meta);
                            }
                        };
                        
                        this.observability.emit('PERSISTENT_CACHE_HIT', { cacheKey });
                        resolve(entry);
                    } else {
                        this.observability.emit('PERSISTENT_CACHE_MISS', { cacheKey });
                        resolve(null);
                    }
                };
                request.onerror = () => {
                    reject(new Error(`Failed to read from PersistentCache: ${request.error?.message}`));
                };
            });
        } catch (e) {
            this.observability.emit('PERSISTENT_CACHE_UNAVAILABLE', { cacheKey, reason: e instanceof Error ? e.message : String(e) });
            return null;
        }
    }

    public async put(entry: PersistentChunkEntry): Promise<void> {
        try {
            const db = await this.getDb();
            await this.initializeSequence(db);
            
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORE_NAME, METADATA_STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const metadataStore = transaction.objectStore(METADATA_STORE_NAME);
                
                this.accessSequence++;
                entry.lastAccessSequence = this.accessSequence;
                
                const request = store.put(entry);
                
                const meta: PersistentChunkMetadata = {
                    cacheKey: entry.cacheKey,
                    cdnBaseUrl: entry.cdnBaseUrl,
                    chunkId: entry.chunkId,
                    sha256: entry.sha256,
                    size: entry.size,
                    lastAccessSequence: this.accessSequence
                };
                metadataStore.put(meta);
                
                transaction.oncomplete = () => {
                    this.observability.emit('PERSISTENT_CACHE_WRITE', { cacheKey: entry.cacheKey, size: entry.size });
                    resolve();
                };
                
                transaction.onerror = () => {
                    const error = request.error || transaction.error;
                    if (error?.name === 'QuotaExceededError') {
                        this.observability.emit('PERSISTENT_CACHE_QUOTA_FAILURE', { cacheKey: entry.cacheKey, size: entry.size });
                    } else {
                        this.observability.emit('PERSISTENT_CACHE_WRITE_FAILURE', { cacheKey: entry.cacheKey, reason: error?.message });
                    }
                    reject(error);
                };
                
                request.onerror = () => {
                    if (request.error?.name === 'QuotaExceededError') {
                        this.observability.emit('PERSISTENT_CACHE_QUOTA_FAILURE', { cacheKey: entry.cacheKey, size: entry.size });
                    } else {
                        this.observability.emit('PERSISTENT_CACHE_WRITE_FAILURE', { cacheKey: entry.cacheKey, reason: request.error?.message });
                    }
                    reject(request.error);
                };
            });
        } catch (e) {
             this.observability.emit('PERSISTENT_CACHE_UNAVAILABLE', { cacheKey: entry.cacheKey, reason: e instanceof Error ? e.message : String(e) });
        }
    }

    public async delete(cacheKey: string): Promise<void> {
        try {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORE_NAME, METADATA_STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const metadataStore = transaction.objectStore(METADATA_STORE_NAME);
                
                const request = store.delete(cacheKey);
                metadataStore.delete(cacheKey);
                
                transaction.oncomplete = () => {
                    this.observability.emit('PERSISTENT_CACHE_DELETE', { cacheKey });
                    resolve();
                };
                request.onerror = () => {
                    reject(request.error);
                };
            });
        } catch (e) {
            // fail safe
        }
    }

    public async clearPrefix(cdnBaseUrlPrefix: string): Promise<void> {
        try {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORE_NAME, METADATA_STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const metadataStore = transaction.objectStore(METADATA_STORE_NAME);
                
                const index = store.index('cdnBaseUrl');
                const range = IDBKeyRange.bound(cdnBaseUrlPrefix, cdnBaseUrlPrefix + '￿');
                const request = index.openCursor(range);
                
                request.onsuccess = (event: Event) => {
                    const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
                    if (cursor) {
                        cursor.delete();
                        metadataStore.delete(cursor.value.cacheKey);
                        cursor.continue();
                    } else {
                        this.observability.emit('PERSISTENT_CACHE_CLEAR_PREFIX', { prefix: cdnBaseUrlPrefix });
                        resolve();
                    }
                };
                request.onerror = () => {
                    reject(request.error);
                };
            });
        } catch (e) {
            // fail safe
        }
    }

    public async enumerateMetadata(): Promise<PersistentChunkMetadata[]> {
        try {
            const db = await this.getDb();
            await this.initializeSequence(db);
            
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(METADATA_STORE_NAME, 'readonly');
                const store = transaction.objectStore(METADATA_STORE_NAME);
                const results: PersistentChunkMetadata[] = [];
                
                const request = store.openCursor();
                request.onsuccess = (event: Event) => {
                    const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
                    if (cursor) {
                        results.push(cursor.value as PersistentChunkMetadata);
                        cursor.continue();
                    } else {
                        resolve(results);
                    }
                };
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            return [];
        }
    }
}
