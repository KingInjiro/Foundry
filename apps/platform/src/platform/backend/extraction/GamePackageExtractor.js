import { QuotaConfig } from '../config/quotas.js';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
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
        let tempFilePath = null;
        let tempDirectoryPath = null;
        const uploadedKeys = [];
        const baseKey = `games/${gameId}/versions/${versionId}/extracted`;
        
        // Ensure idempotency by deleting any previous partial extraction
        if (typeof this.storage.deletePrefix === 'function') {
            await this.storage.deletePrefix(baseKey);
        }
        try {
            // 1. Download ZIP to temp file
            const metadata = await this.storage.getObjectMetadata(sourceObjectKey);
            if (metadata.contentLength > QuotaConfig.PLATFORM_MAX_PACKAGE_SIZE_BYTES) {
                throw new Error(`Package is too large (${metadata.contentLength} bytes).`);
            }

            const stream = await this.storage.getDownloadStream(sourceObjectKey);
            tempDirectoryPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'foundry-extract-'));
            tempFilePath = path.join(tempDirectoryPath, 'package.zip');
            const fileStream = fs.createWriteStream(tempFilePath);
            await pipeline(stream, fileStream);

            // 2. Load JSZip
            const buffer = await fs.promises.readFile(tempFilePath);
            const actualPackageSha256 = `sha256-${crypto.createHash('sha256').update(buffer).digest('hex')}`;
            if (options.expectedPackageSha256 && actualPackageSha256 !== options.expectedPackageSha256) {
                const error = new Error('Uploaded package changed after validation. Upload a new version and validate it again.');
                error.code = 'PACKAGE_CHANGED_AFTER_VALIDATION';
                throw error;
            }
            if (
                Number.isSafeInteger(options.expectedPackageSizeBytes)
                && options.expectedPackageSizeBytes >= 0
                && metadata.contentLength !== options.expectedPackageSizeBytes
            ) {
                const error = new Error('Uploaded package size changed after validation. Upload a new version and validate it again.');
                error.code = 'PACKAGE_CHANGED_AFTER_VALIDATION';
                throw error;
            }
            const zip = await JSZip.loadAsync(buffer);
            
            const files = Object.keys(zip.files);
            if (files.length > QuotaConfig.PLATFORM_MAX_EXTRACTED_FILES_PER_PACKAGE) {
                throw new Error(`Package exceeds the maximum allowed number of files (${QuotaConfig.PLATFORM_MAX_EXTRACTED_FILES_PER_PACKAGE}).`);
            }

            let totalExtractedSize = 0;
            const quotaExtractedLimit = Number.isFinite(options.maxExtractedSizeBytes)
                ? Math.max(0, Math.floor(options.maxExtractedSizeBytes))
                : QuotaConfig.PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES;
            const effectiveExtractedLimit = Math.min(
                QuotaConfig.PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES,
                quotaExtractedLimit
            );
            const validPaths = new Set();
            const canonicalPaths = new Set();
            const filesToExtract = [];
            let declaredExtractedSize = 0;

            // 3. Pre-flight validation of all files in ZIP
            for (const filename of files) {
                const zipEntry = zip.files[filename];
                if (zipEntry.dir) continue; // skip directories

                if (this.isUnsafePath(filename)) {
                    throw new Error(`Unsafe path detected: ${filename}`);
                }

                // Normalize separators and reject case-only collisions for portable extraction.
                const normalizedPath = filename;
                const canonicalPath = normalizedPath.normalize('NFC').toLocaleLowerCase('en-US');
                if (canonicalPaths.has(canonicalPath)) {
                    throw new Error(`Duplicate or conflicting path detected: ${filename}`);
                }

                const declaredFileSize = Number(zipEntry?._data?.uncompressedSize);
                if (Number.isSafeInteger(declaredFileSize) && declaredFileSize >= 0) {
                    if (declaredFileSize > QuotaConfig.PLATFORM_MAX_FILE_SIZE_BYTES) {
                        const error = new Error(`File ${filename} exceeds maximum allowed size (${QuotaConfig.PLATFORM_MAX_FILE_SIZE_BYTES} bytes).`);
                        error.code = 'FILE_SIZE_EXCEEDED';
                        throw error;
                    }
                    declaredExtractedSize += declaredFileSize;
                    if (declaredExtractedSize > effectiveExtractedLimit) {
                        const quotaLimited = effectiveExtractedLimit < QuotaConfig.PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES;
                        const error = new Error(quotaLimited
                            ? 'Publishing this version would exceed the developer storage quota.'
                            : `Total extracted size exceeds maximum allowed (${QuotaConfig.PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES} bytes).`);
                        error.code = quotaLimited ? 'STORAGE_QUOTA_EXCEEDED' : 'EXTRACTED_SIZE_EXCEEDED';
                        throw error;
                    }
                }
                validPaths.add(normalizedPath);
                canonicalPaths.add(canonicalPath);

                filesToExtract.push({ filename, normalizedPath, zipEntry });
            }

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
                    const smRaw = await zip.file(resolvedStreamingManifestPath).async('string');
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
                const uncompressedBuffer = await file.zipEntry.async('nodebuffer');
                
                if (uncompressedBuffer.length > QuotaConfig.PLATFORM_MAX_FILE_SIZE_BYTES) {
                    throw new Error(`File ${file.filename} exceeds maximum allowed size (${QuotaConfig.PLATFORM_MAX_FILE_SIZE_BYTES} bytes).`);
                }

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
                if (totalExtractedSize > effectiveExtractedLimit) {
                    const quotaLimited = effectiveExtractedLimit < QuotaConfig.PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES;
                    const error = new Error(quotaLimited
                        ? 'Publishing this version would exceed the developer storage quota.'
                        : `Total extracted size exceeds maximum allowed (${QuotaConfig.PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES} bytes).`);
                    error.code = quotaLimited ? 'STORAGE_QUOTA_EXCEEDED' : 'EXTRACTED_SIZE_EXCEEDED';
                    throw error;
                }

                // Determine content type
                let contentType = mime.lookup(file.normalizedPath) || 'application/octet-stream';
                
                const targetObjectKey = `games/${gameId}/versions/${versionId}/extracted/${file.normalizedPath}`;
                
                // Upload to storage
                await this.storage.uploadBuffer(targetObjectKey, uncompressedBuffer, contentType, {
                    cacheControl: 'public, max-age=31536000, immutable'
                });
                uploadedKeys.push(targetObjectKey);
            }

            return {
                success: true,
                extractedCount: filesToExtract.length,
                totalSize: totalExtractedSize,
                baseKey,
                packageSizeBytes: metadata.contentLength,
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
            if (tempDirectoryPath) {
                try {
                    await fs.promises.rm(tempDirectoryPath, { recursive: true, force: true });
                } catch (e) {
                    console.error(`Failed to cleanup temporary extraction directory ${tempDirectoryPath}`, e);
                }
            }
        }
    }

    async cleanupExtractedRuntime(gameId, versionId) {
        if (typeof this.storage.deletePrefix !== 'function') return;
        await this.storage.deletePrefix(`games/${gameId}/versions/${versionId}/extracted`);
    }
}
