export const GAME_STATES = {
    DRAFT: 'DRAFT',
    PENDING_REVIEW: 'PENDING_REVIEW',
    PUBLISHED: 'PUBLISHED',
    SUSPENDED: 'SUSPENDED',
    ARCHIVED: 'ARCHIVED',
    REMOVED: 'REMOVED'
};

export class ModerationService {
    async reportGame(gameId, reporterId, reason) {
        console.log(`Game ${gameId} reported by ${reporterId} for ${reason}`);
        // Create Report record in DB
    }

    async suspendGame(gameId, reason) {
        console.log(`Game ${gameId} suspended: ${reason}`);
        // Change Game state to SUSPENDED, hiding it from catalog
    }
}
