import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bookmark, Clock3, Gamepad2, Play, RefreshCw, UserMinus, Users, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { dismissRecentGame, loadLibraryCollections, removeSavedGame, unfollowDeveloper } from './libraryData.js';

function GameTile({ game, subtitle, onRemove, removeLabel, actionBusy = false }) {
    const navigate = useNavigate();
    return (
        <article className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 flex items-center gap-4">
            <div className="w-24 h-16 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0 overflow-hidden relative">
                <Gamepad2 className="w-7 h-7 text-neutral-600" />
                {game.thumbnailUrl && <img src={game.thumbnailUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" onError={event => { event.currentTarget.hidden = true; }} />}
            </div>
            <div className="min-w-0 flex-1">
                <button type="button" onClick={() => navigate(`/player/game/${game.gameId}`)} className="font-bold hover:text-blue-300 text-left truncate block w-full">
                    {game.name}
                </button>
                <div className="text-sm text-neutral-500 truncate">{subtitle || game.developer || 'Unknown developer'}</div>
            </div>
            {onRemove && (
                <button type="button" onClick={onRemove} disabled={actionBusy} className="p-2 rounded-lg text-neutral-500 hover:text-white hover:bg-neutral-800 disabled:opacity-50" title={removeLabel} aria-label={`${removeLabel}: ${game.name}`}>
                    <X className="w-4 h-4" />
                </button>
            )}
            <button type="button" onClick={() => navigate(`/player/game/${game.gameId}/play`)} className="p-3 rounded-lg bg-blue-600 hover:bg-blue-500" title={`Play ${game.name}`} aria-label={`Play ${game.name}`}>
                <Play className="w-4 h-4 fill-current" />
            </button>
        </article>
    );
}

export function LibraryPage() {
    const { user, login } = useAuth();
    const [saved, setSaved] = useState([]);
    const [recent, setRecent] = useState([]);
    const [following, setFollowing] = useState({ developers: [], games: [] });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [actionError, setActionError] = useState('');
    const [actionStatus, setActionStatus] = useState('');
    const [actionBusy, setActionBusy] = useState('');
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        if (!user) {
            setSaved([]);
            setRecent([]);
            setFollowing({ developers: [], games: [] });
            setError('');
            setActionError('');
            setActionStatus('');
            setActionBusy('');
            setLoading(false);
            return undefined;
        }
        let cancelled = false;
        setLoading(true);
        setError('');
        loadLibraryCollections().then(result => {
            if (cancelled) return;
            setSaved(result.saved);
            setRecent(result.recent);
            setFollowing(result.following);
            setError(result.errors.join(' '));
        }).catch(loadError => {
            console.error('Failed to load library', loadError);
            if (!cancelled) setError(loadError.message || 'Could not load your Library.');
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [user?.uid, reloadKey]);

    const runAction = async ({ key, action, onSuccess, successMessage }) => {
        if (actionBusy) return;
        setActionBusy(key);
        setActionError('');
        setActionStatus('');
        try {
            await action();
            onSuccess();
            setActionStatus(successMessage);
        } catch (actionFailure) {
            setActionError(actionFailure.message || 'The Library could not be updated.');
        } finally {
            setActionBusy('');
        }
    };

    const removeSaved = game => runAction({
        key: `saved:${game.gameId}`,
        action: () => removeSavedGame(game.gameId),
        onSuccess: () => setSaved(items => items.filter(item => item.gameId !== game.gameId)),
        successMessage: `${game.name} was removed from Saved Games.`
    });

    const dismissRecent = game => runAction({
        key: `recent:${game.gameId}`,
        action: () => dismissRecentGame(game.gameId),
        onSuccess: () => setRecent(items => items.filter(item => item.gameId !== game.gameId)),
        successMessage: `${game.name} was hidden from Continue Playing. Playing it again will restore it.`
    });

    const removeFollow = developer => runAction({
        key: `follow:${developer.uid}`,
        action: () => unfollowDeveloper(developer.uid),
        onSuccess: () => setFollowing(current => ({
            developers: current.developers.filter(item => item.uid !== developer.uid),
            games: current.games.filter(game => game.developerUid !== developer.uid)
        })),
        successMessage: `You stopped following ${developer.displayName || developer.uid}.`
    });

    if (!user) {
        return (
            <main id="main-content" className="flex-1 p-6 md:p-12 max-w-4xl mx-auto w-full flex items-center justify-center">
                <div className="max-w-lg text-center rounded-2xl border border-neutral-800 bg-neutral-900 p-8">
                    <Bookmark className="w-10 h-10 mx-auto text-blue-400 mb-4" />
                    <h2 className="text-2xl font-bold mb-2">Your games, across sessions.</h2>
                    <p className="text-neutral-400 mb-6">Sign in to keep games, continue recently played titles, rate them, and follow developers.</p>
                    <button type="button" onClick={login} className="bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded-xl font-bold">Sign In</button>
                </div>
            </main>
        );
    }

    return (
        <main id="main-content" className="flex-1 p-6 md:p-12 max-w-6xl mx-auto w-full">
            <div className="mb-10">
                <h1 className="text-4xl font-extrabold mb-2">My Library</h1>
                <p className="text-neutral-400">Return to games you kept, recently played, or discovered through creators you follow.</p>
            </div>

            {loading ? <div className="text-neutral-500 flex items-center gap-2" role="status"><RefreshCw className="w-4 h-4 animate-spin" />Loading your library…</div> : (
                <>
                    {error && <div className="border border-amber-500/20 bg-amber-500/5 rounded-xl p-5 mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4" role="status"><p className="text-amber-200 text-sm">{error}</p><button type="button" onClick={() => setReloadKey(value => value + 1)} className="bg-neutral-800 hover:bg-neutral-700 px-4 py-2 rounded-lg text-sm font-bold">Retry Missing Sections</button></div>}
                    {actionError && <div className="border border-red-500/20 bg-red-500/5 text-red-300 rounded-xl p-4 mb-6 text-sm" role="alert">{actionError}</div>}
                    {actionStatus && <div className="border border-green-500/20 bg-green-500/5 text-green-300 rounded-xl p-4 mb-6 text-sm" role="status" aria-live="polite">{actionStatus}</div>}
                    <div className="space-y-12">
                    <section>
                        <div className="flex items-center gap-2 mb-5"><Clock3 className="w-5 h-5 text-blue-400" /><h2 className="text-2xl font-bold">Continue Playing</h2></div>
                        {recent.length ? (
                            <div className="grid md:grid-cols-2 gap-4">
                                {recent.map(game => <GameTile key={game.gameId} game={game} subtitle={game.lastPlayedAt ? `Last played ${new Date(game.lastPlayedAt).toLocaleString()}` : game.developer} onRemove={() => dismissRecent(game)} removeLabel="Hide from Continue Playing" actionBusy={Boolean(actionBusy)} />)}
                            </div>
                        ) : <p className="text-neutral-500">Games you play while signed in will appear here. <Link to="/player" className="font-medium text-blue-400 hover:text-blue-300">Browse games</Link></p>}
                    </section>

                    <section>
                        <div className="flex items-center gap-2 mb-5"><Bookmark className="w-5 h-5 text-green-400" /><h2 className="text-2xl font-bold">Saved Games</h2></div>
                        {saved.length ? (
                            <div className="grid md:grid-cols-2 gap-4">{saved.map(game => <GameTile key={game.gameId} game={game} onRemove={() => removeSaved(game)} removeLabel="Remove from Saved Games" actionBusy={Boolean(actionBusy)} />)}</div>
                        ) : <p className="text-neutral-500">Use “Keep” on a game you want to return to. <Link to="/player" className="font-medium text-blue-400 hover:text-blue-300">Browse games</Link></p>}
                    </section>

                    <section>
                        <div className="flex items-center gap-2 mb-5"><Users className="w-5 h-5 text-violet-400" /><h2 className="text-2xl font-bold">Following</h2></div>
                        {following.developers?.length ? (
                            <div className="flex flex-wrap gap-2 mb-5">
                                {following.developers.map(dev => (
                                    <button key={dev.uid} type="button" onClick={() => removeFollow(dev)} disabled={Boolean(actionBusy)} className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-sm" title={`Unfollow ${dev.displayName || dev.uid}`}>
                                        {dev.displayName || dev.uid}<UserMinus className="w-3.5 h-3.5 text-neutral-500" />
                                    </button>
                                ))}
                            </div>
                        ) : <p className="text-neutral-500 mb-5">Follow a developer from a game page to see their future published games here. <Link to="/player" className="font-medium text-blue-400 hover:text-blue-300">Browse games</Link></p>}
                        {following.games?.length > 0 && <div className="grid md:grid-cols-2 gap-4">{following.games.map(game => <GameTile key={game.gameId} game={game} />)}</div>}
                    </section>
                    </div>
                </>
            )}
        </main>
    );
}
