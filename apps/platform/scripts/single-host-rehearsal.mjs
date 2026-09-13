import path from 'node:path';
import { rehearseSingleHostBackup } from '../src/platform/backend/recovery/SingleHostRehearsal.js';
import { createRecoveryStorage } from '../src/platform/backend/recovery/ExternalStorageRecovery.js';

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

const backupDirectory = argument('--backup');
if (!backupDirectory) throw new Error('Usage: single-host-rehearsal.mjs --backup /absolute/foundry-backup-directory');
const storage = createRecoveryStorage();
try {
const result = await rehearseSingleHostBackup({ backupDirectory: path.resolve(backupDirectory), storage });
console.log(JSON.stringify({ operation: 'single_host_restore_rehearsal', ...result }, null, 2));
} finally { storage?.client?.destroy(); }
