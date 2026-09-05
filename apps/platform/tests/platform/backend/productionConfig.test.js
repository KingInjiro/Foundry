import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateProductionConfiguration } from '../../../src/platform/backend/config/productionConfig.js';

const tempDirectories = [];

function validProductionEnv(overrides = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-production-config-'));
    tempDirectories.push(directory);
    const credentialsPath = path.join(directory, 'firebase.json');
    const clientBuildProfile = path.join(directory, 'deployment-profile.json');
    fs.writeFileSync(credentialsPath, '{}');
    fs.writeFileSync(clientBuildProfile, JSON.stringify({
        schemaVersion: 2,
        deploymentMode: 'cloud',
        authProvider: 'firebase',
        storageProvider: 'r2',
        firebaseProjectId: 'foundry-staging-123',
        firebaseAuthDomain: 'foundry-staging.firebaseapp.com'
    }));
    return {
        NODE_ENV: 'production',
        FOUNDRY_DEPLOYMENT_MODE: 'cloud',
        PLATFORM_PUBLIC_BASE_URL: 'https://staging.foundry.example',
        PLATFORM_DB_PATH: path.join(directory, 'platform.db'),
        FIREBASE_PROJECT_ID: 'foundry-staging-123',
        PLATFORM_CLIENT_BUILD_PROFILE: clientBuildProfile,
        GOOGLE_APPLICATION_CREDENTIALS: credentialsPath,
        FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS: 'false',
        R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
        R2_ACCESS_KEY_ID: 'access-key',
        R2_SECRET_ACCESS_KEY: 'super-secret-value',
        R2_BUCKET_NAME: 'foundry-staging',
        R2_ENDPOINT: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
        R2_DIRECT_DOWNLOADS: 'false',
        R2_UPLOAD_URL_TTL_SECONDS: '900',
        R2_DOWNLOAD_URL_TTL_SECONDS: '120',
        PORT: '3000',
        JOB_MODE: 'async',
        JOB_LEASE_MS: '60000',
        MAX_JOB_ATTEMPTS: '3',
        UPLOAD_CLEANUP_INTERVAL_MS: '900000',
        TRUST_PROXY_HOPS: '1',
        ENABLE_HSTS: 'true',
        ALLOW_UNREADY_STARTUP: 'false',
        SHUTDOWN_GRACE_MS: '30000',
        LOG_LEVEL: 'info',
        ...overrides
    };
}

