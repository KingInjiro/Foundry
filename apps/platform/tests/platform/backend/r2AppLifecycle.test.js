import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../src/platform/backend/server/app.js';
import { createProductionProviders } from '../../../src/platform/backend/config/productionProviders.js';
import { R2StorageProvider } from '../../../src/platform/backend/storage/R2StorageProvider.js';
import { checkStorageIntegrity } from '../../../src/platform/backend/storage/StorageIntegrityChecker.js';
import { QuotaConfig } from '../../../src/platform/backend/config/quotas.js';
import { controlledR2, r2RequestHandler } from '../../helpers/controlledR2.mjs';

const origin = 'https://foundry.r2.test';
const manifest = { version: 1, format: 'web-game', gameId: 'r2-game', gameVersion: '1.0.0', name: 'Remote game', runtime: 'web', entry: 'index.html' };
const entryBytes = Buffer.from('<!doctype html><main>Remote game</main>');
const sha256 = bytes => `sha256-${crypto.createHash('sha256').update(bytes).digest('hex')}`;

async function packageBytes({ overflow = false, entry = entryBytes } = {}) {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('index.html', entry);
    zip.file('data.bin', Buffer.from('0123456789'));
    if (overflow) for (let i = 0; i < QuotaConfig.PLATFORM_MAX_FILES_PER_PACKAGE; i++) zip.file(`extra-${i}`, 'x');
    return zip.generateAsync({ type: 'nodebuffer' });
}

