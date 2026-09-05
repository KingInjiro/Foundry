import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/platform/backend/server/app.js';
import { LocalAuthService, verifyLocalPassword } from '../../../src/platform/backend/auth/LocalAuthService.js';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';
import { LocalDiskStorageProvider } from '../../../src/platform/backend/storage/LocalDiskStorageProvider.js';

const ORIGIN = 'https://foundry.single.test';
const SESSION_SECRET = 'single-host-session-secret-for-integration-tests';
const STORAGE_SECRET = 'single-host-storage-secret-for-integration-tests';
const PASSWORD = 'correct horse battery staple';
const CRYPTO_HEAVY_TEST_TIMEOUT_MS = 15_000;

let originalBypass;
const resources = [];

function createFixture({ now, secureCookies = false, logger, sessionTtlSeconds } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-local-auth-'));
    const db = new LocalSqliteProvider(path.join(root, 'platform.db'));
    const storage = new LocalDiskStorageProvider(path.join(root, 'objects'), '/api/storage/upload', {
        uploadSigningSecret: STORAGE_SECRET,
        now
    });
    const app = createApp(db, storage, undefined, {
        logger,
        runtimeConfig: {
            deploymentMode: 'single-host',
            production: secureCookies,
            publicBaseUrl: ORIGIN
        },
        localAuthOptions: { sessionSecret: SESSION_SECRET, secureCookies, now, sessionTtlSeconds }
    });
    resources.push({ root, db, app });
    return { app, db, storage };
}

async function register(agent, username, password = PASSWORD) {
    const response = await agent
        .post('/api/auth/local/register')
        .set('Origin', ORIGIN)
        .send({ username, password, displayName: `${username} display` });
    return { response, csrfToken: response.body?.data?.csrfToken, user: response.body?.data?.user };
}

beforeEach(() => {
    originalBypass = process.env.AUTH_DEV_BYPASS;
    process.env.AUTH_DEV_BYPASS = 'false';
});

afterEach(async () => {
    if (originalBypass === undefined) delete process.env.AUTH_DEV_BYPASS;
    else process.env.AUTH_DEV_BYPASS = originalBypass;
    for (const { root, db, app } of resources.splice(0)) {
        await app?.locals?.jobQueue?.stop?.();
        await db.close();
        if (root) fs.rmSync(root, { recursive: true, force: true });
    }
});

