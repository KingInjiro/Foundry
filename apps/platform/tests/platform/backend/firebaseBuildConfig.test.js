import { describe, expect, it } from 'vitest';
import { createDeploymentProfile, validateFirebaseClientBuildConfig } from '../../../vite.config.js';
import { profileSupportsStorage } from '../../../src/platform/backend/config/storageConfig.js';
import { r2TestEnvironment } from '../../helpers/r2TestEnvironment.mjs';

describe('Firebase client production build configuration', () => {
    it('advertises runtime storage capabilities without embedding R2 server configuration', () => {
        const serverEnv = r2TestEnvironment();
        const profile = createDeploymentProfile({ ...serverEnv, FOUNDRY_DEPLOYMENT_MODE: 'single-host', FOUNDRY_STORAGE_PROVIDER: 'r2' }, 'production');
        expect(profile).toEqual({ schemaVersion: 2, deploymentMode: 'single-host', authProvider: 'local', storageProvider: 'r2', supportedStorageProviders: ['local-disk', 'r2'] });
        for (const value of [serverEnv.R2_ACCOUNT_ID, serverEnv.R2_ACCESS_KEY_ID, serverEnv.R2_SECRET_ACCESS_KEY, serverEnv.R2_ENDPOINT]) {
            expect(JSON.stringify(profile)).not.toContain(value);
        }
        expect(profileSupportsStorage(profile, 'single-host', 'local-disk')).toBe(true);
        expect(profileSupportsStorage(profile, 'single-host', 'r2')).toBe(true);
        expect(profileSupportsStorage({ ...profile, supportedStorageProviders: ['r2', 'anything'] }, 'single-host', 'r2')).toBe(false);
        expect(profileSupportsStorage({ ...profile, supportedStorageProviders: ['r2', 'r2'] }, 'single-host', 'r2')).toBe(false);
        expect(profileSupportsStorage({ ...profile, firebaseProjectId: 'cloud-project' }, 'single-host', 'r2')).toBe(false);
    });

    const valid = {
        FOUNDRY_DEPLOYMENT_MODE: 'cloud',
        VITE_FIREBASE_API_KEY: 'public-key',
        VITE_FIREBASE_AUTH_DOMAIN: 'foundry-staging.firebaseapp.com',
        VITE_FIREBASE_PROJECT_ID: 'foundry-staging-123',
        VITE_FIREBASE_APP_ID: '1:123:web:abc'
    };

    it('requires an explicit production Firebase project', () => {
        expect(() => validateFirebaseClientBuildConfig({}, 'production')).toThrow('FOUNDRY_DEPLOYMENT_MODE');
        expect(() => validateFirebaseClientBuildConfig({ FOUNDRY_DEPLOYMENT_MODE: 'cloud' }, 'production')).toThrow('VITE_FIREBASE_API_KEY');
        expect(() => validateFirebaseClientBuildConfig(valid, 'production')).not.toThrow();
    });

    it('does not require Firebase browser configuration for a single-host production build', () => {
        const env = { FOUNDRY_DEPLOYMENT_MODE: 'single-host' };
        expect(() => validateFirebaseClientBuildConfig(env, 'production')).not.toThrow();
        expect(createDeploymentProfile(env, 'production')).toEqual({
            schemaVersion: 2,
            deploymentMode: 'single-host',
            authProvider: 'local',
            storageProvider: 'local-disk',
            supportedStorageProviders: ['local-disk', 'r2']
        });
    });

    it('rejects malformed auth domains and project IDs', () => {
        expect(() => validateFirebaseClientBuildConfig({ ...valid, VITE_FIREBASE_AUTH_DOMAIN: 'https://bad.example' }, 'production')).toThrow('AUTH_DOMAIN');
        expect(() => validateFirebaseClientBuildConfig({ ...valid, VITE_FIREBASE_PROJECT_ID: '../bad' }, 'production')).toThrow('PROJECT_ID');
    });

    it('does not require deployment credentials for development/test transforms', () => {
        expect(() => validateFirebaseClientBuildConfig({}, 'test')).not.toThrow();
    });

    it('emits only non-secret environment identity into the build profile', () => {
        expect(createDeploymentProfile(valid, 'production')).toEqual({
            schemaVersion: 2,
            deploymentMode: 'cloud',
            authProvider: 'firebase',
            storageProvider: 'r2',
            firebaseProjectId: 'foundry-staging-123',
            firebaseAuthDomain: 'foundry-staging.firebaseapp.com'
        });
        expect(createDeploymentProfile(valid, 'production')).not.toHaveProperty('VITE_FIREBASE_API_KEY');
    });
});
