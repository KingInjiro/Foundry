import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseProvider } from './DatabaseProvider.js';
import { PLATFORM_MIGRATIONS, SqliteMigrationRunner } from './SqliteMigrationRunner.js';

const GAME_VERSION_METADATA_FIELDS = new Set([
    'version',
    'runtime',
    'format',
    'entry',
    'status',
    'runtimeUrl',
    'streamingManifestPath',
    'capabilities',
    'thumbnail',
    'tags',
    'controls',
    'publishedAt',
    'packageSha256',
    'publishError',
    'extractedSizeBytes',
    'packageSizeBytes'
]);

const UPLOAD_SESSION_UPDATE_FIELDS = new Set([
    'status',
    'updatedAt',
    'completedAt',
    'packageSizeBytes'
]);

const CATALOG_SORT_SQL = Object.freeze({
    featured: 'publishedAt DESC, gameId ASC',
    newest: 'publishedAt DESC, gameId ASC',
    rating: 'rating DESC, ratingCount DESC, publishedAt DESC, gameId ASC',
    popular: 'playCount DESC, publishedAt DESC, gameId ASC',
    name: 'name COLLATE NOCASE ASC, gameId ASC'
});

function escapeLikePattern(value) {
    return String(value || '').replace(/[\\%_]/g, match => `\\${match}`);
}

export function configureSqliteConnection(database, dbPath) {
    database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (dbPath === ':memory:') return;

    // WAL mode is persistent in the database header. Reissuing the mode-change
    // pragma from an operator/doctor process while the service is writing can
    // fail even though the file is already correctly configured for WAL.
    const currentMode = database.prepare('PRAGMA journal_mode;').get()?.journal_mode;
    if (String(currentMode || '').toLowerCase() !== 'wal') {
        database.exec('PRAGMA journal_mode = WAL;');
    }
    database.exec('PRAGMA synchronous = NORMAL;');
}

export class LocalSqliteProvider extends DatabaseProvider {
    constructor(dbPath = '.data/platform.db') {
        super();
        this.transactionContext = new AsyncLocalStorage();
        this.transactionTail = Promise.resolve();
        this.closing = false;
        this.closed = false;
        const dir = path.dirname(dbPath); if (dir !== '.') { fs.mkdirSync(dir, { recursive: true }); } this.db = new DatabaseSync(dbPath);
        configureSqliteConnection(this.db, dbPath);
        this.init();
    }

        init() {
        // Run pragmas for safety? Not needed yet.
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                uid TEXT PRIMARY KEY,
                email TEXT,
                displayName TEXT,
                avatarUrl TEXT,
                role TEXT,
                createdAt INTEGER,
                updatedAt INTEGER
            );
            CREATE TABLE IF NOT EXISTS games (
                id TEXT PRIMARY KEY,
                ownerUid TEXT,
                title TEXT,
                description TEXT,
                storageMode TEXT,
                currentState TEXT,
                moderationState TEXT NOT NULL DEFAULT 'ACTIVE',
                createdAt INTEGER,
                updatedAt INTEGER
            );
            
