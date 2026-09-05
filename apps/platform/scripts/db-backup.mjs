import path from 'node:path';
import { createSqliteBackup } from '../src/platform/backend/database/SqliteRecovery.js';

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
}

const sourcePath = path.resolve(argument('--source') || process.env.PLATFORM_DB_PATH || '');
const output = argument('--output') || process.env.FOUNDRY_BACKUP_OUTPUT;
if (!output) throw new Error('Usage: npm run db:backup -- --output /absolute/path/foundry-backup.db [--source /absolute/path/platform.db]');
const outputPath = path.resolve(output);

const result = createSqliteBackup({ sourcePath, outputPath });
console.log(JSON.stringify({ operation: 'sqlite_backup', ...result }, null, 2));
