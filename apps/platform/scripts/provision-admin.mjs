import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LocalSqliteProvider } from '../src/platform/backend/database/LocalSqliteProvider.js';

function readArgument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message) {
    console.error(JSON.stringify({ status: 'FAIL', event: 'operator_role_provision_failed', message }));
    process.exitCode = 1;
}

async function main() {
    const uid = readArgument('--uid')?.trim();
    const role = readArgument('--role')?.trim().toUpperCase() || 'ADMIN';
    const databasePath = path.resolve(readArgument('--db') || process.env.PLATFORM_DB_PATH || '');
    if (!process.argv.includes('--confirm-provision')) return fail('Pass --confirm-provision to acknowledge this privileged operation.');
    if (!uid || uid.length > 128 || /\s/.test(uid)) return fail('A valid stable user UID is required with --uid.');
    if (!new Set(['ADMIN', 'MODERATOR']).has(role)) return fail('--role must be ADMIN or MODERATOR.');
    if (!path.isAbsolute(databasePath) || databasePath === path.parse(databasePath).root) return fail('--db/PLATFORM_DB_PATH must be an absolute non-root path.');
    if (!fs.statSync(databasePath, { throwIfNoEntry: false })?.isFile()) return fail('The target database must already exist; provisioning never creates a production database implicitly.');

    const db = new LocalSqliteProvider(databasePath);
    try {
        const result = await db.provisionUserRole({ uid, role });
        console.log(JSON.stringify({
            status: 'PASS',
            event: 'operator_role_provisioned',
            uid,
            role,
            previousRole: result.previousRole,
            databasePath,
            changedAt: result.user.updatedAt
        }));
    } finally {
        await db.close();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await main().catch(error => fail(error.message));
}
