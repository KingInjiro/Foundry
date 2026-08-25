function assertSafeId(value, label) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
        const error = new Error(`Invalid ${label}.`);
        error.code = 'INVALID_LIFECYCLE_TARGET';
        error.isPermanent = true;
        throw error;
    }
}

export class ReleaseLifecycleService {
    constructor(database, storage) {
        this.database = database;
        this.storage = storage;
    }

    async processDeleteVersionJob({ gameId, versionId }) {
        assertSafeId(gameId, 'game id');
        assertSafeId(versionId, 'version id');
        const version = await this.database.getGameVersion(versionId);
        if (!version) return;
        if (version.gameId !== gameId) {
            const error = new Error('Version does not belong to the requested game.');
            error.code = 'LIFECYCLE_TARGET_MISMATCH';
            error.isPermanent = true;
            throw error;
        }
        if (version.status !== 'DELETING') {
            const error = new Error('Version is not marked for deletion.');
            error.code = 'INVALID_LIFECYCLE_STATE';
            error.isPermanent = true;
            throw error;
        }

        await this.storage.deletePrefix(`games/${gameId}/versions/${versionId}`);
        await this.database.transaction(tx => tx.deleteGameVersion(gameId, versionId));
    }

    async processDeleteGameJob({ gameId }) {
        assertSafeId(gameId, 'game id');
        const game = await this.database.getGame(gameId);
        if (!game) return;
        if (game.currentState !== 'DELETING') {
            const error = new Error('Game is not marked for deletion.');
            error.code = 'INVALID_LIFECYCLE_STATE';
            error.isPermanent = true;
            throw error;
        }

        await this.storage.deletePrefix(`games/${gameId}`);
        await this.database.transaction(tx => tx.deleteGame(gameId));
    }
}
