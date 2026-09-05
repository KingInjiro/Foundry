import fs from 'node:fs';
import path from 'node:path';
import { createSingleHostBackup } from '../src/platform/backend/recovery/SingleHostRecovery.js';

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.env.FOUNDRY_DEPLOYMENT_MODE !== 'single-host') {
    throw new Error('FOUNDRY_DEPLOYMENT_MODE=single-host is required for a coordinated single-host backup.');
}
if (!process.argv.includes('--confirm-service-stopped')) {
    throw new Error('Stop the Foundry service, then pass --confirm-service-stopped. Use the installed `foundry backup` command to coordinate this automatically.');
}

const dataDirectory = path.resolve(argument('--data-dir') || process.env.FOUNDRY_DATA_DIR || '');
const backupParent = path.join(dataDirectory, 'backups');
if (!fs.statSync(backupParent, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('The configured <FOUNDRY_DATA_DIR>/backups directory must already exist.');
}
const compactTimestamp = new Date().toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const outputDirectory = path.resolve(argument('--output') || path.join(backupParent, `foundry-backup-${compactTimestamp}`));
const result = await createSingleHostBackup({
    dataDirectory,
    databasePath: argument('--db') || process.env.PLATFORM_DB_PATH,
    outputDirectory,
    applicationVersion: process.env.npm_package_version || 'unknown',
    releaseId: process.env.FOUNDRY_RELEASE_ID || 'unknown'
});
console.log(JSON.stringify({ operation: 'single_host_backup', ...result, manifest: undefined }, null, 2));
