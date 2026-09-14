import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProductionProviders } from '../../../src/platform/backend/config/productionProviders.js';
import { r2TestEnvironment } from '../../helpers/r2TestEnvironment.mjs';

const roots = [];
const originalR2 = {};

afterEach(async () => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
    for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_ENDPOINT']) {
        if (Object.hasOwn(originalR2, key)) process.env[key] = originalR2[key];
        else delete process.env[key];
    }
});

describe('production provider selection', () => {
    it('selects configured R2 from explicit env in single-host and produces an expiring S3 upload, not a local route', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-hybrid-provider-'));
        roots.push(root);
        const env = r2TestEnvironment();
        const providers = createProductionProviders({ deploymentMode: 'single-host', storageProvider: 'r2', databasePath: path.join(root, 'platform.db') }, env);
        try {
            expect(providers.storage.kind).toBe('r2');
            expect(providers.storage.uploadRoute).toBeUndefined();
            const { uploadUrl } = await providers.storage.createUploadSession('games/one/versions/two/package.zip');
            const url = new URL(uploadUrl);
            expect(url.protocol).toBe('https:');
            expect(url.hostname).toContain(env.R2_ACCOUNT_ID);
            expect(url.pathname).toContain('/games/one/versions/two/package.zip');
            expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
            expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');
            expect(providers.storage.directDownloadsEnabled).toBe(false);
            await providers.database.ping();
        } finally {
            await providers.database.close();
            providers.storage.client.destroy();
        }
    });

    it('fails before opening SQLite when explicit R2 is incomplete; never falls back to disk', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-hybrid-provider-'));
        roots.push(root);
        const dbPath = path.join(root, 'platform.db');
        expect(() => createProductionProviders({ deploymentMode: 'single-host', storageProvider: 'r2', databasePath: dbPath }, {})).toThrow('Selected R2 storage is not configured');
        expect(fs.existsSync(dbPath)).toBe(false);
    });

    it('constructs SQLite plus signed local-disk storage for single-host mode', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-production-provider-'));
        roots.push(root);
        const objects = path.join(root, 'objects');
        fs.mkdirSync(objects);
        const providers = createProductionProviders({
            deploymentMode: 'single-host',
            databasePath: path.join(root, 'platform.db'),
            objectStoragePath: objects,
            localStorageUploadUrlTtlSeconds: 600,
            publicBaseUrl: 'https://foundry.example.test'
        }, { LOCAL_STORAGE_SIGNING_SECRET: 'local-storage-secret-more-than-thirty-two-bytes' });
        expect(providers.storage.kind).toBe('local-disk');
        expect(providers.storage.uploadSigningSecret).toBeTruthy();
        expect((await providers.storage.createUploadSession('games/one/package.zip')).uploadUrl).toMatch(/^\/api\/storage\/upload\?/);
        await providers.database.close();
    });

    it('preserves SQLite plus configured R2 for cloud mode', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-production-provider-'));
        roots.push(root);
        const values = {
            R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
            R2_ACCESS_KEY_ID: 'access',
            R2_SECRET_ACCESS_KEY: 'secret',
            R2_BUCKET_NAME: 'foundry-cloud',
            R2_ENDPOINT: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com'
        };
        for (const [key, value] of Object.entries(values)) {
            if (process.env[key] !== undefined) originalR2[key] = process.env[key];
            process.env[key] = value;
        }
        const providers = createProductionProviders({
            deploymentMode: 'cloud',
            databasePath: path.join(root, 'platform.db')
        });
        expect(providers.storage.kind).toBe('r2');
        expect(providers.storage.isConfigured).toBe(true);
        expect(providers.storage.bucketName).toBe('foundry-cloud');
        await providers.database.close();
        providers.storage.client?.destroy();
    });
});
