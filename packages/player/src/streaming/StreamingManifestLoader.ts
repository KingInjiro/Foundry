import { StreamingObservability } from './StreamingObservability';
import { MEMORY_PRIORITIES, STREAMING_SCHEMA_VERSION } from '@foundry/contracts/streaming';
import type { AssetManifest, ChunkDescriptor } from '@foundry/contracts/streaming/types';

const SHA256_PATTERN = /^sha256-[a-f0-9]{64}$/i;

export class StreamingManifestNetworkError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StreamingManifestNetworkError';
    }
}

export class StreamingManifestHttpError extends Error {
    public status: number;
    constructor(status: number, message: string) {
        super(message);
        this.name = 'StreamingManifestHttpError';
        this.status = status;
    }
}

export class StreamingManifestJsonError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StreamingManifestJsonError';
    }
}

export class StreamingManifestValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StreamingManifestValidationError';
    }
}

export interface StreamingRuntimeManifest {
    readonly schemaVersion: number;
    readonly runtime: Readonly<AssetManifest['runtime']>;
    readonly chunks: ReadonlyMap<string, Readonly<ChunkDescriptor>>;
    readonly dependencies: ReadonlyMap<string, readonly string[]>;
}

export class StreamingManifestLoader {
    private observability: StreamingObservability;
    private inFlightRequests = new Map<string, Promise<StreamingRuntimeManifest>>();

    constructor(observability: StreamingObservability = new StreamingObservability()) {
        this.observability = observability;
    }

    /**
     * Loads a streaming manifest from the specified URL.
     * Implements a simple deduplication cache for concurrent requests to the same URL.
     */
    public load(url: string): Promise<StreamingRuntimeManifest> {
        if (this.inFlightRequests.has(url)) {
            return this.inFlightRequests.get(url)!;
        }

        this.observability.emit('MANIFEST_LOAD_START', { url: url.split('?')[0] });
        const startTime = performance.now();
        const promise = this.doLoad(url).then(res => {
            this.observability.emit('MANIFEST_LOAD_SUCCESS', { url: url.split('?')[0], durationMs: performance.now() - startTime });
            return res;
        }).catch(err => {
            const category = err.name === 'StreamingManifestNetworkError' ? 'NETWORK' : 
                             err.name === 'StreamingManifestHttpError' ? 'HTTP' :
                             err.name === 'StreamingManifestJsonError' ? 'JSON' :
                             err.name === 'StreamingManifestValidationError' ? 'VALIDATION' : 'UNKNOWN';
            this.observability.emit('MANIFEST_LOAD_FAILURE', { url: url.split('?')[0], durationMs: performance.now() - startTime, category, status: (err as any).status });
            throw err;
        }).finally(() => {
            this.inFlightRequests.delete(url);
        });
        
        this.inFlightRequests.set(url, promise);
        return promise;
    }

