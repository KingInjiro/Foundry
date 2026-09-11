import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../src/platform/backend/server/app.js';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';
import { LocalDiskStorageProvider } from '../../../src/platform/backend/storage/LocalDiskStorageProvider.js';
import { mockGoogleClient } from '../../helpers/googleOAuthMock.js';

const ORIGIN = 'https://foundry.google.test';
const CALLBACK = '/api/auth/google/callback';
const resources = [];

function fixture({ enabled = true, secureCookies = false } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-google-http-'));
    const db = new LocalSqliteProvider(path.join(root, 'platform.db'));
    const storage = new LocalDiskStorageProvider(path.join(root, 'objects'), '/api/storage/upload', { uploadSigningSecret: crypto.randomBytes(32).toString('hex') });
    const mock = mockGoogleClient({ redirectUri: ORIGIN + CALLBACK });
    const records = [];
    const logger = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level, (event, fields) => records.push({ level, event, fields })]));
    const app = createApp(db, storage, undefined, {
        logger,
        runtimeConfig: { deploymentMode: 'single-host', production: secureCookies, publicBaseUrl: ORIGIN },
        localAuthOptions: { sessionSecret: crypto.randomBytes(32).toString('hex'), secureCookies },
        googleAuthOptions: { clientId: mock.clientId, clientSecret: enabled ? mock.clientSecret : '', client: mock.client }
    });
    resources.push({ app, db, root });
    const agent = request.agent(app);
    const start = async (returnTo = '/developer') => {
        const response = await agent.post('/api/auth/google/start').set('Origin', ORIGIN).send({ returnTo });
        expect(response.status).toBe(200);
        const url = new URL(response.body.data.url);
        const state = url.searchParams.get('state');
        const issued = mock.issueCode({ nonce: url.searchParams.get('nonce'), challenge: url.searchParams.get('code_challenge') });
        return { ...issued, state, response, url };
    };
    return { app, db, agent, mock, records, start };
}

