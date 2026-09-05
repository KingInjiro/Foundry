import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/platform/backend/server/app.js';
import JSZip from 'jszip';
import { Readable } from 'stream';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';

describe('Upload Validation Pipeline', () => {
    let app;
    let db;
    let storage;
    
    beforeEach(() => {
        process.env.AUTH_DEV_BYPASS = 'true';
        db = new LocalSqliteProvider(':memory:');
        storage = {
            isConfigured: true,
            createUploadSession: vi.fn().mockResolvedValue({ uploadUrl: 'http://storage.test/upload' }),
            uploadBuffer: vi.fn().mockResolvedValue(undefined),
            getObjectMetadata: vi.fn(),
            getDownloadStream: vi.fn(),
            deleteObject: vi.fn().mockResolvedValue(undefined)
        };
        app = createApp(db, storage);
    });

    afterEach(async () => {
        await app?.locals?.jobQueue?.stop?.();
        await db?.close();
        vi.restoreAllMocks();
        delete process.env.AUTH_DEV_BYPASS;
    });

    it('Valid ZIP uploaded directly to R2 -> VALID', async () => {
        const gameRes = await request(app).post('/api/games').send({ title: 'Test', description: 'Test' });
        const gameId = gameRes.body.data.id;

        const versionRes = await request(app).post(`/api/games/${gameId}/versions`).send({});
        const { sessionId, versionId, objectKey } = versionRes.body.data;
        
        expect(sessionId).toBeDefined();

        const zip = new JSZip();
        zip.file("manifest.json", JSON.stringify({
            version: 1,
            gameId: gameId,
            gameVersion: "1.0.0",
            name: "Test Game",
            format: "web-game",
            runtime: "web",
            entry: "index.html"
        }));
        zip.file("index.html", "<html></html>");
        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

        storage.getObjectMetadata.mockResolvedValue({
            contentLength: zipBuffer.length,
            contentType: 'application/zip',
            lastModified: new Date()
        });
        
        storage.getDownloadStream.mockResolvedValue(Readable.from(zipBuffer));

        const completeRes = await request(app).post(`/api/uploads/${sessionId}/complete`).send();
        if (!completeRes.body.success) console.error("VALID ZIP FAILED WITH", completeRes.body.error);
        expect(completeRes.status).toBe(200);
        expect(completeRes.body.success).toBe(true);
        expect(completeRes.body.data.status).toBe('READY');
    });

    it('Missing manifest -> REJECTED', async () => {
        const gameRes = await request(app).post('/api/games').send({ title: 'Test 2', description: 'Test' });
        const gameId = gameRes.body.data.id;
        
        const versionRes = await request(app).post(`/api/games/${gameId}/versions`).send({});
        const { sessionId, versionId } = versionRes.body.data;

        const zip = new JSZip();
        zip.file("index.html", "<html></html>");
        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

        storage.getObjectMetadata.mockResolvedValue({
            contentLength: zipBuffer.length,
            contentType: 'application/zip',
            lastModified: new Date()
        });
        storage.getDownloadStream.mockResolvedValue(Readable.from(zipBuffer));

        const completeRes = await request(app).post(`/api/uploads/${sessionId}/complete`).send();
        
        expect(completeRes.status).toBe(200);
        expect(completeRes.body.success).toBe(false);
        expect(completeRes.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('Malicious path traversal -> REJECTED', async () => {
        const gameRes = await request(app).post('/api/games').send({ title: 'Test 3', description: 'Test' });
        const gameId = gameRes.body.data.id;
        const versionRes = await request(app).post(`/api/games/${gameId}/versions`).send({});
        const { sessionId, versionId } = versionRes.body.data;

        const zip = new JSZip();
        zip.file("manifest.json", JSON.stringify({
            version: 1,
            gameId: gameId,
            gameVersion: "1.0.0",
            name: "Test Game",
            format: "web-game",
            runtime: "web",
            entry: "index.html"
        }));
        zip.file("index.html", "<html></html>");
        zip.file("../secret.txt", "hacked");
        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

        storage.getObjectMetadata.mockResolvedValue({ contentLength: zipBuffer.length });
        storage.getDownloadStream.mockResolvedValue(Readable.from(zipBuffer));

        const completeRes = await request(app).post(`/api/uploads/${sessionId}/complete`).send();
        
        expect(completeRes.body.success).toBe(false);
        expect(completeRes.body.error.details[0].code).toBe('UNSAFE_FILE_PATH');
    });

    it('Oversized package -> REJECTED', async () => {
        const gameRes = await request(app).post('/api/games').send({ title: 'Test 4', description: 'Test' });
        const gameId = gameRes.body.data.id;
        const versionRes = await request(app).post(`/api/games/${gameId}/versions`).send({});
        const { sessionId, versionId } = versionRes.body.data;

        storage.getObjectMetadata.mockResolvedValue({ contentLength: 100 * 1024 * 1024 });
        
        const completeRes = await request(app).post(`/api/uploads/${sessionId}/complete`).send();
        
        expect(completeRes.body.success).toBe(false);
        expect(completeRes.body.error.code).toBe('PACKAGE_SIZE_EXCEEDED');
    });

    it('Mismatched direct upload size -> REJECTED with an actionable error', async () => {
        const gameRes = await request(app).post('/api/games').send({ title: 'Size Check', description: '' });
        const gameId = gameRes.body.data.id;
        const versionRes = await request(app)
            .post(`/api/games/${gameId}/versions`)
            .send({ expectedSize: 100 });
        const { sessionId, versionId } = versionRes.body.data;

        storage.getObjectMetadata.mockResolvedValue({ contentLength: 99, contentType: 'application/zip' });
        const completeRes = await request(app).post(`/api/uploads/${sessionId}/complete`).send();

        expect(completeRes.status).toBe(400);
        expect(completeRes.body.error.code).toBe('UPLOAD_SIZE_MISMATCH');
        expect((await db.getGameVersion(versionId)).status).toBe('REJECTED');
    });

    it('User A cannot publish User B game', async () => {
        const gameRes = await request(app).post('/api/games').set('x-dev-uid', 'owner-user').send({ title: 'Test 5', description: 'Test' });
        const gameId = gameRes.body.data.id;
        const versionRes = await request(app).post(`/api/games/${gameId}/versions`).set('x-dev-uid', 'owner-user').send({});
        const { versionId } = versionRes.body.data;

        const publishRes = await request(app).post(`/api/games/${gameId}/versions/${versionId}/publish`).set('x-dev-uid', 'other-user').send();
        expect(publishRes.status).toBe(403);
    });
});
