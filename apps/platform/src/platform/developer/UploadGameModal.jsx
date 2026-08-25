import { apiClient } from '../api/apiClient.js';
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, FileArchive, UploadCloud, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { QuotaConfig } from '../backend/config/quotas.js';
import { uploadFileWithProgress } from './uploadFileWithProgress.js';
import { validatePackageOffMainThread } from './packageValidationClient.js';

const MAX_PACKAGE_BYTES = Number(QuotaConfig.PLATFORM_MAX_PACKAGE_SIZE_BYTES);

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** index);
    return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function UploadGameModal({ isOpen, onClose, gameId, onUploaded }) {
    const navigate = useNavigate();
    const fileInputRef = useRef(null);
    const uploadAbortRef = useRef(null);
    const [file, setFile] = useState(null);
    const [status, setStatus] = useState('idle');
    const [errors, setErrors] = useState([]);
    const [warnings, setWarnings] = useState([]);
    const [manifest, setManifest] = useState(null);
    const [streamingManifestPath, setStreamingManifestPath] = useState(null);
    const [uploaded, setUploaded] = useState(null);
    const [dragActive, setDragActive] = useState(false);
    const [createdGameId, setCreatedGameId] = useState(null);
    const [pendingUpload, setPendingUpload] = useState(null);
    const [uploadRetryAvailable, setUploadRetryAvailable] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadPhase, setUploadPhase] = useState('transferring');

    const reset = () => {
        uploadAbortRef.current?.abort();
        uploadAbortRef.current = null;
        setFile(null);
        setStatus('idle');
        setErrors([]);
        setWarnings([]);
        setManifest(null);
        setStreamingManifestPath(null);
        setUploaded(null);
        setDragActive(false);
        setCreatedGameId(null);
        setPendingUpload(null);
        setUploadRetryAvailable(false);
        setUploadProgress(0);
        setUploadPhase('transferring');
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    useEffect(() => {
        if (isOpen) reset();
    }, [isOpen]);

    useEffect(() => () => uploadAbortRef.current?.abort(), []);

    useEffect(() => {
        if (!isOpen) return undefined;
        const onKeyDown = event => {
            if (event.key === 'Escape' && status !== 'uploading') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose, status]);

    const validateFile = async selected => {
        if (!selected) return;
        setFile(selected);
        setErrors([]);
        setWarnings([]);
        setManifest(null);
        setStreamingManifestPath(null);
        setUploaded(null);
        setPendingUpload(null);
        setUploadRetryAvailable(false);
        setUploadProgress(0);
        setUploadPhase('transferring');

        if (!selected.name.toLowerCase().endsWith('.zip')) {
            setStatus('error');
            setErrors([{ code: 'INVALID_FILE_TYPE', message: 'Choose a ZIP package.' }]);
            return;
        }
        if (selected.size > MAX_PACKAGE_BYTES) {
            setStatus('error');
            setErrors([{ code: 'PACKAGE_SIZE_EXCEEDED', message: `Package is ${formatBytes(selected.size)}; the limit is ${formatBytes(MAX_PACKAGE_BYTES)}.` }]);
            return;
        }

        setStatus('validating');
        try {
            const result = await validatePackageOffMainThread(selected);
            setWarnings(result.warnings || []);
            if (!result.valid) {
                setStatus('error');
                setErrors(result.errors?.length ? result.errors : [{ code: 'VALIDATION_FAILED', message: 'Package validation failed.' }]);
                return;
            }
            setManifest(result.manifest);
            setStreamingManifestPath(result.streamingManifestPath || null);
            setStatus('valid');
        } catch (error) {
            setStatus('error');
            setErrors([{ code: 'VALIDATION_EXCEPTION', message: error.message || 'The ZIP package could not be read.' }]);
        }
    };

    const handleUpload = async () => {
        if (!file || !manifest || status === 'uploading') return;
        setStatus('uploading');
        setErrors([]);
        setUploadRetryAvailable(false);
        setUploadProgress(0);
        setUploadPhase('transferring');
        let canRetryCurrentSession = false;

        try {
            let targetGameId = gameId || createdGameId;
            if (!targetGameId) {
                const gameResponse = await apiClient.post('/api/games', {
                    title: manifest.name,
                    description: manifest.description || ''
                });
                const gameResult = await gameResponse.json();
                if (!gameResponse.ok || !gameResult.success) {
                    throw new Error(gameResult.error?.message || 'Could not create the game project.');
                }
                targetGameId = gameResult.data.id;
                setCreatedGameId(targetGameId);
                onUploaded?.({ gameId: targetGameId, projectCreated: true });
            }

            const fileSignature = `${file.name}:${file.size}:${file.lastModified || 0}`;
            let uploadSession = pendingUpload?.gameId === targetGameId && pendingUpload?.fileSignature === fileSignature
                ? pendingUpload
                : null;
            if (!uploadSession) {
                const versionResponse = await apiClient.post(`/api/games/${targetGameId}/versions`, { expectedSize: file.size });
                const versionResult = await versionResponse.json();
                if (!versionResponse.ok || !versionResult.success) {
                    throw new Error(versionResult.error?.message || 'Could not start the upload.');
                }
                uploadSession = { ...versionResult.data, gameId: targetGameId, fileSignature };
                setPendingUpload(uploadSession);
            }

            const { uploadUrl, sessionId, versionId } = uploadSession;
            canRetryCurrentSession = true;
            const abortController = new AbortController();
            uploadAbortRef.current = abortController;
            await uploadFileWithProgress({
                url: uploadUrl,
                file,
                signal: abortController.signal,
                onProgress: progress => setUploadProgress(progress.percentage)
            });
            uploadAbortRef.current = null;
            setUploadProgress(100);
            setUploadPhase('finalizing');

            const completeResponse = await apiClient.post(`/api/uploads/${sessionId}/complete`, {});
            const completeResult = await completeResponse.json();
            if (!completeResponse.ok || !completeResult.success) {
                canRetryCurrentSession = false;
                setPendingUpload(null);
                const details = completeResult.error?.details;
                if (Array.isArray(details) && details.length) {
                    setErrors(details);
                    setStatus('error');
                    return;
                }
                throw new Error(completeResult.error?.message || 'Server validation failed.');
            }

            const uploadResult = {
                gameId: targetGameId,
                versionId,
                manifest: completeResult.data.manifest || manifest,
                streamingManifestPath: completeResult.data.streamingManifestPath || null
            };
            setUploaded(uploadResult);
            setPendingUpload(null);
            setStatus('success');
            onUploaded?.(uploadResult);
        } catch (error) {
            uploadAbortRef.current = null;
            setStatus('error');
            setUploadRetryAvailable(canRetryCurrentSession);
            setErrors([{ code: error.code || 'UPLOAD_FAILED', message: error.message || 'Upload failed.' }]);
        }
    };

    const cancelUpload = () => {
        uploadAbortRef.current?.abort();
    };

    const openProject = () => {
        if (!uploaded?.gameId) return;
        onClose();
        navigate(`/developer/project/${uploaded.gameId}`);
    };

    if (!isOpen) return null;
    const busy = status === 'uploading' || status === 'validating';

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
                onMouseDown={event => {
                    if (event.target === event.currentTarget && !busy) onClose();
                }}
            >
                <motion.div
                    initial={{ scale: 0.96, opacity: 0, y: 8 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.96, opacity: 0, y: 8 }}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="upload-game-title"
                    className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 w-full max-w-xl shadow-2xl relative max-h-[90vh] overflow-y-auto"
                >
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        aria-label="Close upload dialog"
                        className="absolute top-4 right-4 p-1 text-neutral-400 hover:text-white disabled:opacity-40 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>

                    <h2 id="upload-game-title" className="text-2xl font-bold mb-2 flex items-center gap-2 pr-8">
                        <UploadCloud className="w-6 h-6 text-blue-400" />
                        {gameId ? 'Upload New Version' : 'Upload Game Package'}
                    </h2>
                    <p className="text-neutral-400 text-sm mb-6">
                        Choose a ZIP with a root <code className="text-neutral-300">manifest.json</code>. Foundry validates it locally before any upload.
                    </p>

                    {status !== 'success' && (
                        <div className="mb-5">
                            <div
                                className={`border-2 border-dashed rounded-xl p-7 text-center transition-colors relative ${status === 'error' ? 'border-red-500/40 bg-red-500/5' : status === 'valid' ? 'border-green-500/40 bg-green-500/5' : dragActive ? 'border-blue-400 bg-blue-500/10' : 'border-neutral-700 hover:border-blue-500 bg-neutral-950/50'}`}
                                onDragEnter={event => {
                                    event.preventDefault();
                                    if (!busy) setDragActive(true);
                                }}
                                onDragOver={event => event.preventDefault()}
                                onDragLeave={event => {
                                    if (!event.currentTarget.contains(event.relatedTarget)) setDragActive(false);
                                }}
                                onDrop={event => {
                                    event.preventDefault();
                                    setDragActive(false);
                                    if (!busy) void validateFile(event.dataTransfer.files?.[0]);
                                }}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".zip,application/zip"
                                    onChange={event => {
                                        const selectedFile = event.target.files?.[0];
                                        event.target.value = '';
                                        void validateFile(selectedFile);
                                    }}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                                    disabled={busy}
                                    aria-label="Choose game ZIP package"
                                />
                                {file ? <FileArchive className="w-10 h-10 text-blue-400 mx-auto mb-3" /> : <UploadCloud className="w-10 h-10 text-neutral-500 mx-auto mb-3" />}
                                <div className="font-medium text-neutral-200 break-all">
                                    {file ? file.name : 'Drop a ZIP here or click to browse'}
                                </div>
                                <div className="text-xs text-neutral-500 mt-1">
                                    {file ? formatBytes(file.size) : `Maximum ${formatBytes(MAX_PACKAGE_BYTES)}`}
                                </div>
                            </div>
                        </div>
                    )}

                    <div aria-live="polite">
                        {status === 'validating' && (
                            <div className="flex items-center gap-2 text-yellow-300 text-sm mb-4" role="status">
                                <div className="w-4 h-4 border-2 border-yellow-300 border-t-transparent rounded-full animate-spin" />
                                Checking manifest, paths, capabilities, and entry files…
                            </div>
                        )}

                        {status === 'error' && errors.length > 0 && (
                            <div className="text-red-300 text-sm mb-4 bg-red-400/10 p-4 rounded-xl border border-red-400/20">
                                <div className="flex items-center gap-2 font-bold mb-2"><AlertCircle className="w-5 h-5 shrink-0" />Package needs attention</div>
                                <ul className="space-y-2 list-disc pl-5">
                                    {errors.map((error, index) => (
                                        <li key={`${error.code || 'error'}:${index}`}>
                                            {error.message}{error.path ? <span className="text-red-400/70"> — {error.path}</span> : null}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {status === 'valid' && manifest && (
                            <div className="text-green-300 text-sm mb-4 bg-green-400/10 p-4 rounded-xl border border-green-400/20">
                                <div className="flex items-center gap-2 font-bold mb-2"><CheckCircle2 className="w-5 h-5 shrink-0" />Package is ready</div>
                                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-neutral-300">
                                    <dt className="text-neutral-500">Game</dt><dd className="truncate">{manifest.name}</dd>
                                    <dt className="text-neutral-500">Version</dt><dd>{manifest.gameVersion}</dd>
                                    <dt className="text-neutral-500">Runtime</dt><dd className="capitalize">{manifest.runtime}</dd>
                                    <dt className="text-neutral-500">Entry</dt><dd className="font-mono text-xs self-center truncate">{manifest.entry}</dd>
                                    {manifest.runtime === 'foundry' && <><dt className="text-neutral-500">Streaming</dt><dd className="font-mono text-xs self-center truncate">{streamingManifestPath || 'Legacy loading'}</dd></>}
                                </dl>
                            </div>
                        )}

                        {warnings.length > 0 && status !== 'error' && (
                            <div className="text-amber-300 text-xs mb-4">{warnings.map(warning => warning.message).join(' ')}</div>
                        )}

                        {status === 'uploading' && (
                            <div className="text-blue-300 text-sm mb-4" role="status">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span>{uploadPhase === 'finalizing' ? 'Running server validation…' : `Uploading package… ${uploadProgress}%`}</span>
                                    {uploadPhase === 'transferring' && <span className="font-mono text-xs">{uploadProgress}%</span>}
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-neutral-800" role="progressbar" aria-label="Package upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={uploadProgress}>
                                    <div className="h-full rounded-full bg-blue-500 transition-[width] duration-150" style={{ width: `${uploadProgress}%` }} />
                                </div>
                            </div>
                        )}

                        {status === 'success' && uploaded && (
                            <div className="text-green-300 mb-4 bg-green-400/10 p-5 rounded-xl border border-green-400/20">
                                <div className="flex items-center gap-2 font-bold mb-2"><CheckCircle2 className="w-5 h-5" />Version uploaded</div>
                                <p className="text-sm text-neutral-300">The package passed both validation stages and is ready for your explicit publish action.</p>
                                {uploaded.streamingManifestPath && <p className="text-xs text-green-400/80 mt-2 font-mono">Streaming: {uploaded.streamingManifestPath}</p>}
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 mt-7">
                        {status === 'uploading' && uploadPhase === 'transferring' && (
                            <button type="button" onClick={cancelUpload} className="rounded-lg border border-red-500/30 px-4 py-2.5 text-sm font-bold text-red-300 hover:bg-red-500/10">
                                Cancel Upload
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={busy}
                            className="px-4 py-2.5 text-sm font-medium text-neutral-300 hover:text-white disabled:opacity-40 transition-colors"
                        >
                            {status === 'success' ? 'Back to Dashboard' : 'Cancel'}
                        </button>
                        {(status === 'valid' || (status === 'error' && uploadRetryAvailable && manifest)) && (
                            <button
                                type="button"
                                onClick={handleUpload}
                                className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2"
                            >
                                {status === 'error' ? 'Retry Upload' : 'Upload Version'} <ArrowRight className="w-4 h-4" />
                            </button>
                        )}
                        {status === 'success' && (
                            <button
                                type="button"
                                onClick={openProject}
                                className="bg-green-500 hover:bg-green-400 text-neutral-950 px-6 py-2.5 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2"
                            >
                                Manage & Publish <ArrowRight className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
