import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/platform/backend/server/app.js';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';

describe('Backend API', () => {
    let app;
    let db;
    
    beforeAll(() => {
        process.env.AUTH_DEV_BYPASS = 'true';
        db = new LocalSqliteProvider(':memory:');
        app = createApp(db);
    });

    afterAll(async () => {
        await app?.locals?.jobQueue?.stop?.();
        await db.close();
    });

    it('GET /api/health should return ok', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('ok');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-powered-by']).toBeUndefined();
        expect(res.headers['x-request-id']).toEqual(expect.any(String));
    });

    it('echoes a valid request id and exposes dependency readiness separately from liveness', async () => {
        const health = await request(app).get('/api/health').set('x-request-id', 'support-trace-123');
        expect(health.headers['x-request-id']).toBe('support-trace-123');

        const ready = await request(app).get('/api/ready');
        expect(ready.status).toBe(503);
        expect(ready.body.data.checks.database).toBe(true);
        expect(ready.body.data.checks.storage).toBe(false);
        expect(ready.body.data.checks.jobs).toBe(true);
    });

    it('returns consistent JSON for malformed bodies and unknown API routes', async () => {
        const malformed = await request(app)
            .post('/api/games')
            .set('Content-Type', 'application/json')
            .send('{"title":');
        expect(malformed.status).toBe(400);
        expect(malformed.body.error.code).toBe('INVALID_JSON');

        const missing = await request(app).get('/api/does-not-exist');
        expect(missing.status).toBe(404);
        expect(missing.body.error.code).toBe('API_ROUTE_NOT_FOUND');
    });

    it('denies unconfigured cross-origin API preflights', async () => {
        const response = await request(app)
            .options('/api/games')
            .set('Origin', 'https://untrusted.example')
            .set('Access-Control-Request-Method', 'POST');
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('CORS_ORIGIN_DENIED');
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('POST /api/games should create a game', async () => {
        const res = await request(app)
            .post('/api/games')
            .send({ title: 'Test Game', description: 'A test game' });
        
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.title).toBe('Test Game');
        expect(res.body.data.id).toBeDefined();
    });

    it('POST /api/games without title should fail', async () => {
        const res = await request(app)
            .post('/api/games')
            .send({ description: 'No title' });
        
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('INVALID_REQUEST');
    });

    it('POST /api/games trims text and rejects unbounded metadata', async () => {
        const trimmed = await request(app)
            .post('/api/games')
            .send({ title: '  Trimmed Game  ', description: '  Description  ' });
        expect(trimmed.status).toBe(200);
        expect(trimmed.body.data.title).toBe('Trimmed Game');
        expect(trimmed.body.data.description).toBe('Description');

        const oversized = await request(app)
            .post('/api/games')
            .send({ title: 'x'.repeat(121) });
        expect(oversized.status).toBe(400);
        expect(oversized.body.error.message).toContain('120');
    });

    it('GET /api/games should list games', async () => {
        await request(app).post('/api/games').send({ title: 'Game 1' });
        
        const res = await request(app).get('/api/games');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('PATCH /api/games/:id updates bounded public project metadata', async () => {
        const created = await request(app).post('/api/games').send({ title: 'Old title', description: 'Old description' });
        const gameId = created.body.data.id;

        const updated = await request(app).patch(`/api/games/${gameId}`)
            .send({ title: '  New title  ', description: '  New description  ' });
        expect(updated.status).toBe(200);
        expect(updated.body.data).toMatchObject({ title: 'New title', description: 'New description' });

        const invalid = await request(app).patch(`/api/games/${gameId}`)
            .send({ title: '', description: 'No title' });
        expect(invalid.status).toBe(400);
        expect(invalid.body.error.code).toBe('INVALID_REQUEST');
    });

    it('POST /api/games/:id/versions should handle R2 gracefully', async () => {
        const gameRes = await request(app).post('/api/games').send({ title: 'Upload Test' });
        const gameId = gameRes.body.data.id;

        const versionRes = await request(app).post(`/api/games/${gameId}/versions`).send({});
        
        // Since R2 is NOT configured in the test environment, it should return 501
        expect(versionRes.status).toBe(501);
        expect(versionRes.body.success).toBe(false);
        expect(versionRes.body.error.code).toBe('STORAGE_NOT_CONFIGURED');
    });

    it('treats a repeated completion request for a completed upload as idempotent', async () => {
        const gameId = 'completed-game';
        const versionId = 'completed-version';
        const sessionId = 'completed-session';
        const now = Date.now();
        await db.createGame({ id: gameId, ownerUid: 'dev-user-123', title: 'Completed', description: '', storageMode: 'platform', currentState: 'DRAFT', createdAt: now, updatedAt: now });
        await db.createGameVersion({ id: versionId, gameId, version: '2.0.0', runtime: 'web', format: 'web-game', entry: 'index.html', status: 'READY', createdAt: now });
        await db.createUploadSession({ id: sessionId, ownerUid: 'dev-user-123', gameId, versionId, storageProvider: 'local', objectKey: 'unused', expectedSize: 10, expectedContentType: 'application/zip', status: 'COMPLETED', expiresAt: now + 1000, createdAt: now });

        const repeated = await request(app).post(`/api/uploads/${sessionId}/complete`).send({});
        expect(repeated.status).toBe(200);
        expect(repeated.body.data).toMatchObject({ status: 'READY', versionId, resumed: true });
    });
});
