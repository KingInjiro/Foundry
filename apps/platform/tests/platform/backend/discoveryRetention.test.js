import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../../../src/platform/backend/server/app.js';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';

describe('Discovery retention loop', () => {
    let app;
    let db;
    const playerUid = 'player-1';
    const developerUid = 'developer-1';

    beforeEach(async () => {
        process.env.NODE_ENV = 'test';
        process.env.AUTH_DEV_BYPASS = 'true';
        db = new LocalSqliteProvider(':memory:');
        app = createApp(db, { isConfigured: true });
        await db.createUser({ uid: developerUid, email: 'developer@foundry.test', displayName: 'Test Developer', avatarUrl: '', role: 'DEVELOPER', createdAt: Date.now(), updatedAt: Date.now() });
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await app?.locals?.jobQueue?.stop?.();
        await db.close();
    });

    async function createPublishedGame(title = 'Playable Game') {
        const gameId = crypto.randomUUID();
        await db.createGame({ id: gameId, ownerUid: developerUid, title, description: 'Test', storageMode: 'platform', currentState: 'DRAFT', createdAt: Date.now(), updatedAt: Date.now() });
        await db.createGameVersion({ id: crypto.randomUUID(), gameId, version: '1.0.0', runtime: 'web', format: 'web-game', entry: 'index.html', status: 'PUBLISHED', createdAt: Date.now() });
        return gameId;
    }

    it('records player telemetry and uses it for continue-playing', async () => {
        const gameId = await createPublishedGame();
        const event = await request(app)
            .post('/api/discovery/events')
            .set('x-dev-uid', playerUid)
            .send({ sessionId: 'session-1', gameId, eventType: 'play_start' });
        expect(event.status).toBe(200);

        const recent = await request(app).get('/api/continue-playing').set('x-dev-uid', playerUid);
        expect(recent.status).toBe(200);
        expect(recent.body.data[0].gameId).toBe(gameId);
    });

    it('hides a Continue Playing entry without deleting analytics and restores it after a new play', async () => {
        const gameId = await createPublishedGame();
        await request(app).post('/api/discovery/events').set('x-dev-uid', playerUid)
            .send({ sessionId: 'first-play', gameId, eventType: 'game_ready' });

        const dismiss = await request(app).delete(`/api/continue-playing/${gameId}`).set('x-dev-uid', playerUid);
        expect(dismiss.status).toBe(200);
        expect(dismiss.body.data.visible).toBe(false);

        const hidden = await request(app).get('/api/continue-playing').set('x-dev-uid', playerUid);
        expect(hidden.body.data).toEqual([]);

        const analytics = await request(app).get(`/api/games/${gameId}/analytics`).set('x-dev-uid', developerUid);
        expect(analytics.body.data.successfulStarts).toBe(1);

        await request(app).post('/api/discovery/events').set('x-dev-uid', playerUid)
            .send({ sessionId: 'second-play', gameId, eventType: 'play_start' });
        const restored = await request(app).get('/api/continue-playing').set('x-dev-uid', playerUid);
        expect(restored.body.data[0].gameId).toBe(gameId);
    });

    it('supports multiple discovery exclusions so a tab can avoid repeats', async () => {
        const first = await createPublishedGame('First');
        const second = await createPublishedGame('Second');
        const third = await createPublishedGame('Third');

        const selected = await request(app)
            .get(`/api/discovery/play-now?exclude=${encodeURIComponent(first)}&exclude=${encodeURIComponent(second)}`);
        expect(selected.status).toBe(200);
        expect(selected.body.data.gameId).toBe(third);

        const exhausted = await request(app)
            .get(`/api/discovery/play-now?exclude=${encodeURIComponent(first)},${encodeURIComponent(second)}&exclude=${encodeURIComponent(third)}`);
        expect(exhausted.status).toBe(404);
        expect(exhausted.body.error.code).toBe('NO_PLAYABLE_GAMES');
    });

    it('adds and removes a published game from the user library', async () => {
        const gameId = await createPublishedGame();
        const add = await request(app).put(`/api/library/${gameId}`).set('x-dev-uid', playerUid).send({});
        expect(add.status).toBe(200);
        expect(add.body.data.inLibrary).toBe(true);

        const library = await request(app).get('/api/library').set('x-dev-uid', playerUid);
        expect(library.body.data.map(item => item.gameId)).toContain(gameId);

        const remove = await request(app).delete(`/api/library/${gameId}`).set('x-dev-uid', playerUid);
        expect(remove.body.data.inLibrary).toBe(false);
    });

    it('does not inflate discovery metrics when an already-saved game is kept again', async () => {
        const gameId = await createPublishedGame();
        await request(app).put(`/api/library/${gameId}`).set('x-dev-uid', playerUid).send({});
        await request(app).put(`/api/library/${gameId}`).set('x-dev-uid', playerUid).send({});

        const analytics = await request(app).get(`/api/games/${gameId}/analytics`).set('x-dev-uid', developerUid);
        expect(analytics.body.data.libraryAdds).toBe(1);
    });

    it('stores one rating per user and returns the aggregate', async () => {
        const gameId = await createPublishedGame();
        const rate = await request(app).put(`/api/ratings/${gameId}`).set('x-dev-uid', playerUid).send({ rating: 5 });
        expect(rate.status).toBe(200);
        expect(rate.body.data.average).toBe(5);
        expect(rate.body.data.count).toBe(1);

        const summary = await request(app).get(`/api/ratings/${gameId}`).set('x-dev-uid', playerUid);
        expect(summary.body.data.userRating).toBe(5);
    });

    it('follows a developer and surfaces their published games', async () => {
        const gameId = await createPublishedGame();
        const follow = await request(app).put(`/api/developers/${developerUid}/follow`).set('x-dev-uid', playerUid).send({});
        expect(follow.status).toBe(200);

        const following = await request(app).get('/api/following').set('x-dev-uid', playerUid);
        expect(following.body.data.developers[0].uid).toBe(developerUid);
        expect(following.body.data.games.map(item => item.gameId)).toContain(gameId);
    });

    it('exposes owner-only analytics from real discovery events', async () => {
        const gameId = await createPublishedGame();
        await request(app).post('/api/discovery/events').send({ sessionId: 'anon', gameId, eventType: 'play_start' });
        await request(app).post('/api/discovery/events').send({ sessionId: 'anon', gameId, eventType: 'game_ready' });

        const analytics = await request(app).get(`/api/games/${gameId}/analytics`).set('x-dev-uid', developerUid);
        expect(analytics.status).toBe(200);
        expect(analytics.body.data.playStarts).toBe(1);
        expect(analytics.body.data.successfulStarts).toBe(1);
        expect(analytics.body.data.readyRate).toBe(1);
    });

    it('treats successful launches as stronger trending signals than skips and failures', async () => {
        const reliableGame = await createPublishedGame('Reliable');
        const skippedGame = await createPublishedGame('Skipped');

        await request(app).post('/api/discovery/events').send({ sessionId: 'reliable-start', gameId: reliableGame, eventType: 'play_start' });
        await request(app).post('/api/discovery/events').send({ sessionId: 'reliable-ready', gameId: reliableGame, eventType: 'game_ready' });
        await request(app).post('/api/discovery/events').send({ sessionId: 'skipped-start', gameId: skippedGame, eventType: 'play_start' });
        await request(app).post('/api/discovery/events').send({ sessionId: 'skipped-next', gameId: skippedGame, eventType: 'next_game' });
        await request(app).post('/api/discovery/events').send({ sessionId: 'skipped-error', gameId: skippedGame, eventType: 'game_error' });

        const trending = await request(app).get('/api/discovery/trending?limit=2');
        expect(trending.status).toBe(200);
        expect(trending.body.data.map(game => game.gameId)).toEqual([reliableGame, skippedGame]);

        const analytics = await request(app).get(`/api/games/${skippedGame}/analytics`).set('x-dev-uid', developerUid);
        expect(analytics.body.data.failedStarts).toBe(1);
    });

    it('rejects malformed ratings and discovery events', async () => {
        const gameId = await createPublishedGame();
        const badRating = await request(app).put(`/api/ratings/${gameId}`).set('x-dev-uid', playerUid).send({ rating: 9 });
        expect(badRating.status).toBe(400);

        const badEvent = await request(app).post('/api/discovery/events').send({ sessionId: 'x', gameId, eventType: 'arbitrary_event' });
        expect(badEvent.status).toBe(400);
    });

    it('uses bounded batch catalog queries for multi-game discovery and retention responses', async () => {
        const gameIds = await Promise.all(Array.from({ length: 8 }, (_, index) => createPublishedGame(`Batch ${index}`)));
        for (const gameId of gameIds.slice(0, 4)) {
            await db.addToLibrary(playerUid, gameId);
            await db.recordDiscoveryEvent({ id: crypto.randomUUID(), sessionId: `batch-${gameId}`, userUid: playerUid, gameId, eventType: 'game_ready', durationMs: 0, createdAt: Date.now() });
        }

        const perGameRating = vi.spyOn(db, 'getGameRatingSummary');
        const perGameEngagement = vi.spyOn(db, 'getGameDiscoveryStats');
        const perGameLookup = vi.spyOn(db, 'getGame');
        const batchRows = vi.spyOn(db, 'getCatalogRowsByGameIds');

        await request(app).get('/api/discovery/trending?limit=8');
        await request(app).get('/api/discovery/recommendations?limit=8').set('x-dev-uid', playerUid);
        await request(app).get('/api/library').set('x-dev-uid', playerUid);
        await request(app).get('/api/continue-playing').set('x-dev-uid', playerUid);

        expect(perGameRating).not.toHaveBeenCalled();
        expect(perGameEngagement).not.toHaveBeenCalled();
        expect(perGameLookup).not.toHaveBeenCalled();
        expect(batchRows).toHaveBeenCalledTimes(5);
        expect(batchRows.mock.calls.every(([ids]) => ids.length <= 100)).toBe(true);
    });
});
