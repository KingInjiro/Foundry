import { apiClient } from '../api/apiClient.js';
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, BarChart3, Bookmark, CheckCircle, Clock3, ExternalLink, History, LoaderCircle, Package, Pencil, Play, RefreshCw, RotateCcw, Save, Star, Trash2, UploadCloud, X } from 'lucide-react';
import { UploadGameModal } from './UploadGameModal.jsx';

const TRANSIENT_VERSION_STATES = new Set(['UPLOADING', 'VALIDATING', 'PUBLISHING', 'DELETING']);

function formatDuration(milliseconds) {
    const seconds = Math.round(Number(milliseconds || 0) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes}m ${remainder}s`;
}

function VersionStatus({ status }) {
    const styles = {
        PUBLISHED: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
        READY: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
        REJECTED: 'bg-red-500/20 text-red-300 border-red-500/30',
        PUBLISH_FAILED: 'bg-red-500/20 text-red-300 border-red-500/30',
        EXPIRED: 'bg-red-500/20 text-red-300 border-red-500/30',
        PUBLISHING: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
        VALIDATING: 'bg-neutral-500/20 text-neutral-300 border-neutral-500/30',
        UPLOADING: 'bg-neutral-500/20 text-neutral-300 border-neutral-500/30',
        ARCHIVED: 'bg-neutral-500/20 text-neutral-300 border-neutral-500/30',
        DELETING: 'bg-red-500/20 text-red-300 border-red-500/30'
    };
    const labels = { PUBLISHED: 'Active', ARCHIVED: 'Archived', DELETING: 'Deleting', PUBLISH_FAILED: 'Publish failed', EXPIRED: 'Source expired' };
    return <span className={`text-xs px-2 py-0.5 rounded border ${styles[status] || 'bg-neutral-800 text-neutral-400 border-neutral-700'}`}>{labels[status] || status}</span>;
}

export function ProjectManager() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [game, setGame] = useState(null);
    const [versions, setVersions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [actionError, setActionError] = useState('');
    const [actionMessage, setActionMessage] = useState('');
    const [publishingId, setPublishingId] = useState(null);
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [analytics, setAnalytics] = useState(null);
    const [editingDetails, setEditingDetails] = useState(false);
    const [editTitle, setEditTitle] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [savingDetails, setSavingDetails] = useState(false);
    const [lifecycleAction, setLifecycleAction] = useState('');

    const fetchData = useCallback(async ({ silent = false } = {}) => {
        if (silent) setRefreshing(true);
        else setLoading(true);
        setError('');
        try {
            const [gameResponse, versionsResponse, analyticsResponse] = await Promise.all([
                apiClient.get(`/api/games/${id}`),
                apiClient.get(`/api/games/${id}/versions`),
                apiClient.get(`/api/games/${id}/analytics`)
            ]);
            const [gameResult, versionsResult, analyticsResult] = await Promise.all([
                gameResponse.json(),
                versionsResponse.json(),
                analyticsResponse.json()
            ]);
            if (!gameResponse.ok || !gameResult.success) throw new Error(gameResult.error?.message || 'Failed to load project.');
            if (!versionsResponse.ok || !versionsResult.success) throw new Error(versionsResult.error?.message || 'Failed to load versions.');

            setGame(gameResult.data);
            setVersions((versionsResult.data || []).sort((a, b) => Number(b.createdAt) - Number(a.createdAt)));
            setAnalytics(analyticsResponse.ok && analyticsResult.success ? analyticsResult.data : null);
        } catch (fetchError) {
            setError(fetchError.message || 'Failed to load project.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [id]);

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    useEffect(() => {
        if (!versions.some(version => TRANSIENT_VERSION_STATES.has(version.status))) return undefined;
        const timeout = window.setTimeout(() => void fetchData({ silent: true }), 1500);
        return () => window.clearTimeout(timeout);
    }, [versions, fetchData]);

    const activeVersion = versions.find(version => version.status === 'PUBLISHED');

    const handlePublish = async versionId => {
        if (publishingId) return;
        setPublishingId(versionId);
        setActionError('');
        setActionMessage('');
        try {
            const response = await apiClient.post(`/api/games/${id}/versions/${versionId}/publish`, {});
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error?.message || 'Could not publish this version.');
            if (result.data?.status === 'PUBLISHED') {
                setActionMessage('Version published successfully.');
                await fetchData({ silent: true });
            } else {
                setActionMessage('Publishing started. This page will update automatically.');
                setVersions(current => current.map(version => (
                    version.id === versionId ? { ...version, status: 'PUBLISHING' } : version
                )));
            }
        } catch (publishError) {
            setActionError(publishError.message || 'Could not publish this version.');
        } finally {
            setPublishingId(null);
        }
    };

    const runLifecycleAction = async (actionKey, requestAction, successMessage) => {
        if (lifecycleAction) return false;
        setLifecycleAction(actionKey);
        setActionError('');
        setActionMessage('');
        try {
            const response = await requestAction();
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error?.message || 'Release action failed.');
            if (successMessage) setActionMessage(successMessage);
            return true;
        } catch (actionError) {
            setActionError(actionError.message || 'Release action failed.');
            return false;
        } finally {
            setLifecycleAction('');
        }
    };

    const handleUnpublish = async () => {
        if (!window.confirm(`Unpublish “${game.title}”? Existing public and player links will stop working until a release is restored.`)) return;
        const succeeded = await runLifecycleAction('unpublish', () => apiClient.post(`/api/games/${id}/unpublish`, {}), 'Game unpublished. Its active release remains available for rollback.');
        if (succeeded) await fetchData({ silent: true });
    };

    const handleRestore = async version => {
        if (!window.confirm(`Restore v${version.version} as the live release? The current live version will be archived.`)) return;
        const succeeded = await runLifecycleAction(`restore:${version.id}`, () => apiClient.post(`/api/games/${id}/versions/${version.id}/activate`, {}), `v${version.version} is now live.`);
        if (succeeded) await fetchData({ silent: true });
    };

    const handleDeleteVersion = async version => {
        if (!window.confirm(`Permanently delete v${version.version} and its stored package/runtime files? This cannot be undone.`)) return;
        const succeeded = await runLifecycleAction(`delete:${version.id}`, () => apiClient.delete(`/api/games/${id}/versions/${version.id}`), 'Version cleanup started.');
        if (succeeded) await fetchData({ silent: true });
    };

    const handleDeleteProject = async () => {
        if (!window.confirm(`Permanently delete “${game.title}”, every version, and all retained player signals? This cannot be undone.`)) return;
        const succeeded = await runLifecycleAction('delete-project', () => apiClient.delete(`/api/games/${id}`, { confirmTitle: game.title }));
        if (succeeded) navigate('/developer', { replace: true });
    };

    const startEditingDetails = () => {
        setEditTitle(game?.title || '');
        setEditDescription(game?.description || '');
        setActionError('');
        setActionMessage('');
        setEditingDetails(true);
    };

    const saveDetails = async event => {
        event.preventDefault();
        if (savingDetails) return;
        const title = editTitle.trim();
        const description = editDescription.trim();
        if (!title) {
            setActionError('Project title is required.');
            return;
        }
        setSavingDetails(true);
        setActionError('');
        setActionMessage('');
        try {
            const response = await apiClient.patch(`/api/games/${id}`, { title, description });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error?.message || 'Could not update project details.');
            setGame(result.data);
            setEditingDetails(false);
            setActionMessage('Project details updated. The public catalog now uses the new title and description.');
        } catch (saveError) {
            setActionError(saveError.message || 'Could not update project details.');
        } finally {
            setSavingDetails(false);
        }
    };

    if (loading) return <div className="flex-1 p-8 flex items-center justify-center text-neutral-400" role="status"><LoaderCircle className="w-5 h-5 animate-spin mr-2" />Loading project…</div>;
    if (error) return <div className="flex-1 p-8 flex items-center justify-center"><div className="text-center"><p className="text-red-400 mb-4">{error}</p><button type="button" onClick={() => fetchData()} className="bg-neutral-800 hover:bg-neutral-700 px-4 py-2 rounded-lg font-bold">Try Again</button></div></div>;
    if (!game) return <div className="p-8 text-neutral-400">Project not found.</div>;

    return (
        <main id="main-content" className="flex-1 p-5 sm:p-8 max-w-6xl mx-auto w-full">
            <div className="mb-7 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                    <Link to="/developer" className="p-2 hover:bg-neutral-800 rounded-lg transition-colors shrink-0" aria-label="Back to dashboard"><ArrowLeft className="w-5 h-5 text-neutral-400" /></Link>
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                            <h2 className="text-3xl font-extrabold truncate">{game.title}</h2>
                            <span className={`text-sm px-2 py-0.5 rounded border ${activeVersion ? 'bg-green-500/10 text-green-300 border-green-500/20' : 'bg-neutral-800 text-neutral-400 border-neutral-700'}`}>{activeVersion ? 'Published' : 'Draft'}</span>
                        </div>
                        <p className="text-neutral-500 mt-1 text-sm font-mono truncate" title={id}>{id}</p>
                        {!editingDetails && <p className="text-neutral-400 mt-2 max-w-2xl">{game.description || 'No project description yet.'}</p>}
                    </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                    <button type="button" onClick={startEditingDetails} disabled={editingDetails || savingDetails} className="inline-flex items-center justify-center gap-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50">
                        <Pencil className="w-4 h-4" />Edit Details
                    </button>
                    <button type="button" onClick={() => fetchData({ silent: true })} disabled={refreshing} className="inline-flex items-center justify-center gap-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50">
                        <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh
                    </button>
                    <button type="button" onClick={() => void handleDeleteProject()} disabled={Boolean(lifecycleAction)} className="inline-flex items-center justify-center gap-2 border border-red-500/30 bg-red-500/5 px-4 py-2 rounded-lg text-sm font-bold text-red-300 hover:bg-red-500/10 disabled:opacity-50">
                        {lifecycleAction === 'delete-project' ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}Delete Project
                    </button>
                </div>
            </div>

            {editingDetails && (
                <form onSubmit={saveDetails} className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5" aria-labelledby="edit-project-heading">
                    <div className="flex items-center justify-between gap-4 mb-4">
                        <h3 id="edit-project-heading" className="font-bold text-lg">Edit Project Details</h3>
                        <button type="button" onClick={() => setEditingDetails(false)} disabled={savingDetails} className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-neutral-800 disabled:opacity-50" aria-label="Cancel editing"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="grid gap-4">
                        <label className="grid gap-1.5 text-sm font-medium">
                            Title
                            <input autoFocus value={editTitle} onChange={event => setEditTitle(event.target.value)} maxLength={120} required className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 outline-none focus:border-blue-500" />
                            <span className="text-xs text-neutral-600 text-right">{editTitle.length}/120</span>
                        </label>
                        <label className="grid gap-1.5 text-sm font-medium">
                            Description
                            <textarea value={editDescription} onChange={event => setEditDescription(event.target.value)} maxLength={2000} rows={4} className="resize-y rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 outline-none focus:border-blue-500" />
                            <span className="text-xs text-neutral-600 text-right">{editDescription.length}/2000</span>
                        </label>
                    </div>
                    <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                        <button type="button" onClick={() => setEditingDetails(false)} disabled={savingDetails} className="px-4 py-2.5 rounded-lg text-sm font-bold text-neutral-400 hover:text-white disabled:opacity-50">Cancel</button>
                        <button type="submit" disabled={savingDetails || !editTitle.trim()} className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-5 py-2.5 rounded-lg text-sm font-bold">
                            {savingDetails ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{savingDetails ? 'Saving…' : 'Save Details'}
                        </button>
                    </div>
                </form>
            )}

            {(actionError || actionMessage) && (
                <div className={`mb-6 rounded-xl border p-4 text-sm ${actionError ? 'border-red-500/20 bg-red-500/5 text-red-300' : 'border-blue-500/20 bg-blue-500/5 text-blue-300'}`} role="status">
                    {actionError || actionMessage}
                </div>
            )}

            {analytics && (
                <section className="mb-8" aria-labelledby="analytics-heading">
                    <div className="flex items-center gap-2 mb-4"><BarChart3 className="w-5 h-5 text-blue-400" /><h3 id="analytics-heading" className="text-xl font-bold">Player Funnel</h3></div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4"><div className="text-2xl font-extrabold">{analytics.impressions || 0}</div><div className="text-xs text-neutral-500">Impressions</div></div>
                        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4"><div className="text-2xl font-extrabold">{analytics.playStarts || 0}</div><div className="text-xs text-neutral-500">Play starts · {Math.round((analytics.playRate || 0) * 100)}%</div></div>
                        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4"><div className="text-2xl font-extrabold">{Math.round((analytics.readyRate || 0) * 100)}%</div><div className="text-xs text-neutral-500">Reached ready</div></div>
                        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4"><div className="text-2xl font-extrabold flex items-center gap-1"><Bookmark className="w-5 h-5 text-green-400" />{analytics.libraryAdds || 0}</div><div className="text-xs text-neutral-500">Library keeps</div></div>
                        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4"><div className="text-2xl font-extrabold flex items-center gap-1"><Star className="w-5 h-5 text-yellow-400" />{analytics.ratingAverage ? Number(analytics.ratingAverage).toFixed(1) : '—'}</div><div className="text-xs text-neutral-500">{analytics.ratingCount || 0} ratings</div></div>
                        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4"><div className="text-2xl font-extrabold flex items-center gap-1"><Clock3 className="w-5 h-5 text-violet-400" />{formatDuration(analytics.avgSessionDurationMs)}</div><div className="text-xs text-neutral-500">Average session</div></div>
                    </div>
                    <p className="text-xs text-neutral-600 mt-3">Telemetry is best-effort and never blocks gameplay.</p>
                </section>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-7">
                <div className="space-y-5">
                    <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
                        <h3 className="font-bold text-lg mb-4">Live Version</h3>
                        {activeVersion ? (
                            <div className="space-y-4">
                                <div className="flex items-center gap-3 p-3 bg-neutral-950 rounded-lg border border-neutral-800">
                                    <Package className="w-5 h-5 text-blue-400 shrink-0" />
                                    <div className="min-w-0"><div className="font-bold">v{activeVersion.version}</div><div className="text-xs text-neutral-500">{new Date(activeVersion.createdAt).toLocaleString()}</div></div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <Link to={`/player/game/${id}/play`} className="bg-green-600 hover:bg-green-500 text-white py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2"><Play className="w-4 h-4 fill-current" />Test Play</Link>
                                    <Link to={`/player/game/${id}`} className="bg-neutral-800 hover:bg-neutral-700 text-white py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2"><ExternalLink className="w-4 h-4" />Public Page</Link>
                                </div>
                                <button type="button" onClick={() => void handleUnpublish()} disabled={Boolean(lifecycleAction)} className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-sm font-bold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">
                                    {lifecycleAction === 'unpublish' ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}Unpublish
                                </button>
                            </div>
                        ) : <div className="text-neutral-500 text-sm">Upload a version, review it, then publish when it is ready.</div>}
                    </section>

                    <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
                        <h3 className="font-bold text-lg mb-3">New Version</h3>
                        <p className="text-sm text-neutral-500 mb-4">Client and server validation run before a version can be published.</p>
                        <button type="button" onClick={() => setIsUploadOpen(true)} className="w-full bg-blue-600 hover:bg-blue-500 px-4 py-3 rounded-lg font-bold flex items-center justify-center gap-2"><UploadCloud className="w-5 h-5" />Upload Version</button>
                    </section>
                </div>

                <section className="lg:col-span-2 bg-neutral-900 border border-neutral-800 rounded-xl p-5 sm:p-6" aria-labelledby="versions-heading">
                    <div className="flex items-center justify-between mb-6">
                        <h3 id="versions-heading" className="font-bold text-lg flex items-center gap-2"><History className="w-5 h-5 text-neutral-400" />Version History</h3>
                        <span className="text-xs text-neutral-600">{versions.length} total</span>
                    </div>
                    <div className="space-y-3">
                        {versions.length === 0 ? (
                            <div className="text-neutral-500 text-sm py-6 text-center">No versions uploaded yet.</div>
                        ) : versions.map(version => (
                            <article key={version.id} className={`p-4 rounded-xl border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${version.status === 'PUBLISHED' ? 'bg-blue-500/5 border-blue-500/30' : 'bg-neutral-950 border-neutral-800'}`}>
                                <div className="flex items-center gap-4 min-w-0">
                                    <div className="w-10 h-10 bg-neutral-900 rounded-lg flex items-center justify-center shrink-0">
                                        {version.status === 'PUBLISHED' ? <CheckCircle className="w-5 h-5 text-blue-400" /> : TRANSIENT_VERSION_STATES.has(version.status) ? <LoaderCircle className="w-5 h-5 text-violet-400 animate-spin" /> : <Package className="w-5 h-5 text-neutral-500" />}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="font-bold flex flex-wrap items-center gap-2">v{version.version}<VersionStatus status={version.status} /></div>
                                        <div className="text-sm text-neutral-500 truncate">{new Date(version.createdAt).toLocaleString()} · {version.format}</div>
                                        {(version.status === 'PUBLISH_FAILED' || version.status === 'EXPIRED') && version.publishError && (
                                            <div className="text-xs text-red-300 mt-1 max-w-xl">{version.publishError}</div>
                                        )}
                                    </div>
                                </div>

                                <div className="flex w-full sm:w-auto flex-col sm:flex-row gap-2">
                                    {(version.status === 'READY' || version.status === 'PUBLISH_FAILED') && (
                                        <button type="button" onClick={() => handlePublish(version.id)} disabled={Boolean(publishingId || lifecycleAction)} className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2">
                                            {publishingId === version.id ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}{version.status === 'PUBLISH_FAILED' ? 'Retry Publish' : 'Publish'}
                                        </button>
                                    )}
                                    {version.status === 'ARCHIVED' && (
                                        <button type="button" onClick={() => void handleRestore(version)} disabled={Boolean(publishingId || lifecycleAction)} className="w-full sm:w-auto border border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-bold text-blue-300 flex items-center justify-center gap-2">
                                            {lifecycleAction === `restore:${version.id}` ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}Restore
                                        </button>
                                    )}
                                    {!['PUBLISHED', 'PUBLISHING', 'VALIDATING', 'UPLOADING'].includes(version.status) && (
                                        <button type="button" onClick={() => void handleDeleteVersion(version)} disabled={Boolean(publishingId || lifecycleAction)} className="w-full sm:w-auto border border-red-500/30 bg-red-500/5 hover:bg-red-500/10 disabled:opacity-50 px-3 py-2 rounded-lg text-sm font-bold text-red-300 flex items-center justify-center gap-2" aria-label={`Delete version ${version.version}`}>
                                            {lifecycleAction === `delete:${version.id}` ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}Delete
                                        </button>
                                    )}
                                </div>
                            </article>
                        ))}
                    </div>
                </section>
            </div>

            <UploadGameModal isOpen={isUploadOpen} onClose={() => setIsUploadOpen(false)} gameId={id} onUploaded={() => fetchData({ silent: true })} />
        </main>
    );
}
