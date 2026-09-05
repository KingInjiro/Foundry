import path from 'node:path';
import { restoreSqliteBackup } from '../src/platform/backend/database/SqliteRecovery.js';

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
}

const backup = argument('--backup');
const target = argument('--target');
const confirmed = process.argv.includes('--confirm-new-target');
if (!backup || !target || !confirmed) {
    throw new Error('Usage: npm run db:restore -- --backup /absolute/backup.db --target /absolute/new-platform.db --confirm-new-target');
}

const result = restoreSqliteBackup({ backupPath: path.resolve(backup), targetPath: path.resolve(target) });
console.log(JSON.stringify({ operation: 'sqlite_restore', ...result }, null, 2));
