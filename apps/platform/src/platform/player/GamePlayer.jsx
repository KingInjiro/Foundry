import { apiClient } from '../api/apiClient.js';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Bookmark, ChevronLeft, Maximize2, RotateCcw, ShieldAlert, Shuffle } from 'lucide-react';
import { SANDBOX_MESSAGE_TYPES } from '@foundry/player/sandboxProtocol';
import { SandboxBridge } from './SandboxBridge';
import { FoundryRuntimeAdapter, WebGameRuntimeAdapter } from '../backend/runtime/GameRuntimeAdapter';
import { useAuth } from '../auth/AuthContext.jsx';
import { requestPersistentStorage } from '../discovery/storagePersistence.js';
import { createPlaySessionId, trackDiscoveryEvent } from '../discovery/telemetry.js';
import { findDiscoveryGame, rememberDiscoveredGame } from '../discovery/discoveryQueue.js';
import { createGameSaveKey, gameSaveStorage } from './gameSaveStorage.js';

const SAVE_STATUS_LABELS = Object.freeze({
    enabled: 'Progress saves locally',
    saving: 'Saving progress…',
    saved: 'Progress saved',
    restored: 'Progress restored',
    error: 'Progress could not be saved'
});

function createLaunchId(gameId) {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${gameId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function GamePlayer() {
    const { id } = useParams();
    const navigate = useNavigate();
    const iframeRef = useRef(null);
    const bridgeRef = useRef(null);
    const sessionIdRef = useRef(null);
    const sessionStartedAtRef = useRef(0);
    const readyTrackedRef = useRef(false);
    const saveSequenceRef = useRef(0);
    const saveWarningShownRef = useRef(false);
    const { user, login } = useAuth();
    const [launchConfig, setLaunchConfig] = useState(null);
    const [gameStatus, setGameStatus] = useState('loading');
    const [nextLoading, setNextLoading] = useState(false);
    const [inLibrary, setInLibrary] = useState(false);
    const [libraryBusy, setLibraryBusy] = useState(false);
    const [actionError, setActionError] = useState('');
    const [launchError, setLaunchError] = useState('');
    const [retryNonce, setRetryNonce] = useState(0);
    const [progressStatus, setProgressStatus] = useState('idle');
    const [clearSaveBusy, setClearSaveBusy] = useState(false);

    useEffect(() => {
        rememberDiscoveredGame(id);
        sessionIdRef.current = createPlaySessionId(id);
        sessionStartedAtRef.current = Date.now();
        readyTrackedRef.current = false;
        void trackDiscoveryEvent({ sessionId: sessionIdRef.current, gameId: id, eventType: 'play_start' });

        return () => {
            const durationMs = Math.max(0, Date.now() - sessionStartedAtRef.current);
            void trackDiscoveryEvent({
                sessionId: sessionIdRef.current,
                gameId: id,
                eventType: 'session_end',
                durationMs,
                keepalive: true
            });
        };
    }, [id]);

    useEffect(() => {
        let cancelled = false;

        const fetchConfig = async () => {
            setLaunchConfig(null);
            setGameStatus('loading');
            setActionError('');
            setLaunchError('');
            setProgressStatus('idle');
            saveSequenceRef.current = 0;
            saveWarningShownRef.current = false;

            try {
                const response = await apiClient.get(`/api/catalog/games/${id}`);
                const result = await response.json();

                if (!result.success || !result.data) {
                    if (!cancelled) {
                        setLaunchError(result.error?.message || 'This game is not published or no longer available.');
                        setGameStatus('not_found');
                    }
                    return;
                }

                const manifest = {
                    runtime: result.data.runtime,
                    entry: result.data.entry,
                    capabilities: result.data.capabilities || []
                };
                const storageRef = result.data.storageRef;
                if (!cancelled) setInLibrary(Boolean(result.data.userState?.inLibrary));

                let streamingManifest = null;
                if (result.data.runtime === 'foundry' && result.data.streamingManifestUrl) {
                    try {
                        const { StreamingManifestLoader } = await import('@foundry/player/streaming/StreamingManifestLoader');
                        const loader = new StreamingManifestLoader();
                        streamingManifest = await loader.load(result.data.streamingManifestUrl);
                        console.log('[Streaming Platform] Successfully loaded streaming manifest:', streamingManifest);
                    } catch (streamingError) {
                        console.error('[Streaming Platform] Declared streaming manifest could not be loaded.', streamingError);
                        throw new Error('Streaming resources could not be prepared. Check your connection and retry.');
                    }
                }

                const adapter = manifest.runtime === 'foundry'
                    ? new FoundryRuntimeAdapter()
                    : new WebGameRuntimeAdapter();
                const config = await adapter.prepareLaunchConfig(manifest, storageRef, streamingManifest);

                let saveKey = null;
                let recoverState = null;
                let saveStatus = 'idle';
                if (config.type === 'foundry' && config.capabilities.includes('storage')) {
                    saveKey = createGameSaveKey({
                        viewerId: user?.uid || 'guest',
                        gameId: id,
                        versionId: result.data.versionId || result.data.gameVersion
                    });
                    try {
                        recoverState = await gameSaveStorage.load(saveKey);
                        saveStatus = recoverState ? 'restored' : 'enabled';
                    } catch (saveError) {
                        console.warn('Local game progress could not be loaded.', saveError);
                        saveStatus = 'error';
                    }
                }

                if (!cancelled) {
                    setProgressStatus(saveStatus);
                    setLaunchConfig({
                        ...config,
                        launchId: createLaunchId(id),
                        saveKey,
                        recoverState
                    });
                }
            } catch (err) {
                console.error('Failed to load game configuration', err);
                if (!cancelled) {
                    setLaunchError(err instanceof Error ? err.message : 'The game could not be prepared.');
                    setGameStatus('error');
                }
            }
        };

        fetchConfig();
        return () => { cancelled = true; };
    }, [id, retryNonce, user?.uid]);

    const sendFoundryLaunch = useCallback(() => {
        if (!launchConfig || launchConfig.type !== 'foundry') return false;
        return bridgeRef.current?.send(SANDBOX_MESSAGE_TYPES.RUN_GAME, {
            launchId: launchConfig.launchId,
            gameUrl: launchConfig.gameUrl,
            assets: {},
            capabilities: launchConfig.capabilities,
            recoverState: launchConfig.recoverState,
            streamingManifest: launchConfig.streamingManifest
        }) || false;
    }, [launchConfig]);

    useEffect(() => {
        if (!iframeRef.current || !launchConfig) return;

        // Foundry games communicate through our same-origin sandbox page, so
        // their bridge can require an exact origin. Generic web games run in an
        // opaque-origin iframe and are still pinned to the exact iframe window
        // by SandboxBridge's event.source check.
        const bridgeOrigin = launchConfig.type === 'foundry' ? window.location.origin : 'null';
        const targetOrigin = launchConfig.type === 'foundry' ? window.location.origin : '*';
        const bridge = new SandboxBridge(iframeRef.current, bridgeOrigin, targetOrigin);
        let active = true;
        bridgeRef.current = bridge;

        bridge.on(SANDBOX_MESSAGE_TYPES.SANDBOX_READY, () => {
            sendFoundryLaunch();
        });
        bridge.on(SANDBOX_MESSAGE_TYPES.GAME_READY, (payload) => {
            if (payload?.launchId && payload.launchId !== launchConfig.launchId) return;
            console.log('Platform received GAME_READY:', payload);
            setGameStatus('ready');
            setLaunchError('');
            if (!readyTrackedRef.current) {
                readyTrackedRef.current = true;
                void trackDiscoveryEvent({ sessionId: sessionIdRef.current, gameId: id, eventType: 'game_ready' });
            }
        });
        bridge.on(SANDBOX_MESSAGE_TYPES.GAME_ERROR, (payload) => {
            if (payload?.launchId && payload.launchId !== launchConfig.launchId) return;
            console.error('Platform received GAME_ERROR:', payload);
            setLaunchError(payload?.message || 'The game runtime stopped unexpectedly.');
            setGameStatus('error');
            void trackDiscoveryEvent({ sessionId: sessionIdRef.current, gameId: id, eventType: 'game_error' });
        });
        bridge.on(SANDBOX_MESSAGE_TYPES.GAME_AUTOSAVE, (payload) => {
            if (!launchConfig.saveKey || typeof payload?.state !== 'string') return;
            if (payload?.launchId && payload.launchId !== launchConfig.launchId) return;

            const saveSequence = ++saveSequenceRef.current;
            setProgressStatus('saving');
            void gameSaveStorage.save(launchConfig.saveKey, payload.state).then(() => {
                if (active && saveSequence === saveSequenceRef.current) setProgressStatus('saved');
            }).catch((saveError) => {
                console.warn('Local game progress could not be saved.', saveError);
                if (!active) return;
                bridge.send(SANDBOX_MESSAGE_TYPES.DISABLE_AUTOSAVE, { launchId: launchConfig.launchId });
                setProgressStatus('error');
                if (!saveWarningShownRef.current) {
                    saveWarningShownRef.current = true;
                    setActionError('This game is still running, but its progress could not be saved on this device.');
                }
            });
        });
        bridge.on(SANDBOX_MESSAGE_TYPES.GAME_AUTOSAVE_ERROR, (payload) => {
            if (!launchConfig.saveKey) return;
            if (payload?.launchId && payload.launchId !== launchConfig.launchId) return;
            setProgressStatus('error');
            if (!saveWarningShownRef.current) {
                saveWarningShownRef.current = true;
                setActionError(payload?.message || 'This game is still running, but its progress is too large to save on this device.');
            }
        });
        bridge.on('GAME_EXIT', () => {
            navigate('/player');
        });

        // This covers an iframe that finished loading before the bridge effect
        // ran. SANDBOX_READY and iframe onLoad provide the other two race-safe
        // paths; the sandbox deduplicates them with launchId.
        sendFoundryLaunch();

        return () => {
            active = false;
            bridge.destroy();
            bridgeRef.current = null;
        };
    }, [launchConfig, navigate, id, sendFoundryLaunch]);

    const handleFullscreen = async () => {
        try {
            await iframeRef.current?.requestFullscreen?.();
        } catch {
            setActionError('Fullscreen could not be opened in this browser.');
        }
    };

    const handleToggleLibrary = async () => {
        if (!user && !await login()) return;
        if (libraryBusy) return;
        setLibraryBusy(true);
        setActionError('');
        try {
            const response = inLibrary
                ? await apiClient.delete(`/api/library/${id}`)
                : await apiClient.put(`/api/library/${id}`, {});
            const result = await response.json();
            if (result.success) {
                setInLibrary(Boolean(result.data.inLibrary));
                if (result.data.inLibrary) void requestPersistentStorage();
            } else {
                throw new Error(result.error?.message || 'Could not update your Library.');
            }
        } catch (error) {
            console.error('Failed to update library', error);
            setActionError(error.message || 'Could not update your Library.');
        } finally {
            setLibraryBusy(false);
        }
    };

    const handleNextGame = async () => {
        if (nextLoading) return;
        setNextLoading(true);
        setActionError('');
        void trackDiscoveryEvent({ sessionId: sessionIdRef.current, gameId: id, eventType: 'next_game' });
        try {
            const { game } = await findDiscoveryGame({ currentGameId: id });
            navigate(`/player/game/${game.gameId}/play`);
        } catch (e) {
            console.error('Failed to find next game', e);
            setActionError(e.message || 'Could not find another game.');
        } finally {
            setNextLoading(false);
        }
    };

    const handleRetryLaunch = () => {
        setLaunchConfig(null);
        setLaunchError('');
        setGameStatus('loading');
        setRetryNonce(value => value + 1);
    };

    const handleStartFresh = async () => {
        if (!launchConfig?.saveKey || clearSaveBusy) return;
        setClearSaveBusy(true);
        setActionError('');
        try {
            await gameSaveStorage.remove(launchConfig.saveKey);
            handleRetryLaunch();
        } catch (clearError) {
            console.warn('Local game progress could not be cleared.', clearError);
            setActionError('Saved progress could not be cleared on this device.');
        } finally {
            setClearSaveBusy(false);
        }
    };

    return (
        <div className="flex flex-col h-screen bg-black text-white">
            <header className="flex-none flex items-center justify-between px-4 md:px-6 py-3 bg-neutral-900 border-b border-neutral-800">
                <button
                    onClick={() => navigate(`/player/game/${id}`)}
                    className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors text-sm font-medium"
                >
                    <ChevronLeft className="w-5 h-5" />
                    <span className="hidden sm:inline">Game Details</span>
                </button>

                <div className="flex items-center gap-2 md:gap-3">
                    <div className="hidden md:flex items-center gap-2 text-xs text-neutral-500 bg-neutral-950 px-3 py-1.5 rounded-full border border-neutral-800" title="Running in isolated sandbox">
                        <ShieldAlert className="w-4 h-4" />
                        Sandboxed
                    </div>
                    {launchConfig?.saveKey && SAVE_STATUS_LABELS[progressStatus] && (
                        <div className={`hidden lg:block text-xs px-3 py-1.5 rounded-full border ${progressStatus === 'error' ? 'border-red-500/30 text-red-300 bg-red-500/10' : 'border-neutral-800 text-neutral-400 bg-neutral-950'}`} role="status" aria-live="polite">
                            {SAVE_STATUS_LABELS[progressStatus]}
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={handleToggleLibrary}
                        disabled={libraryBusy}
                        className={`inline-flex items-center gap-2 border px-3 py-2 rounded-lg text-sm font-bold transition-colors ${inLibrary ? 'border-green-500/40 bg-green-500/15 text-green-300' : 'border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-200'}`}
                        title={user ? (inLibrary ? 'Remove from Library' : 'Keep this game in your Library') : 'Sign in to keep games'}
                    >
                        <Bookmark className={`w-4 h-4 ${inLibrary ? 'fill-current' : ''}`} />
                        <span className="hidden sm:inline">{inLibrary ? 'Kept' : 'Keep'}</span>
                    </button>
                    <button
                        type="button"
                        onClick={handleNextGame}
                        disabled={nextLoading}
                        className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-4 py-2 rounded-lg text-sm font-bold transition-colors"
                        title="Skip directly to another published game"
                    >
                        <Shuffle className="w-4 h-4" />
                        {nextLoading ? 'Finding…' : 'Next Game'}
                    </button>
                    <button
                        onClick={handleFullscreen}
                        className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
                        title="Fullscreen"
                    >
                        <Maximize2 className="w-5 h-5" />
                    </button>
                </div>
            </header>

            {actionError && (
                <div className="flex-none flex items-center justify-between gap-4 bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-sm text-red-300" role="status">
                    <span>{actionError}</span>
                    <button type="button" onClick={() => setActionError('')} className="text-red-200 hover:text-white font-bold" aria-label="Dismiss message">×</button>
                </div>
            )}

            <main id="main-content" className="flex-1 relative bg-neutral-950 flex items-center justify-center overflow-hidden">
                {gameStatus === 'not_found' ? (
                    <div className="text-center">
                        <div className="text-red-400 font-bold mb-4">Game not found or unavailable</div>
                        <button onClick={handleNextGame} className="bg-blue-600 hover:bg-blue-500 px-5 py-2.5 rounded-lg font-bold">Try Another Game</button>
                    </div>
                ) : gameStatus === 'error' ? (
                    <div className="text-center max-w-lg px-6">
                        <div className="text-red-400 font-bold mb-2">Game failed to launch</div>
                        {launchError && <p className="text-sm text-neutral-400 mb-5">{launchError}</p>}
                        <div className="flex flex-wrap items-center justify-center gap-3">
                            <button onClick={handleRetryLaunch} className="inline-flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 px-5 py-2.5 rounded-lg font-bold">
                                <RotateCcw className="w-4 h-4" /> Retry Game
                            </button>
                            {launchConfig?.saveKey && launchConfig.recoverState && (
                                <button onClick={handleStartFresh} disabled={clearSaveBusy} className="inline-flex items-center gap-2 border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-50 text-amber-200 px-5 py-2.5 rounded-lg font-bold">
                                    {clearSaveBusy ? 'Clearing…' : 'Start Fresh'}
                                </button>
                            )}
                            <button onClick={handleNextGame} className="bg-blue-600 hover:bg-blue-500 px-5 py-2.5 rounded-lg font-bold">Try Another Game</button>
                        </div>
                    </div>
                ) : launchConfig ? (
                    <div className="relative w-full h-full">
                        <iframe
                            ref={iframeRef}
                            title={`Game ${id}`}
                            src={launchConfig.entryUrl}
                            sandbox={launchConfig.sandboxAttributes}
                            allow={launchConfig.permissionsPolicy || undefined}
                            allowFullScreen={launchConfig.allowFullScreen}
                            className="w-full h-full border-none bg-black"
                            onLoad={() => {
                                if (launchConfig.type === 'foundry') {
                                    sendFoundryLaunch();
                                } else {
                                    setGameStatus('ready');
                                    if (!readyTrackedRef.current) {
                                        readyTrackedRef.current = true;
                                        void trackDiscoveryEvent({ sessionId: sessionIdRef.current, gameId: id, eventType: 'game_ready' });
                                    }
                                }
                            }}
                        />
                        {gameStatus === 'loading' && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 text-neutral-300 pointer-events-none" role="status" aria-live="polite" data-testid="game-launch-status">
                                <div className="w-8 h-8 border-2 border-neutral-700 border-t-blue-500 rounded-full animate-spin" />
                                <div>Starting secure game runtime…</div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-3 text-neutral-400">
                        <div className="w-8 h-8 border-2 border-neutral-700 border-t-blue-500 rounded-full animate-spin" />
                        <div>Preparing game…</div>
                    </div>
                )}
            </main>
        </div>
    );
}
