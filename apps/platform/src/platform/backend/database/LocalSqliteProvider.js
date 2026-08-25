import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseProvider } from './DatabaseProvider.js';

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

export class LocalSqliteProvider extends DatabaseProvider {
    constructor(dbPath = '.data/platform.db') {
        super();
        const dir = path.dirname(dbPath); if (dir !== '.') { fs.mkdirSync(dir, { recursive: true }); } this.db = new DatabaseSync(dbPath);
        this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
        if (dbPath !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
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
            CREATE INDEX IF NOT EXISTS idx_jobs_claim
                ON jobs (status, leaseExpiresAt, createdAt);

        `);

        // Migration for existing databases
        const addColumn = (table, col, def) => {
            try {
                this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def};`);
            } catch (e) {
                // Column might already exist
            }
        };
        addColumn('game_versions', 'runtimeUrl', 'TEXT');
        addColumn('game_versions', 'streamingManifestPath', 'TEXT');
        addColumn('game_versions', 'capabilities', "TEXT NOT NULL DEFAULT '[]'");
        addColumn('game_versions', 'thumbnail', 'TEXT');
        addColumn('game_versions', 'tags', "TEXT NOT NULL DEFAULT '[]'");
        addColumn('game_versions', 'controls', "TEXT NOT NULL DEFAULT '[]'");
        addColumn('game_versions', 'publishedAt', 'INTEGER');
        addColumn('game_versions', 'packageSha256', 'TEXT');
        addColumn('game_versions', 'publishError', 'TEXT');
        addColumn('game_versions', 'publishAttempts', 'INTEGER DEFAULT 0');
        addColumn('game_versions', 'extractedSizeBytes', 'INTEGER DEFAULT 0');
        addColumn('game_versions', 'packageSizeBytes', 'INTEGER DEFAULT 0');
        addColumn('upload_sessions', 'updatedAt', 'INTEGER');
        addColumn('upload_sessions', 'completedAt', 'INTEGER');
        addColumn('upload_sessions', 'packageSizeBytes', 'INTEGER DEFAULT 0');
        addColumn('jobs', 'workerId', 'TEXT');
        addColumn('jobs', 'leaseExpiresAt', 'INTEGER');

        // Repair legacy rows before enforcing the single-active-release invariant.
        this.db.exec(`
            UPDATE game_versions AS current
            SET status = 'ARCHIVED'
            WHERE current.status = 'PUBLISHED'
              AND EXISTS (
                SELECT 1
                FROM game_versions AS newer
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
                ON game_versions (gameId)
                WHERE status = 'PUBLISHED';
            UPDATE jobs AS duplicate
            SET status = 'FAILED', error = 'Superseded duplicate active job during schema migration.', completedAt = unixepoch('subsec') * 1000
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
                ON jobs (type, targetId)
                WHERE status IN ('QUEUED', 'RUNNING', 'RETRYING');
            INSERT OR IGNORE INTO schema_migrations (version, appliedAt)
            VALUES (4, unixepoch('subsec') * 1000);
        `);
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

    async listGames(ownerUid) {
        if (ownerUid) {
            const stmt = this.db.prepare('SELECT * FROM games WHERE ownerUid = ? ORDER BY createdAt DESC');
            return stmt.all(ownerUid);
        }

        const stmt = this.db.prepare('SELECT * FROM games ORDER BY createdAt DESC');
        return stmt.all();
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
            WHERE v.status = 'PUBLISHED'
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
            WHERE (
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
            WHERE TRIM(CAST(tag.value AS TEXT)) <> ''
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
            WHERE v.status = 'PUBLISHED' AND g.ownerUid IN (${placeholders})
            GROUP BY g.id
            ORDER BY latestPublishedAt DESC, g.updatedAt DESC, g.createdAt DESC
        `);
        return stmt.all(...ownerUids);
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

        this.db.exec('BEGIN IMMEDIATE');
        try {
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
            this.db.exec('COMMIT');

            return {
                allowed,
                remaining: Math.max(0, max - nextCount),
                resetAfterMs: Math.max(0, windowStart + windowMs - now)
            };
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    async transaction(callback) {
        // Simple transaction simulation
        this.db.exec('BEGIN');
        try {
            const result = await callback(this);
            this.db.exec('COMMIT');
            return result;
        } catch (e) {
            this.db.exec('ROLLBACK');
            throw e;
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
        this.db.exec('BEGIN IMMEDIATE');
        try {
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
                    this.db.exec('COMMIT');
                    return null;
                }
                this.db.exec('COMMIT');
                job.status = 'RUNNING';
                job.attempts += 1;
                job.workerId = workerId;
                job.leaseExpiresAt = now + safeLeaseMs;
                return job;
            }
            this.db.exec('COMMIT');
            return null;
        } catch (e) {
            this.db.exec('ROLLBACK');
            throw e;
        }
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
