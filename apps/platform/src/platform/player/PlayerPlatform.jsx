import React, { lazy, Suspense } from 'react';
import { Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { Gamepad2, ChevronLeft, Library, Wrench } from 'lucide-react';
import { GameCatalog } from './GameCatalog.jsx';
import { GameDetails } from './GameDetails.jsx';
import { LibraryPage } from './LibraryPage.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

const GamePlayer = lazy(() => import('./GamePlayer.jsx').then(module => ({ default: module.GamePlayer })));

export function PlayerPlatform() {
    const location = useLocation();
    const { user, login, logout } = useAuth();
    const isPlaying = location.pathname.endsWith('/play');
    const isCatalog = location.pathname === '/player' || location.pathname === '/player/';
    const isLibrary = location.pathname.startsWith('/player/library');

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col font-sans">
            {!isPlaying && (
                <header className="flex items-center justify-between px-6 py-4 bg-neutral-900 border-b border-neutral-800 sticky top-0 z-50">
                    <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-white">Skip to content</a>
                    <div className="flex items-center gap-4">
                        <Link to="/" className="text-neutral-400 hover:text-white transition-colors" title="Back to Foundry Home">
                            <ChevronLeft className="w-5 h-5" />
                        </Link>
                        <Link to="/player" aria-current={isCatalog ? 'page' : undefined} className="flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors">
                            <Gamepad2 className="w-6 h-6" />
                            <span className="font-bold text-lg text-white tracking-tight">Discover</span>
                        </Link>
                    </div>

                    <div className="flex items-center gap-3 text-sm font-medium">
                        {user && <Link to="/player/library" aria-current={isLibrary ? 'page' : undefined} className={`inline-flex items-center gap-1.5 transition-colors ${isLibrary ? 'text-white' : 'text-neutral-400 hover:text-white'}`} title="Library"><Library className="w-4 h-4 sm:hidden" /><span className="hidden sm:inline">Library</span></Link>}
                        <Link to="/developer" className="inline-flex items-center gap-1.5 text-neutral-400 hover:text-white transition-colors" title="Developer tools"><Wrench className="w-4 h-4 sm:hidden" /><span className="hidden sm:inline">Developers</span></Link>
                        {user ? (
                            <button type="button" onClick={logout} className="bg-neutral-800 hover:bg-neutral-700 px-4 py-2 rounded-full transition-colors">Sign Out</button>
                        ) : (
                            <button type="button" onClick={login} className="bg-neutral-800 hover:bg-neutral-700 px-4 py-2 rounded-full transition-colors">Sign In</button>
                        )}
                    </div>
                </header>
            )}

            <Suspense fallback={<div className="flex-1 flex items-center justify-center text-neutral-500" role="status">Preparing player…</div>}>
                <Routes>
                    <Route path="/" element={<GameCatalog />} />
                    <Route path="/game/:id" element={<GameDetails />} />
                    <Route path="/game/:id/play" element={<GamePlayer />} />
                    <Route path="/library" element={<LibraryPage />} />
                    <Route path="*" element={<Navigate to="/player" replace />} />
                </Routes>
            </Suspense>
        </div>
    );
}
