import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/platform/backend/server/app.js';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';

describe('server-side catalog search and pagination', () => {
    let db;
    let app;

    beforeEach(async () => {
        process.env.AUTH_DEV_BYPASS = 'true';
        db = new LocalSqliteProvider(':memory:');
        app = createApp(db, { isConfigured: true, kind: 'memory' });
        await db.createUser({ uid: 'studio-north', email: 'north@test.local', displayName: 'North Studio', avatarUrl: '', role: 'DEVELOPER', createdAt: 1, updatedAt: 1 });
        await db.createUser({ uid: 'studio-south', email: 'south@test.local', displayName: 'South Studio', avatarUrl: '', role: 'DEVELOPER', createdAt: 1, updatedAt: 1 });
    });

    afterEach(() => {
        db.db.close();
        delete process.env.AUTH_DEV_BYPASS;
    });

    async function publish({ id, title, description, ownerUid = 'studio-north', tags = [], publishedAt }) {
        await db.createGame({ id, ownerUid, title, description, storageMode: 'platform', currentState: 'PUBLISHED', createdAt: publishedAt, updatedAt: publishedAt });
        const versionId = `version-${id}`;
        await db.createGameVersion({ id: versionId, gameId: id, version: '1.0.0', runtime: 'web', format: 'web-game', entry: 'index.html', status: 'PUBLISHED', createdAt: publishedAt });
        await db.updateGameVersionMetadata(versionId, {
            runtimeUrl: `/api/cdn/games/${id}/versions/${versionId}/extracted`,
            tags: JSON.stringify(tags),
            publishedAt
        });
    }

    it('returns bounded pages with an opaque cursor and no overlap', async () => {
        for (let index = 0; index < 5; index += 1) {
            await publish({ id: `game-${index}`, title: `Game ${index}`, description: '', tags: ['Arcade'], publishedAt: 100 + index });
        }

        const first = await request(app).get('/api/catalog/games?limit=2&sort=newest');
        expect(first.status).toBe(200);
        expect(first.body.data.map(game => game.gameId)).toEqual(['game-4', 'game-3']);
        expect(first.body.meta.hasMore).toBe(true);
        expect(first.body.meta.nextCursor).toEqual(expect.any(String));

        const second = await request(app).get(`/api/catalog/games?limit=2&sort=newest&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`);
        expect(second.body.data.map(game => game.gameId)).toEqual(['game-2', 'game-1']);
        expect(second.body.data.map(game => game.gameId)).not.toContain('game-4');
    });

    it('searches server-side across title, description, developer and tags', async () => {
        await publish({ id: 'racer', title: 'Velocity', description: 'Neon circuits', tags: ['Arcade', 'Racing'], publishedAt: 10 });
        await publish({ id: 'puzzle', title: 'Quiet Shapes', description: 'Calm logic rooms', ownerUid: 'studio-south', tags: ['Puzzle'], publishedAt: 20 });

        const byDeveloper = await request(app).get('/api/catalog/games?q=north');
        expect(byDeveloper.body.data.map(game => game.gameId)).toEqual(['racer']);

        const byDescriptionAndTag = await request(app).get('/api/catalog/games?q=logic&tag=Puzzle');
        expect(byDescriptionAndTag.body.data.map(game => game.gameId)).toEqual(['puzzle']);
        expect(byDescriptionAndTag.body.meta.popularTags).toContainEqual({ label: 'Puzzle', count: 1 });
    });

    it('rejects a cursor reused with different filters', async () => {
        await publish({ id: 'one', title: 'One', description: '', publishedAt: 1 });
        await publish({ id: 'two', title: 'Two', description: '', publishedAt: 2 });
        const first = await request(app).get('/api/catalog/games?limit=1&q=o');

        const mismatch = await request(app).get(`/api/catalog/games?limit=1&q=two&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`);
        expect(mismatch.status).toBe(400);
        expect(mismatch.body.error.code).toBe('INVALID_CURSOR');
    });

    it('supports public response revalidation with ETag', async () => {
        await publish({ id: 'cached', title: 'Cached Game', description: '', publishedAt: 1 });
        const first = await request(app).get('/api/catalog/games');
        expect(first.headers.etag).toBeDefined();
        expect(first.headers['cache-control']).toContain('stale-while-revalidate');

        const revalidated = await request(app).get('/api/catalog/games').set('If-None-Match', first.headers.etag);
        expect(revalidated.status).toBe(304);
    });
});
