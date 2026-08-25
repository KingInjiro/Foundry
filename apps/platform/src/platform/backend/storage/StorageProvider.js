/**
 * Storage provider contract used by the upload, validation, extraction and CDN
 * paths. Concrete providers must keep uploaded packages private and expose only
 * the extracted runtime files through the Platform API.
 */
export class StorageProvider {
    async ping() {
        throw new Error("Method not implemented.");
    }

    async createUploadSession(_objectKey, _contentType = 'application/zip') {
        throw new Error("Method not implemented.");
    }

    async getObjectMetadata(_objectKey) {
        throw new Error("Method not implemented.");
    }

    async getDownloadStream(_objectKey, _options = {}) {
        throw new Error("Method not implemented.");
    }

    async uploadBuffer(_objectKey, _buffer, _contentType, _options = {}) {
        throw new Error("Method not implemented.");
    }

    async deleteObject(_objectKey) {
        throw new Error("Method not implemented.");
    }

    async deletePrefix(_prefix) {
        throw new Error("Method not implemented.");
    }
}
