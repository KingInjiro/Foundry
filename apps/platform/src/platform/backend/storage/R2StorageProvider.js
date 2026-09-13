import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, HeadBucketCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { StorageProvider } from './StorageProvider.js';
import { resolveR2ObjectPrefix } from '../config/storageConfig.js';

export class R2StorageProvider extends StorageProvider {
    constructor({ env = process.env } = {}) {
        super();
        this.kind = 'r2';
        const accountId = env.R2_ACCOUNT_ID;
        const accessKeyId = env.R2_ACCESS_KEY_ID;
        const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
        const endpoint = env.R2_ENDPOINT;
        this.endpoint = endpoint;
        this.objectPrefix = resolveR2ObjectPrefix(env);
        
        this.bucketName = env.R2_BUCKET_NAME;
        this.isConfigured = !!(accountId && accessKeyId && secretAccessKey && this.bucketName && endpoint);
        this.directDownloadsEnabled = this.isConfigured && env.R2_DIRECT_DOWNLOADS === 'true';
        const configuredUploadTtl = Number(env.R2_UPLOAD_URL_TTL_SECONDS || NaN);
        this.uploadUrlTtlSeconds = Number.isFinite(configuredUploadTtl)
            ? Math.max(60, Math.min(Math.floor(configuredUploadTtl), 3600))
            : 900;
        const configuredDownloadTtl = Number(env.R2_DOWNLOAD_URL_TTL_SECONDS || NaN);
        this.downloadUrlTtlSeconds = Number.isFinite(configuredDownloadTtl)
            ? Math.max(30, Math.min(Math.floor(configuredDownloadTtl), 900))
            : 120;

        if (this.isConfigured) {
            this.client = new S3Client({
                region: "auto",
                endpoint: endpoint,
                credentials: {
                    accessKeyId: accessKeyId,
                    secretAccessKey: secretAccessKey,
                },
            });
        }
    }

    async send(command) {
        try { return await this.client.send(command); }
        catch (error) { throw this.operationError(error); }
    }

    async sign(command, options) {
        // A presigned PUT has no body yet. The SDK's automatic optional CRC32
        // would sign the empty-body checksum and reject the browser's real ZIP.
        // Override only this signing context, without mutating the shared client
        // or changing checksums for server uploads, deletes or downloads.
        const signingClient = command instanceof PutObjectCommand ? {
            ...this.client,
            config: { ...this.client.config, requestChecksumCalculation: async () => 'WHEN_REQUIRED' }
        } : this.client;
        try { return await getSignedUrl(signingClient, command, options); }
        catch (error) { throw this.operationError(error); }
    }

    operationError(cause) {
        // SDK/service error strings may include signed URLs or request details.
        // Keep failures observable without logging credentials or bearer URLs.
        const status = Number(cause?.$metadata?.httpStatusCode);
        const error = new Error(`R2 storage operation failed${Number.isInteger(status) ? ` (HTTP ${status})` : ''}.`);
        error.name = status === 404 || cause?.name === 'NotFound' || cause?.name === 'NoSuchKey' ? 'NotFound' : 'R2StorageError';
        error.code = error.name === 'NotFound' ? 'R2_OBJECT_NOT_FOUND' : 'R2_STORAGE_FAILED';
        if (Number.isInteger(status)) error.$metadata = { httpStatusCode: status };
        return error;
    }

    safePrefix(prefix, directory = false) {
        if (typeof prefix !== 'string' || !prefix || /[\\\x00-\x1f\x7f]/.test(prefix)) {
            throw new Error('Refusing an empty or unsafe R2 prefix.');
        }
        const base = prefix.replace(/\/$/, '');
        if (base.split('/').some(part => !part || part === '.' || part === '..')) {
            throw new Error('Refusing an empty or unsafe R2 prefix.');
        }
        return directory ? `${base}/` : prefix;
    }

    physicalKey(key) {
        this.safePrefix(key);
        if (key.endsWith('/')) throw new Error('R2 object key must name a file.');
        return `${this.objectPrefix ? `${this.objectPrefix}/` : ''}${key}`;
    }

    physicalPrefix(prefix, directory = false) {
        return `${this.objectPrefix ? `${this.objectPrefix}/` : ''}${this.safePrefix(prefix, directory)}`;
    }

    nextPage(response, seen) {
        if (!response.IsTruncated) return undefined;
        const token = response.NextContinuationToken;
        if (typeof token !== 'string' || !token || seen.has(token)) {
            throw new Error('R2 returned incomplete or repeated listing pagination.');
        }
        seen.add(token);
        return token;
    }

