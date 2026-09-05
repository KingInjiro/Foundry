import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalAuthService } from '../../../src/platform/backend/auth/LocalAuthService.js';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';

const roots = [];
const SESSION_SECRET = 'operator-cli-session-secret-longer-than-thirty-two-bytes';
const CRYPTO_HEAVY_TEST_TIMEOUT_MS = 15_000;

function runCli(args, { stdin = '' } = {}) {
    const script = path.resolve('scripts/local-user.mjs');
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script, ...args], {
            cwd: path.resolve('.'),
            env: {
                ...process.env,
                NODE_ENV: 'production',
                LOCAL_AUTH_SESSION_SECRET: SESSION_SECRET,
                PLATFORM_PUBLIC_BASE_URL: 'https://foundry.single.test'
            },
            stdio: ['pipe', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
        child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', code => resolve({ code, stdout, stderr }));
        child.stdin.end(stdin);
    });
}

afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('single-host operator account CLI', () => {
    it('creates, resets, disables, and enables a privileged local account without password arguments', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-local-user-cli-'));
        roots.push(root);
        const databasePath = path.join(root, 'platform.db');
        const initial = new LocalSqliteProvider(databasePath);
        await initial.close();

        const created = await runCli([
            'create-user', '--db', databasePath, '--username', 'operator', '--role', 'MODERATOR',
            '--confirm-create-user', '--confirm-privileged-role', '--password-stdin'
        ], { stdin: 'initial operator password\n' });
        expect(created.code, created.stderr).toBe(0);
        const createdOutput = JSON.parse(created.stdout);
        expect(createdOutput).toMatchObject({ status: 'PASS', username: 'operator', role: 'MODERATOR', disabled: false });
        expect(created.stdout).not.toContain('initial operator password');

        const reset = await runCli([
            'reset-password', '--db', databasePath, '--user', 'operator',
            '--confirm-reset-password', '--password-stdin'
        ], { stdin: 'replacement operator password\n' });
        expect(reset.code, reset.stderr).toBe(0);
        expect(JSON.parse(reset.stdout).sessionsRevoked).toBe(true);

        const disabled = await runCli([
            'disable-user', '--db', databasePath, '--user', 'operator', '--confirm-account-state'
        ]);
        expect(disabled.code, disabled.stderr).toBe(0);
        expect(JSON.parse(disabled.stdout).disabled).toBe(true);

        const enabled = await runCli([
            'enable-user', '--db', databasePath, '--user', 'operator', '--confirm-account-state'
        ]);
        expect(enabled.code, enabled.stderr).toBe(0);
        expect(JSON.parse(enabled.stdout).disabled).toBe(false);

        const database = new LocalSqliteProvider(databasePath);
        const service = new LocalAuthService(database, {
            sessionSecret: SESSION_SECRET,
            publicOrigin: 'https://foundry.single.test'
        });
        const login = await service.login({ username: 'operator', password: 'replacement operator password' });
        expect(login.user.role).toBe('MODERATOR');
        expect((await database.getLocalCredentialByUsername('operator')).passwordHash).not.toContain('replacement operator password');
        await database.close();
    }, CRYPTO_HEAVY_TEST_TIMEOUT_MS);

    it('requires explicit confirmation and password via stdin', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-local-user-cli-'));
        roots.push(root);
        const databasePath = path.join(root, 'platform.db');
        const database = new LocalSqliteProvider(databasePath);
        await database.close();
        const rejected = await runCli(['create-user', '--db', databasePath, '--username', 'blocked']);
        expect(rejected.code).toBe(1);
        expect(rejected.stderr).toContain('confirm-create-user');
    });
});
