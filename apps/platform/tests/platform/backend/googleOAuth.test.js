import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GoogleOAuthService, GOOGLE_STATE_TTL_MS, googleConfiguration, safeGoogleReturnTo } from '../../../src/platform/backend/auth/GoogleOAuthService.js';
import { LocalAuthService } from '../../../src/platform/backend/auth/LocalAuthService.js';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';
import { createSqliteBackup, restoreSqliteBackup } from '../../../src/platform/backend/database/SqliteRecovery.js';
import { mockGoogleClient } from '../../helpers/googleOAuthMock.js';

const ORIGIN = 'https://foundry.google.test';
const resources = [];
function fixture(options = {}) {
    const db = new LocalSqliteProvider(options.databasePath || ':memory:');
    resources.push(db);
    const local = new LocalAuthService(db, { sessionSecret: crypto.randomBytes(32).toString('hex'), publicOrigin: ORIGIN, secureCookies: true });
    const mock = mockGoogleClient({ redirectUri: `${ORIGIN}/api/auth/google/callback` });
    const google = new GoogleOAuthService(local, { clientId: mock.clientId, clientSecret: mock.clientSecret, publicOrigin: ORIGIN }, { client: mock.client, now: options.now });
    const attempt = (claims = {}, overrides = {}) => {
        const start = google.start('/developer');
        const url = new URL(start.url);
        const state = google.consume(url.searchParams.get('state'), start.cookie.split(';')[0].split('=')[1]);
        const { code, token } = mock.issueCode({ nonce: state.nonce, challenge: url.searchParams.get('code_challenge'), claims, ...overrides });
        return { code, token, state, signIn: () => google.signIn(code, state) };
    };
    return { db, local, google, mock, attempt };
}

afterEach(async () => { for (const db of resources.splice(0)) await db.close(); });

