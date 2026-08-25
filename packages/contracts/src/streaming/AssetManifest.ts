/**
 * Core contract for the Foundry Platform Streaming Architecture.
 * This file defines the technical topology of a streamable package.
 * It strictly avoids game semantics (levels, worlds, etc.).
 */

export type MemoryPriority = 'low' | 'medium' | 'high' | 'critical';

export interface DependencyDescriptor {
    /** The ID of the chunk this chunk depends on */
    chunkId: string;
    /** Whether this dependency is strictly required before loading the current chunk */
    required: boolean;
}

export interface ChunkDescriptor {
    /** Stable identifier or hash of the chunk */
    id: string;
    /** URL path relative to the manifest */
    url: string;
    /** Uncompressed size in bytes */
    size: number;
    /** Compressed size in bytes (if applicable) */
    compressedSize?: number;
    /** Cryptographic hash (e.g., sha256-...) for integrity verification */
    hash: string;
    /** List of chunks that must or should be loaded with this chunk */
    dependencies: DependencyDescriptor[];
    /** Heuristic priority for cache/memory eviction */
    priority: MemoryPriority;
    /** Whether the runtime should attempt to preload this chunk immediately */
    preload: boolean;
}

export interface RuntimeDescriptor {
    /** The entry point chunk ID or relative URL to bootstrap the engine */
    entry: string;
    /** Required engine capabilities */
    capabilities?: string[];
    /** Optional versioning requirement for the Foundry runtime */
    minRuntimeVersion?: string;
}

export interface AssetManifest {
    /** Manifest schema version, currently 1 */
    schemaVersion: number;
    /** Runtime configuration */
    runtime: RuntimeDescriptor;
    /** Array of streamable chunks */
    chunks: ChunkDescriptor[];
}
