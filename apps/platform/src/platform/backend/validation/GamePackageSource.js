export class GamePackageSource {
    /**
     * Reads the manifest.json file from the package root.
     * @returns {Promise<string|null>} The raw JSON string or null if not found.
     */
    async readStreamingManifest(path = 'streaming-manifest.json') {
        throw new Error('Not implemented');
    }

    async readManifest() {
        throw new Error("Method not implemented.");
    }

    /**
     * Reads a package file as bytes for integrity validation.
     * @param {string} path
     * @returns {Promise<Uint8Array|null>}
     */
    async readFile(path) {
        throw new Error('Not implemented');
    }

    /**
     * Checks if a specific file exists in the package.
     * @param {string} path 
     * @returns {Promise<boolean>}
     */
    async exists(path) {
        throw new Error("Method not implemented.");
    }

    /**
     * Gets all file paths in the package.
     * @returns {Promise<string[]>}
     */
    async getFiles() {
        throw new Error("Method not implemented.");
    }
}
