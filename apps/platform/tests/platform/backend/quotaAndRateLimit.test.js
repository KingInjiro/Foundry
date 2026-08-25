import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/platform/backend/server/app.js';
import { QuotaConfig } from '../../../src/platform/backend/config/quotas.js';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';

class MockStorage {
    constructor() {
        this.isConfigured = true;
        this.kind = 'memory';
    }
    async createUploadSession() { return { uploadUrl: 'http://mock-upload' }; }
    async getObjectMetadata() { return { contentLength: 1024 }; }
    async getDownloadStream() { return null; }
    async deleteObject() {}
}

class TestJobQueue {
    registerHandler() {}
    async enqueue() { return 'test-job'; }
}

describe('Rate Limiting & Quotas', () => {
    let app;
    let db;
    let mockStorage;
    const defaultActiveUploads = QuotaConfig.PLATFORM_MAX_ACTIVE_UPLOADS_PER_USER;
    const defaultStorageBytes = QuotaConfig.PLATFORM_MAX_STORAGE_BYTES_PER_USER;

    beforeEach(() => {
        process.env.AUTH_DEV_BYPASS = 'true';
        db = new LocalSqliteProvider(':memory:');
        mockStorage = new MockStorage();
        app = createApp(db, mockStorage, new TestJobQueue());
    });

    afterEach(() => {
        db.db.close();
        QuotaConfig.PLATFORM_MAX_ACTIVE_UPLOADS_PER_USER = defaultActiveUploads;
        QuotaConfig.PLATFORM_MAX_STORAGE_BYTES_PER_USER = defaultStorageBytes;
        delete process.env.AUTH_DEV_BYPASS;
    });

    it('QUOTA-001: Active upload quota exceeded', async () => {
        QuotaConfig.PLATFORM_MAX_ACTIVE_UPLOADS_PER_USER = 2;
        const uid = 'dev-quota-1';
        
        const createGameRes = await request(app).post('/api/games').send({ title: 'Game' }).set('x-dev-uid', uid);
        const gameId = createGameRes.body.data.id;

        for (let i = 0; i < 2; i++) {
            const res = await request(app).post(`/api/games/${gameId}/versions`).set('x-dev-uid', uid);
            expect(res.status).toBe(200);
        }

        const overLimit = await request(app).post(`/api/games/${gameId}/versions`).set('x-dev-uid', uid);
        expect(overLimit.status).toBe(403);
        expect(overLimit.body.error.code).toBe('ACTIVE_UPLOAD_LIMIT_EXCEEDED');
    });

    it('RATE-001: Rate limit enforced on create version', async () => {
        QuotaConfig.PLATFORM_MAX_ACTIVE_UPLOADS_PER_USER = 100;
        const uid = 'dev-rate-1';
        const createGameRes = await request(app).post('/api/games').send({ title: 'Game' }).set('x-dev-uid', uid);
        const gameId = createGameRes.body.data.id;

        for (let i = 0; i < 10; i++) {
            const response = await request(app).post(`/api/games/${gameId}/versions`).set('x-dev-uid', uid);
            expect(response.status).toBe(200);
        }

        const limited = await request(app).post(`/api/games/${gameId}/versions`).set('x-dev-uid', uid);
        expect(limited.status).toBe(429);
        expect(limited.body.error.code).toBe('RATE_LIMITED');
        expect(limited.headers['retry-after']).toBeDefined();
    });
    
    it('PACKAGE-001: Oversized upload is rejected before validation', async () => {
        const uid = 'dev-quota-2';
        const createGameRes = await request(app).post('/api/games').send({ title: 'Game' }).set('x-dev-uid', uid);
        const gameId = createGameRes.body.data.id;

        const versionRes = await request(app).post(`/api/games/${gameId}/versions`).set('x-dev-uid', uid);
        const versionId = versionRes.body.data.versionId;
        const sessionId = versionRes.body.data.sessionId;

        mockStorage.getObjectMetadata = vi.fn().mockResolvedValue({ contentLength: QuotaConfig.PLATFORM_MAX_PACKAGE_SIZE_BYTES + 1 });
        
        const completeRes = await request(app).post(`/api/uploads/${sessionId}/complete`).set('x-dev-uid', uid);
        expect(completeRes.status).toBe(403);
        expect(completeRes.body.error.code).toBe('PACKAGE_SIZE_EXCEEDED');
    });

    it('PACKAGE-002: Oversized selected files are rejected before creating an upload session', async () => {
        const uid = 'dev-quota-3';
        const createGameRes = await request(app).post('/api/games').send({ title: 'Game' }).set('x-dev-uid', uid);
        const gameId = createGameRes.body.data.id;
        const createUploadSpy = vi.spyOn(mockStorage, 'createUploadSession');

        const response = await request(app)
            .post(`/api/games/${gameId}/versions`)
            .set('x-dev-uid', uid)
            .send({ expectedSize: QuotaConfig.PLATFORM_MAX_PACKAGE_SIZE_BYTES + 1 });

        expect(response.status).toBe(413);
        expect(response.body.error.code).toBe('PACKAGE_SIZE_EXCEEDED');
        expect(createUploadSpy).not.toHaveBeenCalled();
    });

    it('QUOTA-002: Upload sessions reserve known package bytes against storage quota', async () => {
        const uid = 'dev-storage-quota';
        QuotaConfig.PLATFORM_MAX_STORAGE_BYTES_PER_USER = 100;
        const createGameRes = await request(app).post('/api/games').send({ title: 'Quota Game' }).set('x-dev-uid', uid);
        const gameId = createGameRes.body.data.id;

        const response = await request(app)
            .post(`/api/games/${gameId}/versions`)
            .set('x-dev-uid', uid)
            .send({ expectedSize: 101 });

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('STORAGE_QUOTA_EXCEEDED');
    });

    it('AUTH-007: Public catalog is not blocked by quotas', async () => {
        const res = await request(app).get('/api/catalog/games');
        expect(res.status).toBe(200);
    });
});
