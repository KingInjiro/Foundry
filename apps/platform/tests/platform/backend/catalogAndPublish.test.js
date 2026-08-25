import { afterEach, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/platform/backend/server/app.js';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';
import crypto from 'crypto';
import JSZip from 'jszip';
import { Readable } from 'stream';

class MemoryStorage {
    constructor() {
        this.isConfigured = true;
        this.kind = 'memory';
    }

    async createUploadSession(objectKey) {
        return { uploadUrl: `memory://${objectKey}` };
    }

    async getDownloadStream() {
        const zip = new JSZip();
        zip.file('index.html', 'hello');
        return Readable.from(await zip.generateAsync({ type: 'nodebuffer' }));
    }

    async getObjectMetadata() {
        return { contentLength: 1024, contentType: 'application/zip' };
    }

    async uploadBuffer() {}
    async deleteObject() {}
    async deletePrefix() {}
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
        const job = { id: `job:${type}:${targetId}`, type, targetId, payload };
        await handler(payload, job);
        return job.id;
    }
}

describe('Catalog and Publish Pipeline', () => {
    let app;
    let db;
    let devUserId = 'dev-user-123';
    let otherUserId = 'other-user-456';

    beforeEach(() => {
        process.env.AUTH_DEV_BYPASS = 'true';

        db = new LocalSqliteProvider(':memory:');
    });

    afterEach(() => {
        db.db.close();
        delete process.env.AUTH_DEV_BYPASS;
    });

    const setupApp = () => {
        app = createApp(db, new MemoryStorage(), new InlineJobQueue());
    };

    const createGame = async (ownerUid) => {
        const id = crypto.randomUUID();
        return db.createGame({
            id, ownerUid, title: 'Test Game', description: 'Test',
            storageMode: 'platform', currentState: 'DRAFT',
            createdAt: Date.now(), updatedAt: Date.now()
        });
    };

    const createVersion = async (gameId, status) => {
        const id = crypto.randomUUID();
        await db.createGameVersion({
            id, gameId, version: '1.0.0', runtime: 'web', format: 'web-game',
            entry: 'index.html', status, createdAt: Date.now()
        });
        if (status === 'PUBLISHED') {
            await db.updateGameVersionRuntimeUrl(id, `/api/cdn/games/${gameId}/versions/${id}/extracted`);
        }
        
        // Create matching session
        await db.createUploadSession({
            id: crypto.randomUUID(), ownerUid: devUserId, gameId, versionId: id,
            storageProvider: 'platform', objectKey: 'test.zip', expectedSize: 1024,
            expectedContentType: 'application/zip', status: 'COMPLETED',
            expiresAt: Date.now() + 10000, createdAt: Date.now()
        });
        
        return { id, gameId, version: '1.0.0', runtime: 'web', format: 'web-game', entry: 'index.html', status };
    };

    it('1. Unpublished game is absent from public catalog', async () => {
        setupApp();
        await createGame(devUserId);
        const res = await request(app).get('/api/catalog/games');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(0);
    });

    it('2. VALID but unpublished game is absent from catalog', async () => {
        setupApp();
        const game = await createGame(devUserId);
        await createVersion(game.id, 'READY');
        const res = await request(app).get('/api/catalog/games');
        expect(res.body.data).toHaveLength(0);
    });

    it('3. PUBLISHED game appears in catalog', async () => {
        setupApp();
        const game = await createGame(devUserId);
        await createVersion(game.id, 'PUBLISHED');
        const res = await request(app).get('/api/catalog/games');
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].gameId).toBe(game.id);
    });

    it('4. REJECTED game is absent', async () => {
        setupApp();
        const game = await createGame(devUserId);
        await createVersion(game.id, 'REJECTED');
        const res = await request(app).get('/api/catalog/games');
        expect(res.body.data).toHaveLength(0);
    });

    it('5. VALIDATING game is absent', async () => {
        setupApp();
        const game = await createGame(devUserId);
        await createVersion(game.id, 'VALIDATING');
        const res = await request(app).get('/api/catalog/games');
        expect(res.body.data).toHaveLength(0);
    });

    it('6. Published game metadata is returned correctly', async () => {
        setupApp();
        const game = await createGame(devUserId);
        const version = await createVersion(game.id, 'PUBLISHED');
        const res = await request(app).get('/api/catalog/games');
        const item = res.body.data[0];
        expect(item.gameId).toBe(game.id);
        expect(item.name).toBe('Test Game');
        expect(item.gameVersion).toBe('1.0.0');
    });

    it('7. Unpublished game cannot be played directly', async () => {
        setupApp();
        const game = await createGame(devUserId);
        await createVersion(game.id, 'READY');
        const res = await request(app).get(`/api/catalog/games/${game.id}`);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_PUBLISHED');
    });

    it('8. Published game can obtain its playback configuration', async () => {
        setupApp();
        const game = await createGame(devUserId);
        const version = await createVersion(game.id, 'PUBLISHED');
        const res = await request(app).get(`/api/catalog/games/${game.id}`);
        expect(res.status).toBe(200);
        expect(res.body.data.gameId).toBe(game.id);
    });

    it('9. Discovery Play Now returns a published game', async () => {
        setupApp();
        const game = await createGame(devUserId);
        await createVersion(game.id, 'PUBLISHED');

        const res = await request(app).get('/api/discovery/play-now');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.gameId).toBe(game.id);
    });

    it('10. Discovery Play Now excludes the current game when another game exists', async () => {
        setupApp();
        const first = await createGame(devUserId);
        const second = await createGame(devUserId);
        await createVersion(first.id, 'PUBLISHED');
        await createVersion(second.id, 'PUBLISHED');

        const res = await request(app).get(`/api/discovery/play-now?exclude=${first.id}`);

        expect(res.status).toBe(200);
        expect(res.body.data.gameId).toBe(second.id);
    });

    it('11. Discovery Play Now reports when no published games exist', async () => {
        setupApp();
        const res = await request(app).get('/api/discovery/play-now');

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NO_PLAYABLE_GAMES');
    });

    it('12. User cannot publish another user\'s game', async () => {
        setupApp();
        const game = await createGame(otherUserId);
        const version = await createVersion(game.id, 'READY');
        const res = await request(app).post(`/api/games/${game.id}/versions/${version.id}/publish`);
        expect(res.status).toBe(403);
    });

    it('13. Cannot publish REJECTED version', async () => {
        setupApp();
        const game = await createGame(devUserId);
        const version = await createVersion(game.id, 'REJECTED');
        const res = await request(app).post(`/api/games/${game.id}/versions/${version.id}/publish`);
        expect(res.status).toBe(400);
    });

    it('14. Cannot publish VALIDATING version', async () => {
        setupApp();
        const game = await createGame(devUserId);
        const version = await createVersion(game.id, 'VALIDATING');
        const res = await request(app).post(`/api/games/${game.id}/versions/${version.id}/publish`);
        expect(res.status).toBe(400);
    });

    it('15. Cannot publish UPLOADED version', async () => {
        setupApp();
        const game = await createGame(devUserId);
        const version = await createVersion(game.id, 'UPLOADED');
        const res = await request(app).post(`/api/games/${game.id}/versions/${version.id}/publish`);
        expect(res.status).toBe(400);
    });

    it('16. Valid version can be published', async () => {
        setupApp();
        const game = await createGame(devUserId);
        const version = await createVersion(game.id, 'READY');
        const res = await request(app).post(`/api/games/${game.id}/versions/${version.id}/publish`);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('PUBLISHED');
    });
});