describe('single-host Google identity foundation', () => {
    it('creates a separate DEVELOPER with an existing opaque Foundry session and no local password', async () => {
        const { db, local, attempt } = fixture();
        const login = await attempt({ email: 'verified@example.test', email_verified: true, name: 'Google developer', uid: 'admin', role: 'ADMIN' }).signIn();
        expect(login.user).toMatchObject({ role: 'DEVELOPER', email: 'verified@example.test', displayName: 'Google developer' });
        expect(login.user.uid).not.toBe('admin');
        expect(login.user.username).toBeUndefined();
        expect(await db.getLocalCredentialByUid(login.user.uid)).toBeUndefined();
        expect((await local.authenticateToken(login.token)).user.uid).toBe(login.user.uid);
        expect(local.sessionCookie(login.token)).toContain('SameSite=Strict');
        expect(local.sessionCookie(login.token)).toContain('__Host-foundry_session=');
    });

    it('maps by provider+sub through concurrent/repeated logins, never by email', async () => {
        const { db, attempt } = fixture();
        const [first, repeated] = await Promise.all([attempt({ email: 'shared@test.example', email_verified: true }).signIn(), attempt({ email: 'changed@test.example', email_verified: true }).signIn()]);
        const different = await attempt({ sub: 'different', email: first.user.email, email_verified: true }).signIn();
        expect(repeated.user.uid).toBe(first.user.uid);
        expect(different.user.uid).not.toBe(first.user.uid);
        expect(db.db.prepare('SELECT count(*) AS n FROM external_auth_identities').get().n).toBe(2);
        expect(db.db.prepare('SELECT count(*) AS n FROM users').get().n).toBe(2);
    });

    it('cannot claim a local username/email/privileged UID, change credentials or grant a role', async () => {
        const { db, local, attempt } = fixture();
        const admin = await local.createAccount({ username: 'KingInjiro', password: 'local account password test', role: 'ADMIN' });
        db.db.prepare('UPDATE users SET email = ? WHERE uid = ?').run('same@example.test', admin.uid);
        const before = await db.getLocalCredentialByUid(admin.uid);
        const google = await attempt({ sub: admin.uid, uid: admin.uid, email: 'same@example.test', email_verified: true, name: 'KingInjiro', role: 'MODERATOR' }).signIn();
        expect(google.user.uid).not.toBe(admin.uid);
        expect(google.user.role).toBe('DEVELOPER');
        expect(await db.getLocalCredentialByUid(admin.uid)).toEqual(before);
        expect((await local.login({ username: 'kinginjiro', password: 'local account password test' })).user.role).toBe('ADMIN');
        await expect(local.resetPassword(google.user.uid, 'cannot add password here')).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
    });

    it('rejects disabled external accounts and revokes their existing sessions without affecting local accounts', async () => {
        const { local, attempt } = fixture();
        const first = await attempt().signIn();
        expect(await local.setDisabled(first.user.uid, true)).toMatchObject({ disabled: true });
        await expect(attempt().signIn()).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
        expect(await local.authenticateToken(first.token)).toBeNull();
        await local.setDisabled(first.user.uid, false);
        expect((await attempt().signIn()).user.uid).toBe(first.user.uid);
    });

    it.each([
        ['issuer', { iss: 'https://attacker.example' }],
        ['audience', { aud: 'another.apps.googleusercontent.com' }],
        ['authorized presenter', { azp: 'another.apps.googleusercontent.com' }],
        ['expiry', { exp: Math.floor(Date.now() / 1000) - 1 }],
        ['future issuance', { iat: Math.floor(Date.now() / 1000) + 120 }],
        ['missing expiry', { exp: null }],
        ['missing subject', { sub: null }],
        ['oversized subject', { sub: 'x'.repeat(256) }],
        ['nonce', { nonce: 'incorrect' }]
    ])('rejects invalid %s before persisting any identity', async (_label, claims) => {
        const { db, attempt } = fixture();
        await expect(attempt(claims).signIn()).rejects.toMatchObject({ code: 'GOOGLE_IDENTITY_REJECTED' });
        expect(db.db.prepare('SELECT count(*) AS n FROM users').get().n).toBe(0);
    });

    it('verifies the actual signature, restricts the algorithm and sanitizes SDK errors', async () => {
        const { attempt, google, mock } = fixture();
        const differentKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        await expect(attempt({}, { privateKey: differentKeys.privateKey }).signIn()).rejects.toMatchObject({ code: 'GOOGLE_IDENTITY_REJECTED' });
        await expect(attempt({}, { header: { alg: 'none' } }).signIn()).rejects.toMatchObject({ code: 'GOOGLE_IDENTITY_REJECTED' });
        const pending = attempt();
        mock.client.getToken = async () => { throw new Error(`${pending.code} ${pending.token} ${mock.clientSecret}`); };
        const error = await google.signIn(pending.code, pending.state).catch(value => value);
        expect(error.message).not.toContain(pending.code);
        expect(error.message).not.toContain(pending.token);
        expect(error.message).not.toContain(mock.clientSecret);
        expect(error.cause).toBeUndefined();
    });

    it('does not store an unverified email or accept caller fields outside verified claims', async () => {
        const { google, attempt } = fixture();
        const { code, state } = attempt({ email: 'unverified@example.test' });
        const session = await google.signIn(code, { ...state, email: 'spoof@example.test', uid: 'admin', role: 'ADMIN', subject: 'spoof' });
        expect(session.user).toMatchObject({ email: '', role: 'DEVELOPER' });
        expect(session.user.uid).not.toBe('admin');
    });

    it('enforces mapping uniqueness and foreign keys; a collision cannot leave an orphan user', async () => {
        const { db, attempt } = fixture();
        const { user } = await attempt().signIn();
        expect(() => db.db.prepare("INSERT INTO external_auth_identities(provider, subject, uid, createdAt) VALUES ('google', 'collision', ?, 1)").run(user.uid)).toThrow(/UNIQUE/);
        expect(() => db.db.prepare("INSERT INTO external_auth_identities(provider, subject, uid, createdAt) VALUES ('google', 'new', 'missing', 1)").run()).toThrow(/FOREIGN KEY/);
        db.db.exec("CREATE TRIGGER reject_identity BEFORE INSERT ON external_auth_identities BEGIN SELECT RAISE(ABORT, 'test collision'); END");
        await expect(attempt({ sub: 'new-subject' }).signIn()).rejects.toThrow('test collision');
        expect(db.db.prepare('SELECT count(*) AS n FROM users').get().n).toBe(1);
    });

    it('upgrades schema 8 additively and retains identities/sessions through a verified backup restore', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-google-recovery-'));
        try {
            const dbPath = path.join(root, 'platform.db');
            const old = fixture({ databasePath: dbPath });
            const localSession = await old.local.register({ username: 'old-account', password: 'previous local account password' });
            const credential = await old.db.getLocalCredentialByUid(localSession.user.uid);
            old.db.db.exec('DROP TABLE external_auth_identities; DELETE FROM schema_migrations WHERE version = 9');
            await old.db.close();
            const upgraded = fixture({ databasePath: dbPath });
            expect(await upgraded.db.getLocalCredentialByUid(localSession.user.uid)).toEqual(credential);
            expect((await upgraded.local.authenticateToken(localSession.token)).user.uid).toBe(localSession.user.uid);
            const googleSession = await upgraded.attempt().signIn();
            const backupPath = path.join(root, 'backup.db');
            const backup = createSqliteBackup({ sourcePath: dbPath, outputPath: backupPath });
            expect(backup).toMatchObject({ quickCheck: 'ok', foreignKeyViolations: 0 });
            expect(backup.schemaMigrations.at(-1).version).toBe(9);
            const restoredPath = path.join(root, 'restored.db');
            restoreSqliteBackup({ backupPath, targetPath: restoredPath });
            const restored = fixture({ databasePath: restoredPath });
            expect((await restored.attempt().signIn()).user.uid).toBe(googleSession.user.uid);
            expect((await restored.local.authenticateToken(googleSession.token)).user.uid).toBe(googleSession.user.uid);
            expect(await restored.db.getLocalCredentialByUid(localSession.user.uid)).toEqual(credential);
            await upgraded.db.close(); await restored.db.close();
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
});

describe('Google state and configuration', () => {
    it('uses browser-bound one-time state, nonce and S256 PKCE without changing the session cookie', () => {
        const { google } = fixture();
        const { url, cookie } = google.start('/developer/projects?tab=mine');
        const params = new URL(url).searchParams;
        expect(cookie).toContain('__Host-foundry_google=');
        expect(cookie).toContain('HttpOnly; SameSite=Lax; Max-Age=600; Secure');
        expect(params.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/google/callback`);
        expect(params.get('code_challenge_method')).toBe('S256');
        const binding = cookie.split(';')[0].split('=')[1];
        const state = params.get('state');
        expect(() => google.consume(state, crypto.randomBytes(32).toString('base64url'))).toThrow();
        const pending = google.consume(state, binding);
        expect(pending.returnTo).toBe('/developer/projects?tab=mine');
        expect(pending.nonce).toBe(params.get('nonce'));
        expect(crypto.createHash('sha256').update(pending.codeVerifier).digest('base64url')).toBe(params.get('code_challenge'));
        expect(() => google.consume(state, binding)).toThrow();
    });

    it('rejects absent/malformed/expired states and clears superseded attempts', () => {
        let now = Date.now();
        const { google } = fixture({ now: () => now });
        expect(() => google.consume(undefined, undefined)).toThrow();
        expect(() => google.consume(['state'], 'cookie')).toThrow();
        const start = google.start('/developer');
        const binding = start.cookie.split(';')[0].split('=')[1];
        const state = new URL(start.url).searchParams.get('state');
        now += GOOGLE_STATE_TTL_MS;
        expect(() => google.consume(state, binding)).toThrow();
        const next = google.start('/player');
        google.start('/editor', next.cookie.split(';')[0].split('=')[1]);
        expect(google.pending.size).toBe(1);
    });

    it('bounds pending state memory without evicting a valid pending login', () => {
        const { google } = fixture();
        for (let i = 0; i < 1000; i++) google.start('/');
        expect(() => google.start('/')).toThrow();
        expect(google.pending.size).toBe(1000);
    });

    it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/api/auth/google/callback', '/player/../../api/auth/local/logout', '/%2f%2fevil.test', '/developer\r\nLocation:evil'])('rejects unsafe destination %s', value => {
        expect(safeGoogleReturnTo(value)).toBe('/');
    });

    it('disables only Google when settings are missing or invalid', async () => {
        const { local, mock } = fixture();
        expect(googleConfiguration({})).toBeNull();
        expect(googleConfiguration({ clientId: mock.clientId, clientSecret: mock.clientSecret, publicOrigin: 'http://unsafe.example' })).toBeNull();
        const disabled = new GoogleOAuthService(local, { clientId: mock.clientId, publicOrigin: ORIGIN });
        expect(disabled.enabled).toBe(false);
        expect(() => disabled.start('/')).toThrow();
        expect((await local.register({ username: 'local-still-works', password: 'local login still works' })).user.role).toBe('DEVELOPER');
    });
});
