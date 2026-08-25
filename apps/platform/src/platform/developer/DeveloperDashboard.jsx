import { apiClient } from '../api/apiClient.js';
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { FolderGit2, Gamepad2, Hammer, LogOut, Package, RefreshCw, UploadCloud } from 'lucide-react';
import { ProjectManager } from './ProjectManager.jsx';
import { UploadGameModal } from './UploadGameModal.jsx';

function DashboardHome() {
    const { user, logout } = useAuth();
    const [isUploadModalOpen, setUploadModalOpen] = useState(false);
    const [games, setGames] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');

    const loadGames = useCallback(async ({ silent = false } = {}) => {
        if (!silent) setLoading(true);
        setLoadError('');
        try {
            const response = await apiClient.get('/api/games');
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error?.message || 'Could not load projects.');
            setGames(result.data || []);
        } catch (error) {
            setLoadError(error.message || 'Could not load projects.');
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadGames();
    }, [loadGames]);

    const displayName = user?.displayName || user?.email || 'Developer';
    const initial = displayName.trim().charAt(0).toUpperCase() || 'D';

    return (
        <div className="min-h-screen bg-neutral-950 text-white flex flex-col font-sans">
            <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-neutral-800 bg-neutral-900 sticky top-0 z-40">
                <div className="flex items-center gap-3 min-w-0">
                    <Link to="/" className="w-9 h-9 bg-neutral-800 rounded-lg flex items-center justify-center hover:bg-neutral-700 transition-colors shrink-0" aria-label="Back to Foundry home">
                        <LogOut className="w-4 h-4 text-neutral-400 rotate-180" />
                    </Link>
                    <div className="min-w-0">
                        <h1 className="font-bold tracking-tight truncate">Developer Dashboard</h1>
                        <p className="text-xs text-neutral-500 truncate">{displayName}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 text-sm">
                    <Link to="/player" className="inline-flex items-center gap-2 text-neutral-400 hover:text-white px-2.5 py-2 transition-colors" title="Open game discovery">
                        <Gamepad2 className="w-4 h-4" /><span className="hidden sm:inline">Discover</span>
                    </Link>
                    <button type="button" onClick={logout} className="inline-flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg px-3 py-2 transition-colors" title="Sign out">
                        <span className="w-5 h-5 bg-gradient-to-tr from-green-500 to-emerald-600 rounded-full text-[11px] font-bold text-neutral-950 flex items-center justify-center">{initial}</span>
                        <span className="hidden sm:inline">Sign Out</span>
                    </button>
                </div>
            </header>

            <main className="flex-1 p-5 sm:p-8 max-w-6xl mx-auto w-full">
                <div className="mb-8">
                    <p className="text-green-400 text-xs font-bold uppercase tracking-[0.18em] mb-2">Create & publish</p>
                    <h2 className="text-3xl sm:text-4xl font-extrabold mb-2">Your games, one clear workflow.</h2>
                    <p className="text-neutral-400 max-w-2xl">Build in the Foundry editor, or upload a validated browser game package. Publishing stays explicit so a new version never replaces the live build by accident.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-12">
                    <Link
                        to="/editor"
                        className="bg-neutral-900 border border-neutral-800 hover:border-green-500/50 p-6 rounded-2xl group transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                    >
                        <div className="w-12 h-12 bg-green-500/10 rounded-xl flex items-center justify-center mb-4 group-hover:bg-green-500/20 transition-colors">
                            <Hammer className="w-6 h-6 text-green-400" />
                        </div>
                        <h3 className="text-xl font-bold mb-2">Create with Foundry</h3>
                        <p className="text-neutral-400 text-sm leading-relaxed">Open the browser editor and build with the integrated Foundry engine.</p>
                    </Link>

                    <button
                        type="button"
                        onClick={() => setUploadModalOpen(true)}
                        className="bg-neutral-900 border border-neutral-800 hover:border-blue-500/50 p-6 rounded-2xl text-left group transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                        <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center mb-4 group-hover:bg-blue-500/20 transition-colors">
                            <UploadCloud className="w-6 h-6 text-blue-400" />
                        </div>
                        <h3 className="text-xl font-bold mb-2">Upload Game Package</h3>
                        <p className="text-neutral-400 text-sm leading-relaxed">Validate and upload an HTML5, Unity WebGL, Godot, or Foundry ZIP package to platform storage.</p>
                    </button>
                </div>

                <section aria-labelledby="projects-heading">
                    <div className="flex items-center justify-between gap-4 mb-4">
                        <h3 id="projects-heading" className="text-xl font-bold flex items-center gap-2">
                            <FolderGit2 className="w-5 h-5 text-neutral-400" />Your Projects
                        </h3>
                        {!loading && (
                            <button type="button" onClick={() => loadGames()} className="p-2 text-neutral-500 hover:text-white hover:bg-neutral-900 rounded-lg transition-colors" aria-label="Refresh projects" title="Refresh projects">
                                <RefreshCw className="w-4 h-4" />
                            </button>
                        )}
                    </div>

                    {loading ? (
                        <div className="space-y-3" role="status" aria-label="Loading projects">
                            {[1, 2].map(item => <div key={item} className="h-20 rounded-xl border border-neutral-900 bg-neutral-900/50 animate-pulse" />)}
                        </div>
                    ) : loadError ? (
                        <div className="border border-red-500/20 bg-red-500/5 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <p className="text-red-300 text-sm">{loadError}</p>
                            <button type="button" onClick={() => loadGames()} className="bg-neutral-800 hover:bg-neutral-700 px-4 py-2 rounded-lg text-sm font-bold">Try Again</button>
                        </div>
                    ) : games.length === 0 ? (
                        <div className="border border-dashed border-neutral-800 bg-neutral-900/30 rounded-2xl p-8 text-center">
                            <Package className="w-10 h-10 mx-auto text-neutral-700 mb-3" />
                            <h4 className="font-bold mb-1">No projects yet</h4>
                            <p className="text-neutral-500 text-sm mb-5">Upload a ready build or start in the Foundry editor.</p>
                            <button type="button" onClick={() => setUploadModalOpen(true)} className="bg-blue-600 hover:bg-blue-500 px-5 py-2.5 rounded-lg text-sm font-bold">Upload Your First Game</button>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {games.map(game => (
                                <article key={game.id} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:border-neutral-700 transition-colors">
                                    <div className="flex items-center gap-4 min-w-0">
                                        <div className="w-12 h-12 bg-neutral-800 rounded-lg flex items-center justify-center shrink-0">
                                            <Package className="w-6 h-6 text-blue-400" />
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="font-bold text-lg truncate">{game.title}</h4>
                                            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                                                <span className={`px-2 py-0.5 rounded border ${game.currentState === 'PUBLISHED' ? 'bg-green-500/10 border-green-500/20 text-green-300' : 'bg-neutral-800 border-neutral-700 text-neutral-400'}`}>{game.currentState || 'DRAFT'}</span>
                                                <span className="inline-flex items-center gap-1 text-neutral-500"><UploadCloud className="w-3 h-3" />{game.storageMode === 'platform' ? 'Platform storage' : game.storageMode}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <Link to={`/developer/project/${game.id}`} className="w-full sm:w-auto text-center bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors">Manage</Link>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            </main>

            <UploadGameModal
                isOpen={isUploadModalOpen}
                onClose={() => setUploadModalOpen(false)}
                onUploaded={() => loadGames({ silent: true })}
            />
        </div>
    );
}

export function DeveloperDashboard() {
    const { user, loading } = useAuth();
    if (loading) return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-neutral-400" role="status">Checking your session…</div>;
    if (!user) return <Navigate to="/" replace />;

    return (
        <Routes>
            <Route path="/" element={<DashboardHome />} />
            <Route path="/project/:id" element={
                <div className="min-h-screen bg-neutral-950 text-white flex flex-col font-sans">
                    <header className="flex items-center gap-3 px-4 sm:px-6 py-4 border-b border-neutral-800 bg-neutral-900">
                        <Link to="/developer" className="text-neutral-400 hover:text-white text-sm">Developer Dashboard</Link>
                        <span className="text-neutral-700">/</span>
                        <h1 className="font-bold tracking-tight">Project</h1>
                    </header>
                    <ProjectManager />
                </div>
            } />
        </Routes>
    );
}
