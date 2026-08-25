/**
 * Database Entity Schemas (Conceptual)
 * These represent the required metadata model for the Foundry Platform.
 */

export class Game {
    constructor(id, ownerUid, title, description, storageMode, currentState, createdAt) {
        this.id = id;
        this.ownerUid = ownerUid; // References User/DeveloperProfile
        this.title = title;
        this.description = description;
        this.storageMode = storageMode; // 'platform' or 'external'
        this.currentState = currentState; // 'DRAFT', 'PUBLISHED', 'ARCHIVED'
        this.createdAt = createdAt;
    }
}

export class GameManifest {
    constructor(format, version, engineVersion, gameVersion, name, entry, capabilities, assets) {
        this.format = format;
        this.version = version;
        this.engineVersion = engineVersion;
        this.gameVersion = gameVersion;
        this.name = name;
        this.entry = entry;
        this.capabilities = capabilities; // e.g. ['audio', 'storage']
        this.assets = assets;
    }
}

export class GameActivity {
    constructor(gameId, lastLaunch, lastDownload, totalPlayers, launchFrequency) {
        this.gameId = gameId;
        this.lastLaunch = lastLaunch; // Date
        this.lastDownload = lastDownload; // Date
        this.totalPlayers = totalPlayers;
        this.launchFrequency = launchFrequency; // e.g., launches per week
    }
}

export class RevenueRecord {
    constructor(id, gameId, periodStart, periodEnd, grossRevenue, platformShare, developerShare, status) {
        this.id = id;
        this.gameId = gameId;
        this.periodStart = periodStart;
        this.periodEnd = periodEnd;
        this.grossRevenue = grossRevenue;
        this.platformShare = platformShare;
        this.developerShare = developerShare;
        this.status = status; // 'PENDING', 'PAID'
    }
}

export class AdSession {
    constructor(id, userId, gameId, startedAt, completedAt, providerId) {
        this.id = id;
        this.userId = userId;
        this.gameId = gameId;
        this.startedAt = startedAt;
        this.completedAt = completedAt;
        this.providerId = providerId;
    }
}
