import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import yauzl from 'yauzl';
import { QuotaConfig } from '../config/quotas.js';
import { GamePackageValidator, MAX_MANIFEST_BYTES, SUPPORTED_STREAMING_MANIFEST_PATHS } from './GamePackageValidator.js';
import { PackageReadError } from './GamePackageSource.js';

const pathValidator = new GamePackageValidator();
const changedPackage = () => new PackageReadError('PACKAGE_CHANGED_AFTER_VALIDATION',
    'Uploaded package changed after validation. Upload a new version and validate it again.');

// Only the bounded central-directory index and one decompressed file are held in RAM.
// The storage contract still accepts a Buffer, so entry reads are deliberately sequential.
export class FileBackedZip {
    static async download(storage, objectKey, options = {}) {
        const archive = new FileBackedZip(options);
        try {
            await archive.downloadAndOpen(storage, objectKey);
            return archive;
        } catch (error) {
            await archive.cleanup();
            throw error;
        }
    }

    constructor(options) {
        this.options = options;
        this.entries = new Map();
        this.actualSizes = new Map();
        this.totalReadBytes = 0;
        this.maxTotalBytes = Math.min(QuotaConfig.PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES,
            Number.isFinite(options.maxExtractedSizeBytes) ? Math.max(0, Math.floor(options.maxExtractedSizeBytes)) : Infinity);
    }

    totalSizeError() {
        const quotaLimited = this.maxTotalBytes < QuotaConfig.PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES;
        return new PackageReadError(quotaLimited ? 'STORAGE_QUOTA_EXCEEDED' : 'EXTRACTED_SIZE_EXCEEDED',
            quotaLimited ? 'Publishing this version would exceed the developer storage quota.'
                : `Total extracted size exceeds maximum allowed (${this.maxTotalBytes} bytes).`);
    }

    fileLimit(filename) {
        if (filename === 'manifest.json' && MAX_MANIFEST_BYTES <= QuotaConfig.PLATFORM_MAX_FILE_SIZE_BYTES) {
            return { bytes: MAX_MANIFEST_BYTES, code: 'MANIFEST_TOO_LARGE' };
        }
        return {
            bytes: QuotaConfig.PLATFORM_MAX_FILE_SIZE_BYTES,
            code: SUPPORTED_STREAMING_MANIFEST_PATHS.includes(filename) ? 'STREAMING_MANIFEST_LIMIT_EXCEEDED' : 'FILE_SIZE_EXCEEDED'
        };
    }

