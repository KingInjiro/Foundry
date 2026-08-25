import { apiClient } from '../api/apiClient.js';
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Clock3, Flame, Gamepad2, LoaderCircle, Play, Radio, Search, Shuffle, Sparkles, Star, Tags, X } from 'lucide-react';
import { PlayNowButton } from '../discovery/PlayNowButton.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { trackDiscoveryEvent } from '../discovery/telemetry.js';
import { CATALOG_SORT_OPTIONS, normalizeCatalogSort } from './catalogFilters.js';

async function loadDiscoveryEndpoint(endpoint) {
    const response = await apiClient.get(endpoint);
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error?.message || 'Discovery request failed.');
    return result;
}

function GameCard({ game, onTagSelect = null }) {
    const navigate = useNavigate();
    const cardRef = useRef(null);
    const impressionTrackedRef = useRef(false);

    useEffect(() => {
        const node = cardRef.current;
        if (!node || impressionTrackedRef.current || typeof IntersectionObserver === 'undefined') return undefined;
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.5)) {
                impressionTrackedRef.current = true;
                const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
                void trackDiscoveryEvent({ sessionId: `impression:${game.gameId}:${random}`, gameId: game.gameId, eventType: 'impression' });
                observer.disconnect();
            }
        }, { threshold: [0.5] });
        observer.observe(node);
        return () => observer.disconnect();
    }, [game.gameId]);

    return (
        <article ref={cardRef} className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden group hover:border-neutral-700 hover:-translate-y-0.5 transition-all">
            <button type="button" onClick={() => navigate(`/player/game/${game.gameId}/play`)} className="block w-full aspect-video bg-neutral-800 relative text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500" aria-label={`Play ${game.name}`}>
                <div className="absolute inset-0 flex items-center justify-center text-neutral-600"><Gamepad2 className="w-12 h-12" /></div>
                {game.thumbnailUrl && <img src={game.thumbnailUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" onError={event => { event.currentTarget.hidden = true; }} />}
                {game.streamingEnabled && <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full border border-blue-400/30 bg-neutral-950/85 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-blue-300"><Radio className="w-3 h-3" />Streaming</span>}
                <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center justify-center"><div className="bg-blue-500 text-white rounded-full p-3 shadow-lg"><Play className="w-6 h-6 fill-current" /></div></div>
            </button>
            <div className="p-4">
                <button type="button" onClick={() => navigate(`/player/game/${game.gameId}`)} className="text-left w-full focus-visible:outline-none">
                    <h3 className="font-bold text-lg hover:text-blue-300 focus-visible:text-blue-300 transition-colors truncate">{game.name}</h3>
                    <p className="text-neutral-500 text-sm mt-1 mb-3 line-clamp-2 min-h-10">{game.description || 'No description available.'}</p>
                </button>
                {game.tags?.length > 0 && (
                    <div className="flex gap-1.5 mb-3 overflow-hidden">
                        {game.tags.slice(0, 3).map(tag => onTagSelect ? (
                            <button key={tag} type="button" onClick={() => onTagSelect(tag)} className="truncate max-w-28 rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[10px] text-neutral-400 hover:border-blue-500/50 hover:text-blue-300" title={`Filter by ${tag}`}>{tag}</button>
                        ) : <span key={tag} className="truncate max-w-28 rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[10px] text-neutral-400">{tag}</span>)}
                    </div>
                )}
                <div className="flex items-center justify-between gap-3 text-xs text-neutral-500">
                    <span className="truncate">{game.developer || 'Unknown developer'}</span>
                    <div className="flex items-center gap-3 shrink-0">
                        <span className="inline-flex items-center gap-1"><Play className="w-3 h-3" />{game.playCount || 0}</span>
                        <span className="inline-flex items-center gap-1"><Star className="w-3 h-3 text-yellow-500" />{game.rating > 0 ? Number(game.rating).toFixed(1) : '—'}</span>
                    </div>
                </div>
            </div>
        </article>
    );
}

function GameSection({ title, description, icon: Icon, games }) {
    if (!games?.length) return null;
    return (
        <section className="mb-12">
            <div className="mb-5">
                <div className="flex items-center gap-2"><Icon className="w-5 h-5 text-blue-400" /><h2 className="text-2xl md:text-3xl font-extrabold">{title}</h2></div>
                {description && <p className="text-neutral-500 mt-1">{description}</p>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">{games.map(game => <GameCard key={game.gameId} game={game} />)}</div>
        </section>
    );
}

function CatalogSkeleton() {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6" role="status" aria-label="Loading games">
            {[1, 2, 3, 4].map(item => <div key={item} className="h-72 rounded-xl border border-neutral-900 bg-neutral-900/60 animate-pulse" />)}
        </div>
    );
}

export function GameCatalog() {
    const { user } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [games, setGames] = useState([]);
    const [trending, setTrending] = useState([]);
    const [recommended, setRecommended] = useState([]);
    const [personalized, setPersonalized] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [reloadKey, setReloadKey] = useState(0);
    const [popularTags, setPopularTags] = useState([]);
    const [nextCursor, setNextCursor] = useState(null);
    const [loadingMore, setLoadingMore] = useState(false);

    const query = searchParams.get('q') || '';
    const selectedTag = searchParams.get('tag') || '';
    const sort = normalizeCatalogSort(searchParams.get('sort') || 'featured');
    const [debouncedQuery, setDebouncedQuery] = useState(query);

    useEffect(() => {
        const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
        return () => window.clearTimeout(timeout);
    }, [query]);

    const catalogEndpoint = cursor => {
        const params = new URLSearchParams({ limit: '24' });
        if (debouncedQuery) params.set('q', debouncedQuery);
        if (selectedTag) params.set('tag', selectedTag);
        if (sort !== 'featured') params.set('sort', sort);
        if (cursor) params.set('cursor', cursor);
        return `/api/catalog/games?${params.toString()}`;
    };

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            setLoadError('');
            try {
                const catalogResult = await loadDiscoveryEndpoint(catalogEndpoint());
                if (cancelled) return;
                setGames(catalogResult.data || []);
                setPopularTags(catalogResult.meta?.popularTags || []);
                setNextCursor(catalogResult.meta?.nextCursor || null);
            } catch (error) {
                if (!cancelled) setLoadError(error.message || 'Could not load playable games.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [debouncedQuery, selectedTag, sort, reloadKey]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const [trendingResult, recommendationsResult] = await Promise.allSettled([
                loadDiscoveryEndpoint('/api/discovery/trending?limit=4'),
                loadDiscoveryEndpoint('/api/discovery/recommendations?limit=4')
            ]);
            if (cancelled) return;
            setTrending(trendingResult.status === 'fulfilled' ? trendingResult.value.data || [] : []);
            if (recommendationsResult.status === 'fulfilled') {
                setRecommended(recommendationsResult.value.data || []);
                setPersonalized(Boolean(recommendationsResult.value.meta?.personalized));
            } else {
                setRecommended([]);
                setPersonalized(false);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [user?.uid, reloadKey]);

    const loadMore = async () => {
        if (!nextCursor || loadingMore) return;
        setLoadingMore(true);
        setLoadError('');
        try {
            const result = await loadDiscoveryEndpoint(catalogEndpoint(nextCursor));
            setGames(current => {
                const byId = new Map(current.map(game => [game.gameId, game]));
                for (const game of result.data || []) byId.set(game.gameId, game);
                return [...byId.values()];
            });
            setNextCursor(result.meta?.nextCursor || null);
        } catch (error) {
            setLoadError(error.message || 'Could not load more games.');
        } finally {
            setLoadingMore(false);
        }
    };

    const setFilter = (key, value) => {
        setSearchParams(current => {
            const next = new URLSearchParams(current);
            if (value && !(key === 'sort' && value === 'featured')) next.set(key, value);
            else next.delete(key);
            return next;
        }, { replace: true });
    };

    const clearFilters = () => {
        setSearchParams(current => {
            const next = new URLSearchParams(current);
            next.delete('q');
            next.delete('tag');
            next.delete('sort');
            return next;
        }, { replace: true });
    };

    return (
        <main id="main-content" className="flex-1 p-5 md:p-12 max-w-7xl mx-auto w-full">
            <section className="mb-14 rounded-3xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-neutral-900 to-neutral-950 p-7 md:p-10 flex flex-col lg:flex-row gap-8 items-start lg:items-center justify-between">
                <div className="max-w-2xl">
                    <div className="flex items-center gap-2 text-blue-300 font-semibold text-sm mb-3"><Shuffle className="w-4 h-4" /> PLAYABLE DISCOVERY</div>
                    <h1 className="text-3xl md:text-4xl font-extrabold mb-3">Don't browse forever. Try the game.</h1>
                    <p className="text-neutral-400 text-lg">Foundry ranks playable games from real session signals. Start instantly, keep what you like, or jump straight to the next one.</p>
                </div>
                <PlayNowButton label="Play Something Now" />
            </section>

            {loading ? <CatalogSkeleton /> : loadError ? (
                <div className="border border-red-500/20 bg-red-500/5 rounded-2xl p-8 text-center">
                    <div className="text-red-300 font-bold mb-2">Discovery is temporarily unavailable</div>
                    <p className="text-neutral-500 mb-5">{loadError}</p>
                    <button type="button" onClick={() => setReloadKey(value => value + 1)} className="bg-neutral-800 hover:bg-neutral-700 px-5 py-2.5 rounded-lg font-bold">Try Again</button>
                </div>
            ) : games.length === 0 && !query && !selectedTag && sort === 'featured' && !trending.length && !recommended.length ? (
                <div className="border border-neutral-800 bg-neutral-900/50 rounded-2xl p-10 text-center"><Gamepad2 className="w-12 h-12 mx-auto text-neutral-700 mb-4" /><div className="text-white font-bold text-lg mb-2">No published games yet</div><div className="text-neutral-500">Discovery becomes useful as soon as developers publish playable games.</div></div>
            ) : (
                <>
                    <GameSection title={personalized ? 'Recommended for You' : 'Worth Trying'} description={personalized ? 'Deprioritizes games you already played or kept.' : 'A quality-and-freshness ranking until you sign in and build play history.'} icon={Sparkles} games={recommended} />
                    <GameSection title="Trending Now" description="Driven by launches, successful game starts, ratings and library saves from the last week." icon={Flame} games={trending} />
                    <section id="all-games">
                        <div className="mb-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
                            <div><div className="flex items-center gap-2"><Clock3 className="w-5 h-5 text-neutral-400" /><h2 className="text-2xl md:text-3xl font-extrabold">All Playable Games</h2></div><p className="text-neutral-500 mt-1">Search when you already know what you want.</p></div>
                            <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                                <label className="relative w-full md:w-72">
                                    <span className="sr-only">Search games</span>
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                                    <input value={query} onChange={event => setFilter('q', event.target.value)} maxLength={120} placeholder="Search games, tags or developers" className="w-full bg-neutral-900 border border-neutral-800 rounded-xl py-2.5 pl-10 pr-10 text-sm outline-none focus:border-blue-500" />
                                    {query && <button type="button" onClick={() => setFilter('q', '')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-neutral-500 hover:text-white" aria-label="Clear search"><X className="w-4 h-4" /></button>}
                                </label>
                                <label>
                                    <span className="sr-only">Sort games</span>
                                    <select value={sort} onChange={event => setFilter('sort', event.target.value)} className="w-full sm:w-auto bg-neutral-900 border border-neutral-800 rounded-xl py-2.5 px-3 text-sm outline-none focus:border-blue-500">
                                        {CATALOG_SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </label>
                            </div>
                        </div>
                        {popularTags.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 mb-5" aria-label="Filter by tag">
                                <Tags className="w-4 h-4 text-neutral-500" aria-hidden="true" />
                                {popularTags.map(({ label, count }) => (
                                    <button key={label.toLocaleLowerCase()} type="button" onClick={() => setFilter('tag', selectedTag.toLocaleLowerCase() === label.toLocaleLowerCase() ? '' : label)} aria-pressed={selectedTag.toLocaleLowerCase() === label.toLocaleLowerCase()} className={`rounded-full border px-3 py-1 text-xs transition-colors ${selectedTag.toLocaleLowerCase() === label.toLocaleLowerCase() ? 'border-blue-500/60 bg-blue-500/15 text-blue-300' : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700 hover:text-white'}`}>
                                        {label} <span className="text-neutral-600">{count}</span>
                                    </button>
                                ))}
                                {(query || selectedTag || sort !== 'featured') && <button type="button" onClick={clearFilters} className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1">Clear filters</button>}
                            </div>
                        )}
                        {games.length ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">{games.map(game => <GameCard key={game.gameId} game={game} onTagSelect={tag => setFilter('tag', tag)} />)}</div>
                        ) : (
                            <div className="border border-dashed border-neutral-800 rounded-xl p-8 text-center text-neutral-500">No games match the current filters. <button type="button" onClick={clearFilters} className="text-blue-400 hover:text-blue-300">Clear filters</button></div>
                        )}
                        <div className="mt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="text-xs text-neutral-600">Loaded {games.length} playable {games.length === 1 ? 'game' : 'games'}</div>
                            {nextCursor && (
                                <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-bold hover:bg-neutral-800 disabled:opacity-50">
                                    {loadingMore && <LoaderCircle className="h-4 w-4 animate-spin" />}{loadingMore ? 'Loading…' : 'Load More'}
                                </button>
                            )}
                        </div>
                    </section>
                </>
            )}
        </main>
    );
}
