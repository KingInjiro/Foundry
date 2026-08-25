import { QuotaConfig } from '../config/quotas.js';
import { MEMORY_PRIORITIES, STREAMING_SCHEMA_VERSION } from '@foundry/contracts/streaming';

const SHA256_PATTERN = /^sha256-[a-f0-9]{64}$/i;

export class StreamingManifestValidator {
    /**
     * @param {string} manifestRaw JSON string of the streaming manifest
     * @param {Set<string>} packageFiles Set of normalized file paths present in the uploaded package
     * @param {Object} options Configuration options like quotas
     */
    validate(manifestRaw, packageFiles, options = {}) {
        const result = {
            valid: true,
            diagnostics: [],
            metadata: null,
            validatedChunkCount: 0,
            validatedAssetCount: 0,
            validatedDependencyCount: 0,
            totalDeclaredSize: 0
        };

        const addError = (code, message) => {
            result.valid = false;
            result.diagnostics.push({ code, message, severity: 'ERROR' });
        };

        const addWarning = (code, message) => {
            result.diagnostics.push({ code, message, severity: 'WARNING' });
        };

        let manifest;
        try {
            manifest = JSON.parse(manifestRaw);
        } catch (e) {
            addError('STREAMING_MANIFEST_INVALID', 'Manifest contains invalid JSON.');
            return result;
        }

        if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
            addError('STREAMING_MANIFEST_INVALID', 'Manifest root must be an object.');
            return result;
        }

        if (manifest.schemaVersion !== STREAMING_SCHEMA_VERSION) {
            addError('STREAMING_MANIFEST_INVALID', `Unsupported schema version: ${manifest.schemaVersion}`);
        }

        if (!manifest.runtime || typeof manifest.runtime !== 'object' || Array.isArray(manifest.runtime)) {
            addError('STREAMING_MANIFEST_INVALID', 'Missing or invalid "runtime" object.');
        } else {
            if (typeof manifest.runtime.entry !== 'string') {
                addError('STREAMING_MANIFEST_INVALID', 'runtime.entry must be a string.');
            } else if (this.isUnsafePath(manifest.runtime.entry)) {
                addError('STREAMING_MANIFEST_INVALID_PATH', 'runtime.entry path is unsafe.');
            }
        }

        if (!Array.isArray(manifest.chunks)) {
            addError('STREAMING_MANIFEST_INVALID', 'Missing or invalid "chunks" array.');
            return result;
        }

        if (!result.valid) return result;

        const chunkIds = new Set();
        const chunkPaths = new Set();
        let totalSize = 0;
        let depCount = 0;
        const graph = new Map();

        for (const chunk of manifest.chunks) {
            if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) {
                addError('STREAMING_MANIFEST_INVALID', 'Manifest contains an invalid chunk entry.');
                continue;
            }
            if (!chunk.id || typeof chunk.id !== 'string') {
                addError('STREAMING_MANIFEST_INVALID', 'Chunk missing valid id.');
                continue;
            }

            if (chunkIds.has(chunk.id)) {
                addError('STREAMING_MANIFEST_DUPLICATE_ID', `Duplicate chunk ID: ${chunk.id}`);
            }
            chunkIds.add(chunk.id);

            if (!chunk.url || typeof chunk.url !== 'string') {
                addError('STREAMING_MANIFEST_INVALID', `Chunk ${chunk.id} missing valid url.`);
                continue;
            }

            if (this.isUnsafePath(chunk.url)) {
                addError('STREAMING_MANIFEST_INVALID_PATH', `Chunk ${chunk.id} has unsafe URL: ${chunk.url}`);
            } else {
                const normalizedUrl = chunk.url.replace(/\\/g, '/');
                chunkPaths.add(normalizedUrl);
                
                if (!packageFiles.has(normalizedUrl)) {
                    addError('STREAMING_MANIFEST_CHUNK_MISSING', `Chunk file ${normalizedUrl} not found in package.`);
                }
            }

            if (typeof chunk.size !== 'number' || chunk.size < 0 || !Number.isFinite(chunk.size) || !Number.isInteger(chunk.size)) {
                addError('STREAMING_MANIFEST_INVALID', `Chunk ${chunk.id} has invalid size.`);
            } else {
                totalSize += chunk.size;
                if (chunk.size > QuotaConfig.PLATFORM_MAX_FILE_SIZE_BYTES) {
                     addError('STREAMING_MANIFEST_LIMIT_EXCEEDED', `Chunk ${chunk.id} exceeds maximum file size.`);
                }
            }

            if (chunk.compressedSize !== undefined && (typeof chunk.compressedSize !== 'number' || chunk.compressedSize < 0 || !Number.isFinite(chunk.compressedSize) || !Number.isInteger(chunk.compressedSize))) {
                addError('STREAMING_MANIFEST_INVALID', `Chunk ${chunk.id} has invalid compressedSize.`);
            }

