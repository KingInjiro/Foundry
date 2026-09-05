import React from 'react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { Bookmark, Code, Gamepad2, Hammer, Zap, Globe, LogOut, Shuffle } from 'lucide-react';
import { useAuth } from './auth/AuthContext.jsx';
import { PlayNowButton } from './discovery/PlayNowButton.jsx';

export function LandingPage() {
    const { user, login, logout } = useAuth();

    return (
        <div className="min-h-screen bg-neutral-950 text-white flex flex-col font-sans">
            <header className="flex items-center justify-between gap-2 px-3 sm:px-8 py-4 sm:py-6 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-md sticky top-0 z-50">
                <Link to="/" className="flex items-center gap-3 shrink-0" aria-label="Foundry home">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 bg-green-500 rounded-lg flex items-center justify-center shadow-lg shadow-green-500/20">
                        <Hammer className="w-6 h-6 text-neutral-950" />
                    </div>
                    <h1 className="hidden md:block text-xl font-bold tracking-tight">Foundry</h1>
                </Link>

                <nav className="flex items-center gap-1 sm:gap-4 text-sm font-medium" aria-label="Primary navigation">
                    <Link to="/player" aria-label="Discover" className="inline-flex items-center justify-center rounded-lg p-2 sm:p-0 text-neutral-400 hover:text-white hover:bg-neutral-900 sm:hover:bg-transparent transition-colors"><Gamepad2 className="w-5 h-5 sm:hidden" /><span className="hidden sm:inline">Discover</span></Link>
                    {user && <Link to="/player/library" aria-label="Library" className="inline-flex items-center justify-center rounded-lg p-2 sm:p-0 text-neutral-400 hover:text-white hover:bg-neutral-900 sm:hover:bg-transparent transition-colors"><Bookmark className="w-5 h-5 sm:hidden" /><span className="hidden sm:inline">Library</span></Link>}
                    <Link to="/developer" aria-label="Developers" className="inline-flex items-center justify-center rounded-lg p-2 sm:p-0 text-neutral-400 hover:text-white hover:bg-neutral-900 sm:hover:bg-transparent transition-colors"><Code className="w-5 h-5 sm:hidden" /><span className="hidden sm:inline">Developers</span></Link>
                    <div className="hidden sm:block h-4 w-px bg-neutral-800" />
                    {user ? (
                        <div className="flex items-center gap-1 sm:gap-4">
                            <span className="hidden md:inline text-neutral-400">{user.displayName || user.email}</span>
                            <button type="button" onClick={logout} aria-label="Sign Out" className="inline-flex items-center justify-center text-white bg-neutral-800 hover:bg-neutral-700 p-2 sm:px-4 sm:py-2 rounded-md transition-colors"><LogOut className="w-5 h-5 sm:hidden" /><span className="hidden sm:inline">Sign Out</span></button>
                        </div>
                    ) : (
                        <button type="button" onClick={login} className="text-white bg-neutral-800 hover:bg-neutral-700 px-3 sm:px-4 py-2 rounded-md transition-colors">Sign In</button>
                    )}
                </nav>
            </header>

            <main className="flex-1">
                <section className="px-4 pt-24 pb-16 text-center">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                        className="max-w-4xl mx-auto"
                    >
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300 text-sm font-medium mb-6">
                            <Shuffle className="w-4 h-4" />
                            Discover → Play → Next
                        </div>
                        <h2 className="text-5xl sm:text-7xl font-extrabold tracking-tight mb-6 leading-[1.05]">
                            Don't search for a game.
                            <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-400 to-green-400">Just start playing.</span>
                        </h2>
                        <p className="text-xl text-neutral-400 mb-10 max-w-2xl mx-auto leading-relaxed">
                            Foundry is built around instant browser play. Try a game immediately, skip to the next one, and keep the games worth coming back to.
                        </p>

                        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                            <PlayNowButton label="Play Something Now" />
                            <Link to="/player" className="inline-flex items-center gap-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl px-6 py-3 font-bold transition-colors">
                                <Gamepad2 className="w-5 h-5" /> Browse Games
                            </Link>
                        </div>

                        <p className="mt-5 text-sm text-neutral-500">No install. No launcher. Games run in the Foundry browser sandbox.</p>
                    </motion.div>
                </section>

                <section className="px-6 py-14 border-y border-neutral-900 bg-neutral-950/70">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
                        <div className="bg-neutral-900/50 border border-neutral-800 p-6 rounded-2xl">
                            <Zap className="w-8 h-8 text-yellow-400 mb-4" />
                            <h3 className="text-xl font-bold mb-2">Instant Play</h3>
                            <p className="text-neutral-400 leading-relaxed">The shortest path from discovery to gameplay: open Foundry, choose Play, and launch in the browser.</p>
                        </div>
                        <div className="bg-neutral-900/50 border border-neutral-800 p-6 rounded-2xl">
                            <Shuffle className="w-8 h-8 text-blue-400 mb-4" />
                            <h3 className="text-xl font-bold mb-2">Playable Discovery</h3>
                            <p className="text-neutral-400 leading-relaxed">Discovery is ranked from real play signals. Try the game, keep it, rate it, or move straight to the next one.</p>
                        </div>
                        <div className="bg-neutral-900/50 border border-neutral-800 p-6 rounded-2xl">
                            <Globe className="w-8 h-8 text-green-400 mb-4" />
                            <h3 className="text-xl font-bold mb-2">Streaming-Ready Runtime</h3>
                            <p className="text-neutral-400 leading-relaxed">Foundry Player can stream validated game assets and reuse its browser cache instead of forcing a traditional install.</p>
                        </div>
                    </div>
                </section>

                <section className="px-6 py-20">
                    <div className="max-w-4xl mx-auto rounded-3xl border border-neutral-800 bg-neutral-900/50 p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-8">
                        <div className="text-left">
                            <div className="text-green-400 text-sm font-bold uppercase tracking-wider mb-2">For developers</div>
                            <h3 className="text-3xl font-bold mb-3">Turn a build into something players can try immediately.</h3>
                            <p className="text-neutral-400 max-w-2xl">Publish a web-native or Foundry game, let the platform validate and deliver it, and reduce the distance between somebody discovering your project and actually playing it.</p>
                        </div>
                        <Link to="/developer" className="shrink-0 inline-flex items-center gap-2 bg-green-500 hover:bg-green-400 text-neutral-950 rounded-xl px-6 py-3 font-bold transition-colors">
                            <Code className="w-5 h-5" /> Developer Tools
                        </Link>
                    </div>
                </section>
            </main>

            <footer className="py-8 border-t border-neutral-900 text-center text-neutral-500 text-sm">
                &copy; {new Date().getFullYear()} Foundry.
            </footer>
        </div>
    );
}
