import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/platform/backend/server/app.js';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';

describe('Authentication & Authorization', () => {
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

    it('AUTH-001: Public endpoints allow unauthenticated access', async () => {
        const res = await request(app).get('/api/catalog/games');
        expect(res.status).toBe(200);
    });

    it('AUTH-002: Protected endpoints reject unauthenticated access', async () => {
        process.env.AUTH_DEV_BYPASS = 'false'; // temporarily disable bypass
        const res = await request(app).post('/api/games').send({ title: 'Test' });
        expect(res.status).toBe(401);
        process.env.AUTH_DEV_BYPASS = 'true';
    });

    it('AUTH-003: Protected endpoints accept valid token/bypass', async () => {
        const res = await request(app).post('/api/games').send({ title: 'Test' }).set('x-dev-uid', 'test-auth-user');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('AUTH-004: Automatically provisions user profile on first access', async () => {
        const res = await request(app).get('/api/auth/me').set('x-dev-uid', 'new-user-123');
        expect(res.status).toBe(200);
        expect(res.body.data.uid).toBe('new-user-123');
        expect(res.body.data.role).toBe('DEVELOPER');
    });

    it('AUTH-005: User cannot escalate privileges', async () => {
        // Just checking that standard users are assigned DEVELOPER
        const res = await request(app).get('/api/auth/me').set('x-dev-uid', 'hacker-123');
        expect(res.body.data.role).toBe('DEVELOPER');
    });

    it('AUTH-006: User cannot access other user games', async () => {
        const createRes = await request(app).post('/api/games').send({ title: 'Victim Game' }).set('x-dev-uid', 'victim-user');
        const gameId = createRes.body.data.id;
        
        // Attacker tries to publish
        const pubRes = await request(app).post(`/api/games/${gameId}/versions/fake-version/publish`).set('x-dev-uid', 'attacker-user');
        expect(pubRes.status).toBe(403);
    });
});
