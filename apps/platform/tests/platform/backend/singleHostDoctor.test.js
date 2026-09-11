import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
