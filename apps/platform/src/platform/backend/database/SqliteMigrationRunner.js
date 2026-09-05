function tableColumns(db, tableName) {
    return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map(column => column.name));
}

export function addColumnIfMissing(db, tableName, columnName, definition) {
    if (tableColumns(db, tableName).has(columnName)) return false;
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    return true;
}

export class SqliteMigrationRunner {
    constructor(db, migrations) {
        this.db = db;
        this.migrations = [...migrations].sort((a, b) => a.version - b.version);
    }

    run() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                appliedAt INTEGER NOT NULL
            )
        `);
        addColumnIfMissing(this.db, 'schema_migrations', 'name', "TEXT NOT NULL DEFAULT 'legacy'");

        const applied = new Set(this.db.prepare('SELECT version FROM schema_migrations').all().map(row => row.version));
        for (const migration of this.migrations) {
            if (applied.has(migration.version)) continue;

            this.db.exec('BEGIN IMMEDIATE');
            try {
                migration.up(this.db);
                this.db.prepare('INSERT INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, ?)')
                    .run(migration.version, migration.name, Date.now());
                this.db.exec('COMMIT');
            } catch (error) {
                this.db.exec('ROLLBACK');
                error.message = `SQLite migration ${migration.version} (${migration.name}) failed: ${error.message}`;
                throw error;
            }
        }
    }
}

export const PLATFORM_MIGRATIONS = Object.freeze([
    {
        version: 4,
        name: 'release_and_job_integrity',
        up(db) {
            const versionColumns = [
                ['runtimeUrl', 'TEXT'],
                ['streamingManifestPath', 'TEXT'],
                ['capabilities', "TEXT NOT NULL DEFAULT '[]'"],
                ['thumbnail', 'TEXT'],
                ['tags', "TEXT NOT NULL DEFAULT '[]'"],
                ['controls', "TEXT NOT NULL DEFAULT '[]'"],
                ['publishedAt', 'INTEGER'],
                ['packageSha256', 'TEXT'],
                ['publishError', 'TEXT'],
                ['publishAttempts', 'INTEGER DEFAULT 0'],
                ['extractedSizeBytes', 'INTEGER DEFAULT 0'],
                ['packageSizeBytes', 'INTEGER DEFAULT 0']
            ];
            for (const [column, definition] of versionColumns) {
                addColumnIfMissing(db, 'game_versions', column, definition);
            }
            for (const [column, definition] of [
                ['updatedAt', 'INTEGER'],
                ['completedAt', 'INTEGER'],
                ['packageSizeBytes', 'INTEGER DEFAULT 0']
            ]) {
                addColumnIfMissing(db, 'upload_sessions', column, definition);
            }
            addColumnIfMissing(db, 'jobs', 'workerId', 'TEXT');
            addColumnIfMissing(db, 'jobs', 'leaseExpiresAt', 'INTEGER');

            db.exec(`
                UPDATE game_versions AS current
                SET status = 'ARCHIVED'
                WHERE current.status = 'PUBLISHED'
                  AND EXISTS (
                    SELECT 1 FROM game_versions AS newer
                    WHERE newer.gameId = current.gameId
                      AND newer.status = 'PUBLISHED'
                      AND (
                        COALESCE(newer.publishedAt, newer.createdAt, 0) > COALESCE(current.publishedAt, current.createdAt, 0)
                        OR (
                          COALESCE(newer.publishedAt, newer.createdAt, 0) = COALESCE(current.publishedAt, current.createdAt, 0)
                          AND newer.id > current.id
                        )
                      )
                  );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_game_versions_one_active
                    ON game_versions (gameId) WHERE status = 'PUBLISHED';
                UPDATE jobs AS duplicate
                SET status = 'FAILED', error = 'Superseded duplicate active job during schema migration.',
                    completedAt = unixepoch('subsec') * 1000
                WHERE duplicate.status IN ('QUEUED', 'RUNNING', 'RETRYING')
                  AND EXISTS (
                    SELECT 1 FROM jobs AS keeper
                    WHERE keeper.type = duplicate.type
                      AND keeper.targetId = duplicate.targetId
                      AND keeper.status IN ('QUEUED', 'RUNNING', 'RETRYING')
                      AND (
                        COALESCE(keeper.createdAt, 0) < COALESCE(duplicate.createdAt, 0)
                        OR (COALESCE(keeper.createdAt, 0) = COALESCE(duplicate.createdAt, 0) AND keeper.id < duplicate.id)
                      )
                  );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_one_active_target
                    ON jobs (type, targetId) WHERE status IN ('QUEUED', 'RUNNING', 'RETRYING');
                CREATE INDEX IF NOT EXISTS idx_jobs_claim
                    ON jobs (status, leaseExpiresAt, createdAt);
            `);
        }
    },
    {
        version: 5,
        name: 'editor_platform_projects',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS editor_projects (
                    id TEXT PRIMARY KEY,
                    ownerUid TEXT NOT NULL,
                    title TEXT NOT NULL,
                    files TEXT NOT NULL,
                    platformGameId TEXT,
                    lastReadyVersionId TEXT,
                    createdAt INTEGER NOT NULL,
                    updatedAt INTEGER NOT NULL,
                    FOREIGN KEY (platformGameId) REFERENCES games(id) ON DELETE SET NULL,
                    FOREIGN KEY (lastReadyVersionId) REFERENCES game_versions(id) ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS idx_editor_projects_owner_updated
                    ON editor_projects (ownerUid, updatedAt DESC);
                CREATE INDEX IF NOT EXISTS idx_editor_projects_platform_game
                    ON editor_projects (platformGameId);
            `);
        }
    },
    {
        version: 6,
        name: 'moderation_foundation',
        up(db) {
            addColumnIfMissing(db, 'games', 'moderationState', "TEXT NOT NULL DEFAULT 'ACTIVE'");
            db.exec(`
                CREATE TABLE IF NOT EXISTS game_reports (
                    id TEXT PRIMARY KEY,
                    gameId TEXT NOT NULL,
                    reporterUid TEXT NOT NULL,
                    category TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'OPEN',
                    createdAt INTEGER NOT NULL,
                    resolvedAt INTEGER,
                    FOREIGN KEY (gameId) REFERENCES games(id) ON DELETE CASCADE,
                    FOREIGN KEY (reporterUid) REFERENCES users(uid) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_game_reports_game_status
                    ON game_reports (gameId, status, createdAt DESC);
                CREATE INDEX IF NOT EXISTS idx_game_reports_reporter_time
                    ON game_reports (reporterUid, createdAt DESC);
            `);
        }
    },
    {
        version: 7,
        name: 'moderation_operations_audit',
        up(db) {
            addColumnIfMissing(db, 'game_reports', 'resolvedByUid', 'TEXT');
            addColumnIfMissing(db, 'game_reports', 'resolution', 'TEXT');
            addColumnIfMissing(db, 'game_reports', 'updatedAt', 'INTEGER');
            db.exec(`
                UPDATE game_reports SET updatedAt = COALESCE(updatedAt, createdAt);
                CREATE TABLE IF NOT EXISTS moderation_actions (
                    id TEXT PRIMARY KEY,
                    gameId TEXT NOT NULL,
                    reportId TEXT,
                    operatorUid TEXT NOT NULL,
                    action TEXT NOT NULL,
                    previousState TEXT NOT NULL,
                    nextState TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    createdAt INTEGER NOT NULL,
                    FOREIGN KEY (gameId) REFERENCES games(id) ON DELETE CASCADE,
                    FOREIGN KEY (reportId) REFERENCES game_reports(id) ON DELETE SET NULL,
                    FOREIGN KEY (operatorUid) REFERENCES users(uid) ON DELETE RESTRICT
                );
                CREATE INDEX IF NOT EXISTS idx_moderation_actions_game_time
                    ON moderation_actions (gameId, createdAt DESC);
                CREATE INDEX IF NOT EXISTS idx_game_reports_status_time
                    ON game_reports (status, createdAt DESC);
            `);
        }
    },
    {
        version: 8,
        name: 'local_production_auth',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS local_auth_credentials (
                    uid TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    usernameNormalized TEXT NOT NULL UNIQUE,
                    passwordHash TEXT NOT NULL,
                    disabledAt INTEGER,
                    passwordChangedAt INTEGER NOT NULL,
                    createdAt INTEGER NOT NULL,
                    updatedAt INTEGER NOT NULL,
                    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_local_auth_username
                    ON local_auth_credentials (usernameNormalized);
                CREATE TABLE IF NOT EXISTS local_auth_sessions (
                    tokenHash TEXT PRIMARY KEY,
                    uid TEXT NOT NULL,
                    createdAt INTEGER NOT NULL,
                    expiresAt INTEGER NOT NULL,
                    lastSeenAt INTEGER NOT NULL,
                    revokedAt INTEGER,
                    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_local_auth_sessions_uid
                    ON local_auth_sessions (uid, expiresAt);
                CREATE INDEX IF NOT EXISTS idx_local_auth_sessions_expiry
                    ON local_auth_sessions (expiresAt, revokedAt);
            `);
        }
    }
]);
