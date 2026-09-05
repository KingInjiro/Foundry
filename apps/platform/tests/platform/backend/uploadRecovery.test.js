import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/platform/backend/server/app.js';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';

describe('upload recovery API', () => {
    let app;
    let db;
    const storage = {
        kind: 'test',
        isConfigured: true,
        createUploadSession: vi.fn(async objectKey => ({ uploadUrl: `/signed-upload?key=${encodeURIComponent(objectKey)}` }))
    };

    beforeAll(async () => {
        process.env.NODE_ENV = 'test';
        process.env.AUTH_DEV_BYPASS = 'true';
        db = new LocalSqliteProvider(':memory:');
        app = createApp(db, storage);
        const now = Date.now();
        await db.createUser({ uid: 'recovery-owner', email: 'owner@test', displayName: 'Owner', avatarUrl: '', role: 'DEVELOPER', createdAt: now, updatedAt: now });
        await db.createGame({ id: 'recovery-game', ownerUid: 'recovery-owner', title: 'Recover me', description: '', storageMode: 'platform', currentState: 'DRAFT', createdAt: now, updatedAt: now });
        await db.createGameVersion({ id: 'recovery-version', gameId: 'recovery-game', version: '1.0.0', runtime: 'web', format: 'web-game', entry: 'index.html', status: 'UPLOADING', createdAt: now });
        await db.createUploadSession({
            id: 'recovery-session', ownerUid: 'recovery-owner', gameId: 'recovery-game', versionId: 'recovery-version',
            storageProvider: 'test', objectKey: 'games/recovery-game/versions/recovery-version/package.zip', expectedSize: 123,
            expectedContentType: 'application/zip', status: 'CREATED', expiresAt: now + 60_000, createdAt: now, updatedAt: now
        });
    });

    afterAll(async () => {
        await app?.locals?.jobQueue?.stop?.();
        await db.close();
    });

    it('discovers a resumable server session after refresh without serializing a File', async () => {
        const response = await request(app).get('/api/uploads/recovery').set('x-dev-uid', 'recovery-owner');
        expect(response.status).toBe(200);
        expect(response.body.data).toContainEqual(expect.objectContaining({
            sessionId: 'recovery-session',
            versionId: 'recovery-version',
            expectedSize: 123,
            resumable: true,
            requiresFileReselection: true
        }));
        expect(JSON.stringify(response.body.data)).not.toContain('fileContents');
    });

    it('reissues an upload URL for the same session and does not create a duplicate version', async () => {
        const before = db.db.prepare('SELECT COUNT(*) AS count FROM game_versions WHERE gameId = ?').get('recovery-game').count;
        const response = await request(app).post('/api/uploads/recovery-session/resume').set('x-dev-uid', 'recovery-owner').send({});
        const after = db.db.prepare('SELECT COUNT(*) AS count FROM game_versions WHERE gameId = ?').get('recovery-game').count;

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({ sessionId: 'recovery-session', versionId: 'recovery-version', expectedSize: 123 });
        expect(response.body.data.uploadUrl).toContain('/signed-upload');
        expect(after).toBe(before);
    });

    it('does not disclose or resume another owners session', async () => {
        const list = await request(app).get('/api/uploads/recovery').set('x-dev-uid', 'other-user');
        expect(list.body.data).toEqual([]);
        const resume = await request(app).post('/api/uploads/recovery-session/resume').set('x-dev-uid', 'other-user').send({});
        expect(resume.status).toBe(404);
    });

    it('fails closed for an expired session and marks its version expired', async () => {
        const now = Date.now();
        await db.createGameVersion({ id: 'expired-version', gameId: 'recovery-game', version: '2.0.0', runtime: 'web', format: 'web-game', entry: 'index.html', status: 'UPLOADING', createdAt: now });
        await db.createUploadSession({
            id: 'expired-session', ownerUid: 'recovery-owner', gameId: 'recovery-game', versionId: 'expired-version',
            storageProvider: 'test', objectKey: 'expired.zip', expectedSize: 10, expectedContentType: 'application/zip',
            status: 'CREATED', expiresAt: now - 1, createdAt: now
        });

        const response = await request(app).post('/api/uploads/expired-session/resume').set('x-dev-uid', 'recovery-owner').send({});
        expect(response.status).toBe(410);
        expect((await db.getUploadSession('expired-session')).status).toBe('EXPIRED');
        expect((await db.getGameVersion('expired-version')).status).toBe('EXPIRED');
    });
});
