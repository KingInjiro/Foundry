import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

describe('runtime upload limits API', () => {
    let app;
    let db;

    beforeEach(async () => {
        vi.resetModules();
        vi.stubEnv('FOUNDRY_DEPLOYMENT_MODE', 'cloud');
        vi.stubEnv('PLATFORM_MAX_PACKAGE_SIZE_BYTES', '2147483648');
        vi.stubEnv('PLATFORM_MAX_FILE_SIZE_BYTES', '2147483648');
        vi.stubEnv('PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES', '4294967296');
        vi.stubEnv('PLATFORM_MAX_FILES_PER_PACKAGE', '1234');
        vi.stubEnv('PLATFORM_MAX_EXTRACTED_FILES_PER_PACKAGE', '2345');
        const { createApp } = await import('../../../src/platform/backend/server/app.js');
        const { LocalSqliteProvider } = await import('../../../src/platform/backend/database/LocalSqliteProvider.js');
        db = new LocalSqliteProvider(':memory:');
        app = createApp(db, { isConfigured: true }, { registerHandler() {} });
    });

    afterEach(async () => {
        await db?.close();
        vi.unstubAllEnvs();
    });

    it('returns the running process quotas with no caching and no client build dependency', async () => {
        const response = await request(app).get('/api/config/upload-limits');
        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.body).toEqual({ success: true, data: {
            maxPackageSizeBytes: 2147483648,
            maxFileSizeBytes: 2147483648,
            maxTotalExtractedSizeBytes: 4294967296,
            maxFilesPerPackage: 1234,
            maxExtractedFilesPerPackage: 2345
        } });
        // Quotas are resolved when the process starts, not an unvalidated env dump.
        vi.stubEnv('PLATFORM_MAX_PACKAGE_SIZE_BYTES', 'not-a-number');
        expect((await request(app).get('/api/config/upload-limits')).body).toEqual(response.body);
    });

    it('exposes only the public numeric allowlist, never credentials or runtime paths', async () => {
        for (const name of ['R2_SECRET_ACCESS_KEY', 'R2_ACCESS_KEY_ID', 'R2_ENDPOINT', 'LOCAL_AUTH_SESSION_SECRET', 'PLATFORM_DB_PATH']) {
            vi.stubEnv(name, `private-${name}`);
        }
        const response = await request(app).get('/api/config/upload-limits');
        expect(response.status).toBe(200);
        expect(Object.keys(response.body).sort()).toEqual(['data', 'success']);
        expect(Object.keys(response.body.data).sort()).toEqual([
            'maxExtractedFilesPerPackage', 'maxFileSizeBytes', 'maxFilesPerPackage', 'maxPackageSizeBytes', 'maxTotalExtractedSizeBytes'
        ]);
        expect(Object.values(response.body.data).every(value => Number.isSafeInteger(value) && value >= 0)).toBe(true);
        expect(response.text).not.toContain('private-');
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
});