            CREATE TABLE IF NOT EXISTS game_versions (
                id TEXT PRIMARY KEY,
                gameId TEXT,
                version TEXT,
                runtime TEXT,
                format TEXT,
                entry TEXT,
                status TEXT,
                createdAt INTEGER,
                runtimeUrl TEXT,
                streamingManifestPath TEXT,
                capabilities TEXT NOT NULL DEFAULT '[]',
                thumbnail TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                controls TEXT NOT NULL DEFAULT '[]',
                publishedAt INTEGER,
                packageSha256 TEXT,
                publishAttempts INTEGER DEFAULT 0,
                publishError TEXT,
                extractedSizeBytes INTEGER DEFAULT 0,
                packageSizeBytes INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS upload_sessions (
                id TEXT PRIMARY KEY,
                ownerUid TEXT,
                gameId TEXT,
                versionId TEXT,
                storageProvider TEXT,
                objectKey TEXT,
                expectedSize INTEGER,
                expectedContentType TEXT,
                status TEXT,
                expiresAt INTEGER,
                createdAt INTEGER,
                updatedAt INTEGER,
                completedAt INTEGER,
                packageSizeBytes INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                type TEXT,
                targetId TEXT,
                payload TEXT,
                status TEXT,
                attempts INTEGER DEFAULT 0,
                error TEXT,
                createdAt INTEGER,
                updatedAt INTEGER,
                startedAt INTEGER,
                completedAt INTEGER,
                workerId TEXT,
                leaseExpiresAt INTEGER
            );

            CREATE TABLE IF NOT EXISTS rate_limit_buckets (
                identity TEXT NOT NULL,
                operation TEXT NOT NULL,
                windowStart INTEGER NOT NULL,
                operationCount INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL,
                PRIMARY KEY (identity, operation)
            );

            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                appliedAt INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_library (
                userUid TEXT NOT NULL,
                gameId TEXT NOT NULL,
                addedAt INTEGER NOT NULL,
                PRIMARY KEY (userUid, gameId)
            );
            CREATE TABLE IF NOT EXISTS game_ratings (
                userUid TEXT NOT NULL,
                gameId TEXT NOT NULL,
                rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL,
                PRIMARY KEY (userUid, gameId)
            );
            CREATE TABLE IF NOT EXISTS developer_follows (
                followerUid TEXT NOT NULL,
                developerUid TEXT NOT NULL,
                createdAt INTEGER NOT NULL,
                PRIMARY KEY (followerUid, developerUid)
            );
            CREATE TABLE IF NOT EXISTS discovery_events (
                id TEXT PRIMARY KEY,
                sessionId TEXT NOT NULL,
                userUid TEXT,
                gameId TEXT NOT NULL,
                eventType TEXT NOT NULL,
                durationMs INTEGER DEFAULT 0,
                createdAt INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS continue_playing_dismissals (
                userUid TEXT NOT NULL,
                gameId TEXT NOT NULL,
                dismissedAt INTEGER NOT NULL,
                PRIMARY KEY (userUid, gameId)
            );
            CREATE INDEX IF NOT EXISTS idx_discovery_events_game_type_time
                ON discovery_events (gameId, eventType, createdAt);
            CREATE INDEX IF NOT EXISTS idx_discovery_events_user_time
                ON discovery_events (userUid, createdAt);
            CREATE INDEX IF NOT EXISTS idx_library_user
                ON user_library (userUid, addedAt);
            CREATE INDEX IF NOT EXISTS idx_ratings_game
                ON game_ratings (gameId);
            CREATE INDEX IF NOT EXISTS idx_follows_user
                ON developer_follows (followerUid, createdAt);
            CREATE INDEX IF NOT EXISTS idx_continue_dismissals_user
                ON continue_playing_dismissals (userUid, dismissedAt);
            CREATE INDEX IF NOT EXISTS idx_rate_limit_updated
                ON rate_limit_buckets (updatedAt);
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

            CREATE TABLE IF NOT EXISTS game_reports (
                id TEXT PRIMARY KEY,
                gameId TEXT NOT NULL,
                reporterUid TEXT NOT NULL,
                category TEXT NOT NULL,
                reason TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'OPEN',
                createdAt INTEGER NOT NULL,
                resolvedAt INTEGER,
                resolvedByUid TEXT,
                resolution TEXT,
                updatedAt INTEGER,
                FOREIGN KEY (gameId) REFERENCES games(id) ON DELETE CASCADE,
                FOREIGN KEY (reporterUid) REFERENCES users(uid) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_game_reports_game_status
                ON game_reports (gameId, status, createdAt DESC);
            CREATE INDEX IF NOT EXISTS idx_game_reports_reporter_time
                ON game_reports (reporterUid, createdAt DESC);
            CREATE INDEX IF NOT EXISTS idx_game_reports_status_time
                ON game_reports (status, createdAt DESC);
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

        `);
        new SqliteMigrationRunner(this.db, PLATFORM_MIGRATIONS).run();
    }

    async getUser(uid) {
        const stmt = this.db.prepare('SELECT * FROM users WHERE uid = ?');
        return stmt.get(uid);
    }
    
    async createUser(user) {
        const stmt = this.db.prepare(`
            INSERT INTO users (uid, email, displayName, avatarUrl, role, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(user.uid, user.email, user.displayName, user.avatarUrl, user.role, user.createdAt, user.updatedAt);
        return user;
    }

    async provisionUserRole({ uid, role, email = '', displayName = '' }) {
        const existing = await this.getUser(uid);
        const now = Date.now();
        this.db.prepare(`
            INSERT INTO users (uid, email, displayName, avatarUrl, role, createdAt, updatedAt)
            VALUES (?, ?, ?, '', ?, ?, ?)
            ON CONFLICT(uid) DO UPDATE SET role = excluded.role, updatedAt = excluded.updatedAt
        `).run(uid, email, displayName || uid, role, now, now);
        return { previousRole: existing?.role || null, user: await this.getUser(uid) };
    }

    async getLocalCredentialByUsername(usernameNormalized) {
        return this.db.prepare(`
            SELECT c.*, u.email, u.displayName, u.avatarUrl, u.role
            FROM local_auth_credentials c
            JOIN users u ON u.uid = c.uid
            WHERE c.usernameNormalized = ?
        `).get(usernameNormalized);
    }

    async getLocalCredentialByUid(uid) {
        return this.db.prepare(`
            SELECT c.*, u.email, u.displayName, u.avatarUrl, u.role
            FROM local_auth_credentials c
            JOIN users u ON u.uid = c.uid
            WHERE c.uid = ?
        `).get(uid);
    }

    async createLocalAccount({ user, username, usernameNormalized, passwordHash, now = Date.now() }) {
        return this.runSerializedTransaction(async () => {
            this.db.prepare(`
                INSERT INTO users (uid, email, displayName, avatarUrl, role, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                user.uid,
                user.email || '',
                user.displayName,
                user.avatarUrl || '',
                user.role || 'DEVELOPER',
                user.createdAt || now,
                user.updatedAt || now
            );
            this.db.prepare(`
                INSERT INTO local_auth_credentials (
                    uid, username, usernameNormalized, passwordHash,
                    disabledAt, passwordChangedAt, createdAt, updatedAt
                ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
            `).run(user.uid, username, usernameNormalized, passwordHash, now, now, now);
            return this.getUser(user.uid);
        });
    }

    async updateLocalPassword(uid, passwordHash, now = Date.now()) {
        return this.runSerializedTransaction(async () => {
            const result = this.db.prepare(`
                UPDATE local_auth_credentials
                SET passwordHash = ?, passwordChangedAt = ?, updatedAt = ?
                WHERE uid = ?
            `).run(passwordHash, now, now, uid);
            if (!result.changes) return null;
            this.db.prepare(`
                UPDATE local_auth_sessions
                SET revokedAt = COALESCE(revokedAt, ?)
                WHERE uid = ? AND revokedAt IS NULL
            `).run(now, uid);
            return this.getLocalCredentialByUid(uid);
        });
    }

    async setLocalUserDisabled(uid, disabled, now = Date.now()) {
        return this.runSerializedTransaction(async () => {
            const disabledAt = disabled ? now : null;
            const result = this.db.prepare(`
                UPDATE local_auth_credentials
                SET disabledAt = ?, updatedAt = ?
                WHERE uid = ?
            `).run(disabledAt, now, uid);
            if (!result.changes) return null;
            if (disabled) {
                this.db.prepare(`
                    UPDATE local_auth_sessions
                    SET revokedAt = COALESCE(revokedAt, ?)
                    WHERE uid = ? AND revokedAt IS NULL
                `).run(now, uid);
            }
            return this.getLocalCredentialByUid(uid);
        });
    }

    async findOrCreateGoogleUser({ subject, email = '', displayName = '', now = Date.now() }) {
        if (typeof subject !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(subject)) {
            throw new TypeError('Invalid Google subject.');
        }
        return this.runSerializedTransaction(async () => {
            const existing = this.db.prepare(`
                SELECT u.*, i.disabledAt FROM external_auth_identities i
                JOIN users u ON u.uid = i.uid WHERE i.provider = 'google' AND i.subject = ?
            `).get(subject);
            if (existing) return existing;

            // Never look up by email, username or client-supplied UID. No local
            // credential is created, so no existing username can be claimed.
            const uid = randomUUID();
            this.db.prepare(`
                INSERT INTO users (uid, email, displayName, avatarUrl, role, createdAt, updatedAt)
                VALUES (?, ?, ?, '', 'DEVELOPER', ?, ?)
            `).run(uid, email, displayName || 'Google user', now, now);
            this.db.prepare(`
                INSERT INTO external_auth_identities (provider, subject, uid, createdAt)
                VALUES ('google', ?, ?, ?)
            `).run(subject, uid, now);
            return this.getExternalAccountByUid(uid);
        });
    }

    async getExternalAccountByUid(uid) {
        return this.db.prepare(`
            SELECT u.*, i.disabledAt FROM external_auth_identities i
            JOIN users u ON u.uid = i.uid WHERE i.uid = ?
        `).get(uid);
    }

    async setExternalUserDisabled(uid, disabled, now = Date.now()) {
        return this.runSerializedTransaction(async () => {
            const result = this.db.prepare('UPDATE external_auth_identities SET disabledAt = ? WHERE uid = ?')
                .run(disabled ? now : null, uid);
            if (!result.changes) return null;
            if (disabled) await this.revokeAllLocalSessions(uid, now);
            return this.getExternalAccountByUid(uid);
        });
    }

    async createLocalSession(session) {
        this.db.prepare(`
            INSERT INTO local_auth_sessions (tokenHash, uid, createdAt, expiresAt, lastSeenAt, revokedAt)
            VALUES (?, ?, ?, ?, ?, NULL)
        `).run(session.tokenHash, session.uid, session.createdAt, session.expiresAt, session.lastSeenAt);
        return session;
    }

    async getLocalSession(tokenHash) {
        return this.db.prepare(`
            SELECT s.tokenHash, s.uid, s.createdAt, s.expiresAt, s.lastSeenAt, s.revokedAt,
                   c.username, c.usernameNormalized, COALESCE(c.disabledAt, i.disabledAt) AS disabledAt, c.passwordChangedAt,
                   u.email, u.displayName, u.avatarUrl, u.role
            FROM local_auth_sessions s
            JOIN users u ON u.uid = s.uid
            LEFT JOIN local_auth_credentials c ON c.uid = s.uid
            LEFT JOIN external_auth_identities i ON i.uid = s.uid
            WHERE s.tokenHash = ? AND (c.uid IS NOT NULL OR i.uid IS NOT NULL)
        `).get(tokenHash);
    }

    async touchLocalSession(tokenHash, lastSeenAt) {
        const result = this.db.prepare(`
            UPDATE local_auth_sessions
            SET lastSeenAt = ?
            WHERE tokenHash = ? AND revokedAt IS NULL
        `).run(lastSeenAt, tokenHash);
        return result.changes > 0;
    }

    async revokeLocalSession(tokenHash, revokedAt = Date.now()) {
        const result = this.db.prepare(`
            UPDATE local_auth_sessions
            SET revokedAt = COALESCE(revokedAt, ?)
            WHERE tokenHash = ?
        `).run(revokedAt, tokenHash);
        return result.changes > 0;
    }

    async revokeAllLocalSessions(uid, revokedAt = Date.now()) {
        const result = this.db.prepare(`
            UPDATE local_auth_sessions
            SET revokedAt = COALESCE(revokedAt, ?)
            WHERE uid = ? AND revokedAt IS NULL
        `).run(revokedAt, uid);
        return Number(result.changes || 0);
    }

    async deleteExpiredLocalSessions(now = Date.now()) {
        const result = this.db.prepare(`
            DELETE FROM local_auth_sessions
            WHERE expiresAt <= ? OR revokedAt IS NOT NULL
        `).run(now);
        return Number(result.changes || 0);
    }

    async getLatestMigration() {
        return this.db.prepare(`
            SELECT version, name, appliedAt
            FROM schema_migrations
            ORDER BY version DESC
            LIMIT 1
        `).get() || null;
    }

    async getGame(id) {
        const stmt = this.db.prepare('SELECT * FROM games WHERE id = ?');
        return stmt.get(id);
    }

    async createGame(game) {
        const stmt = this.db.prepare(`
            INSERT INTO games (id, ownerUid, title, description, storageMode, currentState, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(game.id, game.ownerUid, game.title, game.description, game.storageMode, game.currentState, game.createdAt, game.updatedAt);
        return game;
    }

    async updateGameMetadata(id, { title, description }) {
        const updatedAt = Date.now();
        const stmt = this.db.prepare('UPDATE games SET title = ?, description = ?, updatedAt = ? WHERE id = ?');
        const result = stmt.run(title, description, updatedAt, id);
        return result.changes > 0 ? this.getGame(id) : null;
    }

    async updateGameState(id, currentState) {
        const stmt = this.db.prepare('UPDATE games SET currentState = ?, updatedAt = ? WHERE id = ?');
        stmt.run(currentState, Date.now(), id);
    }

    async updateGameModerationState(id, moderationState) {
        const stmt = this.db.prepare('UPDATE games SET moderationState = ?, updatedAt = ? WHERE id = ?');
        const result = stmt.run(moderationState, Date.now(), id);
        return result.changes > 0 ? this.getGame(id) : null;
    }

    async listGames(ownerUid) {
        if (ownerUid) {
            const stmt = this.db.prepare('SELECT * FROM games WHERE ownerUid = ? ORDER BY createdAt DESC');
            return stmt.all(ownerUid);
        }

        const stmt = this.db.prepare('SELECT * FROM games ORDER BY createdAt DESC');
        return stmt.all();
    }

    normalizeEditorProject(row) {
        if (!row) return null;
        let files;
        try {
            files = JSON.parse(row.files);
        } catch {
            files = null;
        }
        return { ...row, files };
    }

    async createEditorProject(project) {
        this.db.prepare(`
            INSERT INTO editor_projects (
                id, ownerUid, title, files, platformGameId, lastReadyVersionId, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            project.id,
            project.ownerUid,
            project.title,
            JSON.stringify(project.files),
            project.platformGameId || null,
            project.lastReadyVersionId || null,
            project.createdAt,
            project.updatedAt
        );
        return this.getEditorProject(project.id);
    }

    async getEditorProject(id) {
        return this.normalizeEditorProject(this.db.prepare('SELECT * FROM editor_projects WHERE id = ?').get(id));
    }

    async listEditorProjects(ownerUid) {
        return this.db.prepare('SELECT * FROM editor_projects WHERE ownerUid = ? ORDER BY updatedAt DESC')
            .all(ownerUid)
            .map(row => this.normalizeEditorProject(row));
    }

    async updateEditorProject(id, ownerUid, { title, files }) {
        const result = this.db.prepare(`
            UPDATE editor_projects
            SET title = ?, files = ?, updatedAt = ?
            WHERE id = ? AND ownerUid = ?
        `).run(title, JSON.stringify(files), Date.now(), id, ownerUid);
        return result.changes > 0 ? this.getEditorProject(id) : null;
    }

    async linkEditorProject(id, ownerUid, platformGameId, lastReadyVersionId = null) {
        const result = this.db.prepare(`
            UPDATE editor_projects
            SET platformGameId = ?, lastReadyVersionId = ?, updatedAt = ?
            WHERE id = ? AND ownerUid = ?
        `).run(platformGameId || null, lastReadyVersionId || null, Date.now(), id, ownerUid);
        return result.changes > 0 ? this.getEditorProject(id) : null;
    }

    async createGameVersion(version) {
        const stmt = this.db.prepare(`
            INSERT INTO game_versions (id, gameId, version, runtime, format, entry, status, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(version.id, version.gameId, version.version, version.runtime, version.format, version.entry, version.status, version.createdAt);
        return version;
    }

    async getGameVersions(gameId) {
        const stmt = this.db.prepare('SELECT * FROM game_versions WHERE gameId = ? ORDER BY createdAt DESC');
        return stmt.all(gameId);
    }

    async getGameVersion(id) {
        const stmt = this.db.prepare('SELECT * FROM game_versions WHERE id = ?');
        return stmt.get(id);
    }

    async createUploadSession(session) {
        const stmt = this.db.prepare(`
            INSERT INTO upload_sessions (id, ownerUid, gameId, versionId, storageProvider, objectKey, expectedSize, expectedContentType, status, expiresAt, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(session.id, session.ownerUid, session.gameId, session.versionId, session.storageProvider, session.objectKey, session.expectedSize, session.expectedContentType, session.status, session.expiresAt, session.createdAt);
        return session;
    }

    async getUploadSession(id) {
        const stmt = this.db.prepare('SELECT * FROM upload_sessions WHERE id = ?');
        return stmt.get(id);
    }

    async getUploadSessionByVersionId(versionId) {
        const stmt = this.db.prepare('SELECT * FROM upload_sessions WHERE versionId = ?');
        return stmt.get(versionId);
    }

    async listUploadRecovery(ownerUid, limit = 50) {
        const stmt = this.db.prepare(`
            SELECT
                g.id AS gameId,
                g.title AS gameTitle,
                g.currentState AS gameState,
                v.id AS versionId,
                v.version,
                v.status AS versionStatus,
                v.publishError,
                v.createdAt AS versionCreatedAt,
                s.id AS sessionId,
                s.status AS sessionStatus,
                s.expectedSize,
                s.expiresAt,
                s.updatedAt AS sessionUpdatedAt
            FROM games g
            INNER JOIN game_versions v ON v.gameId = g.id
            LEFT JOIN upload_sessions s ON s.versionId = v.id
            WHERE g.ownerUid = ?
              AND (
                v.status IN ('UPLOADING', 'VALIDATING', 'READY', 'PUBLISHING', 'PUBLISH_FAILED', 'DELETING')
                OR g.currentState = 'DELETING'
                OR s.status IN ('CREATED', 'VALIDATING', 'EXPIRED')
              )
            ORDER BY COALESCE(s.updatedAt, v.createdAt) DESC
            LIMIT ?
        `);
        return stmt.all(ownerUid, Math.max(1, Math.min(Number(limit) || 50, 100)));
    }

    async updateUploadSessionStatus(id, status) {
        const stmt = this.db.prepare('UPDATE upload_sessions SET status = ? WHERE id = ?');
        stmt.run(status, id);
    }

    async updateGameVersionStatus(id, status) {
        const stmt = this.db.prepare('UPDATE game_versions SET status = ? WHERE id = ?');
        stmt.run(status, id);
    }

    async listPublishedGames() {
        const stmt = this.db.prepare(`
            SELECT g.*, MAX(COALESCE(v.publishedAt, v.createdAt)) AS latestPublishedAt
            FROM games g
            INNER JOIN game_versions v ON g.id = v.gameId
            WHERE v.status = 'PUBLISHED' AND COALESCE(g.moderationState, 'ACTIVE') = 'ACTIVE'
            GROUP BY g.id
            ORDER BY latestPublishedAt DESC, g.createdAt DESC
        `);
        return stmt.all();
    }

    async getPublishedGameVersion(gameId) {
        // Return the most recently published version
        const stmt = this.db.prepare(`
            SELECT * FROM game_versions
            WHERE gameId = ? AND status = 'PUBLISHED'
            ORDER BY COALESCE(publishedAt, createdAt) DESC, createdAt DESC, id DESC
            LIMIT 1
        `);
        return stmt.get(gameId);
    }

    async activateGameVersion(gameId, versionId, publishedAt = Date.now()) {
        const target = this.db.prepare('SELECT * FROM game_versions WHERE id = ? AND gameId = ?').get(versionId, gameId);
        if (!target) return null;

        this.db.prepare(`
            UPDATE game_versions
            SET status = 'ARCHIVED'
            WHERE gameId = ? AND id <> ? AND status = 'PUBLISHED'
        `).run(gameId, versionId);
        const result = this.db.prepare(`
            UPDATE game_versions
            SET status = 'PUBLISHED', publishedAt = ?, publishError = NULL
            WHERE id = ? AND gameId = ?
        `).run(publishedAt, versionId, gameId);
        if (result.changes === 0) return null;
        await this.updateGameState(gameId, 'PUBLISHED');
        return this.getGameVersion(versionId);
    }

    async unpublishGame(gameId) {
        const result = this.db.prepare(`
            UPDATE game_versions
            SET status = 'ARCHIVED'
            WHERE gameId = ? AND status = 'PUBLISHED'
        `).run(gameId);
        await this.updateGameState(gameId, 'DRAFT');
        return result.changes;
    }

    async deleteGameVersion(gameId, versionId) {
        const sessionIds = this.db.prepare('SELECT id FROM upload_sessions WHERE gameId = ? AND versionId = ?')
            .all(gameId, versionId)
            .map(row => row.id);
        if (sessionIds.length) {
            const placeholders = sessionIds.map(() => '?').join(',');
            this.db.prepare(`DELETE FROM jobs WHERE targetId IN (${placeholders})`).run(...sessionIds);
        }
        this.db.prepare("DELETE FROM jobs WHERE targetId = ? AND type <> 'DELETE_GAME_VERSION'").run(versionId);
        this.db.prepare('DELETE FROM upload_sessions WHERE gameId = ? AND versionId = ?').run(gameId, versionId);
        const result = this.db.prepare('DELETE FROM game_versions WHERE gameId = ? AND id = ?').run(gameId, versionId);
        return result.changes > 0;
    }

    async deleteGame(gameId) {
        const versionIds = this.db.prepare('SELECT id FROM game_versions WHERE gameId = ?').all(gameId).map(row => row.id);
        const sessionIds = this.db.prepare('SELECT id FROM upload_sessions WHERE gameId = ?').all(gameId).map(row => row.id);
        const jobTargetIds = [...versionIds, ...sessionIds];
        if (jobTargetIds.length) {
            const placeholders = jobTargetIds.map(() => '?').join(',');
            this.db.prepare(`DELETE FROM jobs WHERE targetId IN (${placeholders})`).run(...jobTargetIds);
        }
        this.db.prepare('DELETE FROM upload_sessions WHERE gameId = ?').run(gameId);
        this.db.prepare('DELETE FROM game_versions WHERE gameId = ?').run(gameId);
        this.db.prepare('DELETE FROM user_library WHERE gameId = ?').run(gameId);
        this.db.prepare('DELETE FROM game_ratings WHERE gameId = ?').run(gameId);
        this.db.prepare('DELETE FROM discovery_events WHERE gameId = ?').run(gameId);
        this.db.prepare('DELETE FROM continue_playing_dismissals WHERE gameId = ?').run(gameId);
        const result = this.db.prepare('DELETE FROM games WHERE id = ?').run(gameId);
        return result.changes > 0;
    }

    async getCatalogRowsByGameIds(gameIds, userUid = null) {
        const ids = [...new Set((gameIds || []).filter(id => typeof id === 'string' && id))].slice(0, 100);
        if (ids.length === 0) return [];
        const placeholders = ids.map(() => '?').join(',');
        const userStateSql = userUid ? `
            EXISTS(SELECT 1 FROM user_library library WHERE library.userUid = ? AND library.gameId = g.id) AS inLibrary,
            (SELECT rating FROM game_ratings own_rating WHERE own_rating.userUid = ? AND own_rating.gameId = g.id) AS userRating,
            CASE WHEN g.ownerUid = ? THEN 0 ELSE EXISTS(
                SELECT 1 FROM developer_follows own_follow
                WHERE own_follow.followerUid = ? AND own_follow.developerUid = g.ownerUid
            ) END AS followingDeveloper
        ` : '0 AS inLibrary, NULL AS userRating, 0 AS followingDeveloper';
        const stmt = this.db.prepare(`
            WITH rating_stats AS (
                SELECT gameId, AVG(rating) AS rating, COUNT(*) AS ratingCount
                FROM game_ratings
                WHERE gameId IN (${placeholders})
                GROUP BY gameId
            ), discovery_stats AS (
                SELECT gameId,
                    SUM(CASE WHEN eventType = 'play_start' THEN 1 ELSE 0 END) AS playCount,
                    SUM(CASE WHEN eventType = 'game_ready' THEN 1 ELSE 0 END) AS readyCount,
                    SUM(CASE WHEN eventType = 'next_game' THEN 1 ELSE 0 END) AS nextCount,
                    SUM(CASE WHEN eventType = 'game_error' THEN 1 ELSE 0 END) AS errorCount,
                    AVG(CASE WHEN eventType = 'session_end' AND durationMs > 0 THEN durationMs END) AS avgSessionDurationMs
                FROM discovery_events
                WHERE gameId IN (${placeholders})
                GROUP BY gameId
            )
            SELECT
                g.id AS gameId,
                g.title AS name,
                g.description,
                g.ownerUid AS developerUid,
                v.id AS versionId,
                v.version AS gameVersion,
                v.runtime,
                v.format,
                v.entry,
                v.runtimeUrl,
                v.streamingManifestPath,
                v.capabilities,
                v.thumbnail,
                v.tags,
                v.controls,
                COALESCE(v.publishedAt, v.createdAt, 0) AS publishedAt,
                u.displayName AS developerName,
                u.email AS developerEmail,
                u.avatarUrl AS developerAvatarUrl,
                ROUND(COALESCE(r.rating, 0), 2) AS rating,
                COALESCE(r.ratingCount, 0) AS ratingCount,
                COALESCE(d.playCount, 0) AS playCount,
                COALESCE(d.readyCount, 0) AS readyCount,
                COALESCE(d.nextCount, 0) AS nextCount,
                COALESCE(d.errorCount, 0) AS errorCount,
                ROUND(COALESCE(d.avgSessionDurationMs, 0)) AS avgSessionDurationMs,
                ${userStateSql}
            FROM games g
            INNER JOIN game_versions v ON v.gameId = g.id AND v.status = 'PUBLISHED'
            LEFT JOIN users u ON u.uid = g.ownerUid
            LEFT JOIN rating_stats r ON r.gameId = g.id
            LEFT JOIN discovery_stats d ON d.gameId = g.id
            WHERE g.id IN (${placeholders})
              AND COALESCE(g.moderationState, 'ACTIVE') = 'ACTIVE'
        `);
        const params = [
            ...ids,
            ...ids,
            ...(userUid ? [userUid, userUid, userUid, userUid] : []),
            ...ids
        ];
        return stmt.all(...params);
    }

    async searchPublishedCatalog({ query = '', tag = '', sort = 'featured', limit = 25, offset = 0 } = {}) {
        const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
        const normalizedTag = String(tag || '').trim().toLocaleLowerCase();
        const queryPattern = `%${escapeLikePattern(normalizedQuery)}%`;
        const orderBy = CATALOG_SORT_SQL[sort] || CATALOG_SORT_SQL.featured;
        const stmt = this.db.prepare(`
            WITH rating_stats AS (
                SELECT gameId, AVG(rating) AS rating, COUNT(*) AS ratingCount
                FROM game_ratings
                GROUP BY gameId
            ), discovery_stats AS (
                SELECT gameId,
                    SUM(CASE WHEN eventType = 'play_start' THEN 1 ELSE 0 END) AS playCount,
                    AVG(CASE WHEN eventType = 'session_end' AND durationMs > 0 THEN durationMs END) AS avgSessionDurationMs
                FROM discovery_events
                GROUP BY gameId
            )
            SELECT
                g.id AS gameId,
                g.title AS name,
                g.description,
                g.ownerUid AS developerUid,
                v.id AS versionId,
                v.version AS gameVersion,
                v.runtime,
                v.format,
                v.entry,
                v.runtimeUrl,
                v.streamingManifestPath,
                v.capabilities,
                v.thumbnail,
                v.tags,
                v.controls,
                COALESCE(v.publishedAt, v.createdAt, 0) AS publishedAt,
                u.displayName AS developerName,
                u.email AS developerEmail,
                u.avatarUrl AS developerAvatarUrl,
                ROUND(COALESCE(r.rating, 0), 2) AS rating,
                COALESCE(r.ratingCount, 0) AS ratingCount,
                COALESCE(d.playCount, 0) AS playCount,
                ROUND(COALESCE(d.avgSessionDurationMs, 0)) AS avgSessionDurationMs
            FROM games g
            INNER JOIN game_versions v ON v.gameId = g.id AND v.status = 'PUBLISHED'
            LEFT JOIN users u ON u.uid = g.ownerUid
            LEFT JOIN rating_stats r ON r.gameId = g.id
            LEFT JOIN discovery_stats d ON d.gameId = g.id
            WHERE COALESCE(g.moderationState, 'ACTIVE') = 'ACTIVE'
              AND (
                ? = ''
                OR LOWER(COALESCE(g.title, '')) LIKE ? ESCAPE '\\'
                OR LOWER(COALESCE(g.description, '')) LIKE ? ESCAPE '\\'
                OR LOWER(COALESCE(u.displayName, u.email, '')) LIKE ? ESCAPE '\\'
                OR EXISTS (
                    SELECT 1 FROM json_each(CASE WHEN json_valid(v.tags) THEN v.tags ELSE '[]' END)
                    WHERE LOWER(CAST(value AS TEXT)) LIKE ? ESCAPE '\\'
                )
            )
              AND (
                ? = ''
                OR EXISTS (
                    SELECT 1 FROM json_each(CASE WHEN json_valid(v.tags) THEN v.tags ELSE '[]' END)
                    WHERE LOWER(TRIM(CAST(value AS TEXT))) = ?
                )
              )
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
        `);
        return stmt.all(
            normalizedQuery,
            queryPattern,
            queryPattern,
            queryPattern,
            queryPattern,
            normalizedTag,
            normalizedTag,
            Math.max(1, Math.floor(Number(limit) || 1)),
            Math.max(0, Math.floor(Number(offset) || 0))
        );
    }

    async listPublishedCatalogTags({ query = '', limit = 10 } = {}) {
        const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
        const queryPattern = `%${escapeLikePattern(normalizedQuery)}%`;
        const stmt = this.db.prepare(`
            SELECT MIN(TRIM(CAST(tag.value AS TEXT))) AS label, COUNT(DISTINCT g.id) AS count
            FROM games g
            INNER JOIN game_versions v ON v.gameId = g.id AND v.status = 'PUBLISHED'
            LEFT JOIN users u ON u.uid = g.ownerUid
            INNER JOIN json_each(CASE WHEN json_valid(v.tags) THEN v.tags ELSE '[]' END) AS tag
            WHERE COALESCE(g.moderationState, 'ACTIVE') = 'ACTIVE'
              AND TRIM(CAST(tag.value AS TEXT)) <> ''
              AND (
                ? = ''
                OR LOWER(COALESCE(g.title, '')) LIKE ? ESCAPE '\\'
                OR LOWER(COALESCE(g.description, '')) LIKE ? ESCAPE '\\'
                OR LOWER(COALESCE(u.displayName, u.email, '')) LIKE ? ESCAPE '\\'
                OR EXISTS (
                    SELECT 1 FROM json_each(CASE WHEN json_valid(v.tags) THEN v.tags ELSE '[]' END)
                    WHERE LOWER(CAST(value AS TEXT)) LIKE ? ESCAPE '\\'
                )
              )
            GROUP BY LOWER(TRIM(CAST(tag.value AS TEXT)))
            ORDER BY count DESC, label COLLATE NOCASE ASC
            LIMIT ?
        `);
        return stmt.all(
            normalizedQuery,
            queryPattern,
            queryPattern,
            queryPattern,
            queryPattern,
            Math.max(0, Math.floor(Number(limit) || 0))
        ).map(row => ({ label: row.label, count: Number(row.count || 0) }));
    }

    async updateGameVersionMetadata(id, metadata) {
        const sets = [];
        const params = [];
        for (const key of Object.keys(metadata)) {
            if (!GAME_VERSION_METADATA_FIELDS.has(key)) {
                throw new Error(`Unsupported game version metadata field: ${key}`);
            }
            sets.push(`${key} = ?`);
            params.push(metadata[key]);
        }
        if (sets.length === 0) return;
        params.push(id);
        const stmt = this.db.prepare(`UPDATE game_versions SET ${sets.join(', ')} WHERE id = ?`);
        stmt.run(...params);
    }

    async updateGameVersionRuntimeUrl(id, runtimeUrl) {
        const stmt = this.db.prepare('UPDATE game_versions SET runtimeUrl = ? WHERE id = ?');
        stmt.run(runtimeUrl, id);
    }

    async getUserQuotaUsage(uid) {
        const stmt = this.db.prepare(`
            SELECT 
                SUM(v.packageSizeBytes) as totalPackageBytes,
                SUM(v.extractedSizeBytes) as totalExtractedBytes,
                COUNT(v.id) as versionCount
            FROM game_versions v
            JOIN games g ON v.gameId = g.id
            WHERE g.ownerUid = ? AND g.storageMode = 'platform'
              AND v.status NOT IN ('REJECTED', 'EXPIRED')
        `);
        const result = stmt.get(uid) || {};
        
        const uploadStmt = this.db.prepare(`
            SELECT COUNT(id) as activeUploads
            FROM upload_sessions
            WHERE ownerUid = ? AND status IN ('CREATED', 'UPLOADING', 'VALIDATING')
        `);
        const uploadResult = uploadStmt.get(uid) || {};

        return {
            totalStorageBytes: (result.totalPackageBytes || 0) + (result.totalExtractedBytes || 0),
            versionCount: result.versionCount || 0,
            activeUploads: uploadResult.activeUploads || 0
        };
    }

    async updateUploadSession(id, data) {
        const sets = [];
        const params = [];
        for (const key of Object.keys(data)) {
            if (!UPLOAD_SESSION_UPDATE_FIELDS.has(key)) {
                throw new Error(`Unsupported upload session field: ${key}`);
            }
            sets.push(`${key} = ?`);
            params.push(data[key]);
        }
        if (sets.length === 0) return;
        params.push(id);
        const stmt = this.db.prepare(`UPDATE upload_sessions SET ${sets.join(', ')} WHERE id = ?`);
        stmt.run(...params);
    }

    async getUploadSessionsForCleanup(nowMs, completedBeforeMs = nowMs) {
        const stmt = this.db.prepare(`
            SELECT * FROM upload_sessions
            WHERE (status NOT IN ('COMPLETED', 'CLEANED') AND expiresAt < ?)
            OR status = 'EXPIRED'
            OR (status = 'COMPLETED' AND COALESCE(completedAt, createdAt) < ?)
        `);
        return stmt.all(nowMs, completedBeforeMs);
    }

    async claimVersionForPublishing(versionId, ownerUid) {
        const stmt = this.db.prepare(`
            UPDATE game_versions 
            SET status = 'PUBLISHING', publishError = NULL
            WHERE id = ? 
            AND (status = 'READY' OR status = 'PUBLISH_FAILED')
            AND id IN (
                SELECT v.id FROM game_versions v 
                JOIN games g ON v.gameId = g.id 
                WHERE g.ownerUid = ?
            )
        `);
        const info = stmt.run(versionId, ownerUid);
        return info.changes > 0;
    }

    async recordPublishAttempt(versionId) {
        const stmt = this.db.prepare(`
            UPDATE game_versions
            SET publishAttempts = publishAttempts + 1
            WHERE id = ?
        `);
        stmt.run(versionId);
    }

    async markVersionPublishFailed(versionId, errorMessage = null) {
        const stmt = this.db.prepare(`
            UPDATE game_versions
            SET status = 'PUBLISH_FAILED', publishError = ?
            WHERE id = ?
        `);
        const safeMessage = typeof errorMessage === 'string' && errorMessage.trim()
            ? errorMessage.trim().slice(0, 500)
            : 'Publishing failed unexpectedly.';
        stmt.run(safeMessage, versionId);
    }

    async addToLibrary(userUid, gameId) {
        const stmt = this.db.prepare(`
            INSERT INTO user_library (userUid, gameId, addedAt)
            VALUES (?, ?, ?)
            ON CONFLICT(userUid, gameId) DO UPDATE SET addedAt = excluded.addedAt
        `);
        stmt.run(userUid, gameId, Date.now());
        return { userUid, gameId };
    }

    async removeFromLibrary(userUid, gameId) {
        const stmt = this.db.prepare('DELETE FROM user_library WHERE userUid = ? AND gameId = ?');
        const result = stmt.run(userUid, gameId);
        return result.changes > 0;
    }

    async isInLibrary(userUid, gameId) {
        const stmt = this.db.prepare('SELECT 1 AS present FROM user_library WHERE userUid = ? AND gameId = ?');
        return Boolean(stmt.get(userUid, gameId));
    }

    async listLibraryGameIds(userUid) {
        const stmt = this.db.prepare('SELECT gameId FROM user_library WHERE userUid = ? ORDER BY addedAt DESC');
        return stmt.all(userUid).map(row => row.gameId);
    }

    async upsertGameRating(userUid, gameId, rating) {
        const now = Date.now();
        const stmt = this.db.prepare(`
            INSERT INTO game_ratings (userUid, gameId, rating, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(userUid, gameId) DO UPDATE SET rating = excluded.rating, updatedAt = excluded.updatedAt
        `);
        stmt.run(userUid, gameId, rating, now, now);
        return { userUid, gameId, rating };
    }

    async getUserGameRating(userUid, gameId) {
        const stmt = this.db.prepare('SELECT rating FROM game_ratings WHERE userUid = ? AND gameId = ?');
        return stmt.get(userUid, gameId)?.rating ?? null;
    }

    async getGameRatingSummary(gameId) {
        const stmt = this.db.prepare('SELECT AVG(rating) AS average, COUNT(*) AS count FROM game_ratings WHERE gameId = ?');
        const row = stmt.get(gameId) || {};
        return {
            average: row.average == null ? 0 : Number(Number(row.average).toFixed(2)),
            count: Number(row.count || 0)
        };
    }

    async followDeveloper(followerUid, developerUid) {
        const stmt = this.db.prepare(`
            INSERT INTO developer_follows (followerUid, developerUid, createdAt)
            VALUES (?, ?, ?)
            ON CONFLICT(followerUid, developerUid) DO NOTHING
        `);
        stmt.run(followerUid, developerUid, Date.now());
        return { followerUid, developerUid };
    }

    async unfollowDeveloper(followerUid, developerUid) {
        const stmt = this.db.prepare('DELETE FROM developer_follows WHERE followerUid = ? AND developerUid = ?');
        const result = stmt.run(followerUid, developerUid);
        return result.changes > 0;
    }

    async isFollowingDeveloper(followerUid, developerUid) {
        const stmt = this.db.prepare('SELECT 1 AS present FROM developer_follows WHERE followerUid = ? AND developerUid = ?');
        return Boolean(stmt.get(followerUid, developerUid));
    }

    async listFollowedDevelopers(followerUid) {
        const stmt = this.db.prepare(`
            SELECT u.uid, u.displayName, u.avatarUrl
            FROM developer_follows f
            LEFT JOIN users u ON u.uid = f.developerUid
            WHERE f.followerUid = ?
            ORDER BY f.createdAt DESC
        `);
        return stmt.all(followerUid);
    }

    async listPublishedGamesByOwners(ownerUids) {
        if (!ownerUids?.length) return [];
        const placeholders = ownerUids.map(() => '?').join(',');
        const stmt = this.db.prepare(`
            SELECT g.*, MAX(COALESCE(v.publishedAt, v.createdAt)) AS latestPublishedAt
            FROM games g
            INNER JOIN game_versions v ON g.id = v.gameId
            WHERE v.status = 'PUBLISHED'
              AND COALESCE(g.moderationState, 'ACTIVE') = 'ACTIVE'
              AND g.ownerUid IN (${placeholders})
            GROUP BY g.id
            ORDER BY latestPublishedAt DESC, g.updatedAt DESC, g.createdAt DESC
        `);
        return stmt.all(...ownerUids);
    }

    async createGameReport(report) {
        this.db.prepare(`
            INSERT INTO game_reports (id, gameId, reporterUid, category, reason, status, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(report.id, report.gameId, report.reporterUid, report.category, report.reason, report.status, report.createdAt, report.createdAt);
        return report;
    }

    async getGameReport(id) {
        return this.db.prepare('SELECT * FROM game_reports WHERE id = ?').get(id);
    }

    async listGameReports(gameId, status = null) {
        if (status) {
            return this.db.prepare('SELECT * FROM game_reports WHERE gameId = ? AND status = ? ORDER BY createdAt DESC')
                .all(gameId, status);
        }
        return this.db.prepare('SELECT * FROM game_reports WHERE gameId = ? ORDER BY createdAt DESC').all(gameId);
    }

    async listModerationReports(status = 'OPEN', limit = 50) {
        return this.db.prepare(`
            SELECT r.*, g.title AS gameTitle, g.description AS gameDescription,
                   g.ownerUid, g.moderationState, reporter.email AS reporterEmail,
                   reporter.displayName AS reporterDisplayName
            FROM game_reports r
            INNER JOIN games g ON g.id = r.gameId
            LEFT JOIN users reporter ON reporter.uid = r.reporterUid
            WHERE (? = '' OR r.status = ?)
            ORDER BY CASE WHEN r.status = 'OPEN' THEN 0 ELSE 1 END, r.createdAt DESC
            LIMIT ?
        `).all(status || '', status || '', Math.max(1, Math.min(Number(limit) || 50, 100)));
    }

    async countOpenGameReports() {
        return Number(this.db.prepare("SELECT COUNT(*) AS count FROM game_reports WHERE status = 'OPEN'").get().count);
    }

    async resolveGameReport(id, { status, resolution, resolvedByUid, resolvedAt }) {
        const result = this.db.prepare(`
            UPDATE game_reports
            SET status = ?, resolution = ?, resolvedByUid = ?, resolvedAt = ?, updatedAt = ?
            WHERE id = ? AND status = 'OPEN'
        `).run(status, resolution, resolvedByUid, resolvedAt, resolvedAt, id);
        return result.changes > 0 ? this.getGameReport(id) : null;
    }

    async createModerationAction(action) {
        this.db.prepare(`
            INSERT INTO moderation_actions (
                id, gameId, reportId, operatorUid, action, previousState, nextState, reason, createdAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            action.id, action.gameId, action.reportId || null, action.operatorUid,
            action.action, action.previousState, action.nextState, action.reason, action.createdAt
        );
        return action;
    }

    async listModerationActions(gameId) {
        return this.db.prepare(`
            SELECT a.*, operator.email AS operatorEmail, operator.displayName AS operatorDisplayName
            FROM moderation_actions a
            LEFT JOIN users operator ON operator.uid = a.operatorUid
            WHERE a.gameId = ?
            ORDER BY a.createdAt DESC
        `).all(gameId);
    }

    async getStorageIntegritySnapshot() {
        return {
            versions: this.db.prepare(`
                SELECT id, gameId, status, entry, runtimeUrl, streamingManifestPath
                FROM game_versions
                ORDER BY gameId, createdAt, id
            `).all(),
            uploadSessions: this.db.prepare(`
                SELECT id, gameId, versionId, objectKey, status, expiresAt, completedAt
                FROM upload_sessions
                ORDER BY createdAt, id
            `).all()
        };
    }

    async recordDiscoveryEvent(event) {
        const stmt = this.db.prepare(`
            INSERT INTO discovery_events (id, sessionId, userUid, gameId, eventType, durationMs, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(event.id, event.sessionId, event.userUid || null, event.gameId, event.eventType, event.durationMs || 0, event.createdAt);
        if (event.userUid && (event.eventType === 'play_start' || event.eventType === 'game_ready')) {
            this.db.prepare('DELETE FROM continue_playing_dismissals WHERE userUid = ? AND gameId = ?')
                .run(event.userUid, event.gameId);
        }
        return event;
    }

    async getGameDiscoveryStats(gameId) {
        const stmt = this.db.prepare(`
            SELECT
                SUM(CASE WHEN eventType = 'impression' THEN 1 ELSE 0 END) AS impressions,
                SUM(CASE WHEN eventType = 'play_start' THEN 1 ELSE 0 END) AS playStarts,
                SUM(CASE WHEN eventType = 'game_ready' THEN 1 ELSE 0 END) AS readyCount,
                SUM(CASE WHEN eventType = 'next_game' THEN 1 ELSE 0 END) AS nextCount,
                SUM(CASE WHEN eventType = 'game_error' THEN 1 ELSE 0 END) AS errorCount,
                SUM(CASE WHEN eventType = 'library_add' THEN 1 ELSE 0 END) AS libraryAdds,
                AVG(CASE WHEN eventType = 'session_end' AND durationMs > 0 THEN durationMs END) AS avgSessionDurationMs
            FROM discovery_events
            WHERE gameId = ?
        `);
        const row = stmt.get(gameId) || {};
        return {
            impressions: Number(row.impressions || 0),
            playStarts: Number(row.playStarts || 0),
            readyCount: Number(row.readyCount || 0),
            nextCount: Number(row.nextCount || 0),
            errorCount: Number(row.errorCount || 0),
            libraryAdds: Number(row.libraryAdds || 0),
            avgSessionDurationMs: Math.round(Number(row.avgSessionDurationMs || 0))
        };
    }

    async listTrendingGameIds(limit = 12, sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000) {
        const stmt = this.db.prepare(`
            SELECT gameId,
                SUM(CASE
                    WHEN eventType = 'library_add' THEN 6
                    WHEN eventType = 'rating_submit' THEN 5
                    WHEN eventType = 'game_ready' THEN 3
                    WHEN eventType = 'play_start' THEN 1
                    WHEN eventType = 'next_game' THEN -2
                    WHEN eventType = 'game_error' THEN -4
                    ELSE 0 END) AS score,
                MAX(createdAt) AS lastActivity
            FROM discovery_events
            WHERE createdAt >= ?
            GROUP BY gameId
            ORDER BY score DESC, lastActivity DESC
            LIMIT ?
        `);
        return stmt.all(sinceMs, limit).map(row => ({ gameId: row.gameId, score: Number(row.score || 0) }));
    }

    async listRecentlyPlayedGameIds(userUid, limit = 12) {
        const stmt = this.db.prepare(`
            SELECT e.gameId, MAX(e.createdAt) AS lastPlayedAt
            FROM discovery_events e
            LEFT JOIN continue_playing_dismissals d
              ON d.userUid = e.userUid AND d.gameId = e.gameId
            WHERE e.userUid = ?
              AND e.eventType IN ('play_start', 'game_ready')
              AND d.gameId IS NULL
            GROUP BY e.gameId
            ORDER BY lastPlayedAt DESC
            LIMIT ?
        `);
        return stmt.all(userUid, limit);
    }

    async dismissRecentlyPlayedGame(userUid, gameId) {
        const dismissedAt = Date.now();
        const stmt = this.db.prepare(`
            INSERT INTO continue_playing_dismissals (userUid, gameId, dismissedAt)
            VALUES (?, ?, ?)
            ON CONFLICT(userUid, gameId) DO UPDATE SET dismissedAt = excluded.dismissedAt
        `);
        stmt.run(userUid, gameId, dismissedAt);
        return { userUid, gameId, dismissedAt };
    }

    async ping() {
        return this.db.prepare('SELECT 1 AS ok').get()?.ok === 1;
    }

    async consumeRateLimit(identity, operation, config, now = Date.now()) {
        const normalizedIdentity = String(identity || 'anonymous').slice(0, 256);
        const normalizedOperation = String(operation || 'unknown').slice(0, 128);
        const max = Math.max(1, Math.floor(Number(config?.max) || 1));
        const windowMs = Math.max(1000, Math.floor(Number(config?.windowMs) || 60000));
        const windowExpiredBefore = now - windowMs;

        return this.runSerializedTransaction(async () => {
            const row = this.db.prepare(`
                SELECT windowStart, operationCount
                FROM rate_limit_buckets
                WHERE identity = ? AND operation = ?
            `).get(normalizedIdentity, normalizedOperation);

            const resetWindow = !row || Number(row.windowStart) <= windowExpiredBefore;
            const windowStart = resetWindow ? now : Number(row.windowStart);
            const currentCount = resetWindow ? 0 : Number(row.operationCount || 0);
            const allowed = currentCount < max;
            const nextCount = allowed ? currentCount + 1 : currentCount;

            this.db.prepare(`
                INSERT INTO rate_limit_buckets (identity, operation, windowStart, operationCount, updatedAt)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(identity, operation) DO UPDATE SET
                    windowStart = excluded.windowStart,
                    operationCount = excluded.operationCount,
                    updatedAt = excluded.updatedAt
            `).run(normalizedIdentity, normalizedOperation, windowStart, nextCount, now);
            return {
                allowed,
                remaining: Math.max(0, max - nextCount),
                resetAfterMs: Math.max(0, windowStart + windowMs - now)
            };
        });
    }

    async transaction(callback) {
        if (typeof callback !== 'function') {
            throw new TypeError('LocalSqliteProvider.transaction requires a callback.');
        }
        return this.runSerializedTransaction(() => callback(this));
    }

    async runSerializedTransaction(callback) {
        if (this.closing || this.closed) {
            const error = new Error('Database provider is closing and cannot accept a transaction.');
            error.code = 'DATABASE_CLOSING';
            throw error;
        }
        if (this.transactionContext.getStore() === this) {
            const error = new Error('Nested LocalSqliteProvider transactions are not supported.');
            error.code = 'NESTED_TRANSACTION_UNSUPPORTED';
            throw error;
        }

        const execute = async () => {
            this.db.exec('BEGIN IMMEDIATE');
            try {
                const result = await this.transactionContext.run(this, callback);
                this.db.exec('COMMIT');
                return result;
            } catch (error) {
                try {
                    this.db.exec('ROLLBACK');
                } catch (rollbackError) {
                    error.rollbackError = rollbackError;
                }
                throw error;
            }
        };

        const operation = this.transactionTail.then(execute, execute);
        this.transactionTail = operation.then(() => undefined, () => undefined);
        return operation;
    }

    async close() {
        if (this.closed) return;
        this.closing = true;
        await this.transactionTail;
        if (!this.closed) {
            this.db.close();
            this.closed = true;
        }
    }

    async getActiveJob(type, targetId) {
        const stmt = this.db.prepare("SELECT * FROM jobs WHERE type = ? AND targetId = ? AND status IN ('QUEUED', 'RUNNING', 'RETRYING')");
        return stmt.get(type, targetId);
    }

    async createJob(job) {
        const stmt = this.db.prepare(`
            INSERT INTO jobs (id, type, targetId, payload, status, attempts, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(job.id, job.type, job.targetId, job.payload, job.status, job.attempts, job.createdAt, job.updatedAt);
        return job;
    }

    async claimNextJob(workerId = 'local-worker', leaseMs = 60000) {
        const now = Date.now();
        const safeLeaseMs = Math.max(5000, Math.floor(Number(leaseMs) || 60000));
        return this.runSerializedTransaction(async () => {
            const stmt = this.db.prepare(`
                SELECT * FROM jobs
                WHERE status IN ('QUEUED', 'RETRYING')
                   OR (status = 'RUNNING' AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt < ?)
                ORDER BY createdAt ASC
                LIMIT 1
            `);
            const job = stmt.get(now);
            if (job) {
                const updateStmt = this.db.prepare(`
                    UPDATE jobs
                    SET status = 'RUNNING', startedAt = COALESCE(startedAt, ?), updatedAt = ?,
                        attempts = attempts + 1, workerId = ?, leaseExpiresAt = ?
                    WHERE id = ?
                      AND (
                        status IN ('QUEUED', 'RETRYING')
                        OR (status = 'RUNNING' AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt < ?)
                      )
                `);
                const claimed = updateStmt.run(now, now, workerId, now + safeLeaseMs, job.id, now);
                if (claimed.changes === 0) {
                    return null;
                }
                job.status = 'RUNNING';
                job.attempts += 1;
                job.workerId = workerId;
                job.leaseExpiresAt = now + safeLeaseMs;
                return job;
            }
            return null;
        });
    }

    async updateJobStatus(id, status, error = null, attempts = null, workerId = null) {
        let sql = "UPDATE jobs SET status = ?, updatedAt = ?";
        const params = [status, Date.now()];
        
        if (error !== null) {
            sql += ", error = ?";
            params.push(error);
        }
        
        if (attempts !== null) {
            sql += ", attempts = ?";
            params.push(attempts);
        }
        
        if (status === 'SUCCEEDED' || status === 'FAILED') {
            sql += ", completedAt = ?";
            params.push(Date.now());
        }

        if (status !== 'RUNNING') {
            sql += ", workerId = NULL, leaseExpiresAt = NULL";
        }
        
        sql += " WHERE id = ?";
        params.push(id);
        if (workerId) {
            sql += " AND workerId = ?";
            params.push(workerId);
        }
        
        const stmt = this.db.prepare(sql);
        return stmt.run(...params).changes > 0;
    }

    async renewJobLease(id, workerId, leaseMs = 60000) {
        const now = Date.now();
        const safeLeaseMs = Math.max(5000, Math.floor(Number(leaseMs) || 60000));
        const result = this.db.prepare(`
            UPDATE jobs
            SET leaseExpiresAt = ?, updatedAt = ?
            WHERE id = ? AND status = 'RUNNING' AND workerId = ?
        `).run(now + safeLeaseMs, now, id, workerId);
        return result.changes > 0;
    }

    async getJobQueueStats() {
        const rows = this.db.prepare('SELECT status, COUNT(*) AS count FROM jobs GROUP BY status').all();
        const counts = Object.fromEntries(rows.map(row => [String(row.status).toLowerCase(), Number(row.count || 0)]));
        return {
            queued: counts.queued || 0,
            running: counts.running || 0,
            retrying: counts.retrying || 0,
            failed: counts.failed || 0,
            succeeded: counts.succeeded || 0
        };
    }
}
