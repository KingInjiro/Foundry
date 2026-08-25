import { GamePackageSource } from '../../../src/platform/backend/validation/GamePackageSource.js';

export class MockPackageSource extends GamePackageSource {
    constructor(files = {}, manifestRaw = null) {
        super();
        this.files = files; // path -> content
        this.manifestRaw = manifestRaw;
    }

    async readManifest() {
        if (this.manifestRaw !== null) return this.manifestRaw;
        return this.files['manifest.json'] || null;
    }

    async exists(path) {
        return path in this.files;
    }

    async readFile(path) {
        const content = this.files[path];
        if (content === undefined) return null;
        if (content instanceof Uint8Array) return content;
        if (content instanceof ArrayBuffer) return new Uint8Array(content);
        return new TextEncoder().encode(String(content));
    }

    async getFiles() {
        return Object.keys(this.files);
    }
}