    async downloadAndOpen(storage, objectKey) {
        const { signal, expectedPackageSizeBytes, expectedPackageSha256 } = this.options;
        signal?.throwIfAborted();
        const metadata = await storage.getObjectMetadata(objectKey);
        const advertisedBytes = Number(metadata.contentLength);
        const maxPackageBytes = QuotaConfig.PLATFORM_MAX_PACKAGE_SIZE_BYTES;
        const hasExpectedSize = Number.isSafeInteger(expectedPackageSizeBytes) && expectedPackageSizeBytes >= 0;
        const packageTooLarge = () => new PackageReadError('PACKAGE_SIZE_EXCEEDED',
            `Package is too large. Maximum allowed is ${maxPackageBytes} bytes.`);
        const sizeMismatch = () => hasExpectedSize ? changedPackage() : new PackageReadError('UPLOAD_SIZE_MISMATCH',
            'Uploaded package size does not match the advertised object size. Please upload again.');
        if (!Number.isSafeInteger(advertisedBytes) || advertisedBytes < 0) {
            throw new PackageReadError('INVALID_UPLOAD_METADATA', 'Uploaded object size is unavailable.');
        }
        if (advertisedBytes > maxPackageBytes) throw packageTooLarge();
        if (hasExpectedSize && advertisedBytes !== expectedPackageSizeBytes) throw changedPackage();

        this.tempDirectoryPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'foundry-package-'));
        this.tempFilePath = path.join(this.tempDirectoryPath, 'package.zip');
        const digest = crypto.createHash('sha256');
        let downloadedBytes = 0;
        const limiter = new Transform({
            transform(chunk, encoding, callback) {
                downloadedBytes += chunk.length;
                if (downloadedBytes > maxPackageBytes) return callback(packageTooLarge());
                if (downloadedBytes > advertisedBytes || (hasExpectedSize && downloadedBytes > expectedPackageSizeBytes)) {
                    return callback(sizeMismatch());
                }
                digest.update(chunk);
                callback(null, chunk);
            }
        });
        const stream = await storage.getDownloadStream(objectKey);
        await pipeline(stream, limiter, fs.createWriteStream(this.tempFilePath, { flags: 'wx', mode: 0o600 }), { signal });
        if (downloadedBytes !== advertisedBytes) throw sizeMismatch();
        this.packageSizeBytes = downloadedBytes;
        this.packageSha256 = `sha256-${digest.digest('hex')}`;
        if (expectedPackageSha256 && this.packageSha256 !== expectedPackageSha256) throw changedPackage();
        signal?.throwIfAborted();

        this.zip = await yauzl.openPromise(this.tempFilePath, {
            autoClose: false, lazyEntries: true, decodeStrings: false, validateEntrySizes: true
        });
        // Propagate file descriptor failures even between entry reads; never ignore them.
        this.zip.on('error', error => { this.zipError = error; });
        const maxEntries = this.options.maxEntries ?? QuotaConfig.PLATFORM_MAX_FILES_PER_PACKAGE;
        const tooManyFiles = () => new PackageReadError('TOO_MANY_FILES',
            `Package exceeds the maximum allowed number of files (${maxEntries}).`);
        if (this.zip.entryCount > maxEntries) throw tooManyFiles();
        const canonicalPaths = new Map();
        let declaredBytes = 0;
        for await (const entry of this.zip.eachEntry()) {
            signal?.throwIfAborted();
            if (this.entries.size >= maxEntries) throw tooManyFiles();
            // Decode without normalizing away traversal/backslashes. Validate both ZIP names
            // when a Unicode extra field overrides the original filename.
            const filename = yauzl.getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileNameRaw, entry.extraFields, true);
            const originalName = yauzl.getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileNameRaw, [], true);
            if (pathValidator.isUnsafePath(filename) || pathValidator.isUnsafePath(originalName)) {
                throw new PackageReadError('UNSAFE_FILE_PATH', `Unsafe path detected: ${filename}`, filename);
            }
            const canonicalPath = pathValidator.getPortablePathKey(filename);
            if (canonicalPaths.has(canonicalPath)) {
                throw new PackageReadError('CASE_COLLIDING_PATH', `Duplicate or conflicting path detected: ${filename}`, filename);
            }
            canonicalPaths.set(canonicalPath, filename);
            if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod)) {
                throw new PackageReadError('INVALID_ZIP', 'Encrypted or unsupported ZIP entry.', filename);
            }
            if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
                throw new PackageReadError('INVALID_ZIP', 'Invalid ZIP entry size.', filename);
            }
            const limit = this.fileLimit(filename);
            if (entry.uncompressedSize > limit.bytes) {
                throw new PackageReadError(limit.code, `File ${filename} exceeds maximum allowed size (${limit.bytes} bytes).`, filename);
            }
            declaredBytes += entry.uncompressedSize;
            if (declaredBytes > this.maxTotalBytes) throw this.totalSizeError();
            // Drop comments/extra-field buffers after decoding; don't retain up to 64 KiB
            // of attacker-controlled metadata per entry in the index.
            entry.fileName = filename;
            entry.fileNameRaw = entry.extraFieldRaw = entry.fileCommentRaw = entry.fileComment = entry.comment = null;
            entry.extraFields = [];
            this.entries.set(filename, entry);
        }
        // A regular file cannot also be the parent directory of another entry.
        for (const filename of this.entries.keys()) {
            const parts = filename.split('/');
            for (let i = 1; i < parts.length; i++) {
                const parent = canonicalPaths.get(pathValidator.getPortablePathKey(parts.slice(0, i).join('/')));
                if (parent && !parent.endsWith('/')) {
                    throw new PackageReadError('CASE_COLLIDING_PATH', `Duplicate or conflicting path detected: ${filename}`, filename);
                }
            }
        }
    }

    async readFile(filename) {
        this.options.signal?.throwIfAborted();
        if (this.zipError) throw this.zipError;
        const entry = this.entries.get(filename);
        if (!entry || filename.endsWith('/')) return null;
        if (this.reading) throw new Error('Package entries must be read sequentially.');
        this.reading = true;
        const limit = this.fileLimit(filename);
        const chunks = [];
        let actualBytes = 0;
        const otherBytes = this.totalReadBytes - (this.actualSizes.get(filename) || 0);
        try {
            // Own the inflater in the pipeline so error/abort destroys the file stream,
            // inflater and sink together (including a partially decompressed entry).
            const stream = await this.zip.openReadStreamPromise(entry, { decodeFileData: false });
            const stages = entry.compressionMethod === 8 ? [stream, createInflateRaw()] : [stream];
            await pipeline(...stages, new Writable({
                write: (chunk, encoding, callback) => {
                    actualBytes += chunk.length;
                    if (actualBytes > limit.bytes) {
                        return callback(new PackageReadError(limit.code,
                            `File ${filename} exceeds maximum allowed size (${limit.bytes} bytes).`, filename));
                    }
                    if (otherBytes + actualBytes > this.maxTotalBytes) return callback(this.totalSizeError());
                    if (actualBytes > entry.uncompressedSize) {
                        return callback(new PackageReadError('INVALID_ZIP',
                            'ZIP entry size does not match its decompressed bytes.', filename));
                    }
                    chunks.push(chunk);
                    callback();
                }
            }), { signal: this.options.signal });
            if (actualBytes !== entry.uncompressedSize) {
                throw new PackageReadError('INVALID_ZIP', 'ZIP entry size does not match its decompressed bytes.', filename);
            }
            this.actualSizes.set(filename, actualBytes);
            this.totalReadBytes = otherBytes + actualBytes;
            return Buffer.concat(chunks, actualBytes);
        } finally {
            this.reading = false;
        }
    }

    async cleanup() {
        try {
            if (this.zip?.isOpen) {
                const closed = once(this.zip, 'close');
                this.zip.close();
                await closed;
            }
        } finally {
            this.entries.clear();
            this.actualSizes.clear();
            this.zip = null;
            if (this.tempDirectoryPath) {
                await fs.promises.rm(this.tempDirectoryPath, { recursive: true, force: true });
                this.tempFilePath = this.tempDirectoryPath = null;
            }
        }
    }
}
