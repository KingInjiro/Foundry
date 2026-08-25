import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Shuffle } from 'lucide-react';
import { findDiscoveryGame } from './discoveryQueue.js';

/**
 * Starts the first available published game without forcing the player to browse
 * a catalog first. This is intentionally simple for the first discovery MVP:
 * ranking/recommendation logic belongs behind the API and can evolve without
 * changing the player UI contract.
 */
export function PlayNowButton({ excludeGameId = null, variant = 'primary', label = 'Play Something Now' }) {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const start = async () => {
        if (loading) return;
        setLoading(true);
        setError('');

        try {
            const { game } = await findDiscoveryGame({ currentGameId: excludeGameId });
            navigate(`/player/game/${game.gameId}/play`);
        } catch (e) {
            setError(e.message || 'Unable to start a game.');
        } finally {
            setLoading(false);
        }
    };

    const classes = variant === 'secondary'
        ? 'bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-white'
        : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20';

    return (
        <div className="flex flex-col items-center gap-2">
            <button
                type="button"
                onClick={start}
                disabled={loading}
                className={`inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-bold transition-colors disabled:opacity-60 ${classes}`}
            >
                {excludeGameId ? <Shuffle className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
                {loading ? 'Finding a game…' : label}
            </button>
            {error && <span className="text-xs text-red-400" role="status">{error}</span>}
        </div>
    );
}
