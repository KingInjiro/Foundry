import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Readable } from 'node:stream';
import { createApp } from '../../../src/platform/backend/server/app.js';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';

class LifecycleStorage {
    constructor() {
        this.kind = 'memory';
        this.isConfigured = true;
        this.deletedPrefixes = [];
    }
    async getObjectMetadata() { return { contentLength: 4, contentType: 'text/html' }; }
    async getDownloadStream() { return Readable.from('game'); }
    async deletePrefix(prefix) { this.deletedPrefixes.push(prefix); }
    async deleteObject() {}
    async uploadBuffer() {}
    async createUploadSession() { return { uploadUrl: 'https://upload.test/package' }; }
}

class InlineQueue {
    constructor() { this.handlers = new Map(); }
    registerHandler(type, handler) { this.handlers.set(type, handler); }
    async enqueue(type, targetId, payload) {
        await this.handlers.get(type)(payload, { id: `job:${type}:${targetId}` });
        return `job:${type}:${targetId}`;
    }
}

describe('release lifecycle API', () => {
    let db;
    let storage;
    let app;
    const ownerUid = 'release-owner';

    beforeEach(async () => {
        process.env.AUTH_DEV_BYPASS = 'true';
        db = new LocalSqliteProvider(':memory:');
        storage = new LifecycleStorage();
        app = createApp(db, storage, new InlineQueue());
        await db.createUser({ uid: ownerUid, email: 'owner@foundry.test', displayName: 'Release Owner', avatarUrl: '', role: 'DEVELOPER', createdAt: Date.now(), updatedAt: Date.now() });
    });

    afterEach(() => {
        db.db.close();
        delete process.env.AUTH_DEV_BYPASS;
    });

    async function createGame(title = 'Lifecycle Game') {
        const game = await db.createGame({ id: `game-${Math.random().toString(36).slice(2)}`, ownerUid, title, description: '', storageMode: 'platform', currentState: 'PUBLISHED', createdAt: Date.now(), updatedAt: Date.now() });
        return game;
    }

    async function createVersion(gameId, id, status, publishedAt = Date.now()) {
        await db.createGameVersion({ id, gameId, version: id, runtime: 'web', format: 'web-game', entry: 'index.html', status, createdAt: publishedAt });
        await db.updateGameVersionMetadata(id, {
            runtimeUrl: `/api/cdn/games/${gameId}/versions/${id}/extracted`,
            publishedAt
        });
        return db.getGameVersion(id);
    }

    it('restores an archived version and atomically archives the previous active release', async () => {
        const game = await createGame();
        await createVersion(game.id, 'version-current', 'PUBLISHED', 200);
        await createVersion(game.id, 'version-old', 'ARCHIVED', 100);

        const response = await request(app)
            .post(`/api/games/${game.id}/versions/version-old/activate`)
            .set('x-dev-uid', ownerUid)
            .send({});

        expect(response.status).toBe(200);
        expect((await db.getGameVersion('version-old')).status).toBe('PUBLISHED');
        expect((await db.getGameVersion('version-current')).status).toBe('ARCHIVED');
        expect((await db.getGameVersions(game.id)).filter(version => version.status === 'PUBLISHED')).toHaveLength(1);
    });

    it('unpublishes immediately while retaining the runtime for a future rollback', async () => {
        const game = await createGame();
        await createVersion(game.id, 'version-live', 'PUBLISHED');

        const response = await request(app)
            .post(`/api/games/${game.id}/unpublish`)
            .set('x-dev-uid', ownerUid)
            .send({});

        expect(response.status).toBe(200);
        expect((await db.getGameVersion('version-live')).status).toBe('ARCHIVED');
        expect((await db.getGame(game.id)).currentState).toBe('DRAFT');
        expect(storage.deletedPrefixes).toEqual([]);
        const asset = await request(app).get(`/api/cdn/games/${game.id}/versions/version-live/extracted/index.html`);
        expect(asset.status).toBe(404);
    });

    it('deletes a non-active version and all of its stored objects through the cleanup job', async () => {
        const game = await createGame();
        await createVersion(game.id, 'version-live', 'PUBLISHED');
        await createVersion(game.id, 'version-archive', 'ARCHIVED');

        const response = await request(app)
            .delete(`/api/games/${game.id}/versions/version-archive`)
            .set('x-dev-uid', ownerUid);

        expect(response.status).toBe(200);
        expect(response.body.data.status).toBe('DELETED');
        expect(await db.getGameVersion('version-archive')).toBeUndefined();
        expect(storage.deletedPrefixes).toContain(`games/${game.id}/versions/version-archive`);
    });

    it('refuses to delete the active release until it is unpublished', async () => {
        const game = await createGame();
        await createVersion(game.id, 'version-live', 'PUBLISHED');

        const response = await request(app)
            .delete(`/api/games/${game.id}/versions/version-live`)
            .set('x-dev-uid', ownerUid);

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('VERSION_BUSY');
        expect(await db.getGameVersion('version-live')).toBeDefined();
    });

    it('requires title confirmation and removes a whole project through one idempotent prefix cleanup', async () => {
        const game = await createGame('Delete Me');
        await createVersion(game.id, 'version-live', 'PUBLISHED');

        const rejected = await request(app)
            .delete(`/api/games/${game.id}`)
            .set('x-dev-uid', ownerUid)
            .send({ confirmTitle: 'Wrong title' });
        expect(rejected.status).toBe(400);

        const deleted = await request(app)
            .delete(`/api/games/${game.id}`)
            .set('x-dev-uid', ownerUid)
            .send({ confirmTitle: 'Delete Me' });
        expect(deleted.status).toBe(200);
        expect(await db.getGame(game.id)).toBeUndefined();
        expect(storage.deletedPrefixes).toContain(`games/${game.id}`);
    });
});
