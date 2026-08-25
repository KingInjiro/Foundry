# Platform Database Schema

## `users`
- `uid` (TEXT PRIMARY KEY)
- `email` (TEXT)
- `displayName` (TEXT)
- `avatarUrl` (TEXT)
- `role` (TEXT)
- `createdAt` (INTEGER)
- `updatedAt` (INTEGER)

## `games`
- `id` (TEXT PRIMARY KEY)
- `ownerUid` (TEXT)
- `title` (TEXT)
- `description` (TEXT)
- `storageMode` (TEXT)
- `currentState` (TEXT)
- `createdAt` (INTEGER)
- `updatedAt` (INTEGER)

## `game_versions`
- `id` (TEXT PRIMARY KEY)
- `gameId` (TEXT)
- `version` (TEXT)
- `runtime` (TEXT)
- `format` (TEXT)
- `entry` (TEXT)
- `status` (TEXT) - 'DRAFT', 'UPLOADING', 'VALIDATING', 'READY', 'PUBLISHING', 'PUBLISHED', 'PUBLISH_FAILED', 'REJECTED', 'EXPIRED'
- `createdAt` (INTEGER)
- `runtimeUrl` (TEXT)
- `streamingManifestPath` (TEXT, nullable) - exact root manifest filename validated for this version
- `capabilities` (TEXT JSON array) - validated runtime permissions
- `thumbnail` (TEXT, nullable) - validated package-relative image path
- `tags` (TEXT JSON array)
- `controls` (TEXT JSON array)
- `publishedAt` (INTEGER, nullable) - controls current-version selection
- `packageSha256` (TEXT, nullable) - immutable binding to the validated source ZIP
- `publishAttempts` (INTEGER)
- `publishError` (TEXT, nullable) - sanitized actionable failure/expiry reason
- `extractedSizeBytes` (INTEGER)
- `packageSizeBytes` (INTEGER)

## `upload_sessions`
- `id` (TEXT PRIMARY KEY)
- `ownerUid` (TEXT)
- `gameId` (TEXT)
- `versionId` (TEXT)
- `storageProvider` (TEXT)
- `objectKey` (TEXT)
- `expectedSize` (INTEGER)
- `expectedContentType` (TEXT)
- `status` (TEXT) - 'CREATED', 'UPLOADING', 'VALIDATING', 'COMPLETED', 'REJECTED', 'EXPIRED', 'CLEANED'
- `expiresAt` (INTEGER)
- `createdAt` (INTEGER)
- `updatedAt` (INTEGER)
- `completedAt` (INTEGER)
- `packageSizeBytes` (INTEGER)

## `jobs`
- `id` (TEXT PRIMARY KEY)
- `type` (TEXT)
- `targetId` (TEXT)
- `payload` (TEXT)
- `status` (TEXT) - 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRYING'
- `attempts` (INTEGER)
- `error` (TEXT)
- `createdAt` (INTEGER)
- `updatedAt` (INTEGER)
- `startedAt` (INTEGER)
- `completedAt` (INTEGER)

## `user_library`
- `userUid` (TEXT, composite primary key)
- `gameId` (TEXT, composite primary key)
- `addedAt` (INTEGER)

## `game_ratings`
- `userUid` (TEXT, composite primary key)
- `gameId` (TEXT, composite primary key)
- `rating` (INTEGER, 1–5)
- `createdAt` (INTEGER)
- `updatedAt` (INTEGER)

## `developer_follows`
- `followerUid` (TEXT, composite primary key)
- `developerUid` (TEXT, composite primary key)
- `createdAt` (INTEGER)

## `discovery_events`
- `id` (TEXT PRIMARY KEY)
- `sessionId` (TEXT)
- `userUid` (TEXT, nullable for anonymous play)
- `gameId` (TEXT)
- `eventType` (TEXT)
- `durationMs` (INTEGER)
- `createdAt` (INTEGER)

## `continue_playing_dismissals`
- `userUid` (TEXT, composite primary key)
- `gameId` (TEXT, composite primary key)
- `dismissedAt` (INTEGER)

This table is a presentation preference, not deleted history. `play_start` or `game_ready` removes the matching dismissal so a newly played title returns to Continue Playing while the original discovery events remain available for aggregate analytics.
