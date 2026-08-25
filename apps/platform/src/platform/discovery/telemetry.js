import { apiClient } from '../api/apiClient.js';

export function createPlaySessionId(gameId) {
    const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    return `play:${gameId}:${Date.now()}:${random}`;
}

export async function trackDiscoveryEvent({ sessionId, gameId, eventType, durationMs = 0, keepalive = false }) {
    try {
        await apiClient.post('/api/discovery/events', {
            sessionId,
            gameId,
            eventType,
            durationMs
        }, { keepalive });
    } catch (error) {
        // Product telemetry must never block gameplay.
        console.debug('[Foundry Discovery] telemetry unavailable:', eventType, error);
    }
}
