export const CATALOG_SORT_OPTIONS = Object.freeze([
    { value: 'featured', label: 'Featured' },
    { value: 'newest', label: 'Newest' },
    { value: 'rating', label: 'Top Rated' },
    { value: 'popular', label: 'Most Played' },
    { value: 'name', label: 'Name' }
]);

const VALID_SORTS = new Set(CATALOG_SORT_OPTIONS.map(option => option.value));

function normalizedText(value) {
    return String(value || '').trim().toLocaleLowerCase();
}

export function normalizeCatalogSort(value) {
    return VALID_SORTS.has(value) ? value : 'featured';
}

export function filterAndSortGames(games, { query = '', tag = '', sort = 'featured' } = {}) {
    const normalizedQuery = normalizedText(query);
    const normalizedTag = normalizedText(tag);
    const normalizedSort = normalizeCatalogSort(sort);

    const filtered = (Array.isArray(games) ? games : []).filter(game => {
        const tags = Array.isArray(game.tags) ? game.tags : [];
        const matchesTag = !normalizedTag || tags.some(value => normalizedText(value) === normalizedTag);
        if (!matchesTag) return false;
        if (!normalizedQuery) return true;
        return [game.name, game.developer, game.description, ...tags]
            .some(value => normalizedText(value).includes(normalizedQuery));
    });

    if (normalizedSort === 'featured') return filtered;
    return filtered
        .map((game, index) => ({ game, index }))
        .sort((left, right) => {
            let difference = 0;
            if (normalizedSort === 'newest') {
                difference = Number(right.game.publishedAt || 0) - Number(left.game.publishedAt || 0);
            } else if (normalizedSort === 'rating') {
                difference = Number(right.game.rating || 0) - Number(left.game.rating || 0)
                    || Number(right.game.ratingCount || 0) - Number(left.game.ratingCount || 0);
            } else if (normalizedSort === 'popular') {
                difference = Number(right.game.playCount || 0) - Number(left.game.playCount || 0);
            } else if (normalizedSort === 'name') {
                difference = String(left.game.name || '').localeCompare(String(right.game.name || ''), undefined, { sensitivity: 'base' });
            }
            return difference || left.index - right.index;
        })
        .map(entry => entry.game);
}

export function collectPopularTags(games, limit = 10) {
    const counts = new Map();
    for (const game of Array.isArray(games) ? games : []) {
        for (const rawTag of Array.isArray(game.tags) ? game.tags : []) {
            const label = String(rawTag || '').trim();
            const key = normalizedText(label);
            if (!key) continue;
            const current = counts.get(key);
            counts.set(key, { label: current?.label || label, count: (current?.count || 0) + 1 });
        }
    }
    return [...counts.values()]
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
        .slice(0, Math.max(0, Number(limit) || 0));
}
