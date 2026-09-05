import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { StorageProvider } from './StorageProvider.js';

export class LocalDiskStorageProvider extends StorageProvider {
    constructor(basePath = '.e2e/storage', uploadRoute = '/api/test-storage/upload', options = {}) {
        super();
        this.kind = 'local-disk';
        this.basePath = path.resolve(basePath);
        this.uploadRoute = uploadRoute;
        this.uploadSigningSecret = typeof options.uploadSigningSecret === 'string' ? options.uploadSigningSecret : null;
        this.uploadUrlTtlSeconds = Math.max(60, Math.min(Number(options.uploadUrlTtlSeconds) || 900, 3600));
        this.publicOrigin = options.publicOrigin ? new URL(options.publicOrigin).origin : null;
        this.now = typeof options.now === 'function' ? options.now : () => Date.now();
        this.directDownloadsEnabled = false;
        this.isConfigured = true;
        if (!fs.existsSync(this.basePath)) {
            fs.mkdirSync(this.basePath, { recursive: true, mode: 0o750 });
        }
        this.tempPath = path.join(this.basePath, '.tmp');
        fs.mkdirSync(this.tempPath, { recursive: true, mode: 0o750 });
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
        if (this.uploadSigningSecret) {
            const expires = Math.floor(this.now() / 1000) + this.uploadUrlTtlSeconds;
            const signature = this.signUpload(objectKey, contentType, expires);
            const query = new URLSearchParams({ key: objectKey, contentType, expires: String(expires), signature });
            return { uploadUrl: `${this.uploadRoute}?${query}` };
        }
        const port = process.env.PORT || 3000;
        const url = `http://localhost:${port}${this.uploadRoute}?key=${encodeURIComponent(objectKey)}`;
        return { uploadUrl: url };
    }

    signUpload(objectKey, contentType, expires) {
        if (!this.uploadSigningSecret) throw new Error('Local storage upload signing is not configured.');
        return crypto.createHmac('sha256', this.uploadSigningSecret)
            .update('foundry-local-upload-v1\0', 'utf8')
            .update(objectKey, 'utf8')
            .update('\0', 'utf8')
            .update(contentType, 'utf8')
            .update('\0', 'utf8')
            .update(String(expires), 'utf8')
            .digest('base64url');
    }

    verifyUploadRequest({ objectKey, contentType = 'application/zip', expires, signature }) {
        this.resolveObjectPath(objectKey);
        if (!this.uploadSigningSecret) return true;
        const parsedExpires = Number(expires);
        const nowSeconds = Math.floor(this.now() / 1000);
        if (
            !Number.isSafeInteger(parsedExpires)
            || parsedExpires < nowSeconds
            || parsedExpires > nowSeconds + this.uploadUrlTtlSeconds + 30
            || typeof signature !== 'string'
        ) return false;
        const expected = this.signUpload(objectKey, contentType, parsedExpires);
        const actualBuffer = Buffer.from(signature, 'utf8');
        const expectedBuffer = Buffer.from(expected, 'utf8');
        return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
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
            fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
        }
        // The E2E reset path and an operator cleanup may remove an empty temp
        // directory after provider construction. Re-establish it for every
        // atomic write; completed objects still publish only via rename.
        await fs.promises.mkdir(this.tempPath, { recursive: true, mode: 0o750 });
        const temporaryPath = path.join(this.tempPath, `${crypto.randomUUID()}.partial`);
        let handle;
        try {
            handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
            await handle.writeFile(buffer);
            await handle.sync();
            await handle.close();
            handle = null;
            await fs.promises.rename(temporaryPath, filePath);
        } catch (error) {
            await handle?.close().catch(() => {});
            await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
            throw error;
        }
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

    async listObjects(prefix) {
        const normalizedPrefix = String(prefix || '').replace(/\/+$/, '');
        const root = this.resolveObjectPath(normalizedPrefix);
        if (!fs.existsSync(root)) return [];
        const objects = [];
        const visit = currentPath => {
            const stat = fs.lstatSync(currentPath);
            if (stat.isSymbolicLink()) throw new Error('Unsafe symbolic link found in local object storage.');
            if (stat.isDirectory()) {
                for (const entry of fs.readdirSync(currentPath)) visit(path.join(currentPath, entry));
                return;
            }
            const key = path.relative(this.basePath, currentPath).split(path.sep).join('/');
            objects.push({ key, size: stat.size, lastModified: stat.mtime, etag: `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"` });
        };
        visit(root);
        return objects.sort((a, b) => a.key.localeCompare(b.key));
    }
}
