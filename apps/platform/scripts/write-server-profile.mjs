import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_MIGRATIONS } from '../src/platform/backend/database/SqliteMigrationRunner.js';

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versions = PLATFORM_MIGRATIONS.map(migration => migration.version).sort((a, b) => a - b);
if (!versions.length) throw new Error('No Platform database migrations are defined.');
const profile = {
    schemaVersion: 1,
    service: 'foundry-platform',
    minimumDatabaseMigration: versions[0],
    maximumDatabaseMigration: versions.at(-1),
    migrations: PLATFORM_MIGRATIONS.map(({ version, name }) => ({ version, name }))
};
const output = path.join(platformRoot, 'dist', 'server-profile.json');
fs.writeFileSync(output, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o644 });
