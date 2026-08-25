import JSZip from 'jszip';
import { GamePackageSource } from './GamePackageSource.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import { QuotaConfig } from '../config/quotas.js';
import crypto from 'node:crypto';

// NOTE: JSZip loads the entire ZIP into memory.
// To prevent memory exhaustion, we enforce a strict package size limit.
// A true streaming zip parser (like yauzl) should be implemented here in the future.
export class R2PackageSource extends GamePackageSource {
    /**
     * @param {import('../storage/R2StorageProvider.js').R2StorageProvider} storage
     * @param {string} objectKey
     */
    constructor(storage, objectKey) {
        super();
        this.storage = storage;
        this.objectKey = objectKey;
        this.zip = null;
        this.tempFilePath = null;
        this.tempDirectoryPath = null;
        this.packageSha256 = null;
    }

    async init() {
        if (this.zip) return;

        // 1. Get metadata to check size before downloading
        let metadata;
        try {
            metadata = await this.storage.getObjectMetadata(this.objectKey);
        } catch (error) {
            throw new Error(`Failed to access object metadata: ${error.message}`);
        }

        if (metadata.contentLength > QuotaConfig.PLATFORM_MAX_PACKAGE_SIZE_BYTES) {
            throw new Error(`Package is too large (${metadata.contentLength} bytes). Maximum allowed is ${QuotaConfig.PLATFORM_MAX_PACKAGE_SIZE_BYTES} bytes.`);
        }

        // 2. Download stream to a temporary file
        const stream = await this.storage.getDownloadStream(this.objectKey);
        
        this.tempDirectoryPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'foundry-r2-upload-'));
        this.tempFilePath = path.join(this.tempDirectoryPath, 'package.zip');
        const fileStream = fs.createWriteStream(this.tempFilePath);
        
        await pipeline(stream, fileStream);

        // 3. Load into JSZip
        // Limitation: JSZip loads the entire file into memory here.
        // Extension point: Replace this with a streaming zip parser (e.g., yauzl) that reads from this.tempFilePath.
        const buffer = await fs.promises.readFile(this.tempFilePath);
        this.packageSha256 = `sha256-${crypto.createHash('sha256').update(buffer).digest('hex')}`;
        this.zip = await JSZip.loadAsync(buffer);
    }

    async getPackageSha256() {
        await this.init();
        return this.packageSha256;
    }

    async readStreamingManifest(path = 'streaming-manifest.json') {
        await this.init();
        const file = this.zip.file(path);
        if (!file) return null;
        return await file.async('string');
    }

    async readManifest() {
        await this.init();
        const file = this.zip.file('manifest.json');
        if (!file) return null;
        return await file.async('string');
    }

    async readFile(filePath) {
        await this.init();
        const file = this.zip.file(filePath);
        if (!file) return null;
        return await file.async('uint8array');
    }

    async exists(filePath) {
        await this.init();
        const file = this.zip.file(filePath);
        return !!file;
    }

    async getFiles() {
        await this.init();
        return Object.keys(this.zip.files);
    }

    async cleanup() {
        if (this.tempDirectoryPath) {
            try {
                await fs.promises.rm(this.tempDirectoryPath, { recursive: true, force: true });
            } catch (e) {
                console.error(`Failed to cleanup temporary upload directory ${this.tempDirectoryPath}`, e);
            }
            this.tempFilePath = null;
            this.tempDirectoryPath = null;
        }
    }
}
