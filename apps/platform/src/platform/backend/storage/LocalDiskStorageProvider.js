import fs from 'fs';
import path from 'path';
import { StorageProvider } from './StorageProvider.js';

export class LocalDiskStorageProvider extends StorageProvider {
    constructor(basePath = '.e2e/storage', uploadRoute = '/api/test-storage/upload') {
        super();
        this.kind = 'local-disk';
        this.basePath = path.resolve(basePath);
        this.uploadRoute = uploadRoute;
        this.isConfigured = true;
        if (!fs.existsSync(this.basePath)) {
            fs.mkdirSync(this.basePath, { recursive: true });
        }
    }

    resolveObjectPath(objectKey) {
        if (!objectKey || typeof objectKey !== 'string' || objectKey.includes('\0')) {
            throw new Error('Invalid local storage object key.');
        }

        const normalizedKey = objectKey.replace(/\\/g, '/');
        if (normalizedKey.startsWith('/') || /^[a-zA-Z]:/.test(normalizedKey)) {
            throw new Error('Invalid local storage object key.');
        }

        const segments = normalizedKey.split('/');
        if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
            throw new Error('Invalid local storage object key.');
        }

        const filePath = path.resolve(this.basePath, ...segments);
        const relativePath = path.relative(this.basePath, filePath);
        if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
            throw new Error('Invalid local storage object key.');
        }

        return filePath;
    }

    async createUploadSession(objectKey, contentType = 'application/zip') {
        this.resolveObjectPath(objectKey);
        const port = process.env.PORT || 3000;
        const url = `http://localhost:${port}${this.uploadRoute}?key=${encodeURIComponent(objectKey)}`;
        return { uploadUrl: url };
    }

    async ping() {
        await fs.promises.access(this.basePath, fs.constants.R_OK | fs.constants.W_OK);
        return true;
    }

    async getObjectMetadata(objectKey) {
        const filePath = this.resolveObjectPath(objectKey);
        if (!fs.existsSync(filePath)) {
            throw Object.assign(new Error('NotFound'), { name: 'NotFound' });
        }
        const stat = fs.statSync(filePath);
        return {
            contentLength: stat.size,
            contentType: objectKey.endsWith('.zip') ? 'application/zip' : 'application/octet-stream',
            lastModified: stat.mtime,
            etag: `W/\"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}\"`
        };
    }

    async getDownloadStream(objectKey, options = {}) {
        const filePath = this.resolveObjectPath(objectKey);
        if (!fs.existsSync(filePath)) {
            throw Object.assign(new Error('NotFound'), { name: 'NotFound' });
        }
        const range = Number.isInteger(options.start) && Number.isInteger(options.end)
            ? { start: options.start, end: options.end }
            : {};
        return fs.createReadStream(filePath, range);
    }

    async uploadBuffer(objectKey, buffer, contentType, options = {}) {
        const filePath = this.resolveObjectPath(objectKey);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, buffer);
    }

    async deleteObject(objectKey) {
        const filePath = this.resolveObjectPath(objectKey);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }

    async deletePrefix(prefix) {
        const dirPath = this.resolveObjectPath(prefix);
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
        }
    }
}
