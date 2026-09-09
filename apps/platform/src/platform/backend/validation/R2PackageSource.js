import { GamePackageSource } from './GamePackageSource.js';
import { FileBackedZip } from './FileBackedZip.js';

// Used by both local-disk and R2 storage; no storage-specific behavior belongs here.
export class R2PackageSource extends GamePackageSource {
    constructor(storage, objectKey, options = {}) {
        super();
        this.storage = storage;
        this.objectKey = objectKey;
        this.options = options;
        this.archive = null;
    }

    async init() {
        if (!this.archive) {
            this.archive = await FileBackedZip.download(this.storage, this.objectKey, this.options);
        }
    }

    async getPackageSha256() {
        await this.init();
        return this.archive.packageSha256;
    }

    async readStreamingManifest(path = 'streaming-manifest.json') {
        const bytes = await this.readFile(path);
        return bytes === null ? null : bytes.toString('utf8');
    }

    async readManifest() {
        const bytes = await this.readFile('manifest.json');
        return bytes === null ? null : bytes.toString('utf8');
    }

    async readFile(filePath) {
        await this.init();
        try {
            return await this.archive.readFile(filePath);
        } catch (error) {
            await this.cleanup();
            throw error;
        }
    }

    async exists(filePath) {
        await this.init();
        return !filePath.endsWith('/') && this.archive.entries.has(filePath);
    }

    async getFiles() {
        await this.init();
        return [...this.archive.entries.keys()];
    }

    async cleanup() {
        await this.archive?.cleanup();
        this.archive = null;
    }
}
