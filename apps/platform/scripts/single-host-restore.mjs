import path from 'node:path';
import { restoreSingleHostBackup } from '../src/platform/backend/recovery/SingleHostRecovery.js';

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

const backupDirectory = argument('--backup');
const targetDataDirectory = argument('--target');
if (!backupDirectory || !targetDataDirectory || !process.argv.includes('--confirm-new-target')) {
    throw new Error('Usage: single-host-restore.mjs --backup /absolute/backup-dir --target /absolute/new-data-dir --confirm-new-target');
}
const result = await restoreSingleHostBackup({
    backupDirectory: path.resolve(backupDirectory),
    targetDataDirectory: path.resolve(targetDataDirectory)
});
console.log(JSON.stringify({ operation: 'single_host_restore', ...result, objects: { count: result.objects.count, totalBytes: result.objects.totalBytes } }, null, 2));
