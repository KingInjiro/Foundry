import JSZip from 'jszip';
import { GamePackageSource } from './GamePackageSource.js';

export class LocalZipPackageSource extends GamePackageSource {
    constructor(fileOrBuffer) {
        super();
        this.fileOrBuffer = fileOrBuffer;
        this.zip = null;
    }

    async init() {
        if (this.zip) return;
        this.zip = await JSZip.loadAsync(this.fileOrBuffer);
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

    async readFile(path) {
        await this.init();
        const file = this.zip.file(path);
        if (!file) return null;
        return await file.async('uint8array');
    }

    async exists(path) {
        await this.init();
        // JSZip file(path) looks for exact match, doesn't always work for directories depending on trailing slash,
        // but for game files this is usually sufficient.
        const file = this.zip.file(path);
        return !!file;
    }

    async getFiles() {
        await this.init();
        return Object.keys(this.zip.files);
    }
}
