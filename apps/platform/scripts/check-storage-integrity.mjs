import path from 'node:path';
import { LocalSqliteProvider } from '../src/platform/backend/database/LocalSqliteProvider.js';
import { LocalDiskStorageProvider } from '../src/platform/backend/storage/LocalDiskStorageProvider.js';
import { R2StorageProvider } from '../src/platform/backend/storage/R2StorageProvider.js';
import { checkStorageIntegrity } from '../src/platform/backend/storage/StorageIntegrityChecker.js';
import { DEPLOYMENT_MODES, resolveDeploymentMode } from '../src/platform/backend/config/deploymentMode.js';

const databasePath = process.env.PLATFORM_DB_PATH;
if (!databasePath || !path.isAbsolute(databasePath)) {
    console.error(JSON.stringify({ status: 'FAIL', message: 'PLATFORM_DB_PATH must be an absolute path.' }));
    process.exit(1);
}

const deploymentMode = resolveDeploymentMode(process.env);
const dataDirectory = process.env.FOUNDRY_DATA_DIR;
if (deploymentMode === DEPLOYMENT_MODES.SINGLE_HOST && (!dataDirectory || !path.isAbsolute(dataDirectory))) {
    console.error(JSON.stringify({ status: 'FAIL', message: 'FOUNDRY_DATA_DIR must be an absolute path in single-host mode.' }));
    process.exit(1);
}
const database = new LocalSqliteProvider(databasePath);
const storage = deploymentMode === DEPLOYMENT_MODES.SINGLE_HOST
    ? new LocalDiskStorageProvider(path.join(path.resolve(dataDirectory), 'objects'), '/unused', {
        uploadSigningSecret: process.env.LOCAL_STORAGE_SIGNING_SECRET
    })
    : new R2StorageProvider();
try {
    if (!storage.isConfigured) throw new Error('Configured object storage is unavailable for integrity verification.');
    const report = await checkStorageIntegrity(database, storage);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'PASS') process.exitCode = 1;
} catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', message: error.message }));
    process.exitCode = 1;
} finally {
    await database.close();
}
