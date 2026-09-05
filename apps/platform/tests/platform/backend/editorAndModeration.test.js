import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/platform/backend/server/app.js';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';

const auth = uid => ({ 'x-dev-uid': uid });

describe('editor ownership and moderation boundaries', () => {
    let app;
    let db;

    beforeAll(async () => {
        process.env.AUTH_DEV_BYPASS = 'true';
        process.env.NODE_ENV = 'test';
        db = new LocalSqliteProvider(':memory:');
        app = createApp(db);

        const now = Date.now();
        await db.createUser({ uid: 'admin-user', email: 'admin@test', displayName: 'Admin', avatarUrl: '', role: 'ADMIN', createdAt: now, updatedAt: now });
        await db.createUser({ uid: 'moderator-user', email: 'moderator@test', displayName: 'Moderator', avatarUrl: '', role: 'MODERATOR', createdAt: now, updatedAt: now });
    });

    afterAll(async () => {
        await app?.locals?.jobQueue?.stop?.();
        await db.close();
    });

    it('stores editor projects server-side and does not disclose them to another user', async () => {
        const created = await request(app)
            .post('/api/editor-projects')
            .set(auth('editor-owner'))
            .send({ title: 'Owned project', files: [{ id: 'main', name: 'main.js', code: 'export default class Main {}' }] });
        expect(created.status).toBe(201);

        const projectId = created.body.data.id;
        const owned = await request(app).get(`/api/editor-projects/${projectId}`).set(auth('editor-owner'));
        expect(owned.status).toBe(200);
        expect(owned.body.data.files[0].name).toBe('main.js');

        const foreignRead = await request(app).get(`/api/editor-projects/${projectId}`).set(auth('other-user'));
        expect(foreignRead.status).toBe(404);

        const foreignWrite = await request(app)
            .put(`/api/editor-projects/${projectId}`)
            .set(auth('other-user'))
            .send({ files: [{ id: 'x', name: 'main.js', code: 'stolen' }] });
        expect(foreignWrite.status).toBe(404);
    });

    it('rejects malformed stored editor data instead of returning a crashing payload', async () => {
        const created = await request(app)
            .post('/api/editor-projects')
            .set(auth('corrupt-owner'))
            .send({ files: [{ id: 'main', name: 'main.js', code: 'ok' }] });
        db.db.prepare('UPDATE editor_projects SET files = ? WHERE id = ?').run('{not-json', created.body.data.id);

        const response = await request(app).get(`/api/editor-projects/${created.body.data.id}`).set(auth('corrupt-owner'));
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('EDITOR_PROJECT_CORRUPT');
    });

    it('only links an editor project to a Platform game owned by the same authenticated user', async () => {
        const editor = await request(app)
            .post('/api/editor-projects')
            .set(auth('link-owner'))
            .send({ files: [{ id: 'main', name: 'main.js', code: 'ok' }] });
        const ownGame = await request(app).post('/api/games').set(auth('link-owner')).send({ title: 'Mine' });
        const foreignGame = await request(app).post('/api/games').set(auth('other-owner')).send({ title: 'Not mine' });

        const denied = await request(app)
            .put(`/api/editor-projects/${editor.body.data.id}/platform-link`)
            .set(auth('link-owner'))
            .send({ platformGameId: foreignGame.body.data.id });
        expect(denied.status).toBe(403);

        const linked = await request(app)
            .put(`/api/editor-projects/${editor.body.data.id}/platform-link`)
            .set(auth('link-owner'))
            .send({ platformGameId: ownGame.body.data.id });
        expect(linked.status).toBe(200);
        expect(linked.body.data.platformGameId).toBe(ownGame.body.data.id);
    });

    it('provisions operator roles idempotently without a public escalation path', async () => {
        const first = await db.provisionUserRole({ uid: 'provisioned-operator', role: 'MODERATOR' });
        const second = await db.provisionUserRole({ uid: 'provisioned-operator', role: 'MODERATOR' });
        expect(first.previousRole).toBeNull();
        expect(second.previousRole).toBe('MODERATOR');
        expect((await db.getUser('provisioned-operator')).role).toBe('MODERATOR');

        const publicEscalation = await request(app)
            .post('/api/admin/provision')
            .set(auth('provisioned-operator'))
            .send({ uid: 'provisioned-operator', role: 'ADMIN' });
        expect(publicEscalation.status).toBe(404);
    });

    it('persists reports and gates quarantined games from catalog and public detail', async () => {
        const now = Date.now();
        await db.createUser({ uid: 'game-owner', email: 'owner@test', displayName: 'Owner', avatarUrl: '', role: 'DEVELOPER', createdAt: now, updatedAt: now });
        await db.createGame({ id: 'reported-game', ownerUid: 'game-owner', title: 'Reportable', description: '', storageMode: 'platform', currentState: 'PUBLISHED', createdAt: now, updatedAt: now });
        await db.createGameVersion({ id: 'reported-version', gameId: 'reported-game', version: '1.0.0', runtime: 'web', format: 'web-game', entry: 'index.html', status: 'PUBLISHED', createdAt: now });
        await db.updateGameVersionMetadata('reported-version', { runtimeUrl: '/api/cdn/games/reported-game/versions/reported-version/extracted', publishedAt: now });

        const report = await request(app)
            .post('/api/games/reported-game/reports')
            .set(auth('reporter-user'))
            .send({ category: 'BROKEN', reason: 'The published game consistently fails to start.' });
        expect(report.status).toBe(201);
        expect(await db.listGameReports('reported-game')).toHaveLength(1);

        const denied = await request(app)
            .patch('/api/moderation/games/reported-game')
            .set(auth('reporter-user'))
            .send({ moderationState: 'QUARANTINED', reason: 'Untrusted users must never be able to quarantine a game.' });
        expect(denied.status).toBe(403);

        const queue = await request(app)
            .get('/api/moderation/reports?status=OPEN')
            .set(auth('moderator-user'));
        expect(queue.status).toBe(200);
        expect(queue.body.data.pendingCount).toBe(1);
        expect(queue.body.data.items[0]).toMatchObject({ id: report.body.data.id, gameId: 'reported-game', gameTitle: 'Reportable' });

        const resolved = await request(app)
            .patch(`/api/moderation/reports/${report.body.data.id}`)
            .set(auth('moderator-user'))
            .send({
                status: 'RESOLVED',
                moderationState: 'QUARANTINED',
                resolution: 'Confirmed repeated boot failure; quarantined pending a corrected release.'
            });
        expect(resolved.status).toBe(200);
        expect(resolved.body.data.report).toMatchObject({ status: 'RESOLVED', resolvedByUid: 'moderator-user' });
        expect(resolved.body.data.game.moderationState).toBe('QUARANTINED');

        const catalog = await request(app).get('/api/catalog/games');
        expect(catalog.body.data.some(game => game.gameId === 'reported-game')).toBe(false);
        const detail = await request(app).get('/api/catalog/games/reported-game');
        expect(detail.status).toBe(404);
        const asset = await request(app).get('/api/cdn/games/reported-game/versions/reported-version/extracted/index.html');
        expect(asset.status).toBe(404);
        expect(asset.body.error.code).toBe('ASSET_NOT_FOUND');

        const duplicateResolution = await request(app)
            .patch(`/api/moderation/reports/${report.body.data.id}`)
            .set(auth('admin-user'))
            .send({ status: 'DISMISSED', resolution: 'A second operator should not overwrite the audit decision.' });
        expect(duplicateResolution.status).toBe(409);

        const restored = await request(app)
            .patch('/api/moderation/games/reported-game')
            .set(auth('admin-user'))
            .send({ moderationState: 'ACTIVE', reason: 'Developer supplied a corrected package and operator verification passed.' });
        expect(restored.status).toBe(200);

        const actions = await request(app)
            .get('/api/moderation/games/reported-game/actions')
            .set(auth('moderator-user'));
        expect(actions.status).toBe(200);
        expect(actions.body.data).toHaveLength(2);
        expect(actions.body.data.map(action => action.operatorUid)).toEqual(expect.arrayContaining(['moderator-user', 'admin-user']));
    });
});