    private async doLoad(url: string): Promise<StreamingRuntimeManifest> {
        let response: Response;
        try {
            response = await fetch(url, {
                method: 'GET',
                credentials: 'omit', // Security: Do not send authentication credentials
                cache: 'no-cache', // Require revalidation for manifest to ensure latest version is fetched
                headers: {
                    'Accept': 'application/json'
                }
            });
        } catch (e) {
            throw new StreamingManifestNetworkError(`Network error while fetching manifest: ${e instanceof Error ? e.message : String(e)}`);
        }

        if (!response.ok) {
            throw new StreamingManifestHttpError(response.status, `HTTP error ${response.status} while fetching manifest`);
        }

        let rawText: string;
        try {
            rawText = await response.text();
        } catch (e) {
            throw new StreamingManifestNetworkError(`Failed to read response body: ${e instanceof Error ? e.message : String(e)}`);
        }

        let manifest: AssetManifest;
        try {
            manifest = JSON.parse(rawText);
        } catch (e) {
            throw new StreamingManifestJsonError(`Manifest contains invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
        }

        return this.validateAndNormalize(manifest);
    }

    private isUnsafePath(p: string): boolean {
        if (!p || typeof p !== 'string') return true;
        if (p.indexOf('\0') !== -1) return true;
        const lowerPath = p.toLowerCase();
        // Reject encoded traversal attempts
        if (lowerPath.includes('%2e') || lowerPath.includes('%2f') || lowerPath.includes('%5c')) {
            return true;
        }
        // Reject absolute paths and drive letters
        if (p.startsWith('/') || p.startsWith('\\') || p.includes('\\') || /^[a-zA-Z]:/.test(p)) return true;
        // Chunk paths are package-relative, never remote/data/blob URLs.
        if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(p)) return true;
        // Reject relative traversal
        const parts = p.split(/[/\\]/);
        for (const part of parts) {
            if (part === '..') return true;
        }
        return false;
    }

    public validateAndNormalize(manifest: any): StreamingRuntimeManifest {
        if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
            throw new StreamingManifestValidationError('Manifest root must be an object.');
        }

        if (manifest.schemaVersion !== STREAMING_SCHEMA_VERSION) {
            throw new StreamingManifestValidationError(`Unsupported schema version: ${manifest.schemaVersion}`);
        }

        if (!manifest.runtime || typeof manifest.runtime !== 'object' || Array.isArray(manifest.runtime)) {
            throw new StreamingManifestValidationError('Missing or invalid "runtime" object.');
        }

        if (typeof manifest.runtime.entry !== 'string' || manifest.runtime.entry.trim() === '') {
            throw new StreamingManifestValidationError('runtime.entry must be a non-empty string.');
        }

        if (this.isUnsafePath(manifest.runtime.entry)) {
            throw new StreamingManifestValidationError(`runtime.entry has an unsafe path: ${manifest.runtime.entry}`);
        }

        if (!Array.isArray(manifest.chunks)) {
            throw new StreamingManifestValidationError('Missing or invalid "chunks" array.');
        }

        const chunks = new Map<string, Readonly<ChunkDescriptor>>();
        const dependencies = new Map<string, string[]>();

        for (const chunk of manifest.chunks) {
            if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) {
                throw new StreamingManifestValidationError('Manifest contains an invalid chunk entry.');
            }
            if (!chunk.id || typeof chunk.id !== 'string' || chunk.id.trim() === '') {
                throw new StreamingManifestValidationError('Chunk missing valid non-empty id.');
            }

            if (chunks.has(chunk.id)) {
                throw new StreamingManifestValidationError(`Duplicate chunk ID: ${chunk.id}`);
            }

            if (!chunk.url || typeof chunk.url !== 'string') {
                throw new StreamingManifestValidationError(`Chunk ${chunk.id} missing valid url.`);
            }

            if (this.isUnsafePath(chunk.url)) {
                throw new StreamingManifestValidationError(`Chunk ${chunk.id} has unsafe URL: ${chunk.url}`);
            }

            if (typeof chunk.size !== 'number' || chunk.size < 0 || !Number.isFinite(chunk.size) || !Number.isInteger(chunk.size)) {
                throw new StreamingManifestValidationError(`Chunk ${chunk.id} has invalid size.`);
            }

            if (chunk.compressedSize !== undefined && (typeof chunk.compressedSize !== 'number' || chunk.compressedSize < 0 || !Number.isFinite(chunk.compressedSize) || !Number.isInteger(chunk.compressedSize))) {
                throw new StreamingManifestValidationError(`Chunk ${chunk.id} has invalid compressedSize.`);
            }

            if (!chunk.hash || typeof chunk.hash !== 'string' || !SHA256_PATTERN.test(chunk.hash)) {
                throw new StreamingManifestValidationError(`Chunk ${chunk.id} must use a SHA-256 hash in the form sha256-<64 hex characters>.`);
            }

            if (typeof chunk.priority !== 'string' || !MEMORY_PRIORITIES.includes(chunk.priority)) {
                throw new StreamingManifestValidationError(`Chunk ${chunk.id} has invalid priority: ${chunk.priority}`);
            }

            if (typeof chunk.preload !== 'boolean') {
                throw new StreamingManifestValidationError(`Chunk ${chunk.id} missing valid preload flag.`);
            }

            if (!Array.isArray(chunk.dependencies)) {
                throw new StreamingManifestValidationError(`Chunk ${chunk.id} missing or invalid dependencies array.`);
            }

            const depsForChunk: string[] = [];
            for (const dep of chunk.dependencies) {
                if (!dep || typeof dep !== 'object') {
                    throw new StreamingManifestValidationError(`Chunk ${chunk.id} has invalid dependency entry.`);
                }
                if (!dep.chunkId || typeof dep.chunkId !== 'string') {
                    throw new StreamingManifestValidationError(`Chunk ${chunk.id} dependency missing chunkId.`);
                }
                if (typeof dep.required !== 'boolean') {
                    throw new StreamingManifestValidationError(`Chunk ${chunk.id} dependency ${dep.chunkId} missing valid required flag.`);
                }
                if (dep.chunkId === chunk.id) {
                    throw new StreamingManifestValidationError(`Chunk ${chunk.id} depends on itself.`);
                }
                depsForChunk.push(dep.chunkId);
            }

            dependencies.set(chunk.id, depsForChunk);
            const frozenDependencies = Object.freeze(chunk.dependencies.map(dep => Object.freeze({ ...dep })));
            chunks.set(chunk.id, Object.freeze({ ...chunk, hash: chunk.hash.toLowerCase(), dependencies: frozenDependencies }));
        }

        // Validate dependencies
        for (const [chunkId, deps] of Array.from(dependencies.entries())) {
            for (const dep of deps) {
                if (!chunks.has(dep)) {
                    throw new StreamingManifestValidationError(`Chunk ${chunkId} references missing dependency: ${dep}`);
                }
            }
        }

        // Check for cycles
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        const checkCycle = (nodeId: string): boolean => {
            if (recursionStack.has(nodeId)) return true;
            if (visited.has(nodeId)) return false;

            visited.add(nodeId);
            recursionStack.add(nodeId);

            const neighbors = dependencies.get(nodeId) || [];
            for (const neighbor of neighbors) {
                if (checkCycle(neighbor)) return true;
            }

            recursionStack.delete(nodeId);
            return false;
        };

        for (const chunkId of Array.from(chunks.keys())) {
            if (checkCycle(chunkId)) {
                throw new StreamingManifestValidationError(`Dependency cycle detected involving chunk: ${chunkId}`);
            }
        }

        const immutableDependencies = new Map<string, readonly string[]>();
        for (const [key, val] of Array.from(dependencies.entries())) {
            immutableDependencies.set(key, Object.freeze([...val]));
        }

        return Object.freeze({
            schemaVersion: manifest.schemaVersion,
            runtime: Object.freeze({
                ...manifest.runtime,
                capabilities: Array.isArray(manifest.runtime.capabilities)
                    ? Object.freeze([...manifest.runtime.capabilities])
                    : manifest.runtime.capabilities
            }),
            chunks: chunks as ReadonlyMap<string, Readonly<ChunkDescriptor>>,
            dependencies: immutableDependencies as ReadonlyMap<string, readonly string[]>
        });
    }
}
