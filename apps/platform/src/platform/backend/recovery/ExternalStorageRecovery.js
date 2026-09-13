import { DatabaseSync } from 'node:sqlite';
import { LocalSqliteProvider } from '../database/LocalSqliteProvider.js';
import { checkStorageIntegrity } from '../storage/StorageIntegrityChecker.js';
import { resolveR2ObjectPrefix, resolveStorageProvider } from '../config/storageConfig.js';
import { createProductionStorage } from '../config/productionProviders.js';

export const EXTERNAL_STORAGE_BACKUP_FORMAT = 'foundry-single-host-external-backup-v2';

// Operator tools may verify an offline backup. Never instantiate a provider
// that runs migrations or opens writable jobs against the backup database.
export async function checkSqliteStorageIntegrity(databasePath, storage) {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
        return await checkStorageIntegrity({
            getStorageIntegritySnapshot: () => LocalSqliteProvider.prototype.getStorageIntegritySnapshot.call({ db })
        }, storage);
    } finally { db.close(); }
}

export function createRecoveryStorage(env = process.env) {
    if (resolveStorageProvider(env, 'single-host') === 'local-disk') return null;
    return createProductionStorage({ deploymentMode: 'single-host', storageProvider: 'r2' }, env);
}

export function externalStorageIdentity(storage) {
    if (storage?.kind !== 'r2' || !storage.isConfigured || !storage.endpoint || !storage.bucketName) {
        throw new Error('External backup requires the configured R2 provider; local fallback is forbidden.');
    }
    const prefix = resolveR2ObjectPrefix({ R2_OBJECT_PREFIX: storage.objectPrefix }, true);
    const endpoint = new URL(storage.endpoint);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
        || endpoint.pathname !== '/' || !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/i.test(endpoint.hostname)) {
        throw new Error('External backup requires a trusted R2 account endpoint.');
    }
    return { provider: 'r2', endpoint: endpoint.origin, bucket: storage.bucketName, prefix };
}

function validateEntry(entry) {
    if (typeof entry?.key !== 'string' || !entry.key.startsWith('games/')
        || /[\\\x00-\x1f\x7f]/.test(entry.key)
        || entry.key.split('/').some(part => !part || part === '.' || part === '..')
        || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0
        || typeof entry.etag !== 'string' || !entry.etag) {
        throw new Error('External backup inventory contains an invalid object.');
    }
}

async function verifyRemoteObject(storage, entry) {
    validateEntry(entry);
    const metadata = await storage.getObjectMetadata(entry.key);
    if (metadata.contentLength !== entry.sizeBytes || metadata.etag !== entry.etag) {
        throw new Error(`External backup object changed: ${entry.key}`);
    }
    // HEAD alone does not establish read permission. Read at most one byte;
    // do not download large assets during backup/verification on the tiny VM.
    const stream = await storage.getDownloadStream(entry.key, entry.sizeBytes ? { start: 0, end: 0 } : {});
    let bytes = 0;
    try {
        for await (const chunk of stream) {
            bytes += chunk.length;
            if (bytes > Math.min(entry.sizeBytes, 1)) throw new Error('R2 ignored the bounded verification range.');
        }
        if (bytes !== Math.min(entry.sizeBytes, 1)) throw new Error(`External backup object is unreadable: ${entry.key}`);
    } finally { stream.destroy?.(); }
}

export async function createExternalInventory(storage, databasePath) {
    const identity = externalStorageIdentity(storage);
    const objects = await storage.listObjects('games/');
    const inventory = {
        storage: identity,
        remoteObjectsIncluded: false,
        count: objects.length,
        totalBytes: objects.reduce((total, object) => total + object.size, 0),
        files: objects.map(object => ({ key: object.key, sizeBytes: object.size, etag: object.etag }))
            .sort((a, b) => a.key.localeCompare(b.key))
    };
    await verifyExternalInventory(storage, databasePath, inventory);
    return inventory;
}

export async function verifyExternalInventory(storage, databasePath, inventory) {
    const identity = externalStorageIdentity(storage);
    if (!inventory || inventory.remoteObjectsIncluded !== false
        || Object.entries(identity).some(([key, value]) => inventory.storage?.[key] !== value)
        || !Array.isArray(inventory.files)) {
        throw new Error('External backup storage binding does not match the configured R2 bucket/prefix.');
    }
    const seen = new Set();
    let totalBytes = 0;
    for (const entry of inventory.files) {
        validateEntry(entry);
        if (seen.has(entry.key)) throw new Error('External backup inventory contains a duplicate object.');
        seen.add(entry.key);
        totalBytes += entry.sizeBytes;
        if (!Number.isSafeInteger(totalBytes)) throw new Error('External backup inventory byte total is invalid.');
        await verifyRemoteObject(storage, entry);
    }
    if (seen.size !== inventory.count || totalBytes !== inventory.totalBytes) {
        throw new Error('External backup inventory totals do not match.');
    }
    const integrity = await checkSqliteStorageIntegrity(databasePath, storage);
    if (integrity.status !== 'PASS') throw new Error(`External backup storage integrity failed (${integrity.counts.missingOrInvalid} issue(s)).`);
    return { count: seen.size, totalBytes, remoteObjectsIncluded: false, storage: identity };
}

export function readOnlyExternalStorage(storage) {
    externalStorageIdentity(storage);
    const readonly = { kind: storage.kind, isConfigured: storage.isConfigured, directDownloadsEnabled: false };
    for (const method of ['ping', 'getObjectMetadata', 'getDownloadStream', 'listObjects']) {
        readonly[method] = storage[method].bind(storage);
    }
    for (const method of ['createUploadSession', 'createDownloadUrl', 'uploadBuffer', 'deleteObject', 'deletePrefix']) {
        readonly[method] = async () => { throw new Error('Restore rehearsal cannot mutate or issue access to production storage.'); };
    }
    return Object.freeze(readonly);
}
