import { StreamingObservability } from './StreamingObservability';

export interface PersistentChunkEntry {
    cacheKey: string;     // Unique identifier in IDB
    cdnBaseUrl: string;   // Represents the version/game isolation boundary
    chunkId: string;
    sha256: string;
    size: number;
    data: ArrayBuffer;
    lastAccessSequence?: number;
}

export interface PersistentChunkCache {
    get(cacheKey: string): Promise<PersistentChunkEntry | null>;
    put(entry: PersistentChunkEntry): Promise<void>;
    delete(cacheKey: string): Promise<void>;
    clearPrefix(cdnBaseUrlPrefix: string): Promise<void>;
    enumerateMetadata(): Promise<PersistentChunkMetadata[]>;
}

export interface PersistentChunkMetadata {
    cacheKey: string;
    cdnBaseUrl: string;
    chunkId: string;
    sha256: string;
    size: number;
    lastAccessSequence: number;
}
