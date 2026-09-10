import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';
import { SqliteMigrationRunner } from '../../../src/platform/backend/database/SqliteMigrationRunner.js';

const tempDirectories = [];

function columnNames(db, table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name).sort();
}

afterEach(async () => {
    await Promise.all(tempDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('versioned SQLite migrations', () => {
    it('records an auditable final schema on a fresh database', async () => {
        const provider = new LocalSqliteProvider(':memory:');
        const migrations = provider.db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all();
        const tables = provider.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);

        expect(migrations).toEqual([
            { version: 4, name: 'release_and_job_integrity' },
            { version: 5, name: 'editor_platform_projects' },
            { version: 6, name: 'moderation_foundation' },
            { version: 7, name: 'moderation_operations_audit' },
            { version: 8, name: 'local_production_auth' },
            { version: 9, name: 'single_host_google_identities' }
        ]);
        expect(tables).toEqual(expect.arrayContaining([
            'editor_projects',
            'game_reports',
            'moderation_actions',
            'local_auth_credentials',
            'local_auth_sessions',
            'external_auth_identities'
        ]));
        expect(columnNames(provider.db, 'games')).toContain('moderationState');
        expect(columnNames(provider.db, 'game_reports')).toEqual(expect.arrayContaining(['resolvedByUid', 'resolution', 'updatedAt']));
        await provider.close();
    });

    it('upgrades a legacy database without losing rows and reaches the fresh schema shape', async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'foundry-migration-'));
        tempDirectories.push(directory);
        const databasePath = path.join(directory, 'platform.db');
        const legacy = new DatabaseSync(databasePath);
        legacy.exec(`
            CREATE TABLE users (uid TEXT PRIMARY KEY, email TEXT, displayName TEXT, avatarUrl TEXT, role TEXT, createdAt INTEGER, updatedAt INTEGER);
            CREATE TABLE games (id TEXT PRIMARY KEY, ownerUid TEXT, title TEXT, description TEXT, storageMode TEXT, currentState TEXT, createdAt INTEGER, updatedAt INTEGER);
            CREATE TABLE game_versions (id TEXT PRIMARY KEY, gameId TEXT, version TEXT, runtime TEXT, format TEXT, entry TEXT, status TEXT, createdAt INTEGER);
            CREATE TABLE upload_sessions (id TEXT PRIMARY KEY, ownerUid TEXT, gameId TEXT, versionId TEXT, storageProvider TEXT, objectKey TEXT, expectedSize INTEGER, expectedContentType TEXT, status TEXT, expiresAt INTEGER, createdAt INTEGER);
            CREATE TABLE jobs (id TEXT PRIMARY KEY, type TEXT, targetId TEXT, payload TEXT, status TEXT, attempts INTEGER DEFAULT 0, error TEXT, createdAt INTEGER, updatedAt INTEGER, startedAt INTEGER, completedAt INTEGER);
            INSERT INTO games (id, ownerUid, title) VALUES ('legacy-game', 'legacy-owner', 'Legacy');
        `);
        legacy.close();

        const upgraded = new LocalSqliteProvider(databasePath);
        const fresh = new LocalSqliteProvider(':memory:');

        expect((await upgraded.getGame('legacy-game')).title).toBe('Legacy');
        for (const table of ['games', 'game_versions', 'upload_sessions', 'jobs', 'editor_projects', 'game_reports', 'moderation_actions', 'local_auth_credentials', 'local_auth_sessions', 'external_auth_identities']) {
            expect(columnNames(upgraded.db, table)).toEqual(columnNames(fresh.db, table));
        }
        expect(upgraded.db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count).toBe(6);

        await upgraded.close();
        await fresh.close();
    });

    it('does not mark a failed migration as applied and rolls back its writes', () => {
        const db = new DatabaseSync(':memory:');
        const runner = new SqliteMigrationRunner(db, [{
            version: 99,
            name: 'intentional_failure',
            up(database) {
                database.exec('CREATE TABLE should_rollback (id TEXT)');
                throw new Error('boom');
            }
        }]);

        expect(() => runner.run()).toThrow(/migration 99/);
        expect(db.prepare('SELECT version FROM schema_migrations WHERE version = 99').get()).toBeUndefined();
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'").get()).toBeUndefined();
        db.close();
    });
});
