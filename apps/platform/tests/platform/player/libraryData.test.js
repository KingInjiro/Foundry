import { describe, expect, it, vi } from 'vitest';
import { dismissRecentGame, loadLibraryCollections, removeSavedGame, unfollowDeveloper } from '../../../src/platform/player/libraryData.js';

function response(data, { ok = true, success = true, message } = {}) {
    return {
        ok,
        json: vi.fn(async () => success
            ? { success: true, data }
            : { success: false, error: { message } })
    };
}

describe('loadLibraryCollections', () => {
    it('loads and normalizes all three independent sections', async () => {
        const client = {
            get: vi.fn(async endpoint => {
                if (endpoint === '/api/library') return response([{ gameId: 'saved' }]);
                if (endpoint === '/api/continue-playing') return response([{ gameId: 'recent' }]);
                return response({ developers: [{ uid: 'dev' }], games: [{ gameId: 'followed' }] });
            })
        };

        await expect(loadLibraryCollections(client)).resolves.toEqual({
            saved: [{ gameId: 'saved' }],
            recent: [{ gameId: 'recent' }],
            following: { developers: [{ uid: 'dev' }], games: [{ gameId: 'followed' }] },
            errors: []
        });
    });

    it('keeps available sections when one endpoint fails', async () => {
        const client = {
            get: vi.fn(async endpoint => {
                if (endpoint === '/api/library') return response([{ gameId: 'saved' }]);
                if (endpoint === '/api/continue-playing') {
                    return response(null, { ok: false, success: false, message: 'Recent history is unavailable.' });
                }
                return response({ developers: [], games: [] });
            })
        };

        const result = await loadLibraryCollections(client);
        expect(result.saved).toEqual([{ gameId: 'saved' }]);
        expect(result.recent).toEqual([]);
        expect(result.following).toEqual({ developers: [], games: [] });
        expect(result.errors).toEqual(['Recent history is unavailable.']);
    });

    it('reports unreadable responses without discarding other data', async () => {
        const client = {
            get: vi.fn(async endpoint => endpoint === '/api/library'
                ? { ok: true, json: vi.fn(async () => { throw new Error('invalid json'); }) }
                : response(endpoint === '/api/following' ? { developers: [], games: [] } : []))
        };

        const result = await loadLibraryCollections(client);
        expect(result.errors).toEqual(['Saved games returned an unreadable response.']);
        expect(result.recent).toEqual([]);
    });

    it('uses the exact deletion endpoints for direct Library management', async () => {
        const client = { delete: vi.fn(async endpoint => response({ endpoint })) };

        await expect(removeSavedGame('game/one', client)).resolves.toEqual({ endpoint: '/api/library/game%2Fone' });
        await expect(dismissRecentGame('game two', client)).resolves.toEqual({ endpoint: '/api/continue-playing/game%20two' });
        await expect(unfollowDeveloper('dev@example', client)).resolves.toEqual({ endpoint: '/api/developers/dev%40example/follow' });
    });

    it('surfaces mutation API failures with their actionable message', async () => {
        const client = { delete: vi.fn(async () => response(null, { ok: false, success: false, message: 'Try again later.' })) };
        await expect(dismissRecentGame('game', client)).rejects.toThrow('Try again later.');
    });
});
