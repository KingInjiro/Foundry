import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import JSZip from 'jszip';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import { createApp, parseByteRange } from '../../../src/platform/backend/server/app.js';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';
import { QuotaConfig } from '../../../src/platform/backend/config/quotas.js';

const DEFAULT_STORAGE_QUOTA = QuotaConfig.PLATFORM_MAX_STORAGE_BYTES_PER_USER;

class MemoryStorage {
    constructor() {
        this.isConfigured = true;
        this.objects = new Map();
    }

    async createUploadSession(objectKey) {
        return { uploadUrl: `memory://${objectKey}` };
    }

    async getObjectMetadata(objectKey) {
        const object = this.objects.get(objectKey);
        if (!object) throw Object.assign(new Error('NotFound'), { name: 'NotFound' });
        return {
            contentLength: object.buffer.length,
            contentType: object.contentType,
            lastModified: object.lastModified,
            etag: object.etag
        };
    }

    async getDownloadStream(objectKey, options = {}) {
        const object = this.objects.get(objectKey);
        if (!object) throw Object.assign(new Error('NotFound'), { name: 'NotFound' });
        const buffer = Number.isInteger(options.start) && Number.isInteger(options.end)
            ? object.buffer.subarray(options.start, options.end + 1)
            : object.buffer;
        return Readable.from(buffer);
    }

    async uploadBuffer(objectKey, buffer, contentType) {
        const storedBuffer = Buffer.from(buffer);
        this.objects.set(objectKey, {
            buffer: storedBuffer,
            contentType,
            lastModified: new Date(),
            etag: `"${crypto.createHash('sha256').update(storedBuffer).digest('hex')}"`
        });
    }

    async deleteObject(objectKey) {
        this.objects.delete(objectKey);
    }

    async deletePrefix(prefix) {
        for (const key of this.objects.keys()) {
            if (key.startsWith(prefix)) this.objects.delete(key);
        }
    }
}

class InlineJobQueue {
    constructor() {
        this.handlers = new Map();
    }

    registerHandler(type, handler) {
        this.handlers.set(type, handler);
    }

    async enqueue(type, targetId, payload) {
        const handler = this.handlers.get(type);
        if (!handler) throw new Error(`No handler registered for ${type}`);
        const job = { id: `job:${type}:${targetId}`, type, targetId, payload };
        await handler(payload, job);
        return job.id;
    }
}

describe('CDN byte ranges', () => {
    it.each([
        ['bytes=0-4', 10, { start: 0, end: 4 }],
        ['bytes=5-', 10, { start: 5, end: 9 }],
        ['bytes=-3', 10, { start: 7, end: 9 }],
        ['bytes=0-99', 10, { start: 0, end: 9 }]
    ])('normalizes %s', (header, length, expected) => {
        expect(parseByteRange(header, length)).toEqual(expected);
    });

    it.each(['bytes=10-12', 'bytes=5-4', 'bytes=0-1,4-5', 'items=0-1', 'bytes=-0'])('rejects %s', header => {
        expect(parseByteRange(header, 10)).toEqual({ invalid: true });
    });
});

