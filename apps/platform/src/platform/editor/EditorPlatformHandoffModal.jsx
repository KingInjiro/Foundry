import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Rocket, X } from 'lucide-react';
import { apiClient } from '../api/apiClient.js';
import { validatePackageOffMainThread } from '../developer/packageValidationClient.js';
import { uploadPackageToPlatform } from '../developer/platformUploadService.js';
import { createEditorGamePackage } from './createEditorGamePackage.js';

export function EditorPlatformHandoffModal({ snapshot, cloudAdapter, onCancel, onReady }) {
    const [games, setGames] = useState([]);
    const [selectedGameId, setSelectedGameId] = useState('');
    const [name, setName] = useState('Foundry Editor Game');
    const [description, setDescription] = useState('');
    const [validation, setValidation] = useState(null);
    const [prepared, setPrepared] = useState(null);
    const [status, setStatus] = useState('preparing');
    const [message, setMessage] = useState('Building a Platform package…');
    const [progress, setProgress] = useState(0);

    const busy = ['preparing', 'uploading'].includes(status);
    const linkedLabel = useMemo(() => games.find(game => game.id === selectedGameId)?.title || '', [games, selectedGameId]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const [availableGames, existingProject] = await Promise.all([
                    apiClient.json.get('/api/games'),
                    snapshot.editorProjectId ? cloudAdapter.load(snapshot.editorProjectId) : Promise.resolve(null)
                ]);
                if (cancelled) return;
                setGames(availableGames || []);
                if (existingProject?.platformGameId) setSelectedGameId(existingProject.platformGameId);
                if (existingProject?.title) setName(existingProject.title);
                const packageResult = await createEditorGamePackage({
                    editorProjectId: snapshot.editorProjectId,
                    files: snapshot.files,
                    name: existingProject?.title || name,
                    description
                });
                const validationResult = await validatePackageOffMainThread(packageResult.file);
                if (cancelled) return;
                setPrepared(packageResult);
                setValidation(validationResult);
                setStatus(validationResult.valid ? 'ready' : 'invalid');
                setMessage(validationResult.valid ? 'Package is valid and ready for the existing upload pipeline.' : 'Fix the validation errors before sending this project.');
            } catch (error) {
                if (!cancelled) {
                    setStatus('error');
                    setMessage(error.message || 'Could not prepare the editor project.');
                }
            }
        })();
        return () => { cancelled = true; };
    }, [snapshot, cloudAdapter]);

    useEffect(() => {
        const onKeyDown = event => {
            if (event.key === 'Escape' && !busy) onCancel();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [busy, onCancel]);

    const rebuild = async (editorProjectId = snapshot.editorProjectId) => {
        setStatus('preparing');
        setMessage('Rebuilding and validating the package…');
        const packageResult = await createEditorGamePackage({ editorProjectId, files: snapshot.files, name, description });
        const validationResult = await validatePackageOffMainThread(packageResult.file);
        setPrepared(packageResult);
        setValidation(validationResult);
        setStatus(validationResult.valid ? 'ready' : 'invalid');
        setMessage(validationResult.valid ? 'Package is valid and ready to send.' : 'Package validation failed.');
        return { packageResult, validationResult };
    };

    const send = async () => {
        try {
            setStatus('preparing');
            setMessage('Saving the private editor project…');
            const savedProject = await cloudAdapter.save({ id: snapshot.editorProjectId, files: snapshot.files, title: name });
            const { packageResult, validationResult } = await rebuild(savedProject.id);
            if (!validationResult.valid) return;
            setStatus('uploading');
            setProgress(0);
            const upload = await uploadPackageToPlatform({
                file: packageResult.file,
                manifest: validationResult.manifest,
                gameId: selectedGameId || null,
                onProgress: value => setProgress(value.percentage),
                onPhase: phase => setMessage({
                    'creating-project': 'Creating Platform project…',
                    'creating-version': 'Creating release version…',
                    transferring: 'Uploading package…',
                    validating: 'Running server validation…'
                }[phase] || 'Sending project…')
            });
            await apiClient.json.put(`/api/editor-projects/${savedProject.id}/platform-link`, {
                platformGameId: upload.gameId,
                lastReadyVersionId: upload.versionId
            });
            setStatus('success');
            setMessage('Version is READY in Release Manager.');
            onReady({ ...upload, editorProjectId: savedProject.id });
        } catch (error) {
            setStatus('error');
            setMessage(error.message || 'Editor handoff failed.');
            if (Array.isArray(error.details)) setValidation({ valid: false, errors: error.details, warnings: [] });
        }
    };

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="editor-handoff-title"
            onMouseDown={event => {
                if (event.target === event.currentTarget && !busy) onCancel();
            }}
        >
            <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-900 p-6 text-white shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 id="editor-handoff-title" className="text-xl font-bold flex items-center gap-2"><Rocket className="w-5 h-5 text-blue-400" /> Send to Platform</h2>
                        <p className="mt-1 text-sm text-neutral-400">Uses the same client validation, upload session, server validation, version lifecycle, and Release Manager as ZIP uploads.</p>
                    </div>
                    <button type="button" onClick={onCancel} disabled={busy} aria-label="Close" className="text-neutral-400 hover:text-white disabled:opacity-40"><X /></button>
                </div>

                <div className="mt-5 grid gap-4">
                    <label className="grid gap-1 text-sm">Game name<input value={name} maxLength={120} onChange={event => setName(event.target.value)} className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2" /></label>
                    <label className="grid gap-1 text-sm">Description<textarea value={description} maxLength={2000} onChange={event => setDescription(event.target.value)} rows={3} className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2" /></label>
                    <label className="grid gap-1 text-sm">Platform project
                        <select value={selectedGameId} onChange={event => setSelectedGameId(event.target.value)} className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2">
                            <option value="">Create a new Platform project</option>
                            {games.map(game => <option key={game.id} value={game.id}>{game.title}</option>)}
                        </select>
                    </label>
                </div>

                <div className={`mt-5 rounded-xl border p-4 text-sm ${status === 'success' || status === 'ready' ? 'border-green-500/30 bg-green-500/10 text-green-200' : status === 'invalid' || status === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-blue-500/30 bg-blue-500/10 text-blue-200'}`} role="status" aria-live="polite">
                    <div className="flex items-center gap-2">{status === 'success' || status === 'ready' ? <CheckCircle2 className="w-4 h-4" /> : status === 'error' || status === 'invalid' ? <AlertCircle className="w-4 h-4" /> : <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />}{message}</div>
                    {status === 'uploading' && <div className="mt-3 h-2 overflow-hidden rounded bg-neutral-800"><div className="h-full bg-blue-500" style={{ width: `${progress}%` }} /></div>}
                </div>

                {validation?.warnings?.length > 0 && <ul className="mt-4 list-disc pl-5 text-xs text-amber-300">{validation.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}</ul>}
                {validation?.errors?.length > 0 && <ul className="mt-4 list-disc pl-5 text-xs text-red-300">{validation.errors.map((error, index) => <li key={`${error.code}-${index}`}>{error.code}: {error.message}</li>)}</ul>}

                <div className="mt-6 flex flex-wrap justify-end gap-3">
                    <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-bold disabled:opacity-40">Cancel</button>
                    <button type="button" onClick={() => void send()} disabled={busy || !prepared || !name.trim()} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold hover:bg-blue-500 disabled:opacity-40">{status === 'uploading' ? 'Sending…' : selectedGameId ? `Create version in ${linkedLabel}` : 'Create project & version'}</button>
                </div>
            </div>
        </div>
    );
}
