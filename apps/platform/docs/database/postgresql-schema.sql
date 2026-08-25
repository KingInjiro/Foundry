-- Foundry Platform metadata schema (PostgreSQL target, schema version 4).
-- The runtime PostgreSQL provider is intentionally a separate implementation
-- step; this file defines the complete contract it must migrate and satisfy.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    "appliedAt" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY,
    email TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    role TEXT NOT NULL DEFAULT 'DEVELOPER',
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    "ownerUid" TEXT NOT NULL REFERENCES users(uid),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    "storageMode" TEXT NOT NULL CHECK ("storageMode" IN ('platform', 'external')),
    "currentState" TEXT NOT NULL CHECK ("currentState" IN ('DRAFT', 'PUBLISHED', 'DELETING', 'ARCHIVED')),
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_versions (
    id TEXT PRIMARY KEY,
    "gameId" TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    runtime TEXT NOT NULL,
    format TEXT NOT NULL,
    entry TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'DRAFT', 'UPLOADING', 'VALIDATING', 'READY', 'PUBLISHING',
        'PUBLISHED', 'ARCHIVED', 'PUBLISH_FAILED', 'REJECTED', 'EXPIRED', 'DELETING'
    )),
    "createdAt" BIGINT NOT NULL,
    "runtimeUrl" TEXT,
    "streamingManifestPath" TEXT,
    capabilities TEXT NOT NULL DEFAULT '[]',
    thumbnail TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    controls TEXT NOT NULL DEFAULT '[]',
    "publishedAt" BIGINT,
    "packageSha256" TEXT,
    "publishAttempts" INTEGER NOT NULL DEFAULT 0,
    "publishError" TEXT,
    "extractedSizeBytes" BIGINT NOT NULL DEFAULT 0,
    "packageSizeBytes" BIGINT NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_versions_one_active
    ON game_versions ("gameId") WHERE status = 'PUBLISHED';
CREATE INDEX IF NOT EXISTS idx_game_versions_game_status
    ON game_versions ("gameId", status);

CREATE TABLE IF NOT EXISTS upload_sessions (
    id TEXT PRIMARY KEY,
    "ownerUid" TEXT NOT NULL REFERENCES users(uid),
    "gameId" TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    "versionId" TEXT NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
    "storageProvider" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "expectedSize" BIGINT NOT NULL,
    "expectedContentType" TEXT NOT NULL,
    status TEXT NOT NULL,
    "expiresAt" BIGINT NOT NULL,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT,
    "completedAt" BIGINT,
    "packageSizeBytes" BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_owner_status
    ON upload_sessions ("ownerUid", status);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_cleanup
    ON upload_sessions (status, "expiresAt", "completedAt");

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRYING')),
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    "startedAt" BIGINT,
    "completedAt" BIGINT,
    "workerId" TEXT,
    "leaseExpiresAt" BIGINT
);

CREATE INDEX IF NOT EXISTS idx_jobs_claim
    ON jobs (status, "leaseExpiresAt", "createdAt");
CREATE INDEX IF NOT EXISTS idx_jobs_type_target
    ON jobs (type, "targetId");
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_one_active_target
    ON jobs (type, "targetId") WHERE status IN ('QUEUED', 'RUNNING', 'RETRYING');

CREATE TABLE IF NOT EXISTS user_library (
    "userUid" TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    "gameId" TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    "addedAt" BIGINT NOT NULL,
    PRIMARY KEY ("userUid", "gameId")
);

CREATE TABLE IF NOT EXISTS game_ratings (
    "userUid" TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    "gameId" TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    PRIMARY KEY ("userUid", "gameId")
);

CREATE TABLE IF NOT EXISTS developer_follows (
    "followerUid" TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    "developerUid" TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    "createdAt" BIGINT NOT NULL,
    PRIMARY KEY ("followerUid", "developerUid")
);

CREATE TABLE IF NOT EXISTS discovery_events (
    id TEXT PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "userUid" TEXT REFERENCES users(uid) ON DELETE SET NULL,
    "gameId" TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    "eventType" TEXT NOT NULL,
    "durationMs" BIGINT NOT NULL DEFAULT 0,
    "createdAt" BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_events_game_type_time
    ON discovery_events ("gameId", "eventType", "createdAt");
CREATE INDEX IF NOT EXISTS idx_discovery_events_user_time
    ON discovery_events ("userUid", "createdAt");

CREATE TABLE IF NOT EXISTS continue_playing_dismissals (
    "userUid" TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    "gameId" TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    "dismissedAt" BIGINT NOT NULL,
    PRIMARY KEY ("userUid", "gameId")
);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    identity TEXT NOT NULL,
    operation TEXT NOT NULL,
    "windowStart" BIGINT NOT NULL,
    "operationCount" INTEGER NOT NULL,
    "updatedAt" BIGINT NOT NULL,
    PRIMARY KEY (identity, operation)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_updated
    ON rate_limit_buckets ("updatedAt");

INSERT INTO schema_migrations (version, "appliedAt")
VALUES (4, (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT)
ON CONFLICT (version) DO NOTHING;

COMMIT;
