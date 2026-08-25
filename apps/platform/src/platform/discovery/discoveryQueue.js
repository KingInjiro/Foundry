import { apiClient } from '../api/apiClient.js';

const DISCOVERY_HISTORY_KEY = 'foundry.discovery.history.v1';
const MAX_HISTORY_ITEMS = 50;

function normalizeGameId(value) {
    return typeof value === 'string' && value.trim()
        ? value.trim().slice(0, 128)
        : null;
}

function defaultStorage() {
    try {
        return globalThis.sessionStorage || null;
    } catch {
        return null;
    }
}

export function readDiscoveryHistory(storage = defaultStorage()) {
    if (!storage) return [];
    try {
        const parsed = JSON.parse(storage.getItem(DISCOVERY_HISTORY_KEY) || '[]');
        if (!Array.isArray(parsed)) return [];
        return [...new Set(parsed.map(normalizeGameId).filter(Boolean))].slice(-MAX_HISTORY_ITEMS);
    } catch {
        return [];
    }
}

export function rememberDiscoveredGame(gameId, storage = defaultStorage()) {
    const normalized = normalizeGameId(gameId);
    if (!normalized || !storage) return readDiscoveryHistory(storage);
    const next = readDiscoveryHistory(storage).filter(id => id !== normalized);
    next.push(normalized);
    const bounded = next.slice(-MAX_HISTORY_ITEMS);
    try {
        storage.setItem(DISCOVERY_HISTORY_KEY, JSON.stringify(bounded));
    } catch {
        // Discovery remains usable when session storage is blocked or full.
    }
    return bounded;
}

export function clearDiscoveryHistory(storage = defaultStorage()) {
    if (!storage) return;
    try {
        storage.removeItem(DISCOVERY_HISTORY_KEY);
    } catch {
        // A blocked storage API must not prevent instant play.
    }
}

async function requestDiscoveryGame(client, excludedIds) {
    const params = new URLSearchParams();
    excludedIds.forEach(id => params.append('exclude', id));
    const serialized = params.toString();
    const query = serialized ? `?${serialized}` : '';
    const response = await client.get(`/api/discovery/play-now${query}`);
    let result;
    try {
        result = await response.json();
    } catch {
        throw new Error('Discovery returned an unreadable response.');
    }

    if (!response.ok || !result.success || !result.data?.gameId) {
        const error = new Error(result.error?.message || 'No playable games are available yet.');
        error.code = result.error?.code || 'DISCOVERY_FAILED';
        throw error;
    }
    return result.data;
}

/**
 * Selects a game without repeating titles already visited in this browser tab.
 * Once the available catalog is exhausted, a new cycle starts automatically,
 * while the current game remains excluded from an immediate repeat.
 */
export async function findDiscoveryGame({
    currentGameId = null,
    client = apiClient,
    storage = defaultStorage()
} = {}) {
    const current = normalizeGameId(currentGameId);
    if (current) rememberDiscoveredGame(current, storage);

    const storedHistory = readDiscoveryHistory(storage);
    const history = current && !storedHistory.includes(current)
        ? [...storedHistory, current].slice(-MAX_HISTORY_ITEMS)
        : storedHistory;
    try {
        const game = await requestDiscoveryGame(client, history);
        rememberDiscoveredGame(game.gameId, storage);
        return { game, cycleReset: false };
    } catch (error) {
        const minimumExclusions = current ? 1 : 0;
        const canStartNewCycle = error?.code === 'NO_PLAYABLE_GAMES' && history.length > minimumExclusions;
        if (!canStartNewCycle) throw error;

        clearDiscoveryHistory(storage);
        const retryExclusions = current ? [current] : [];
        if (current) rememberDiscoveredGame(current, storage);
        const game = await requestDiscoveryGame(client, retryExclusions);
        rememberDiscoveredGame(game.gameId, storage);
        return { game, cycleReset: true };
    }
}

export const DISCOVERY_HISTORY_LIMIT = MAX_HISTORY_ITEMS;