            if (!chunk.hash || typeof chunk.hash !== 'string' || !SHA256_PATTERN.test(chunk.hash)) {
                addError('STREAMING_MANIFEST_INVALID_HASH', `Chunk ${chunk.id} must use a SHA-256 hash in the form sha256-<64 hex characters>.`);
            }

            if (typeof chunk.priority !== 'string' || !MEMORY_PRIORITIES.includes(chunk.priority)) {
                addError('STREAMING_MANIFEST_INVALID', `Chunk ${chunk.id} has invalid priority: ${chunk.priority}`);
            }

            if (typeof chunk.preload !== 'boolean') {
                addError('STREAMING_MANIFEST_INVALID', `Chunk ${chunk.id} missing valid preload flag.`);
            }

            if (!Array.isArray(chunk.dependencies)) {
                addError('STREAMING_MANIFEST_INVALID', `Chunk ${chunk.id} missing or invalid dependencies array.`);
                continue;
            }

            const deps = new Set();
            for (const dep of chunk.dependencies) {
                if (!dep || typeof dep !== 'object' || Array.isArray(dep)) {
                    addError('STREAMING_MANIFEST_INVALID', `Chunk ${chunk.id} has invalid dependency entry.`);
                    continue;
                }
                if (!dep.chunkId || typeof dep.chunkId !== 'string') {
                    addError('STREAMING_MANIFEST_INVALID', `Chunk ${chunk.id} dependency missing chunkId.`);
                    continue;
                }
                if (typeof dep.required !== 'boolean') {
                    addError('STREAMING_MANIFEST_INVALID', `Chunk ${chunk.id} dependency ${dep.chunkId} missing valid required flag.`);
                }
                if (dep.chunkId === chunk.id) {
                    addError('STREAMING_MANIFEST_SELF_DEPENDENCY', `Chunk ${chunk.id} depends on itself.`);
                }
                deps.add(dep.chunkId);
                depCount++;
            }
            graph.set(chunk.id, Array.from(deps));
        }

        if (chunkIds.size > QuotaConfig.PLATFORM_MAX_EXTRACTED_FILES_PER_PACKAGE) {
             addError('STREAMING_MANIFEST_LIMIT_EXCEEDED', `Too many chunks (${chunkIds.size}).`);
        }
        if (totalSize > QuotaConfig.PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES) {
            addError('STREAMING_MANIFEST_LIMIT_EXCEEDED', `Total size of chunks exceeds maximum allowed.`);
        }

        if (!result.valid) return result;

        for (const [chunkId, deps] of graph.entries()) {
            for (const dep of deps) {
                if (!chunkIds.has(dep)) {
                    addError('STREAMING_MANIFEST_MISSING_REFERENCE', `Chunk ${chunkId} references missing dependency: ${dep}`);
                }
            }
        }

        if (!result.valid) return result;

        const visited = new Set();
        const recursionStack = new Set();

        const checkCycle = (nodeId) => {
            if (recursionStack.has(nodeId)) return true;
            if (visited.has(nodeId)) return false;

            visited.add(nodeId);
            recursionStack.add(nodeId);

            const neighbors = graph.get(nodeId) || [];
            for (const neighbor of neighbors) {
                if (checkCycle(neighbor)) return true;
            }

            recursionStack.delete(nodeId);
            return false;
        };

        for (const chunkId of chunkIds) {
            if (checkCycle(chunkId)) {
                addError('STREAMING_MANIFEST_CYCLE', `Dependency cycle detected involving chunk: ${chunkId}`);
                break;
            }
        }

        const entry = manifest.runtime.entry;
        if (!chunkIds.has(entry)) {
            const normalizedEntry = entry.replace(/\\/g, '/');
            if (!packageFiles.has(normalizedEntry)) {
                addError('STREAMING_MANIFEST_INVALID', `Runtime entry "${entry}" is neither a valid chunk ID nor a file in the package.`);
            }
        }

        if (result.valid) {
            result.metadata = {
                schemaVersion: manifest.schemaVersion,
                runtime: manifest.runtime
            };
            result.validatedChunkCount = chunkIds.size;
            result.validatedAssetCount = chunkIds.size;
            result.validatedDependencyCount = depCount;
            result.totalDeclaredSize = totalSize;
        }

        return result;
    }

    isUnsafePath(p) {
        if (!p || typeof p !== 'string') return true;
        if (p.indexOf('\0') !== -1) return true;
        const lowerPath = p.toLowerCase();
        if (lowerPath.includes('%2e') || lowerPath.includes('%2f') || lowerPath.includes('%5c')) {
            return true;
        }
        if (p.startsWith('/') || p.startsWith('\\') || p.includes('\\') || /^[a-zA-Z]:/.test(p)) return true;
        if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(p)) return true;
        const parts = p.split(/[/\\]/);
        for (const part of parts) {
            if (part === '..') return true;
        }
        return false;
    }
}
