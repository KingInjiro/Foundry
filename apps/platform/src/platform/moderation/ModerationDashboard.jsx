import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, RefreshCw, Shield, ShieldAlert } from 'lucide-react';
import { apiClient } from '../api/apiClient.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ProtectedRouteGate } from '../auth/ProtectedRouteGate.jsx';

const FILTERS = ['OPEN', 'ALL'];

function StateBadge({ value }) {
    const color = value === 'ACTIVE'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    return <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${color}`}>{value}</span>;
}

export default function ModerationDashboard() {
    const { user, loading: authLoading } = useAuth();
    const [profile, setProfile] = useState(null);
    const [items, setItems] = useState([]);
    const [pendingCount, setPendingCount] = useState(0);
    const [filter, setFilter] = useState('OPEN');
    const [selectedId, setSelectedId] = useState(null);
    const [reason, setReason] = useState('');
    const [actions, setActions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const selected = items.find(item => item.id === selectedId) || null;

    const loadQueue = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const me = await apiClient.json.get('/api/auth/me');
            setProfile(me);
            if (!['ADMIN', 'MODERATOR'].includes(me.role)) {
                setItems([]);
                setPendingCount(0);
                return;
            }
            const queue = await apiClient.json.get(`/api/moderation/reports?status=${filter}&limit=100`);
            setItems(queue.items || []);
            setPendingCount(queue.pendingCount || 0);
            setSelectedId(current => (queue.items || []).some(item => item.id === current)
                ? current
                : queue.items?.[0]?.id || null);
        } catch (requestError) {
            setError(requestError.message || 'Could not load the moderation queue.');
        } finally {
            setLoading(false);
        }
    }, [filter]);

    useEffect(() => { if (user) void loadQueue(); }, [user, loadQueue]);

    const loadActions = useCallback(async gameId => {
        if (!gameId) {
            setActions([]);
            return;
        }
        try {
            setActions(await apiClient.json.get(`/api/moderation/games/${encodeURIComponent(gameId)}/actions`));
        } catch {
            setActions([]);
        }
    }, []);

    useEffect(() => {
        void loadActions(selected?.gameId);
    }, [selected?.gameId, loadActions]);

    const resolveReport = async ({ status, moderationState }) => {
        if (!selected || reason.trim().length < 10) {
            setError('Enter at least 10 characters explaining the operator decision.');
            return;
        }
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await apiClient.json.patch(`/api/moderation/reports/${encodeURIComponent(selected.id)}`, {
                status,
                resolution: reason.trim(),
                ...(moderationState && { moderationState })
            });
            setNotice(status === 'DISMISSED' ? 'Report dismissed and audited.' : `Report resolved${moderationState ? `; game is ${moderationState.toLowerCase()}` : ''}.`);
            setReason('');
            await Promise.all([loadQueue(), loadActions(selected.gameId)]);
        } catch (requestError) {
            setError(requestError.message || 'Could not resolve the report.');
        } finally {
            setBusy(false);
        }
    };

    const setGameState = async moderationState => {
        if (!selected || reason.trim().length < 10) {
            setError('Enter at least 10 characters explaining the operator decision.');
            return;
        }
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await apiClient.json.patch(`/api/moderation/games/${encodeURIComponent(selected.gameId)}`, {
                moderationState,
                reason: reason.trim()
            });
            setNotice(`Game moderation state changed to ${moderationState}.`);
            setReason('');
            await Promise.all([loadQueue(), loadActions(selected.gameId)]);
        } catch (requestError) {
            setError(requestError.message || 'Could not update the game.');
        } finally {
            setBusy(false);
        }
    };

    if (authLoading) return <div className="min-h-screen bg-neutral-950 text-neutral-400 grid place-items-center" role="status">Checking session…</div>;
    if (!user) return <ProtectedRouteGate area="Moderation operations" />;

    return (
        <div className="min-h-screen bg-neutral-950 text-white">
            <header className="sticky top-0 z-30 border-b border-neutral-800 bg-neutral-950/95 px-4 py-4 backdrop-blur sm:px-6">
                <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <Link to="/developer" className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-900 hover:text-white" aria-label="Back to Developer Dashboard"><ArrowLeft className="h-5 w-5" /></Link>
                        <div className="min-w-0">
                            <h1 className="flex items-center gap-2 truncate font-bold"><Shield className="h-5 w-5 text-violet-400" />Moderation operations</h1>
                            <p className="text-xs text-neutral-500">Protected operator queue · {pendingCount} pending</p>
                        </div>
                    </div>
                    <button type="button" onClick={() => void loadQueue()} disabled={loading} className="rounded-lg bg-neutral-900 p-2 text-neutral-300 hover:bg-neutral-800 disabled:opacity-50" aria-label="Refresh moderation queue"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
                </div>
            </header>

            <main className="mx-auto max-w-7xl p-4 sm:p-6">
                {profile && !['ADMIN', 'MODERATOR'].includes(profile.role) ? (
                    <div className="rounded-2xl border border-red-500/25 bg-red-500/5 p-6" role="alert">
                        <h2 className="flex items-center gap-2 font-bold text-red-200"><ShieldAlert className="h-5 w-5" />Moderator access required</h2>
                        <p className="mt-2 text-sm text-neutral-400">Your current role is {profile.role || 'unassigned'}. Access must be provisioned through the local administrative CLI.</p>
                    </div>
                ) : (
                    <>
                        <div className="mb-4 flex gap-2" aria-label="Report status filter">
                            {FILTERS.map(value => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-lg px-3 py-2 text-xs font-bold ${filter === value ? 'bg-violet-600 text-white' : 'bg-neutral-900 text-neutral-400 hover:text-white'}`}>{value}</button>)}
                        </div>

                        {error && <div className="mb-4 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200" role="alert">{error}</div>}
                        {notice && <div className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-200" role="status">{notice}</div>}

                        <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.4fr)]">
                            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60" aria-label="Reports">
                                {loading ? <div className="p-5 text-sm text-neutral-500" role="status">Loading reports…</div> : items.length === 0 ? (
                                    <div className="p-8 text-center text-neutral-500"><CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-500" /><p>No reports in this view.</p></div>
                                ) : items.map(item => (
                                    <button key={item.id} type="button" onClick={() => { setSelectedId(item.id); setReason(''); setNotice(''); }} className={`block w-full border-b border-neutral-800 p-4 text-left last:border-0 ${selectedId === item.id ? 'bg-violet-500/10' : 'hover:bg-neutral-900'}`}>
                                        <div className="flex items-center justify-between gap-2"><span className="truncate font-bold">{item.gameTitle}</span><StateBadge value={item.moderationState} /></div>
                                        <div className="mt-1 text-xs font-bold text-amber-300">{item.category} · {item.status}</div>
                                        <p className="mt-2 line-clamp-2 text-sm text-neutral-400">{item.reason}</p>
                                    </button>
                                ))}
                            </section>

                            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5" aria-live="polite">
                                {!selected ? <p className="text-sm text-neutral-500">Select a report to review.</p> : (
                                    <div className="space-y-5">
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold">{selected.gameTitle}</h2><StateBadge value={selected.moderationState} /></div>
                                            <p className="mt-1 text-xs text-neutral-500">Game {selected.gameId} · Owner {selected.ownerUid}</p>
                                        </div>
                                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                                            <h3 className="flex items-center gap-2 text-sm font-bold text-amber-200"><AlertTriangle className="h-4 w-4" />{selected.category}</h3>
                                            <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-300">{selected.reason}</p>
                                            <p className="mt-2 text-xs text-neutral-500">Reporter: {selected.reporterDisplayName || selected.reporterEmail || selected.reporterUid}</p>
                                        </div>
                                        <label className="block text-sm font-bold" htmlFor="moderation-reason">Operator reason</label>
                                        <textarea id="moderation-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} rows={4} className="w-full rounded-xl border border-neutral-700 bg-neutral-950 p-3 text-sm outline-none focus:border-violet-500" placeholder="Required audit reason (10–1,000 characters)" />
                                        {selected.status === 'OPEN' && <div className="grid gap-2 sm:grid-cols-3">
                                            <button disabled={busy} type="button" onClick={() => void resolveReport({ status: 'RESOLVED', moderationState: 'QUARANTINED' })} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-bold hover:bg-amber-500 disabled:opacity-50">Resolve + quarantine</button>
                                            <button disabled={busy} type="button" onClick={() => void resolveReport({ status: 'RESOLVED', moderationState: 'HIDDEN' })} className="rounded-lg bg-red-700 px-3 py-2 text-sm font-bold hover:bg-red-600 disabled:opacity-50">Resolve + hide</button>
                                            <button disabled={busy} type="button" onClick={() => void resolveReport({ status: 'DISMISSED' })} className="rounded-lg bg-neutral-800 px-3 py-2 text-sm font-bold hover:bg-neutral-700 disabled:opacity-50">Dismiss report</button>
                                        </div>}
                                        <div className="flex flex-wrap gap-2 border-t border-neutral-800 pt-4">
                                            <button disabled={busy} type="button" onClick={() => void setGameState('ACTIVE')} className="rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50">Restore active</button>
                                            <button disabled={busy} type="button" onClick={() => void setGameState('QUARANTINED')} className="rounded-lg border border-amber-500/30 px-3 py-2 text-xs font-bold text-amber-200 hover:bg-amber-500/10 disabled:opacity-50">Quarantine</button>
                                            <button disabled={busy} type="button" onClick={() => void setGameState('HIDDEN')} className="rounded-lg border border-red-500/30 px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-500/10 disabled:opacity-50">Hide</button>
                                        </div>
                                        <div>
                                            <h3 className="mb-2 text-sm font-bold text-neutral-300">Audit history</h3>
                                            {actions.length === 0 ? <p className="text-xs text-neutral-600">No operator actions yet.</p> : <div className="space-y-2">{actions.slice(0, 10).map(action => (
                                                <div key={action.id} className="rounded-lg bg-neutral-950 p-3 text-xs text-neutral-400"><span className="font-bold text-neutral-200">{action.action}</span> · {action.previousState} → {action.nextState}<br />{action.reason}<br /><span className="text-neutral-600">{action.operatorDisplayName || action.operatorEmail || action.operatorUid} · {new Date(action.createdAt).toLocaleString()}</span></div>
                                            ))}</div>}
                                        </div>
                                    </div>
                                )}
                            </section>
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}