beforeEach(() => { vi.stubEnv('AUTH_DEV_BYPASS', 'false'); });
afterEach(async () => {
    for (const { app, db, root } of resources.splice(0)) {
        await app.locals.jobQueue.stop(); await db.close(); fs.rmSync(root, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
});

describe('Google HTTP flow with existing local sessions', () => {
    it('exchanges the code server-side, resumes destination/session, enforces CSRF and logs out', async () => {
        const { agent, start, records, mock } = fixture();
        const { state, code, token } = await start('/developer/projects?tab=mine#section');
        const callback = await agent.get(CALLBACK).query({ state, code, uid: 'admin', role: 'ADMIN', email: 'spoof@example.test' });
        expect(callback.status).toBe(303);
        expect(callback.headers.location).toBe('/developer/projects?tab=mine#section');
        expect(callback.headers['cache-control']).toBe('no-store');
        expect(callback.headers['referrer-policy']).toBe('no-referrer');
        expect(callback.headers['set-cookie'].some(cookie => cookie.includes('SameSite=Strict'))).toBe(true);
        expect(callback.headers['set-cookie'].some(cookie => cookie.includes('foundry_google=;') && cookie.includes('Max-Age=0'))).toBe(true);
        const resumed = await agent.get('/api/auth/local/session');
        expect(resumed.body.data.user.role).toBe('DEVELOPER');
        expect(resumed.body.data.user.uid).not.toBe('admin');
        const csrf = resumed.body.data.csrfToken;
        expect(csrf).toBeTruthy();
        expect((await agent.get('/api/moderation/reports')).status).toBe(403);
        const denied = await agent.post('/api/games').set('Origin', ORIGIN).send({ title: 'Blocked' });
        expect(denied.body.error.code).toBe('CSRF_TOKEN_INVALID');
        expect((await agent.post('/api/games').set('Origin', ORIGIN).set('X-CSRF-Token', csrf).send({ title: 'Allowed' })).status).toBe(200);
        expect((await agent.post('/api/auth/local/logout').set('Origin', ORIGIN).set('X-CSRF-Token', csrf)).status).toBe(200);
        expect((await agent.get('/api/auth/local/session')).body.data.user).toBeNull();
        for (const credential of [state, code, token, mock.clientSecret, csrf]) expect(JSON.stringify(records)).not.toContain(credential);
        expect(records.some(record => record.event === 'http_request' && record.fields.path === CALLBACK && record.fields.statusCode === 303)).toBe(true);
    });

    it('keeps Secure/HttpOnly/session Strict and a separate short-lived Lax OAuth cookie', async () => {
        const { app, mock } = fixture({ secureCookies: true });
        const start = await request(app).post('/api/auth/google/start').set('Origin', ORIGIN).set('Host', 'attacker.example').send({});
        const cookie = start.headers['set-cookie'][0];
        expect(cookie).toMatch(/^__Host-foundry_google=/);
        expect(cookie).toContain('HttpOnly; SameSite=Lax; Max-Age=600; Secure');
        expect(cookie).not.toContain('Domain=');
        const params = new URL(start.body.data.url).searchParams;
        expect(params.get('redirect_uri')).toBe(ORIGIN + CALLBACK);
        const { code } = mock.issueCode({ nonce: params.get('nonce') });
        const callback = await request(app).get(CALLBACK).set('Cookie', cookie.split(';')[0]).query({ state: params.get('state'), code });
        expect(callback.headers['set-cookie'][1]).toContain('__Host-foundry_session=');
        expect(callback.headers['set-cookie'][1]).toContain('SameSite=Strict');
        expect(callback.headers['set-cookie'][1]).toContain('Secure');
    });

    it('rejects cross-origin start without changing local authentication requirements', async () => {
        const { agent, app } = fixture();
        for (const origin of ['', 'https://attacker.example']) {
            const rejected = await agent.post('/api/auth/google/start').set('Origin', origin).send({});
            expect(rejected.status).toBe(403);
            expect(rejected.headers['set-cookie']).toBeUndefined();
        }
        expect(app.locals.googleAuthService.pending.size).toBe(0);
    });

    it.each(['missing', 'wrong', 'other-browser', 'duplicate'])('rejects %s state before contacting Google', async mode => {
        const { agent, app, start, mock, db } = fixture();
        const { state, code } = await start();
        let route = CALLBACK;
        const caller = mode === 'other-browser' ? request(app) : agent;
        if (mode === 'duplicate') route += `?state=${state}&state=${state}`;
        const query = mode === 'missing' || mode === 'duplicate' ? { code } : { code, state: mode === 'wrong' ? crypto.randomBytes(32).toString('base64url') : state };
        const rejected = await caller.get(route).query(query);
        expect(rejected.headers.location).toBe('/?googleAuth=failed');
        expect(mock.exchanges()).toBe(0);
        expect(db.db.prepare('SELECT count(*) AS n FROM local_auth_sessions').get().n).toBe(0);
    });

    it('rejects replay even when the caller replays the original binding cookie', async () => {
        const { agent, app, start, mock } = fixture();
        const { state, code, response } = await start();
        const cookie = response.headers['set-cookie'][0].split(';')[0];
        expect((await agent.get(CALLBACK).query({ state, code })).headers.location).toBe('/developer');
        const replay = await request(app).get(CALLBACK).set('Cookie', cookie).query({ state, code });
        expect(replay.headers.location).toBe('/?googleAuth=failed');
        expect(mock.exchanges()).toBe(1);
    });

    it.each([{ code: null }, { code: ['first', 'second'] }, { error: ['first', 'second'] }, { error: 'access_denied', code: 'also-code' }])('rejects malformed callback parameters %j and consumes state', async bad => {
        const { agent, app, start, mock } = fixture();
        const { state, response } = await start('/player/library');
        const rejected = await agent.get(CALLBACK).query({ state, ...bad });
        expect(rejected.headers.location).toBe('/player/library?googleAuth=failed');
        const replay = await request(app).get(CALLBACK).set('Cookie', response.headers['set-cookie'][0].split(';')[0]).query({ state, code: 'another' });
        expect(replay.headers.location).toBe('/?googleAuth=failed');
        expect(mock.exchanges()).toBe(0);
    });

    it('cancellation preserves navigation and local Register/Sign In remains usable', async () => {
        const { agent, start, mock } = fixture();
        const { state } = await start('/developer');
        const cancelled = await agent.get(CALLBACK).query({ state, error: 'access_denied', error_description: 'untrusted text' });
        expect(cancelled.headers.location).toBe('/developer?googleAuth=cancelled');
        expect(mock.exchanges()).toBe(0);
        const registration = await agent.post('/api/auth/local/register').set('Origin', ORIGIN).send({ username: 'fallback', password: 'local fallback password' });
        expect(registration.status).toBe(201);
        expect((await agent.post('/api/auth/local/logout').set('Origin', ORIGIN).set('X-CSRF-Token', registration.body.data.csrfToken)).status).toBe(200);
        expect((await agent.post('/api/auth/local/login').set('Origin', ORIGIN).send({ username: 'fallback', password: 'local fallback password' })).status).toBe(200);
        expect((await agent.post('/api/auth/google/start').set('Origin', ORIGIN).send({})).status).toBe(409);
    });

    it('rejects a verified but disabled identity at callback', async () => {
        const { app, agent, start } = fixture();
        let attempt = await start();
        await agent.get(CALLBACK).query({ state: attempt.state, code: attempt.code });
        const session = (await agent.get('/api/auth/local/session')).body.data;
        await app.locals.localAuthService.setDisabled(session.user.uid, true);
        attempt = await start();
        const rejected = await agent.get(CALLBACK).query({ state: attempt.state, code: attempt.code });
        expect(rejected.headers.location).toBe('/developer?googleAuth=disabled');
        expect(rejected.headers['set-cookie'].some(cookie => cookie.startsWith('foundry_session='))).toBe(false);
    });

    it('cannot redirect off-site and does not expose configuration secrets', async () => {
        const { agent, start, mock } = fixture();
        const config = await agent.get('/api/auth/google/config');
        expect(config.body).toEqual({ success: true, data: { enabled: true } });
        const { state, code, response } = await start('https://attacker.example/steal');
        expect(JSON.stringify(response.body)).not.toContain(mock.clientSecret);
        expect((await agent.get(CALLBACK).query({ state, code, returnTo: '//attacker.example' })).headers.location).toBe('/');
    });

    it('missing Google configuration leaves readiness and local auth available', async () => {
        const { agent, mock } = fixture({ enabled: false });
        expect((await agent.get('/api/auth/google/config')).body.data).toEqual({ enabled: false });
        expect((await agent.post('/api/auth/google/start').set('Origin', ORIGIN).send({})).status).toBe(503);
        expect((await agent.get('/api/ready')).status).toBe(200);
        expect((await agent.post('/api/auth/local/register').set('Origin', ORIGIN).send({ username: 'available', password: 'local auth available password' })).status).toBe(201);
        expect(mock.exchanges()).toBe(0);
    });

    it('bounds Google start requests independently of local login rate limits', async () => {
        const { agent } = fixture();
        for (let i = 0; i < 20; i++) expect((await agent.post('/api/auth/google/start').set('Origin', ORIGIN).send({})).status).toBe(200);
        expect((await agent.post('/api/auth/google/start').set('Origin', ORIGIN).send({})).status).toBe(429);
        expect((await agent.post('/api/auth/local/register').set('Origin', ORIGIN).send({ username: 'independent', password: 'local rate limit independent' })).status).toBe(201);
    });
});
