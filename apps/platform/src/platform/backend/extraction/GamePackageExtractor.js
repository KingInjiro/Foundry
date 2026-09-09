import { QuotaConfig } from '../config/quotas.js';
import { FileBackedZip } from '../validation/FileBackedZip.js';
import mime from 'mime-types';
import crypto from 'node:crypto';
import { StreamableGlbValidator } from '../validation/StreamableGlbValidator.ts';


export class GamePackageExtractor {
    constructor(storage) {
        this.storage = storage;
    }

    isUnsafePath(p) {
        if (!p || typeof p !== 'string') return true;
        if (p.length > 512) return true;
        if (p.indexOf('\0') !== -1) return true;
        
        const lowerPath = p.toLowerCase();
        if (lowerPath.includes('%2e') || lowerPath.includes('%2f') || lowerPath.includes('%5c')) {
            return true;
        }

        if (p.includes('\\') || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return true;

        const parts = p.split('/');
        for (const part of parts) {
            if (!part || part === '.' || part === '..') return true;
            if (part.length > 255 || part.endsWith('.') || part.endsWith(' ')) return true;
            if (/[<>:"|?*\x00-\x1f]/.test(part)) return true;
            if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part)) return true;
        }
        return false;
    }

    async extractPackage(gameId, versionId, sourceObjectKey, entryFile, streamingManifestPath = null, options = {}) {
        let archive = null;
        const uploadedKeys = [];
        const baseKey = `games/${gameId}/versions/${versionId}/extracted`;
        
        // Ensure idempotency by deleting any previous partial extraction
        if (typeof this.storage.deletePrefix === 'function') {
            await this.storage.deletePrefix(baseKey);
        }
        try {
            archive = await FileBackedZip.download(this.storage, sourceObjectKey, {
                ...options,
                maxEntries: QuotaConfig.PLATFORM_MAX_EXTRACTED_FILES_PER_PACKAGE
            });
            const filesToExtract = [...archive.entries.keys()]
                .filter(filename => !filename.endsWith('/'))
                .map(filename => ({ filename, normalizedPath: filename }));
            const validPaths = new Set(filesToExtract.map(file => file.filename));
            let totalExtractedSize = 0;

            if (entryFile && !validPaths.has(entryFile)) {
                throw new Error(`Entry file "${entryFile}" is missing from the extracted package.`);
            }

            const streamableChunks = new Map();
            const strictStreamingIntegrity = Boolean(streamingManifestPath);
            const resolvedStreamingManifestPath = streamingManifestPath
                || (validPaths.has('streaming-manifest.json') ? 'streaming-manifest.json' : null)
                || (validPaths.has('foundry-streaming.json') ? 'foundry-streaming.json' : null);
            if (resolvedStreamingManifestPath) {
                if (!validPaths.has(resolvedStreamingManifestPath)) {
                    throw new Error(`Streaming manifest "${resolvedStreamingManifestPath}" is missing from the extracted package.`);
                }
                try {
                    const smRaw = (await archive.readFile(resolvedStreamingManifestPath)).toString('utf8');
                    const sm = JSON.parse(smRaw);
                    if (sm.chunks && Array.isArray(sm.chunks)) {
                        for (const chunk of sm.chunks) {
                            if (chunk.url && typeof chunk.url === 'string') {
                                streamableChunks.set(chunk.url.replace(/\\/g, '/'), chunk);
                            }
                        }
                    }
                } catch (e) {
                    throw new Error(`Failed to parse ${resolvedStreamingManifestPath} during extraction: ${e.message}`);
                }
            }

            // 4. Extract and Upload
            for (const file of filesToExtract) {
                const uncompressedBuffer = await archive.readFile(file.filename);

                const streamableChunk = streamableChunks.get(file.normalizedPath);
                if (streamableChunk) {
                    if (strictStreamingIntegrity && (!Number.isInteger(streamableChunk.size) || typeof streamableChunk.hash !== 'string')) {
                        throw new Error(`Streamable chunk ${file.normalizedPath} is missing validated integrity metadata.`);
                    }
                    if (Number.isInteger(streamableChunk.size) && uncompressedBuffer.length !== streamableChunk.size) {
                        throw new Error(`Streamable chunk ${file.normalizedPath} size mismatch: expected ${streamableChunk.size}, got ${uncompressedBuffer.length}.`);
                    }
                    if (typeof streamableChunk.hash === 'string') {
                        const actualHash = `sha256-${crypto.createHash('sha256').update(uncompressedBuffer).digest('hex')}`;
                        if (actualHash !== streamableChunk.hash.toLowerCase()) {
                            throw new Error(`Streamable chunk ${file.normalizedPath} SHA-256 mismatch.`);
                        }
                    }
                }

                if (streamableChunk && file.normalizedPath.toLowerCase().endsWith('.glb')) {
                    const validationResult = StreamableGlbValidator.validate(uncompressedBuffer);
                    if (!validationResult.valid) {
                        const err = new Error(`StreamableAssetValidationError [${validationResult.code}]: Chunk ${file.normalizedPath} is not a valid self-contained GLB: ${validationResult.error}`);
                        err.code = validationResult.code;
                        throw err;
                    }
                }

                totalExtractedSize += uncompressedBuffer.length;
                // Determine content type
                let contentType = mime.lookup(file.normalizedPath) || 'application/octet-stream';
                
                const targetObjectKey = `games/${gameId}/versions/${versionId}/extracted/${file.normalizedPath}`;
                
                // Upload to storage
                // Include an attempted write: a provider can persist an object before rejecting.
                uploadedKeys.push(targetObjectKey);
                await this.storage.uploadBuffer(targetObjectKey, uncompressedBuffer, contentType, {
                    cacheControl: 'public, max-age=31536000, immutable'
                });
            }

            return {
                success: true,
                extractedCount: filesToExtract.length,
                totalSize: totalExtractedSize,
                baseKey,
                packageSizeBytes: archive.packageSizeBytes,
                extractedSizeBytes: totalExtractedSize,
                runtimeUrl: `/api/cdn/${baseKey}`
            };
        } catch (error) {
            // Cleanup partial extraction in a robust implementation,
            if (uploadedKeys.length > 0 && typeof this.storage.deleteObject === 'function') {
                for (const key of uploadedKeys) {
                    try {
                        await this.storage.deleteObject(key);
                    } catch (cleanupErr) {
                        console.error(`Failed to cleanup uploaded file ${key} after extraction error`, cleanupErr);
                    }
                }
            }
            throw error;
        } finally {
            await archive?.cleanup();
        }
    }

    async cleanupExtractedRuntime(gameId, versionId) {
        if (typeof this.storage.deletePrefix !== 'function') return;
        await this.storage.deletePrefix(`games/${gameId}/versions/${versionId}/extracted`);
    }
}
