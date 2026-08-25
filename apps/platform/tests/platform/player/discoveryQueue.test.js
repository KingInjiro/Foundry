import { describe, expect, it, vi } from 'vitest';
import {
    DISCOVERY_HISTORY_LIMIT,
    clearDiscoveryHistory,
    findDiscoveryGame,
    readDiscoveryHistory,
    rememberDiscoveredGame
} from '../../../src/platform/discovery/discoveryQueue.js';

function createMemoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: vi.fn(key => values.get(key) ?? null),
        setItem: vi.fn((key, value) => values.set(key, value)),
        removeItem: vi.fn(key => values.delete(key))
    };
}

function response({ gameId = null, ok = true, code = null, message = null } = {}) {
    return {
        ok,
        json: vi.fn(async () => ok
            ? { success: true, data: { gameId, name: gameId } }
            : { success: false, error: { code, message } })
    };
}

describe('discovery queue', () => {
    it('deduplicates and bounds tab-scoped discovery history', () => {
        const storage = createMemoryStorage();
        for (let index = 0; index < DISCOVERY_HISTORY_LIMIT + 5; index += 1) {
            rememberDiscoveredGame(`game-${index}`, storage);
        }
        rememberDiscoveredGame('game-10', storage);

        const history = readDiscoveryHistory(storage);
        expect(history).toHaveLength(DISCOVERY_HISTORY_LIMIT);
        expect(history.at(-1)).toBe('game-10');
        expect(new Set(history).size).toBe(history.length);
    });

    it('excludes every game already visited in the current tab and remembers the selection', async () => {
        const storage = createMemoryStorage();
        rememberDiscoveredGame('game-a', storage);
        rememberDiscoveredGame('game-b', storage);
        const client = { get: vi.fn(async () => response({ gameId: 'game-c' })) };

        const result = await findDiscoveryGame({ currentGameId: 'game-b', client, storage });

        expect(result).toEqual({ game: { gameId: 'game-c', name: 'game-c' }, cycleReset: false });
        const endpoint = client.get.mock.calls[0][0];
        const excluded = new URL(`https://foundry.test${endpoint}`).searchParams.getAll('exclude');
        expect(excluded).toEqual(['game-a', 'game-b']);
        expect(readDiscoveryHistory(storage)).toEqual(['game-a', 'game-b', 'game-c']);
    });

    it('starts a new cycle after exhausting the catalog without immediately repeating the current game', async () => {
        const storage = createMemoryStorage();
        rememberDiscoveredGame('game-a', storage);
        rememberDiscoveredGame('game-b', storage);
        const client = {
            get: vi.fn()
                .mockResolvedValueOnce(response({ ok: false, code: 'NO_PLAYABLE_GAMES', message: 'Cycle exhausted.' }))
                .mockResolvedValueOnce(response({ gameId: 'game-a' }))
        };

        const result = await findDiscoveryGame({ currentGameId: 'game-b', client, storage });

        expect(result.cycleReset).toBe(true);
        const retryEndpoint = client.get.mock.calls[1][0];
        expect(new URL(`https://foundry.test${retryEndpoint}`).searchParams.getAll('exclude')).toEqual(['game-b']);
        expect(readDiscoveryHistory(storage)).toEqual(['game-b', 'game-a']);
    });

    it('does not hide a genuine no-alternative error when only the current game was excluded', async () => {
        const storage = createMemoryStorage();
        const client = { get: vi.fn(async () => response({ ok: false, code: 'NO_PLAYABLE_GAMES', message: 'No alternative.' })) };

        await expect(findDiscoveryGame({ currentGameId: 'only-game', client, storage }))
            .rejects.toMatchObject({ message: 'No alternative.', code: 'NO_PLAYABLE_GAMES' });
        expect(client.get).toHaveBeenCalledTimes(1);
    });

    it('continues when session storage is unavailable', async () => {
        const blockedStorage = {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('blocked'); },
            removeItem: () => { throw new Error('blocked'); }
        };
        const client = { get: vi.fn(async () => response({ gameId: 'game-a' })) };

        await expect(findDiscoveryGame({ currentGameId: 'current-game', client, storage: blockedStorage })).resolves.toMatchObject({ game: { gameId: 'game-a' } });
        const endpoint = client.get.mock.calls[0][0];
        expect(new URL(`https://foundry.test${endpoint}`).searchParams.getAll('exclude')).toEqual(['current-game']);
        expect(() => clearDiscoveryHistory(blockedStorage)).not.toThrow();
    });
});
