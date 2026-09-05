import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Readable } from 'node:stream';
import { createApp } from '../../../src/platform/backend/server/app.js';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';

describe('gated direct asset delivery', () => {
    let db;
    let storage;
    let app;

    beforeEach(async () => {
        db = new LocalSqliteProvider(':memory:');
        storage = {
            kind: 'r2',
            isConfigured: true,
            directDownloadsEnabled: true,
            createDownloadUrl: vi.fn(async key => `https://signed-r2.test/${encodeURIComponent(key)}`),
            getObjectMetadata: vi.fn(async key => ({ contentLength: 8, contentType: key.endsWith('.html') ? 'text/html' : 'application/octet-stream', etag: '"asset"' })),
            getDownloadStream: vi.fn(async () => Readable.from('document')),
            deletePrefix: vi.fn(),
            deleteObject: vi.fn()
        };
        app = createApp(db, storage);
        await db.createGame({ id: 'direct-game', ownerUid: 'owner', title: 'Direct', description: '', storageMode: 'platform', currentState: 'PUBLISHED', createdAt: 1, updatedAt: 1 });
        await db.createGameVersion({ id: 'direct-version', gameId: 'direct-game', version: '1', runtime: 'web', format: 'web-game', entry: 'index.html', status: 'PUBLISHED', createdAt: 1 });
        await db.updateGameVersionMetadata('direct-version', { runtimeUrl: '/api/cdn/games/direct-game/versions/direct-version/extracted' });
    });

    afterEach(async () => {
        await app?.locals?.jobQueue?.stop?.();
        await db.close();
    });

    it('redirects non-document assets to a short-lived signed R2 URL after publication checks', async () => {
        const response = await request(app).get('/api/cdn/games/direct-game/versions/direct-version/extracted/world.glb');
        expect(response.status).toBe(307);
        expect(response.headers.location).toContain('https://signed-r2.test/');
        expect(response.headers['cache-control']).toBe('private, no-store');
        expect(storage.createDownloadUrl).toHaveBeenCalledOnce();
        expect(storage.getDownloadStream).not.toHaveBeenCalled();
    });

    it('keeps executable documents behind the Platform security-header proxy', async () => {
        const response = await request(app).get('/api/cdn/games/direct-game/versions/direct-version/extracted/index.html');
        expect(response.status).toBe(200);
        expect(response.headers['content-security-policy']).toContain('sandbox allow-scripts');
        expect(response.headers['cache-control']).toBe('public, no-cache');
        expect(storage.createDownloadUrl).not.toHaveBeenCalled();
        expect(storage.getDownloadStream).toHaveBeenCalledOnce();
    });

    it('never creates a signed URL for an archived release', async () => {
        await db.updateGameVersionStatus('direct-version', 'ARCHIVED');
        const response = await request(app).get('/api/cdn/games/direct-game/versions/direct-version/extracted/world.glb');
        expect(response.status).toBe(404);
        expect(storage.createDownloadUrl).not.toHaveBeenCalled();
    });
});
