export class DatabaseProvider {
    async getUser(uid) { throw new Error("Not implemented"); }
    async createUser(user) { throw new Error("Not implemented"); }
    async provisionUserRole(data) { throw new Error("Not implemented"); }
    async getLocalCredentialByUsername(usernameNormalized) { throw new Error("Not implemented"); }
    async getLocalCredentialByUid(uid) { throw new Error("Not implemented"); }
    async createLocalAccount(account) { throw new Error("Not implemented"); }
    async updateLocalPassword(uid, passwordHash, now) { throw new Error("Not implemented"); }
    async setLocalUserDisabled(uid, disabled, now) { throw new Error("Not implemented"); }
    async findOrCreateGoogleUser(identity) { throw new Error("Not implemented"); }
    async getExternalAccountByUid(uid) { throw new Error("Not implemented"); }
    async setExternalUserDisabled(uid, disabled, now) { throw new Error("Not implemented"); }
    async createLocalSession(session) { throw new Error("Not implemented"); }
    async getLocalSession(tokenHash) { throw new Error("Not implemented"); }
    async touchLocalSession(tokenHash, lastSeenAt) { throw new Error("Not implemented"); }
    async revokeLocalSession(tokenHash, revokedAt) { throw new Error("Not implemented"); }
    async revokeAllLocalSessions(uid, revokedAt) { throw new Error("Not implemented"); }
    async deleteExpiredLocalSessions(now) { throw new Error("Not implemented"); }
    async getLatestMigration() { throw new Error("Not implemented"); }
    async getGame(id) { throw new Error("Not implemented"); }
    async createGame(game) { throw new Error("Not implemented"); }
    async updateGameMetadata(id, metadata) { throw new Error("Not implemented"); }
    async updateGameState(id, currentState) { throw new Error("Not implemented"); }
    async updateGameModerationState(id, moderationState) { throw new Error("Not implemented"); }
    async listGames() { throw new Error("Not implemented"); }
    async createGameVersion(version) { throw new Error("Not implemented"); }
    async getGameVersions(gameId) { throw new Error("Not implemented"); }
    async createUploadSession(session) { throw new Error("Not implemented"); }
    async getUploadSession(id) { throw new Error("Not implemented"); }
    async updateUploadSessionStatus(id, status) { throw new Error("Not implemented"); }
    async updateGameVersionStatus(id, status) { throw new Error("Not implemented"); }
    async updateGameVersionMetadata(id, metadata) { throw new Error("Not implemented"); }
    async getGameVersion(id) { throw new Error("Not implemented"); }
    async listPublishedGames() { throw new Error("Not implemented"); }
    async getPublishedGameVersion(gameId) { throw new Error("Not implemented"); }
    async activateGameVersion(gameId, versionId, publishedAt) { throw new Error("Not implemented"); }
    async unpublishGame(gameId) { throw new Error("Not implemented"); }
    async deleteGameVersion(gameId, versionId) { throw new Error("Not implemented"); }
    async deleteGame(gameId) { throw new Error("Not implemented"); }
    async searchPublishedCatalog(options) { throw new Error("Not implemented"); }
    async listPublishedCatalogTags(options) { throw new Error("Not implemented"); }
    async ping() { throw new Error("Not implemented"); }
    async createGameReport(report) { throw new Error("Not implemented"); }
    async getGameReport(id) { throw new Error("Not implemented"); }
    async listGameReports(gameId, status) { throw new Error("Not implemented"); }
    async listModerationReports(status, limit) { throw new Error("Not implemented"); }
    async countOpenGameReports() { throw new Error("Not implemented"); }
    async resolveGameReport(id, data) { throw new Error("Not implemented"); }
    async createModerationAction(action) { throw new Error("Not implemented"); }
    async listModerationActions(gameId) { throw new Error("Not implemented"); }

    async getUserQuotaUsage(uid) { throw new Error("Not implemented"); }
    async updateUploadSession(id, data) { throw new Error("Not implemented"); }
    async getUploadSessionsForCleanup(expirationMs) { throw new Error("Not implemented"); }
    async claimVersionForPublishing(versionId, ownerUid) { throw new Error("Not implemented"); }
    async recordPublishAttempt(versionId) { throw new Error("Not implemented"); }
    async markVersionPublishFailed(versionId, errorMessage = null) { throw new Error("Not implemented"); }


    async addToLibrary(userUid, gameId) { throw new Error("Not implemented"); }
    async removeFromLibrary(userUid, gameId) { throw new Error("Not implemented"); }
    async isInLibrary(userUid, gameId) { throw new Error("Not implemented"); }
    async listLibraryGameIds(userUid) { throw new Error("Not implemented"); }
    async upsertGameRating(userUid, gameId, rating) { throw new Error("Not implemented"); }
    async getUserGameRating(userUid, gameId) { throw new Error("Not implemented"); }
    async getGameRatingSummary(gameId) { throw new Error("Not implemented"); }
    async followDeveloper(followerUid, developerUid) { throw new Error("Not implemented"); }
    async unfollowDeveloper(followerUid, developerUid) { throw new Error("Not implemented"); }
    async isFollowingDeveloper(followerUid, developerUid) { throw new Error("Not implemented"); }
    async listFollowedDevelopers(followerUid) { throw new Error("Not implemented"); }
    async listPublishedGamesByOwners(ownerUids) { throw new Error("Not implemented"); }
    async recordDiscoveryEvent(event) { throw new Error("Not implemented"); }
    async getGameDiscoveryStats(gameId) { throw new Error("Not implemented"); }
    async listTrendingGameIds(limit, sinceMs) { throw new Error("Not implemented"); }
    async listRecentlyPlayedGameIds(userUid, limit) { throw new Error("Not implemented"); }
    async dismissRecentlyPlayedGame(userUid, gameId) { throw new Error("Not implemented"); }

    async transaction(callback) { throw new Error("Not implemented"); }
    async getActiveJob(type, targetId) { throw new Error("Not implemented"); }
    async createJob(job) { throw new Error("Not implemented"); }
    async claimNextJob() { throw new Error("Not implemented"); }
    async updateJobStatus(id, status, error = null, attempts = null) { throw new Error("Not implemented"); }
    async renewJobLease(id, workerId, leaseMs) { throw new Error("Not implemented"); }
    async getUploadSessionByVersionId(versionId) { throw new Error("Not implemented"); }
    async consumeRateLimit(identity, operation, config, now) { throw new Error("Not implemented"); }
    async getJobQueueStats() { throw new Error("Not implemented"); }
    async getStorageIntegritySnapshot() { throw new Error("Not implemented"); }
}
