import { describe, expect, it } from 'vitest';
import { collectPopularTags, filterAndSortGames, normalizeCatalogSort } from '../../../src/platform/player/catalogFilters.js';

const games = [
    { gameId: 'a', name: 'Zeta', developer: 'North', description: 'Racing game', tags: ['Arcade', 'Fast'], publishedAt: 10, rating: 4.5, ratingCount: 2, playCount: 50 },
    { gameId: 'b', name: 'Alpha', developer: 'South', description: 'Puzzle world', tags: ['Puzzle', 'Arcade'], publishedAt: 30, rating: 4.5, ratingCount: 8, playCount: 20 },
    { gameId: 'c', name: 'Middle', developer: 'North', description: 'Calm builder', tags: ['Strategy'], publishedAt: 20, rating: 3, ratingCount: 10, playCount: 90 }
];

describe('catalog filters', () => {
    it('searches names, developers, descriptions and tags together', () => {
        expect(filterAndSortGames(games, { query: 'north' }).map(game => game.gameId)).toEqual(['a', 'c']);
        expect(filterAndSortGames(games, { query: 'puzzle' }).map(game => game.gameId)).toEqual(['b']);
        expect(filterAndSortGames(games, { query: 'fast' }).map(game => game.gameId)).toEqual(['a']);
    });

    it('combines exact tag filtering with each stable sort mode', () => {
        expect(filterAndSortGames(games, { tag: 'arcade', sort: 'newest' }).map(game => game.gameId)).toEqual(['b', 'a']);
        expect(filterAndSortGames(games, { sort: 'rating' }).map(game => game.gameId)).toEqual(['b', 'a', 'c']);
        expect(filterAndSortGames(games, { sort: 'popular' }).map(game => game.gameId)).toEqual(['c', 'a', 'b']);
        expect(filterAndSortGames(games, { sort: 'name' }).map(game => game.gameId)).toEqual(['b', 'c', 'a']);
    });

    it('falls back to featured order for unsupported URL values', () => {
        expect(normalizeCatalogSort('unknown')).toBe('featured');
        expect(filterAndSortGames(games, { sort: 'unknown' })).toEqual(games);
    });

    it('counts tags case-insensitively and ranks the most common labels first', () => {
        expect(collectPopularTags([...games, { tags: ['arcade'] }], 2)).toEqual([
            { label: 'Arcade', count: 3 },
            { label: 'Fast', count: 1 }
        ]);
    });
});
