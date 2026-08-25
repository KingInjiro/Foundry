import { apiClient } from '../api/apiClient.js';
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Bookmark, Check, ChevronLeft, Gamepad2, Play, Radio, RefreshCw, Share2, Star, UserPlus, UserRoundCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { requestPersistentStorage } from '../discovery/storagePersistence.js';

export function GameDetails() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user, login } = useAuth();
    const [game, setGame] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [actionBusy, setActionBusy] = useState(false);
    const [actionError, setActionError] = useState('');
    const [shareStatus, setShareStatus] = useState('');

    const loadGame = async () => {
        setLoading(true);
        try {
            const response = await apiClient.get(`/api/catalog/games/${id}`);
            const result = await response.json();
            if (result.success) {
                setGame({
                    ...result.data,
                    id: result.data.gameId,
                    title: result.data.name,
                    description: result.data.description || 'No description available.',
                    tags: result.data.tags || [],
                    controls: result.data.controls || []
                });
                setError(null);
            } else {
                setError(result.error?.message || 'Failed to load game');
            }
        } catch (err) {
            console.error('Failed to fetch game details', err);
            setError('Network error loading game');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadGame(); }, [id, user?.uid]);

    const requireUser = async () => {
        if (user) return true;
        return Boolean(await login());
    };

    const toggleLibrary = async () => {
        if (!await requireUser() || !game || actionBusy) return;
        setActionBusy(true);
        setActionError('');
        try {
            const inLibrary = Boolean(game.userState?.inLibrary);
            const response = inLibrary
                ? await apiClient.delete(`/api/library/${game.id}`)
                : await apiClient.put(`/api/library/${game.id}`, {});
            const result = await response.json();
            if (result.success) {
                setGame(current => ({ ...current, userState: { ...(current.userState || {}), inLibrary: result.data.inLibrary } }));
                if (result.data.inLibrary) void requestPersistentStorage();
            } else {
                throw new Error(result.error?.message || 'Could not update your Library.');
            }
        } catch (toggleError) {
            setActionError(toggleError.message || 'Could not update your Library.');
        } finally {
            setActionBusy(false);
        }
    };

    const rateGame = async (rating) => {
        if (!await requireUser() || !game || actionBusy) return;
        setActionBusy(true);
        setActionError('');
        try {
            const response = await apiClient.put(`/api/ratings/${game.id}`, { rating });
            const result = await response.json();
            if (result.success) {
                setGame(current => ({
                    ...current,
                    rating: result.data.average,
                    ratingCount: result.data.count,
                    userState: { ...(current.userState || {}), userRating: result.data.userRating }
                }));
            } else {
                throw new Error(result.error?.message || 'Could not save your rating.');
            }
        } catch (ratingError) {
            setActionError(ratingError.message || 'Could not save your rating.');
        } finally {
            setActionBusy(false);
        }
    };

    const toggleFollow = async () => {
        if (!await requireUser() || !game?.developerUid || actionBusy) return;
        setActionBusy(true);
        setActionError('');
        try {
            const following = Boolean(game.userState?.followingDeveloper);
            const response = following
                ? await apiClient.delete(`/api/developers/${game.developerUid}/follow`)
                : await apiClient.put(`/api/developers/${game.developerUid}/follow`, {});
            const result = await response.json();
            if (result.success) {
                setGame(current => ({ ...current, userState: { ...(current.userState || {}), followingDeveloper: result.data.following } }));
            } else {
                throw new Error(result.error?.message || 'Could not update this follow.');
            }
        } catch (followError) {
            setActionError(followError.message || 'Could not update this follow.');
        } finally {
            setActionBusy(false);
        }
    };

    const shareGame = async () => {
        setShareStatus('');
        try {
            await navigator.clipboard.writeText(window.location.href);
            setShareStatus('Copied');
            window.setTimeout(() => setShareStatus(''), 1800);
        } catch {
            setActionError('Could not copy the game link.');
        }
    };

    if (loading) return <div className="flex-1 p-6 flex items-center justify-center text-neutral-500" role="status"><RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading game details…</div>;
    if (error || !game) return <div className="flex-1 p-6 flex items-center justify-center"><div className="text-center"><p className="text-red-400 font-bold mb-5">{error || 'Game not found'}</p><div className="flex gap-3"><button type="button" onClick={() => navigate('/player')} className="bg-neutral-800 hover:bg-neutral-700 px-4 py-2 rounded-lg inline-flex items-center gap-2"><ChevronLeft className="w-4 h-4" />Catalog</button><button type="button" onClick={loadGame} className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg inline-flex items-center gap-2"><RefreshCw className="w-4 h-4" />Try Again</button></div></div></div>;

    const userRating = game.userState?.userRating || 0;
    const following = Boolean(game.userState?.followingDeveloper);
    const inLibrary = Boolean(game.userState?.inLibrary);

    return (
        <main id="main-content" className="flex-1 p-6 md:p-12 max-w-5xl mx-auto w-full">
            {actionError && <div className="mb-5 border border-red-500/20 bg-red-500/5 text-red-300 rounded-xl p-3 text-sm" role="status">{actionError}</div>}
            <div className="flex flex-col md:flex-row gap-8 mb-12">
                <div className="w-full md:w-2/3 aspect-video bg-neutral-900 rounded-2xl border border-neutral-800 flex items-center justify-center relative overflow-hidden">
                    <Gamepad2 className="w-24 h-24 text-neutral-800" />
                    {game.thumbnailUrl && <img src={game.thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover" onError={event => { event.currentTarget.hidden = true; }} />}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex flex-col justify-end p-8">
                        <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-2">{game.title}</h1>
                        <div className="flex flex-wrap items-center gap-3 text-neutral-300">
                            <span>By {game.developer || 'Unknown Developer'}</span>
                            {game.streamingEnabled && <span className="inline-flex items-center gap-1.5 text-xs border border-blue-400/30 bg-blue-500/10 text-blue-300 px-2.5 py-1.5 rounded-full"><Radio className="w-3.5 h-3.5" />Streaming enabled</span>}
                            {game.developerUid && user?.uid !== game.developerUid && (
                                <button onClick={toggleFollow} disabled={actionBusy} aria-pressed={following} className="inline-flex items-center gap-1.5 text-xs border border-neutral-700 bg-neutral-900/80 hover:bg-neutral-800 disabled:opacity-50 px-2.5 py-1.5 rounded-full">
                                    {following ? <UserRoundCheck className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                                    {following ? 'Following' : 'Follow'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="w-full md:w-1/3 flex flex-col gap-4">
                    <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl">
                        <button onClick={() => navigate(`/player/game/${game.id}/play`)} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-transform active:scale-95 mb-3">
                            <Play className="w-5 h-5 fill-current" /> Play Now
                        </button>
                        <button onClick={toggleLibrary} disabled={actionBusy} aria-pressed={inLibrary} className={`w-full font-bold py-3 rounded-xl flex items-center justify-center gap-2 border transition-colors disabled:opacity-50 ${inLibrary ? 'bg-green-500/15 border-green-500/40 text-green-300' : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:bg-neutral-800'}`}>
                            <Bookmark className={`w-4 h-4 ${inLibrary ? 'fill-current' : ''}`} /> {inLibrary ? 'Kept in Library' : 'Keep for Later'}
                        </button>

                        <div className="grid grid-cols-2 gap-4 mt-6 text-center">
                            <div>
                                <div className="text-white text-lg font-bold flex items-center justify-center gap-1"><Star className="w-4 h-4 text-yellow-400 fill-current" />{game.rating > 0 ? Number(game.rating).toFixed(1) : '—'}</div>
                                <div className="text-xs text-neutral-500">{game.ratingCount || 0} ratings</div>
                            </div>
                            <div>
                                <div className="text-white text-lg font-bold">{game.playCount || 0}</div>
                                <div className="text-xs text-neutral-500">Plays</div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
                        <div className="text-sm font-semibold mb-3">Rate after trying it</div>
                        <div className="flex gap-1">
                            {[1,2,3,4,5].map(value => (
                                <button key={value} onClick={() => rateGame(value)} disabled={actionBusy} className="p-1.5 hover:scale-110 transition-transform" title={`${value} star${value === 1 ? '' : 's'}`}>
                                    <Star className={`w-6 h-6 ${value <= userRating ? 'text-yellow-400 fill-current' : 'text-neutral-700'}`} />
                                </button>
                            ))}
                        </div>
                        {!user && <div className="text-xs text-neutral-600 mt-2">Sign in when you rate or keep a game.</div>}
                    </div>

                    <button onClick={shareGame} className="w-full bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-medium">
                        {shareStatus ? <Check className="w-4 h-4 text-green-400" /> : <Share2 className="w-4 h-4" />}{shareStatus || 'Copy Link'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
                <div className="md:col-span-2">
                    <h2 className="text-2xl font-bold mb-4">About the Game</h2>
                    <p className="text-neutral-400 leading-relaxed mb-8">{game.description}</p>
                    {game.tags?.length > 0 && <><h2 className="text-2xl font-bold mb-4">Tags</h2><div className="flex flex-wrap gap-2">{game.tags.map(tag => <span key={tag} className="bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded-lg text-sm text-neutral-300">{tag}</span>)}</div></>}
                </div>
                {game.controls?.length > 0 && <div><h2 className="text-xl font-bold mb-4">Controls</h2><div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col gap-3">{game.controls.map((ctrl, i) => <div key={i} className="flex justify-between items-center text-sm"><span className="text-neutral-500">{ctrl.action}</span><span className="font-mono bg-neutral-950 px-2 py-1 rounded text-neutral-300 border border-neutral-800">{ctrl.key}</span></div>)}</div></div>}
            </div>
        </main>
    );
}
