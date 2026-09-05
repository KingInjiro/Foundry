import path from 'node:path';
import { rehearseSingleHostBackup } from '../src/platform/backend/recovery/SingleHostRehearsal.js';

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

const backupDirectory = argument('--backup');
if (!backupDirectory) throw new Error('Usage: single-host-rehearsal.mjs --backup /absolute/foundry-backup-directory');
const result = await rehearseSingleHostBackup({ backupDirectory: path.resolve(backupDirectory) });
console.log(JSON.stringify({ operation: 'single_host_restore_rehearsal', ...result }, null, 2));