describe('single-host production authentication', () => {
    it('persists an opaque session across a database/process reopen', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-local-session-restart-'));
        const databasePath = path.join(root, 'platform.db');
        try {
            const firstDatabase = new LocalSqliteProvider(databasePath);
            const firstService = new LocalAuthService(firstDatabase, {
                sessionSecret: SESSION_SECRET,
                publicOrigin: ORIGIN
            });
            const issued = await firstService.register({ username: 'restart-user', password: PASSWORD });
            await firstDatabase.close();

            const reopenedDatabase = new LocalSqliteProvider(databasePath);
            const reopenedService = new LocalAuthService(reopenedDatabase, {
                sessionSecret: SESSION_SECRET,
                publicOrigin: ORIGIN
            });
            const resumed = await reopenedService.authenticateToken(issued.token);
            expect(resumed.user.uid).toBe(issued.user.uid);
            expect(resumed.csrfToken).toBe(issued.csrfToken);
            await reopenedDatabase.close();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('registers, resumes, logs out, and stores only password/session hashes', async () => {
        const { app, db } = createFixture();
        const agent = request.agent(app);
        const { response, csrfToken, user } = await register(agent, 'Alice');

        expect(response.status).toBe(201);
        expect(user).toMatchObject({ username: 'Alice', role: 'DEVELOPER' });
        expect(response.body.data).not.toHaveProperty('token');
        const credential = db.db.prepare('SELECT passwordHash FROM local_auth_credentials WHERE uid = ?').get(user.uid);
        expect(credential.passwordHash).toMatch(/^scrypt\$/);
        expect(credential.passwordHash).not.toContain(PASSWORD);
        await expect(verifyLocalPassword(PASSWORD, credential.passwordHash)).resolves.toBe(true);

        const cookie = response.headers['set-cookie'][0];
        const rawToken = decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('='));
        const storedSession = db.db.prepare('SELECT tokenHash FROM local_auth_sessions WHERE uid = ?').get(user.uid);
        expect(storedSession.tokenHash).toMatch(/^[a-f0-9]{64}$/);
        expect(storedSession.tokenHash).not.toBe(rawToken);

        const resumed = await agent.get('/api/auth/local/session');
        expect(resumed.status).toBe(200);
        expect(resumed.body.data.user.uid).toBe(user.uid);

        const logout = await agent
            .post('/api/auth/local/logout')
            .set('Origin', ORIGIN)
            .set('X-CSRF-Token', csrfToken);
        expect(logout.status).toBe(200);
        expect(logout.headers['set-cookie'][0]).toContain('Max-Age=0');
        const anonymous = await agent.get('/api/auth/local/session');
        expect(anonymous.status).toBe(200);
        expect(anonymous.body.data).toEqual({ user: null, csrfToken: null, expiresAt: null });
    });

    it('rejects duplicate accounts, wrong passwords, disabled accounts, and expired sessions', async () => {
        let currentTime = 1_800_000_000_000;
        const { app } = createFixture({ now: () => currentTime, sessionTtlSeconds: 300 });
        const firstAgent = request.agent(app);
        const first = await register(firstAgent, 'same-user');
        expect(first.response.status).toBe(201);

        const duplicate = await register(request.agent(app), 'SAME-USER');
        expect(duplicate.response.status).toBe(409);
        expect(duplicate.response.body.error.code).toBe('USERNAME_TAKEN');

        const wrong = await request(app)
            .post('/api/auth/local/login')
            .set('Origin', ORIGIN)
            .send({ username: 'same-user', password: 'this password is wrong' });
        expect(wrong.status).toBe(401);
        expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

        await app.locals.localAuthService.setDisabled(first.user.uid, true);
        const disabled = await request(app)
            .post('/api/auth/local/login')
            .set('Origin', ORIGIN)
            .send({ username: 'same-user', password: PASSWORD });
        expect(disabled.status).toBe(403);
        expect(disabled.body.error.code).toBe('ACCOUNT_DISABLED');

        await app.locals.localAuthService.setDisabled(first.user.uid, false);
        const expiringAgent = request.agent(app);
        expect((await expiringAgent
            .post('/api/auth/local/login')
            .set('Origin', ORIGIN)
            .send({ username: 'same-user', password: PASSWORD })).status).toBe(200);
        currentTime += 301_000;
        const expired = await expiringAgent.get('/api/auth/local/session');
        expect(expired.status).toBe(401);
        expect(expired.body.error.code).toBe('UNAUTHORIZED');
    });

    it('requires exact same-origin and CSRF protection for authenticated mutations', async () => {
        const { app } = createFixture();
        const agent = request.agent(app);
        const { csrfToken } = await register(agent, 'csrf-user');

        const crossOrigin = await agent
            .post('/api/games')
            .set('Origin', 'https://attacker.example')
            .set('X-CSRF-Token', csrfToken)
            .send({ title: 'Blocked' });
        expect(crossOrigin.status).toBe(403);
        expect(crossOrigin.body.error.code).toBe('ORIGIN_DENIED');

        const missingCsrf = await agent
            .post('/api/games')
            .set('Origin', ORIGIN)
            .send({ title: 'Blocked' });
        expect(missingCsrf.status).toBe(403);
        expect(missingCsrf.body.error.code).toBe('CSRF_TOKEN_INVALID');

        const accepted = await agent
            .post('/api/games')
            .set('Origin', ORIGIN)
            .set('X-CSRF-Token', csrfToken)
            .send({ title: 'Accepted' });
        expect(accepted.status).toBe(200);
        expect(accepted.body.data.title).toBe('Accepted');
    });

    it('preserves stable UID ownership and denies non-owner mutations', async () => {
        const { app } = createFixture();
        const owner = request.agent(app);
        const other = request.agent(app);
        const ownerAuth = await register(owner, 'owner-user');
        const otherAuth = await register(other, 'other-user');
        const created = await owner
            .post('/api/games')
            .set('Origin', ORIGIN)
            .set('X-CSRF-Token', ownerAuth.csrfToken)
            .send({ title: 'Owner game' });
        expect(created.body.data.ownerUid).toBe(ownerAuth.user.uid);

        const denied = await other
            .patch(`/api/games/${created.body.data.id}`)
            .set('Origin', ORIGIN)
            .set('X-CSRF-Token', otherAuth.csrfToken)
            .send({ title: 'Stolen game' });
        expect(denied.status).toBe(403);
        expect((await owner.get(`/api/games/${created.body.data.id}`)).body.data.title).toBe('Owner game');
    });

    it('uses production cookie flags and never emits credentials in structured logs', async () => {
        const records = [];
        const logger = {
            info: (event, fields) => records.push({ event, fields }),
            warn: (event, fields) => records.push({ event, fields }),
            error: (event, fields) => records.push({ event, fields }),
            debug: () => {}
        };
        const { app, db } = createFixture({ secureCookies: true, logger });
        const registration = await request(app)
            .post('/api/auth/local/register')
            .set('Origin', ORIGIN)
            .send({ username: 'secure-user', password: PASSWORD });
        expect(registration.status).toBe(201);
        const cookie = registration.headers['set-cookie'][0];
        expect(cookie).toContain('__Host-foundry_session=');
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('SameSite=Strict');
        expect(cookie).toContain('Path=/');

        const credential = await db.getLocalCredentialByUsername('secure-user');
        await app.locals.localAuthService.resetPassword(credential.uid, 'replacement secure password');
        const output = JSON.stringify(records);
        expect(output).not.toContain(PASSWORD);
        expect(output).not.toContain('replacement secure password');
        expect(output).not.toContain(cookie.split(';')[0].split('=')[1]);
    });

    it('enforces the durable per-account login rate limit', async () => {
        const { app } = createFixture();
        expect((await register(request.agent(app), 'rate-user')).response.status).toBe(201);
        for (let attempt = 0; attempt < 10; attempt += 1) {
            const response = await request(app)
                .post('/api/auth/local/login')
                .set('Origin', ORIGIN)
                .send({ username: 'rate-user', password: 'wrong password value' });
            expect(response.status).toBe(401);
        }
        const limited = await request(app)
            .post('/api/auth/local/login')
            .set('Origin', ORIGIN)
            .send({ username: 'rate-user', password: 'wrong password value' });
        expect(limited.status).toBe(429);
        expect(limited.body.error.code).toBe('RATE_LIMITED');
        expect(limited.headers['retry-after']).toBeDefined();
    }, CRYPTO_HEAVY_TEST_TIMEOUT_MS);

    it('rejects short secrets before creating a production session service', () => {
        const db = new LocalSqliteProvider(':memory:');
        resources.push({ root: null, db });
        expect(() => new LocalAuthService(db, { sessionSecret: 'too-short', publicOrigin: ORIGIN }))
            .toThrow('at least 32 bytes');
    });
});
