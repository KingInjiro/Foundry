import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, HeadBucketCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { StorageProvider } from './StorageProvider.js';

export class R2StorageProvider extends StorageProvider {
    constructor() {
        super();
        this.kind = 'r2';
        const accountId = process.env.R2_ACCOUNT_ID;
        const accessKeyId = process.env.R2_ACCESS_KEY_ID;
        const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
        const endpoint = process.env.R2_ENDPOINT;
        
        this.bucketName = process.env.R2_BUCKET_NAME;
        this.isConfigured = !!(accountId && accessKeyId && secretAccessKey && this.bucketName && endpoint);
        this.directDownloadsEnabled = this.isConfigured && process.env.R2_DIRECT_DOWNLOADS === 'true';
        const configuredDownloadTtl = Number(process.env.R2_DOWNLOAD_URL_TTL_SECONDS);
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

    async createUploadSession(objectKey, contentType = 'application/zip') {
        if (!this.isConfigured) {
            throw new Error("R2 is not configured in this environment.");
        }
        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: objectKey,
            ContentType: contentType
        });
        const url = await getSignedUrl(this.client, command, { expiresIn: 3600 });
        return { uploadUrl: url };
    }

    async ping() {
        if (!this.isConfigured) return false;
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
        return true;
    }

    async getObjectMetadata(objectKey) {
        if (!this.isConfigured) {
            throw new Error("R2 is not configured in this environment.");
        }
        const command = new HeadObjectCommand({
            Bucket: this.bucketName,
            Key: objectKey
        });
        const response = await this.client.send(command);
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
            Key: objectKey,
            ...(Number.isInteger(options.start) && Number.isInteger(options.end) && {
                Range: `bytes=${options.start}-${options.end}`
            })
        });
        const response = await this.client.send(command);
        return response.Body; // Node.js stream
    }

    async createDownloadUrl(objectKey, options = {}) {
        if (!this.isConfigured) {
            throw new Error("R2 is not configured in this environment.");
        }
        const command = new GetObjectCommand({
            Bucket: this.bucketName,
            Key: objectKey,
            ...(Number.isInteger(options.start) && Number.isInteger(options.end) && {
                Range: `bytes=${options.start}-${options.end}`
            })
        });
        return getSignedUrl(this.client, command, {
            expiresIn: Math.max(30, Math.min(Number(options.expiresIn) || this.downloadUrlTtlSeconds, 900))
        });
    }

    async uploadBuffer(objectKey, buffer, contentType, options = {}) {
        if (!this.isConfigured) {
            throw new Error("R2 is not configured in this environment.");
        }
        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: objectKey,
            Body: buffer,
            ContentType: contentType,
            ...(options.cacheControl && { CacheControl: options.cacheControl })
        });
        await this.client.send(command);
    }

    async deleteObject(objectKey) {
        if (!this.isConfigured) {
            throw new Error("R2 is not configured in this environment.");
        }
        const command = new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: objectKey
        });
        await this.client.send(command);
    }

    async deletePrefix(prefix) {
        if (!this.isConfigured) {
            throw new Error("R2 is not configured in this environment.");
        }

        const normalizedPrefix = `${String(prefix || '').replace(/\/+$/, '')}/`;
        if (normalizedPrefix === '/') throw new Error('Refusing to delete an empty R2 prefix.');
        let continuationToken;
        do {
            const response = await this.client.send(new ListObjectsV2Command({
                Bucket: this.bucketName,
                Prefix: normalizedPrefix,
                ...(continuationToken && { ContinuationToken: continuationToken })
            }));

            const objects = (response.Contents || []).filter(object => object.Key).map(object => ({ Key: object.Key }));
            if (objects.length) {
                const deletion = await this.client.send(new DeleteObjectsCommand({
                    Bucket: this.bucketName,
                    Delete: { Objects: objects, Quiet: true }
                }));
                if (deletion.Errors?.length) {
                    throw new Error(`R2 failed to delete ${deletion.Errors.length} object(s) from prefix ${normalizedPrefix}.`);
                }
            }

            continuationToken = response.IsTruncated
                ? response.NextContinuationToken
                : undefined;
        } while (continuationToken);
    }
}