describe('Publish pipeline', () => {
    let db;
    let storage;
    let app;

    beforeEach(() => {
        process.env.AUTH_DEV_BYPASS = 'true';
        db = new LocalSqliteProvider(':memory:');
        storage = new MemoryStorage();
        app = createApp(db, storage, new InlineJobQueue());
    });

    afterEach(() => {
        QuotaConfig.PLATFORM_MAX_STORAGE_BYTES_PER_USER = DEFAULT_STORAGE_QUOTA;
        db.db.close();
    });

    it('validates, extracts, publishes, and serves the uploaded web game', async () => {
        const auth = { 'x-dev-uid': 'publish-owner' };
        const gameResponse = await request(app)
            .post('/api/games')
            .set(auth)
            .send({ title: 'Playable Build', description: 'End-to-end publish test' });
        const gameId = gameResponse.body.data.id;

        const versionResponse = await request(app)
            .post(`/api/games/${gameId}/versions`)
            .set(auth)
            .send({});
        const { sessionId, versionId, objectKey } = versionResponse.body.data;

        const zip = new JSZip();
        zip.file('manifest.json', JSON.stringify({
            version: 1,
            format: 'web-game',
            gameId: 'playable-build',
            gameVersion: '2.3.4',
            name: 'Playable Build',
            runtime: 'web',
            entry: 'index.html',
            capabilities: ['fullscreen', 'downloads'],
            thumbnail: 'art/cover.png',
            tags: ['Arcade', 'Quick Play'],
            controls: [{ action: 'Move', key: 'Arrow Keys' }]
        }));
        zip.file('index.html', '<!doctype html><title>Playable Build</title><main>READY</main>');
        zip.file('art/cover.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
        const packageBuffer = await zip.generateAsync({ type: 'nodebuffer' });
        await storage.uploadBuffer(objectKey, packageBuffer, 'application/zip');

        const completeResponse = await request(app)
            .post(`/api/uploads/${sessionId}/complete`)
            .set(auth)
            .send({});
        expect(completeResponse.status).toBe(200);
        expect(completeResponse.body.data.status).toBe('READY');

        const publishResponse = await request(app)
            .post(`/api/games/${gameId}/versions/${versionId}/publish`)
            .set(auth)
            .send({});
        expect(publishResponse.status).toBe(200);
        expect(publishResponse.body.data.status).toBe('PUBLISHED');

        const publishedVersion = await db.getGameVersion(versionId);
        expect(publishedVersion.status).toBe('PUBLISHED');
        expect(publishedVersion.version).toBe('2.3.4');
        expect(JSON.parse(publishedVersion.capabilities)).toEqual(['fullscreen', 'downloads']);
        expect(publishedVersion.thumbnail).toBe('art/cover.png');
        expect(publishedVersion.packageSha256).toBe(`sha256-${crypto.createHash('sha256').update(packageBuffer).digest('hex')}`);
        expect(publishedVersion.runtimeUrl).toBe(`/api/cdn/games/${gameId}/versions/${versionId}/extracted`);
        expect((await db.getGame(gameId)).currentState).toBe('PUBLISHED');

        const detailsResponse = await request(app).get(`/api/catalog/games/${gameId}`);
        expect(detailsResponse.status).toBe(200);
        expect(detailsResponse.body.data.storageRef.location).toBe(publishedVersion.runtimeUrl);
        expect(detailsResponse.body.data.versionId).toBe(versionId);
        expect(detailsResponse.body.data.capabilities).toEqual(['fullscreen', 'downloads']);
        expect(detailsResponse.body.data.thumbnailUrl).toBe(`${publishedVersion.runtimeUrl}/art/cover.png`);
        expect(detailsResponse.body.data.tags).toEqual(['Arcade', 'Quick Play']);
        expect(detailsResponse.body.data.controls).toEqual([{ action: 'Move', key: 'Arrow Keys' }]);

        const assetResponse = await request(app).get(`${publishedVersion.runtimeUrl}/index.html`);
        expect(assetResponse.status).toBe(200);
        expect(assetResponse.headers['content-type']).toContain('text/html');
        expect(assetResponse.headers['access-control-allow-origin']).toBe('*');
        expect(assetResponse.headers['x-content-type-options']).toBe('nosniff');
        expect(assetResponse.headers['content-security-policy']).toBe('sandbox allow-scripts allow-downloads');
        expect(assetResponse.text).toContain('Playable Build');

        const notModifiedResponse = await request(app)
            .get(`${publishedVersion.runtimeUrl}/index.html`)
            .set('If-None-Match', `"not-this-one", ${assetResponse.headers.etag}`);
        expect(notModifiedResponse.status).toBe(304);

        const staleIfRangeResponse = await request(app)
            .get(`${publishedVersion.runtimeUrl}/index.html`)
            .set('Range', 'bytes=0-8')
            .set('If-Range', '"stale-etag"');
        expect(staleIfRangeResponse.status).toBe(200);
        expect(staleIfRangeResponse.text).toContain('Playable Build');

        const headResponse = await request(app).head(`${publishedVersion.runtimeUrl}/index.html`);
        expect(headResponse.status).toBe(200);
        expect(headResponse.headers['content-length']).toBe(String(Buffer.byteLength('<!doctype html><title>Playable Build</title><main>READY</main>')));
        expect(headResponse.text).toBeUndefined();

        const rangeResponse = await request(app)
            .get(`${publishedVersion.runtimeUrl}/index.html`)
            .set('Range', 'bytes=0-8');
        expect(rangeResponse.status).toBe(206);
        expect(rangeResponse.headers['accept-ranges']).toBe('bytes');
        expect(rangeResponse.headers['content-range']).toBe(`bytes 0-8/${Buffer.byteLength('<!doctype html><title>Playable Build</title><main>READY</main>')}`);
        expect(rangeResponse.text).toBe('<!doctype');

        const invalidRangeResponse = await request(app)
            .get(`${publishedVersion.runtimeUrl}/index.html`)
            .set('Range', 'bytes=99999-100000');
        expect(invalidRangeResponse.status).toBe(416);

        const preflightResponse = await request(app)
            .options(`${publishedVersion.runtimeUrl}/index.html`)
            .set('Origin', 'null')
            .set('Access-Control-Request-Method', 'GET');
        expect(preflightResponse.status).toBe(204);
        expect(preflightResponse.headers['access-control-allow-origin']).toBe('*');
    });

    it('refuses a package that was replaced after validation', async () => {
        const auth = { 'x-dev-uid': 'tamper-owner' };
        const gameResponse = await request(app)
            .post('/api/games')
            .set(auth)
            .send({ title: 'Immutable Validation' });
        const gameId = gameResponse.body.data.id;
        const versionResponse = await request(app)
            .post(`/api/games/${gameId}/versions`)
            .set(auth)
            .send({});
        const { sessionId, versionId, objectKey } = versionResponse.body.data;

        const validatedZip = new JSZip();
        validatedZip.file('manifest.json', JSON.stringify({
            version: 1,
            format: 'web-game',
            gameId: 'immutable-validation',
            gameVersion: '1.0.0',
            name: 'Immutable Validation',
            runtime: 'web',
            entry: 'index.html',
            capabilities: []
        }));
        validatedZip.file('index.html', '<main>validated</main>');
        await storage.uploadBuffer(objectKey, await validatedZip.generateAsync({ type: 'nodebuffer' }), 'application/zip');

        const completeResponse = await request(app)
            .post(`/api/uploads/${sessionId}/complete`)
            .set(auth)
            .send({});
        expect(completeResponse.status).toBe(200);

        const replacedZip = new JSZip();
        replacedZip.file('manifest.json', JSON.stringify({
            version: 1,
            format: 'web-game',
            gameId: 'immutable-validation',
            gameVersion: '1.0.0',
            name: 'Immutable Validation',
            runtime: 'web',
            entry: 'index.html',
            capabilities: []
        }));
        replacedZip.file('index.html', '<main>replaced after validation</main>');
        await storage.uploadBuffer(objectKey, await replacedZip.generateAsync({ type: 'nodebuffer' }), 'application/zip');

        const publishResponse = await request(app)
            .post(`/api/games/${gameId}/versions/${versionId}/publish`)
            .set(auth)
            .send({});
        expect(publishResponse.status).toBe(409);
        expect(publishResponse.body.error.code).toBe('PACKAGE_CHANGED_AFTER_VALIDATION');

        const failedVersion = await db.getGameVersion(versionId);
        expect(failedVersion.status).toBe('PUBLISH_FAILED');
        expect(failedVersion.publishError).toContain('changed after validation');
        expect([...storage.objects.keys()].some(key => key.includes('/extracted/'))).toBe(false);
    });

    it('does not expose uploaded package ZIPs through the public asset route', async () => {
        const response = await request(app).get('/api/cdn/games/game/versions/version/package.zip');
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('INVALID_ASSET_PATH');
    });

    it('does not serve extracted assets until the matching version is published', async () => {
        const gameId = crypto.randomUUID();
        const versionId = crypto.randomUUID();
        const runtimePath = `games/${gameId}/versions/${versionId}/extracted/index.html`;

        await db.createGame({
            id: gameId,
            ownerUid: 'draft-owner',
            title: 'Private Draft',
            description: '',
            storageMode: 'platform',
            currentState: 'DRAFT',
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
        await db.createGameVersion({
            id: versionId,
            gameId,
            version: '1.0.0',
            runtime: 'web',
            format: 'web-game',
            entry: 'index.html',
            status: 'READY',
            createdAt: Date.now()
        });
        await storage.uploadBuffer(runtimePath, '<main>private</main>', 'text/html');

        const response = await request(app).get(`/api/cdn/${runtimePath}`);
        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('ASSET_NOT_FOUND');
    });

    it('surfaces storage quota failures and leaves no extracted runtime behind', async () => {
        const ownerUid = 'quota-owner';
        const gameId = crypto.randomUUID();
        const versionId = crypto.randomUUID();
        const sessionId = crypto.randomUUID();
        const objectKey = `games/${gameId}/versions/${versionId}/package.zip`;

        await db.createGame({
            id: gameId,
            ownerUid,
            title: 'Quota Build',
            description: '',
            storageMode: 'platform',
            currentState: 'DRAFT',
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
        await db.createGameVersion({
            id: versionId,
            gameId,
            version: '1.0.0',
            runtime: 'web',
            format: 'web-game',
            entry: 'index.html',
            status: 'READY',
            createdAt: Date.now()
        });
        await db.updateGameVersionMetadata(versionId, { packageSizeBytes: 10 });
        await db.createUploadSession({
            id: sessionId,
            ownerUid,
            gameId,
            versionId,
            storageProvider: 'memory',
            objectKey,
            expectedSize: 0,
            expectedContentType: 'application/zip',
            status: 'COMPLETED',
            expiresAt: Date.now() + 60_000,
            createdAt: Date.now()
        });

        const zip = new JSZip();
        zip.file('manifest.json', '{}');
        zip.file('index.html', '<main>This cannot fit in the remaining quota.</main>');
        await storage.uploadBuffer(objectKey, await zip.generateAsync({ type: 'nodebuffer' }), 'application/zip');
        QuotaConfig.PLATFORM_MAX_STORAGE_BYTES_PER_USER = 20;

        const response = await request(app)
            .post(`/api/games/${gameId}/versions/${versionId}/publish`)
            .set('x-dev-uid', ownerUid)
            .send({});

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('STORAGE_QUOTA_EXCEEDED');
        const failedVersion = await db.getGameVersion(versionId);
        expect(failedVersion.status).toBe('PUBLISH_FAILED');
        expect(failedVersion.publishError).toContain('storage quota');
        expect([...storage.objects.keys()].some(key => key.includes('/extracted/'))).toBe(false);
    });

    it('publishes and exposes the exact validated streaming manifest path', async () => {
        const auth = { 'x-dev-uid': 'streaming-owner' };
        const gameResponse = await request(app)
            .post('/api/games')
            .set(auth)
            .send({ title: 'Streamed Build', description: 'Alternative manifest path' });
        const gameId = gameResponse.body.data.id;

        const versionResponse = await request(app)
            .post(`/api/games/${gameId}/versions`)
            .set(auth)
            .send({});
        const { sessionId, versionId, objectKey } = versionResponse.body.data;

        const chunkData = '{"asset":"streamed"}';
        const chunkHash = `sha256-${crypto.createHash('sha256').update(chunkData).digest('hex')}`;
        const zip = new JSZip();
        zip.file('manifest.json', JSON.stringify({
            version: 1,
            format: 'foundry-game',
            gameId: 'streamed-build',
            gameVersion: '3.0.0',
            name: 'Streamed Build',
            runtime: 'foundry',
            engineVersion: '0.1.0',
            entry: 'game.js',
            streamingManifest: 'foundry-streaming.json',
            capabilities: []
        }));
        zip.file('game.js', 'console.log("streamed build");');
        zip.file('foundry-streaming.json', JSON.stringify({
            schemaVersion: 1,
            runtime: { entry: 'game.js' },
            chunks: [{
                id: 'streamed-asset',
                url: 'chunks/asset.json',
                size: Buffer.byteLength(chunkData),
                hash: chunkHash,
                dependencies: [],
                priority: 'critical',
                preload: false
            }]
        }));
        zip.file('chunks/asset.json', chunkData);
        await storage.uploadBuffer(objectKey, await zip.generateAsync({ type: 'nodebuffer' }), 'application/zip');

        const completeResponse = await request(app)
            .post(`/api/uploads/${sessionId}/complete`)
            .set(auth)
            .send({});
        expect(completeResponse.status).toBe(200);
        expect(completeResponse.body.data.streamingManifestPath).toBe('foundry-streaming.json');

        const publishResponse = await request(app)
            .post(`/api/games/${gameId}/versions/${versionId}/publish`)
            .set(auth)
            .send({});
        expect(publishResponse.status).toBe(200);

        const publishedVersion = await db.getGameVersion(versionId);
        expect(publishedVersion.streamingManifestPath).toBe('foundry-streaming.json');

        const detailsResponse = await request(app).get(`/api/catalog/games/${gameId}`);
        const expectedManifestUrl = `${publishedVersion.runtimeUrl}/foundry-streaming.json`;
        expect(detailsResponse.body.data.streamingEnabled).toBe(true);
        expect(detailsResponse.body.data.streamingManifestUrl).toBe(expectedManifestUrl);

        const manifestResponse = await request(app).get(expectedManifestUrl);
        expect(manifestResponse.status).toBe(200);
        expect(manifestResponse.body.chunks[0].id).toBe('streamed-asset');
    });
});
