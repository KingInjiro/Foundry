import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalAuthService } from '../src/platform/backend/auth/LocalAuthService.js';
import { LocalSqliteProvider } from '../src/platform/backend/database/LocalSqliteProvider.js';

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function has(name) {
    return process.argv.includes(name);
}

function fail(message) {
    console.error(JSON.stringify({ status: 'FAIL', event: 'local_user_operation_failed', message }));
    process.exitCode = 1;
}

async function passwordFromStdin() {
    if (!has('--password-stdin')) throw new Error('Pass --password-stdin; passwords are never accepted as command-line arguments.');
    let value = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
        value += chunk;
        if (Buffer.byteLength(value, 'utf8') > 2048) throw new Error('Password input is too large.');
    }
    value = value.replace(/\r?\n$/, '');
    if (/[\r\n]/.test(value)) throw new Error('Password input must contain exactly one line.');
    return value;
}

export async function runLocalUserCommand(argv = process.argv) {
    const command = argv[2];
    const databasePath = path.resolve(argument('--db') || process.env.PLATFORM_DB_PATH || '');
    if (!['create-user', 'reset-password', 'disable-user', 'enable-user'].includes(command)) {
        throw new Error('Usage: local-user.mjs <create-user|reset-password|disable-user|enable-user> [options]');
    }
    if (!path.isAbsolute(databasePath) || databasePath === path.parse(databasePath).root) {
        throw new Error('--db/PLATFORM_DB_PATH must be an absolute non-root path.');
    }
    if (!fs.statSync(databasePath, { throwIfNoEntry: false })?.isFile()) {
        throw new Error('The target database must already exist; account operations never create a production database implicitly.');
    }
    if (typeof process.env.LOCAL_AUTH_SESSION_SECRET !== 'string' || Buffer.byteLength(process.env.LOCAL_AUTH_SESSION_SECRET, 'utf8') < 32) {
        throw new Error('LOCAL_AUTH_SESSION_SECRET must be loaded from the protected operator environment.');
    }

    const database = new LocalSqliteProvider(databasePath);
    const service = new LocalAuthService(database, {
        sessionSecret: process.env.LOCAL_AUTH_SESSION_SECRET,
        secureCookies: true,
        publicOrigin: process.env.PLATFORM_PUBLIC_BASE_URL
    });
    try {
        let user;
        if (command === 'create-user') {
            if (!has('--confirm-create-user')) throw new Error('Pass --confirm-create-user to acknowledge account creation.');
            const role = String(argument('--role') || 'DEVELOPER').trim().toUpperCase();
            if (['ADMIN', 'MODERATOR'].includes(role) && !has('--confirm-privileged-role')) {
                throw new Error('Pass --confirm-privileged-role when creating an ADMIN or MODERATOR account.');
            }
            user = await service.createAccount({
                username: argument('--username'),
                displayName: argument('--display-name'),
                password: await passwordFromStdin(),
                role
            });
        } else if (command === 'reset-password') {
            if (!has('--confirm-reset-password')) throw new Error('Pass --confirm-reset-password to revoke all sessions and replace the password.');
            user = await service.resetPassword(argument('--user'), await passwordFromStdin());
        } else {
            if (!has('--confirm-account-state')) throw new Error('Pass --confirm-account-state to acknowledge this account state change.');
            user = await service.setDisabled(argument('--user'), command === 'disable-user');
        }
        const credential = await service.findAccount(user.uid);
        const output = {
            status: 'PASS',
            event: `local_${command.replaceAll('-', '_')}`,
            uid: user.uid,
            username: credential?.username,
            role: user.role,
            disabled: Boolean(credential?.disabledAt),
            sessionsRevoked: command === 'reset-password' || command === 'disable-user'
        };
        console.log(JSON.stringify(output));
        return output;
    } finally {
        await database.close();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await runLocalUserCommand().catch(error => fail(error.message));
}