function validSingleHostEnv(overrides = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-single-host-config-'));
    tempDirectories.push(directory);
    const dataDirectory = path.join(directory, 'data');
    const objects = path.join(dataDirectory, 'objects');
    const backups = path.join(dataDirectory, 'backups');
    fs.mkdirSync(objects, { recursive: true });
    fs.mkdirSync(backups, { recursive: true });
    const clientBuildProfile = path.join(directory, 'deployment-profile.json');
    fs.writeFileSync(clientBuildProfile, JSON.stringify({
        schemaVersion: 2,
        deploymentMode: 'single-host',
        authProvider: 'local',
        storageProvider: 'local-disk'
    }));
    return {
        NODE_ENV: 'production',
        FOUNDRY_DEPLOYMENT_MODE: 'single-host',
        PLATFORM_PUBLIC_BASE_URL: 'https://foundry.example.test',
        PLATFORM_CLIENT_BUILD_PROFILE: clientBuildProfile,
        FOUNDRY_DATA_DIR: dataDirectory,
        PLATFORM_DB_PATH: path.join(dataDirectory, 'platform.db'),
        HOST: '127.0.0.1',
        PORT: '3000',
        JOB_MODE: 'async',
        JOB_LEASE_MS: '60000',
        MAX_JOB_ATTEMPTS: '3',
        UPLOAD_CLEANUP_INTERVAL_MS: '900000',
        TRUST_PROXY_HOPS: '1',
        ENABLE_HSTS: 'true',
        ALLOW_UNREADY_STARTUP: 'false',
        SHUTDOWN_GRACE_MS: '30000',
        LOG_LEVEL: 'info',
        LOCAL_AUTH_SESSION_SECRET: 'session-secret-with-at-least-32-bytes-aaaaaaaa',
        LOCAL_STORAGE_SIGNING_SECRET: 'storage-secret-with-at-least-32-bytes-bbbbbbbb',
        LOCAL_AUTH_SESSION_TTL_SECONDS: '604800',
        LOCAL_STORAGE_UPLOAD_URL_TTL_SECONDS: '900',
        SINGLE_HOST_ALLOW_EXTERNAL_DB_PATH: 'false',
        CORS_ALLOWED_ORIGINS: '',
        ...overrides
    };
}

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('production configuration', () => {
    it('accepts a complete fail-closed single-node profile', () => {
        const result = validateProductionConfiguration(validProductionEnv());
        expect(result).toMatchObject({
            production: true,
            publicBaseUrl: 'https://staging.foundry.example',
            trustProxyHops: 1,
            hstsEnabled: true,
            jobMode: 'async',
            uploadUrlTtlSeconds: 900
        });
    });

    it('accepts deliberate workload identity without a credential file', () => {
        const env = validProductionEnv({
            GOOGLE_APPLICATION_CREDENTIALS: '',
            FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS: 'true'
        });
        expect(validateProductionConfiguration(env).firebaseProjectId).toBe('foundry-staging-123');
    });

    it('rejects a client bundle built for a different Firebase project', () => {
        const env = validProductionEnv();
        fs.writeFileSync(env.PLATFORM_CLIENT_BUILD_PROFILE, JSON.stringify({
            schemaVersion: 2,
            deploymentMode: 'cloud',
            authProvider: 'firebase',
            storageProvider: 'r2',
            firebaseProjectId: 'different-project',
            firebaseAuthDomain: 'different.firebaseapp.com'
        }));
        expect(() => validateProductionConfiguration(env)).toThrow('built Firebase client project');
    });

    it('accepts a fail-closed single-host profile without Firebase or R2', () => {
        const result = validateProductionConfiguration(validSingleHostEnv({ PLATFORM_DB_PATH: '' }));
        expect(result).toMatchObject({
            production: true,
            deploymentMode: 'single-host',
            authProvider: 'local',
            storageProvider: 'local-disk',
            databasePath: path.join(result.dataDirectory, 'platform.db'),
            objectStoragePath: path.join(result.dataDirectory, 'objects'),
            backupPath: path.join(result.dataDirectory, 'backups'),
            firebaseProjectId: null,
            r2Endpoint: null,
            localAuthSessionTtlSeconds: 604800
        });
    });

    it.each([
        ['missing data root', { FOUNDRY_DATA_DIR: '' }, 'FOUNDRY_DATA_DIR'],
        ['relative data root', { FOUNDRY_DATA_DIR: 'relative/data' }, 'absolute non-root'],
        ['missing session secret', { LOCAL_AUTH_SESSION_SECRET: '' }, 'LOCAL_AUTH_SESSION_SECRET'],
        ['shared auth/storage secret', {
            LOCAL_AUTH_SESSION_SECRET: 'same-secret-with-at-least-32-bytes-aaaaaaaa',
            LOCAL_STORAGE_SIGNING_SECRET: 'same-secret-with-at-least-32-bytes-aaaaaaaa'
        }, 'must be distinct'],
        ['public Node listener', { HOST: '0.0.0.0' }, 'loopback'],
        ['cross-origin cookie API', { CORS_ALLOWED_ORIGINS: 'https://other.example.test' }, 'same-origin only']
    ])('rejects single-host %s', (_label, overrides, expected) => {
        expect(() => validateProductionConfiguration(validSingleHostEnv(overrides))).toThrow(expected);
    });

    it('requires an explicit override before placing SQLite outside the single-host data root', () => {
        const env = validSingleHostEnv();
        env.PLATFORM_DB_PATH = path.join(path.dirname(env.FOUNDRY_DATA_DIR), 'external.db');
        expect(() => validateProductionConfiguration(env)).toThrow('must stay inside FOUNDRY_DATA_DIR');
        expect(validateProductionConfiguration({ ...env, SINGLE_HOST_ALLOW_EXTERNAL_DB_PATH: 'true' }).databasePath)
            .toBe(env.PLATFORM_DB_PATH);
    });

    it('rejects a cloud browser profile in single-host runtime mode', () => {
        const env = validSingleHostEnv();
        fs.writeFileSync(env.PLATFORM_CLIENT_BUILD_PROFILE, JSON.stringify({
            schemaVersion: 2,
            deploymentMode: 'cloud',
            authProvider: 'firebase',
            storageProvider: 'r2',
            firebaseProjectId: 'foundry-staging-123',
            firebaseAuthDomain: 'foundry-staging.firebaseapp.com'
        }));
        expect(() => validateProductionConfiguration(env)).toThrow('does not match FOUNDRY_DEPLOYMENT_MODE');
    });

    it('rejects missing cloud, database, and Firebase configuration without echoing secrets', () => {
        const secret = 'must-never-appear-in-errors';
        let caught;
        try {
            validateProductionConfiguration({ NODE_ENV: 'production', R2_SECRET_ACCESS_KEY: secret });
        } catch (error) {
            caught = error;
        }
        expect(caught).toMatchObject({ code: 'INVALID_PRODUCTION_CONFIGURATION' });
        expect(caught.message).toContain('PLATFORM_DB_PATH');
        expect(caught.message).toContain('FIREBASE_PROJECT_ID');
        expect(caught.message).toContain('R2_ACCOUNT_ID');
        expect(caught.message).not.toContain(secret);
    });

    it.each([
        ['relative database', { PLATFORM_DB_PATH: '.data/platform.db' }, 'absolute non-root'],
        ['inline jobs', { JOB_MODE: 'inline' }, 'JOB_MODE must be async'],
        ['readiness bypass', { ALLOW_UNREADY_STARTUP: 'true' }, 'cannot be enabled'],
        ['unrevocable signed downloads', { R2_DIRECT_DOWNLOADS: 'true' }, 'must remain false'],
        ['untrusted R2 endpoint', { R2_ENDPOINT: 'https://storage.example.com' }, 'account endpoint'],
        ['unsafe public URL', { PLATFORM_PUBLIC_BASE_URL: 'http://staging.example.com' }, 'HTTPS URL'],
        ['implicit proxy depth', { TRUST_PROXY_HOPS: '' }, 'must be set explicitly'],
        ['invalid proxy depth', { TRUST_PROXY_HOPS: '10' }, 'TRUST_PROXY_HOPS']
    ])('rejects %s', (_label, overrides, expected) => {
        expect(() => validateProductionConfiguration(validProductionEnv(overrides))).toThrow(expected);
    });

    it('rejects inconsistent or unsafe production limits', () => {
        expect(() => validateProductionConfiguration(validProductionEnv({
            PLATFORM_MAX_STORAGE_BYTES_PER_USER: '1048576',
            PLATFORM_MAX_PACKAGE_SIZE_BYTES: '2097152'
        }))).toThrow('cannot exceed');
        expect(() => validateProductionConfiguration(validProductionEnv({
            PLATFORM_MAX_FILES_PER_PACKAGE: 'not-a-number'
        }))).toThrow('PLATFORM_MAX_FILES_PER_PACKAGE');
    });

    it('keeps non-production defaults safe and still validates security booleans', () => {
        expect(validateProductionConfiguration({ NODE_ENV: 'test' })).toEqual({
            production: false,
            deploymentMode: 'cloud',
            trustProxyHops: 0,
            shutdownGraceMs: 30000,
            hstsEnabled: false
        });
        expect(() => validateProductionConfiguration({ NODE_ENV: 'test', ENABLE_HSTS: 'yes' })).toThrow('ENABLE_HSTS');
    });
});
