import { DEPLOYMENT_MODES, resolveDeploymentMode } from './deploymentMode.js';

export const STORAGE_PROVIDERS = Object.freeze(['local-disk', 'r2']);

export function resolveR2ObjectPrefix(env = process.env, required = false) {
    const prefix = env.R2_OBJECT_PREFIX || '';
    if (!prefix && !required) return '';
    if (!prefix) throw new Error('R2_OBJECT_PREFIX is required for single-host R2 storage.');
    // One installation component: two configured prefixes cannot contain each
    // other. Logical application keys remain unchanged in SQLite and URLs.
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(prefix)) {
        throw new Error('R2_OBJECT_PREFIX must be a non-empty installation name (1-64 lowercase letters, digits, underscores or hyphens).');
    }
    return prefix;
}

export function resolveStorageProvider(env = process.env, deploymentMode = resolveDeploymentMode(env)) {
    const selected = env.FOUNDRY_STORAGE_PROVIDER;
    const provider = selected === undefined || selected === ''
        ? (deploymentMode === DEPLOYMENT_MODES.SINGLE_HOST ? 'local-disk' : 'r2')
        : selected;
    if (!STORAGE_PROVIDERS.includes(provider)) {
        throw new Error('FOUNDRY_STORAGE_PROVIDER must be exactly local-disk or r2.');
    }
    if (deploymentMode === DEPLOYMENT_MODES.CLOUD && provider !== 'r2') {
        throw new Error('Cloud deployment requires the r2 storage provider.');
    }
    return provider;
}

// storageProvider is the legacy build default. New single-host artifacts can
// advertise both server-selected transports without embedding any server env.
export function profileSupportsStorage(profile, deploymentMode, storageProvider) {
    if (!profile || profile.schemaVersion !== 2 || profile.deploymentMode !== deploymentMode
        || !STORAGE_PROVIDERS.includes(storageProvider)
        || !STORAGE_PROVIDERS.includes(profile.storageProvider)) return false;
    if (deploymentMode === DEPLOYMENT_MODES.CLOUD) {
        return profile.authProvider === 'firebase' && profile.storageProvider === 'r2' && storageProvider === 'r2';
    }
    if (deploymentMode !== DEPLOYMENT_MODES.SINGLE_HOST || profile.authProvider !== 'local'
        || profile.firebaseProjectId || profile.firebaseAuthDomain) return false;
    const supported = profile.supportedStorageProviders;
    if (supported === undefined) return profile.storageProvider === storageProvider;
    return Array.isArray(supported) && supported.length > 0
        && new Set(supported).size === supported.length
        && supported.every(value => STORAGE_PROVIDERS.includes(value))
        && supported.includes(profile.storageProvider) && supported.includes(storageProvider);
}

export function r2UploadOrigins(endpoint, bucketName) {
    // The SDK can use path-style or virtual-hosted bucket addressing. Permit
    // only these two exact validated account/bucket origins, never *.r2.*.
    const url = new URL(endpoint);
    const virtual = new URL(url.origin);
    virtual.hostname = `${bucketName}.${url.hostname}`;
    return [url.origin, virtual.origin];
}
