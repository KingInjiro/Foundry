import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkReleaseCompatibility } from '../../../scripts/single-host-doctor.mjs';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';

const roots = [];

afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function releaseProfile(root, maximumDatabaseMigration) {
    const release = path.join(root, `release-${maximumDatabaseMigration}`);
    const dist = path.join(release, 'apps', 'platform', 'dist');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'server-profile.json'), JSON.stringify({
        schemaVersion: 1,
        service: 'foundry-platform',
        minimumDatabaseMigration: 4,
        maximumDatabaseMigration,
        migrations: []
    }));
    return release;
}

describe('single-host application rollback guard', () => {
    it('rejects pre-R2 target code before its legacy doctor can approve a rollback', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-r2-rollback-'));
        roots.push(root);
        const databasePath = path.join(root, 'platform.db');
        const database = new LocalSqliteProvider(databasePath);
        await database.close();
        const release = releaseProfile(root, 9);
        const clientDirectory = path.join(release, 'apps/platform/dist/client');
        fs.mkdirSync(clientDirectory);
        const profilePath = path.join(clientDirectory, 'deployment-profile.json');
        const profile = { schemaVersion: 2, deploymentMode: 'single-host', authProvider: 'local', storageProvider: 'local-disk' };
        fs.writeFileSync(profilePath, JSON.stringify(profile));
        const scripts = path.join(release, 'apps/platform/scripts');
        fs.mkdirSync(scripts);
        const marker = path.join(root, 'old-doctor-ran');
        fs.writeFileSync(path.join(scripts, 'single-host-doctor.mjs'), 'import fs from "node:fs"; fs.writeFileSync(process.env.FOUNDRY_TEST_DOCTOR_MARKER, "PASS");');
        const common = fileURLToPath(new URL('../../../../../deploy/single-host/common.sh', import.meta.url));
        const run = provider => spawnSync('bash', ['-c', 'source "$1"; foundry_run_as_service() { "$@"; }; foundry_check_release_compatibility "$2"', 'guard-test', common, release], {
            encoding: 'utf8', env: { ...process.env, FOUNDRY_STORAGE_PROVIDER: provider, PLATFORM_DB_PATH: databasePath, FOUNDRY_TEST_DOCTOR_MARKER: marker }
        });
        expect(() => checkReleaseCompatibility(release, databasePath, { FOUNDRY_STORAGE_PROVIDER: 'r2' })).toThrow('does not support single-host R2');
        const denied = run('r2');
        expect(denied.status).not.toBe(0);
        expect(denied.stderr).toContain('does not support single-host R2');
        expect(fs.existsSync(marker)).toBe(false);
        expect(run('local-disk').status).toBe(0);
        fs.rmSync(marker);
        fs.writeFileSync(profilePath, JSON.stringify({ ...profile, supportedStorageProviders: ['local-disk', 'r2'] }));
        expect(checkReleaseCompatibility(release, databasePath, { FOUNDRY_STORAGE_PROVIDER: 'r2' }).status).toBe('PASS');
        expect(run('r2').status).toBe(0);
        expect(fs.readFileSync(marker, 'utf8')).toBe('PASS');
    });

    it('allows a release that supports the current migration and rejects an unsafe downgrade', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-doctor-'));
        roots.push(root);
        const databasePath = path.join(root, 'platform.db');
        const database = new LocalSqliteProvider(databasePath);
        await database.close();

        expect(checkReleaseCompatibility(releaseProfile(root, 9), databasePath)).toMatchObject({
            status: 'PASS',
            currentDatabaseMigration: 9,
            releaseMaximumDatabaseMigration: 9
        });
        expect(() => checkReleaseCompatibility(releaseProfile(root, 8), databasePath))
            .toThrow('Rollback is unsafe');
    });
});
