import { describe, expect, it } from 'vitest';
import { createDeploymentProfile, validateFirebaseClientBuildConfig } from '../../../vite.config.js';

describe('Firebase client production build configuration', () => {
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
            storageProvider: 'local-disk'
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