describe('single-host R2 application acceptance through local auth, SDK HTTP and real jobs', () => {
    let r2, root, db, storage, app, agent, csrf, gameId;
    const events = [];
    const mutate = (method, url, data = {}) => agent[method](url).set('Origin', origin).set('X-CSRF-Token', csrf).send(data);

    beforeEach(async () => {
        vi.stubEnv('AUTH_DEV_BYPASS', 'false');
        vi.stubEnv('JOB_MODE', 'inline');
        r2 = await controlledR2();
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-r2-app-'));
        ({ database: db, storage } = createProductionProviders({ deploymentMode: 'single-host', storageProvider: 'r2', databasePath: path.join(root, 'platform.db') }, r2.env));
        storage.client.config.requestHandler = r2RequestHandler(r2.origin);
        storage.client.config.maxAttempts = async () => 1;
        events.length = 0;
        const record = (event, details) => events.push({ event, ...details });
        app = createApp(db, storage, undefined, {
            runtimeConfig: { deploymentMode: 'single-host', publicBaseUrl: origin, storageProvider: 'r2' },
            localAuthOptions: { sessionSecret: crypto.randomBytes(48).toString('hex'), secureCookies: false },
            logger: { info: record, warn: record, error: record }
        });
        agent = request.agent(app);
        const auth = await agent.post('/api/auth/local/register').set('Origin', origin).send({ username: 'r2-owner', password: 'controlled-r2-local-password' });
        expect(auth.status).toBe(201);
        csrf = auth.body.data.csrfToken;
        expect(auth.body.data.user.role).toBe('DEVELOPER');
        expect(storage).toBeInstanceOf(R2StorageProvider);
        const created = await mutate('post', '/api/games', { title: 'R2 project' });
        expect(created.status).toBe(200);
        gameId = created.body.data.id;
    });

    afterEach(async () => {
        await app?.locals.jobQueue.stop();
        await db?.close();
        storage?.client.destroy();
        await r2?.close();
        if (root) fs.rmSync(root, { recursive: true, force: true });
        vi.unstubAllEnvs();
    });

    async function upload(bytes, { put = true } = {}) {
        const response = await mutate('post', `/api/games/${gameId}/versions`, { expectedSize: bytes.length });
        expect(response.status).toBe(200);
        const session = response.body.data;
        expect((await db.getUploadSession(session.sessionId)).storageProvider).toBe('r2');
        if (put) expect((await r2.putSigned(session.uploadUrl, bytes)).status).toBe(200);
        return session;
    }
    const complete = session => mutate('post', `/api/uploads/${session.sessionId}/complete`);
    const publish = session => mutate('post', `/api/games/${gameId}/versions/${session.versionId}/publish`);

    it('validates SHA, publishes exact bytes and ranges, revokes, restores and deletes only this version/installation', async () => {
        const bytes = await packageBytes();
        const session = await upload(bytes);
        expect((await complete(session)).body.data.status).toBe('READY');
        expect((await db.getGameVersion(session.versionId)).packageSha256).toBe(sha256(bytes));
        expect((await publish(session)).body.data.status).toBe('PUBLISHED');
        const entry = `/api/cdn/games/${gameId}/versions/${session.versionId}/extracted/index.html`;
        const full = await request(app).get(entry);
        expect(full.status).toBe(200);
        expect(full.headers['content-type']).toMatch(/^text\/html/);
        expect(full.text).toBe(entryBytes.toString());
        const range = await request(app).get(entry).set('Range', 'bytes=0-8');
        expect(range.status).toBe(206);
        expect(range.text).toBe(entryBytes.subarray(0, 9).toString());
        expect(range.headers['content-range']).toBe(`bytes 0-8/${entryBytes.length}`);
        expect((await request(app).get(entry).set('Range', 'bytes=999-1000')).status).toBe(416);
        expect((await checkStorageIntegrity(db, storage)).status).toBe('PASS');
        expect((await request(app).get(`/api/catalog/games/${gameId}`)).status).toBe(200);
        expect((await mutate('post', `/api/games/${gameId}/unpublish`)).status).toBe(200);
        expect((await request(app).get(entry)).status).toBe(404);
        expect((await mutate('post', `/api/games/${gameId}/versions/${session.versionId}/activate`)).status).toBe(200);
        expect((await request(app).get(entry)).status).toBe(200);
        await mutate('post', `/api/games/${gameId}/unpublish`);
        const otherKey = `other-installation/${session.objectKey}`;
        r2.objects.set(otherKey, { body: Buffer.from('other'), contentType: 'application/zip', etag: 'other' });
        const deleted = await mutate('delete', `/api/games/${gameId}/versions/${session.versionId}`);
        expect(deleted.status).toBe(200);
        expect(deleted.body.data.status).toBe('DELETED');
        expect((await db.getGameVersions(gameId))).toEqual([]);
        expect([...r2.objects.keys()]).toEqual([otherKey]);
        expect((await checkStorageIntegrity(db, storage)).status).toBe('PASS');
        expect(fs.readdirSync(root).some(name => name === 'objects')).toBe(false);
    });

    it('rejects invalid, expired and changed Content-Type signed uploads; unsigned bucket access is private', async () => {
        const bytes = await packageBytes();
        const session = await upload(bytes, { put: false });
        const invalid = new URL(session.uploadUrl);
        invalid.searchParams.set('X-Amz-Signature', '0'.repeat(64));
        expect((await r2.putSigned(invalid.href, bytes)).status).toBe(403);
        expect((await r2.putSigned(session.uploadUrl, bytes, 'text/plain')).status).toBe(403);
        r2.setClockOffset(3601 * 1000);
        expect((await r2.putSigned(session.uploadUrl, bytes)).status).toBe(403);
        expect(r2.objects.size).toBe(0);
        r2.setClockOffset(0);
        expect((await r2.putSigned(session.uploadUrl, bytes)).status).toBe(200);
        expect((await r2.forwardRequest(session.uploadUrl.split('?')[0], { method: 'GET' })).status).toBe(403);
        expect((await r2.forwardRequest(r2.env.R2_ENDPOINT, { method: 'HEAD' })).status).toBe(403);
    });

    it('reports a missing upload and leaves it resumable', async () => {
        const session = await upload(await packageBytes(), { put: false });
        const response = await complete(session);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('NOT_FOUND');
        expect((await db.getUploadSession(session.sessionId)).status).toBe('CREATED');
        expect((await mutate('post', `/api/uploads/${session.sessionId}/resume`)).status).toBe(200);
    });

    it.each(['malformed', 'bounded'])('rejects %s ZIP bytes through the actual completion route', async kind => {
        const bytes = kind === 'malformed' ? Buffer.from('not a zip archive') : await packageBytes({ overflow: true });
        const session = await upload(bytes);
        const response = await complete(session);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        if (kind === 'bounded') expect(response.body.error.details.some(error => error.code === 'TOO_MANY_FILES')).toBe(true);
        expect((await db.getGameVersion(session.versionId)).status).toBe('REJECTED');
        expect([...r2.objects.keys()].some(key => key.includes('/extracted/'))).toBe(false);
    });

    it('rejects a same-size replacement between validation and extraction', async () => {
        const bytes = await packageBytes();
        const session = await upload(bytes);
        expect((await complete(session)).body.data.status).toBe('READY');
        const replacement = Buffer.from(bytes);
        replacement[0] ^= 1;
        expect((await r2.putSigned(session.uploadUrl, replacement)).status).toBe(200);
        const response = await publish(session);
        expect(response.status).toBe(500);
        expect(response.body.error.code).toBe('PUBLISH_FAILED');
        expect((await db.getGameVersion(session.versionId)).status).toBe('PUBLISH_FAILED');
        expect(events.some(event => event.event === 'job_failed' && event.error?.code === 'PACKAGE_CHANGED_AFTER_VALIDATION')).toBe(true);
        expect([...r2.objects.keys()].some(key => key.includes('/extracted/'))).toBe(false);
        expect((await request(app).get(`/api/catalog/games/${gameId}`)).status).toBe(404);
    });

    it('fails readiness on outage, and reports missing published objects or a wrong installation prefix', async () => {
        const session = await upload(await packageBytes());
        await complete(session); await publish(session);
        r2.setUnavailable(true);
        const unavailable = await request(app).get('/api/ready');
        expect(unavailable.status).toBe(503);
        expect(unavailable.body.data.checks.storage).toBe(false);
        r2.setUnavailable(false);
        expect((await request(app).get('/api/ready')).status).toBe(200);
        const prefix = storage.objectPrefix;
        storage.objectPrefix = 'wrong-installation';
        expect((await checkStorageIntegrity(db, storage)).status).toBe('FAIL');
        storage.objectPrefix = prefix;
        const logical = `games/${gameId}/versions/${session.versionId}/extracted/index.html`;
        r2.objects.delete(`${prefix}/${logical}`);
        expect((await request(app).get(`/api/cdn/${logical}`)).status).toBe(404);
        const integrity = await checkStorageIntegrity(db, storage);
        expect(integrity.status).toBe('FAIL');
        expect(integrity.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_STORAGE_OBJECT', key: logical }));
    });

    it('makes cleanup failure observable, preserves metadata and objects, and retries safely after recovery', async () => {
        const session = await upload(await packageBytes());
        await complete(session); await publish(session);
        const before = [...r2.objects.keys()];
        for (const prefix of ['', '/', '../other', 'games/../other']) await expect(storage.deletePrefix(prefix)).rejects.toThrow(/unsafe/);
        expect([...r2.objects.keys()]).toEqual(before);
        r2.setDenyDeletes(true);
        const failure = await mutate('delete', `/api/games/${gameId}`, { confirmTitle: 'R2 project' });
        expect(failure.status).toBe(202);
        expect((await db.getGame(gameId)).currentState).toBe('DELETING');
        expect([...r2.objects.keys()]).toEqual(before);
        expect(events.some(event => event.event === 'job_failed' && event.nextStatus === 'FAILED' && event.error?.code === 'R2_STORAGE_FAILED')).toBe(true);
        expect((await request(app).get(`/api/catalog/games/${gameId}`)).status).toBe(404);
        r2.setDenyDeletes(false);
        const retry = await mutate('delete', `/api/games/${gameId}`, { confirmTitle: 'R2 project' });
        expect(retry.status).toBe(200);
        expect(retry.body.data.status).toBe('DELETED');
        expect(r2.objects.size).toBe(0);
        expect((await checkStorageIntegrity(db, storage)).status).toBe('PASS');
    });
});