    async createUploadSession(objectKey, contentType = 'application/zip') {
        if (!this.isConfigured) {
            throw new Error("R2 is not configured in this environment.");
        }
        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: this.physicalKey(objectKey),
            ContentType: contentType
        });
        const url = await this.sign(command, { expiresIn: this.uploadUrlTtlSeconds, signableHeaders: new Set(['content-type']) });
        return { uploadUrl: url };
    }

    async ping() {
        if (!this.isConfigured) return false;
        await this.send(new HeadBucketCommand({ Bucket: this.bucketName }));
        return true;
    }

    async getObjectMetadata(objectKey) {
        if (!this.isConfigured) {
            throw new Error("R2 is not configured in this environment.");
        }
        const command = new HeadObjectCommand({
            Bucket: this.bucketName,
            Key: this.physicalKey(objectKey)
        });
        const response = await this.send(command);
        return {
            contentLength: response.ContentLength,
            contentType: response.ContentType,
            lastModified: response.LastModified,
            etag: response.ETag
        };
    }

    async getDownloadStream(objectKey, options = {}) {
        if (!this.isConfigured) {
            throw new Error("R2 is not configured in this environment.");
        }
        
        const command = new GetObjectCommand({
            Bucket: this.bucketName,
            Key: this.physicalKey(objectKey),
            ...(Number.isInteger(options.start) && Number.isInteger(options.end) && {
                Range: `bytes=${options.start}-${options.end}`
            })
        });
        const response = await this.send(command);
        return response.Body; // Node.js stream
    }

    async createDownloadUrl(objectKey, options = {}) {
        if (!this.isConfigured) {
            throw new Error("R2 is not configured in this environment.");
        }
        const command = new GetObjectCommand({
            Bucket: this.bucketName,
            Key: this.physicalKey(objectKey),
            ...(Number.isInteger(options.start) && Number.isInteger(options.end) && {
                Range: `bytes=${options.start}-${options.end}`
            })
        });
        return this.sign(command, {
            expiresIn: Math.max(30, Math.min(Number(options.expiresIn) || this.downloadUrlTtlSeconds, 900))
        });
    }

    async uploadBuffer(objectKey, buffer, contentType, options = {}) {
        if (!this.isConfigured) {
            throw new Error("R2 is not configured in this environment.");
        }
        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: this.physicalKey(objectKey),
            Body: buffer,
            ContentType: contentType,
            ...(options.cacheControl && { CacheControl: options.cacheControl })
        });
        await this.send(command);
    }

    async deleteObject(objectKey) {
        if (!this.isConfigured) {
            throw new Error("R2 is not configured in this environment.");
        }
        const command = new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: this.physicalKey(objectKey)
        });
        await this.send(command);
    }

    async deletePrefix(prefix) {
        if (!this.isConfigured) {
            throw new Error("R2 is not configured in this environment.");
        }

        const normalizedPrefix = this.physicalPrefix(prefix, true);
        const seenTokens = new Set();
        let continuationToken;
        do {
            const response = await this.send(new ListObjectsV2Command({
                Bucket: this.bucketName,
                Prefix: normalizedPrefix,
                ...(continuationToken && { ContinuationToken: continuationToken })
            }));

            const nextToken = this.nextPage(response, seenTokens);
            const objects = (response.Contents || []).map(object => {
                if (!object.Key?.startsWith(normalizedPrefix)) throw new Error('R2 listing escaped the requested prefix.');
                return { Key: object.Key };
            });
            if (objects.length) {
                const deletion = await this.send(new DeleteObjectsCommand({
                    Bucket: this.bucketName,
                    Delete: { Objects: objects, Quiet: true }
                }));
                if (deletion.Errors?.length) {
                    throw new Error(`R2 failed to delete ${deletion.Errors.length} object(s) from prefix ${normalizedPrefix}.`);
                }
            }

            continuationToken = nextToken;
        } while (continuationToken);
    }

    async listObjects(prefix) {
        if (!this.isConfigured) {
            throw new Error("R2 is not configured in this environment.");
        }
        const normalizedPrefix = this.physicalPrefix(prefix);
        const objects = [];
        const seenTokens = new Set();
        const seenKeys = new Set();
        let continuationToken;
        do {
            const response = await this.send(new ListObjectsV2Command({
                Bucket: this.bucketName,
                Prefix: normalizedPrefix,
                ...(continuationToken && { ContinuationToken: continuationToken })
            }));
            for (const object of response.Contents || []) {
                if (!object.Key?.startsWith(normalizedPrefix) || seenKeys.has(object.Key)) {
                    throw new Error('R2 listing returned an out-of-scope or repeated object.');
                }
                seenKeys.add(object.Key);
                objects.push({
                    key: object.Key.slice(this.objectPrefix ? this.objectPrefix.length + 1 : 0),
                    size: Number(object.Size || 0),
                    lastModified: object.LastModified || null,
                    etag: object.ETag || null
                });
            }
            continuationToken = this.nextPage(response, seenTokens);
        } while (continuationToken);
        return objects;
    }
}
