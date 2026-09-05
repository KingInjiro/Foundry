import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/platform/backend/server/app.js';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';
import { LocalDiskStorageProvider } from '../../../src/platform/backend/storage/LocalDiskStorageProvider.js';
import { createEditorGamePackage } from '../../../src/platform/editor/createEditorGamePackage.js';

describe('Editor to Platform handoff boundary', () => {
    let directory;
    let db;
    let storage;
    let app;

    beforeAll(async () => {
        process.env.NODE_ENV = 'test';
        process.env.AUTH_DEV_BYPASS = 'true';
        process.env.JOB_MODE = 'inline';
        directory = await mkdtemp(path.join(os.tmpdir(), 'foundry-editor-handoff-'));
        db = new LocalSqliteProvider(':memory:');
        storage = new LocalDiskStorageProvider(directory, '/test-upload');
        app = createApp(db, storage);
    });

    afterAll(async () => {
        await db.close();
        await rm(directory, { recursive: true, force: true });
    });

    it('creates one editor identity, validates through the normal upload endpoint, and persists a READY link', async () => {
        const uid = 'editor-handoff-owner';
        const headers = { 'x-dev-uid': uid };
        const files = [{ id: 'main', name: 'main.js', code: 'class Main extends Simulation {}\nexport default Main;' }];
        const editorResponse = await request(app).post('/api/editor-projects').set(headers).send({ title: 'Integrated Editor Game', files });
        expect(editorResponse.status).toBe(201);
        const editorProjectId = editorResponse.body.data.id;

        const packageResult = await createEditorGamePackage({ editorProjectId, files, name: 'Integrated Editor Game' });
        const packageBytes = Buffer.from(await packageResult.file.arrayBuffer());
        const gameResponse = await request(app).post('/api/games').set(headers).send({ title: 'Integrated Editor Game' });
        const gameId = gameResponse.body.data.id;
        const versionResponse = await request(app)
            .post(`/api/games/${gameId}/versions`)
            .set(headers)
            .send({ expectedSize: packageBytes.length });
        expect(versionResponse.status).toBe(200);

        await storage.uploadBuffer(versionResponse.body.data.objectKey, packageBytes, 'application/zip');
        const completed = await request(app)
            .post(`/api/uploads/${versionResponse.body.data.sessionId}/complete`)
            .set(headers)
            .send({});
        expect(completed.status).toBe(200);
        expect(completed.body.data).toMatchObject({ status: 'READY', manifest: { runtime: 'foundry', entry: 'main.js' } });

        const linked = await request(app)
            .put(`/api/editor-projects/${editorProjectId}/platform-link`)
            .set(headers)
            .send({ platformGameId: gameId, lastReadyVersionId: versionResponse.body.data.versionId });
        expect(linked.status).toBe(200);
        expect(linked.body.data).toMatchObject({ platformGameId: gameId, lastReadyVersionId: versionResponse.body.data.versionId });

        const versions = await db.getGameVersions(gameId);
        expect(versions).toHaveLength(1);
        expect(versions[0].status).toBe('READY');
    });
});
