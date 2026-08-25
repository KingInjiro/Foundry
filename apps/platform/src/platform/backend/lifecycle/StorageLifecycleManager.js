export const LIFECYCLE_STATES = {
    ACTIVE: 'ACTIVE',
    LOW_ACTIVITY: 'LOW_ACTIVITY',
    DORMANT: 'DORMANT',
    ARCHIVED: 'ARCHIVED',
    EXTERNAL: 'EXTERNAL'
};

export class StorageLifecycleManager {
    constructor(config = {}) {
        this.inactivityWarningDays = config.inactivityWarningDays || 90;
        this.archiveGracePeriodDays = config.archiveGracePeriodDays || 14;
    }

    calculateActivityState(gameActivity, storageMode) {
        if (storageMode === 'external') {
            return LIFECYCLE_STATES.EXTERNAL;
        }

        const daysSinceLastLaunch = this._getDaysSince(gameActivity.lastLaunch);
        
        if (daysSinceLastLaunch > this.inactivityWarningDays + this.archiveGracePeriodDays) {
            return LIFECYCLE_STATES.ARCHIVED;
        } else if (daysSinceLastLaunch > this.inactivityWarningDays) {
            return LIFECYCLE_STATES.DORMANT;
        } else if (daysSinceLastLaunch > 30) {
            return LIFECYCLE_STATES.LOW_ACTIVITY;
        }
        
        return LIFECYCLE_STATES.ACTIVE;
    }

    async processLifecycleTransitions(games) {
        // Find dormant games, send warnings
        // Transition low activity to cold storage
        // Archive packages for grace period expired games
        console.log("Processing lifecycle transitions...");
    }

    _getDaysSince(dateString) {
        if (!dateString) return Infinity;
        const diff = Date.now() - new Date(dateString).getTime();
        return diff / (1000 * 60 * 60 * 24);
    }
}
