import { LocalSqliteProvider } from '../database/LocalSqliteProvider.js';
import { LocalDiskStorageProvider } from '../storage/LocalDiskStorageProvider.js';
import { R2StorageProvider } from '../storage/R2StorageProvider.js';
import { DEPLOYMENT_MODES } from './deploymentMode.js';

export function createProductionProviders(productionConfig, env = process.env) {
    if (productionConfig?.deploymentMode === DEPLOYMENT_MODES.SINGLE_HOST) {
        return {
            database: new LocalSqliteProvider(productionConfig.databasePath),
            storage: new LocalDiskStorageProvider(productionConfig.objectStoragePath, '/api/storage/upload', {
                uploadSigningSecret: env.LOCAL_STORAGE_SIGNING_SECRET,
                uploadUrlTtlSeconds: productionConfig.localStorageUploadUrlTtlSeconds,
                publicOrigin: productionConfig.publicBaseUrl
            })
        };
    }
    if (productionConfig?.deploymentMode === DEPLOYMENT_MODES.CLOUD) {
        return {
            database: new LocalSqliteProvider(productionConfig.databasePath),
            storage: new R2StorageProvider()
        };
    }
    throw new Error('Unsupported production deployment mode.');
}
