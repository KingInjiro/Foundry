import { LocalSqliteProvider } from '../database/LocalSqliteProvider.js';
import { LocalDiskStorageProvider } from '../storage/LocalDiskStorageProvider.js';
import { R2StorageProvider } from '../storage/R2StorageProvider.js';
import { DEPLOYMENT_MODES } from './deploymentMode.js';
import { resolveStorageProvider } from './storageConfig.js';

export function createProductionStorage(productionConfig, env = process.env) {
    if (![DEPLOYMENT_MODES.SINGLE_HOST, DEPLOYMENT_MODES.CLOUD].includes(productionConfig?.deploymentMode)) {
        throw new Error('Unsupported production deployment mode.');
    }
    const selected = resolveStorageProvider({ ...env,
        FOUNDRY_STORAGE_PROVIDER: productionConfig.storageProvider ?? env.FOUNDRY_STORAGE_PROVIDER
    }, productionConfig.deploymentMode);
    if (selected === 'local-disk') {
        return new LocalDiskStorageProvider(productionConfig.objectStoragePath, '/api/storage/upload', {
                uploadSigningSecret: env.LOCAL_STORAGE_SIGNING_SECRET,
                uploadUrlTtlSeconds: productionConfig.localStorageUploadUrlTtlSeconds,
                publicOrigin: productionConfig.publicBaseUrl
        });
    }
    const storage = new R2StorageProvider({ env });
    if (!storage.isConfigured) throw new Error('Selected R2 storage is not configured.');
    return storage;
}

export function createProductionProviders(productionConfig, env = process.env) {
    const storage = createProductionStorage(productionConfig, env);
    try {
        return { database: new LocalSqliteProvider(productionConfig.databasePath), storage };
    } catch (error) {
        storage.client?.destroy();
        throw error;
    }
}
