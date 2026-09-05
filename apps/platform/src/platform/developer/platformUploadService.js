import { apiClient, ApiError } from '../api/apiClient.js';
import { uploadFileWithProgress } from './uploadFileWithProgress.js';

const RECOVERY_STORAGE_KEY = 'foundry_pending_uploads_v1';

function readRecoveryHints() {
    try {
        const parsed = JSON.parse(localStorage.getItem(RECOVERY_STORAGE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        localStorage.removeItem(RECOVERY_STORAGE_KEY);
        return [];
    }
}

function writeRecoveryHint(session, file) {
    if (typeof localStorage === 'undefined') return;
    const remaining = readRecoveryHints().filter(item => item.sessionId !== session.sessionId);
    remaining.unshift({
        sessionId: session.sessionId,
        versionId: session.versionId,
        gameId: session.gameId,
        fileName: file.name,
        fileSize: file.size,
        fileLastModified: file.lastModified || 0,
        expiresAt: session.expiresAt || null,
        updatedAt: Date.now()
    });
    localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(remaining.slice(0, 20)));
}

function clearRecoveryHint(sessionId) {
    if (typeof localStorage === 'undefined') return;
    const remaining = readRecoveryHints().filter(item => item.sessionId !== sessionId);
    if (remaining.length) localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(remaining));
    else localStorage.removeItem(RECOVERY_STORAGE_KEY);
}

export function getUploadRecoveryHints() {
    return typeof localStorage === 'undefined' ? [] : readRecoveryHints();
}

export async function uploadPackageToPlatform({
    file,
    manifest,
    gameId = null,
    uploadSession = null,
    signal,
    onProgress = () => {},
    onPhase = () => {},
    onSession = () => {}
}) {
    if (!file || !manifest) throw new TypeError('A validated ZIP file and manifest are required.');
    let targetGameId = gameId;
    if (!targetGameId) {
        onPhase('creating-project');
        const game = await apiClient.json.post('/api/games', {
            title: manifest.name,
            description: manifest.description || ''
        }, { signal });
        targetGameId = game.id;
    }

    let session = uploadSession;
    if (session?.expectedSize && Number(session.expectedSize) !== file.size) {
        throw new ApiError({ code: 'UPLOAD_SIZE_MISMATCH', message: 'Select the same ZIP file that started this upload session.' });
    }
    if (session && !session.uploadUrl) {
        onPhase('resuming-session');
        session = await apiClient.json.post(`/api/uploads/${session.sessionId}/resume`, {}, { signal });
    }
    if (!session) {
        onPhase('creating-version');
        session = await apiClient.json.post(`/api/games/${targetGameId}/versions`, { expectedSize: file.size }, { signal });
    }
    session = { ...session, gameId: targetGameId };
    onSession(session);
    writeRecoveryHint(session, file);

    try {
        onPhase('transferring');
        await uploadFileWithProgress({ url: session.uploadUrl, file, signal, onProgress });
        onPhase('validating');
        const completed = await apiClient.json.post(`/api/uploads/${session.sessionId}/complete`, {}, { signal, timeoutMs: 60_000 });
        clearRecoveryHint(session.sessionId);
        return {
            gameId: targetGameId,
            versionId: session.versionId,
            sessionId: session.sessionId,
            status: completed.status,
            manifest: completed.manifest || manifest,
            streamingManifestPath: completed.streamingManifestPath || null,
            projectCreated: !gameId
        };
    } catch (error) {
        error.uploadSession = session;
        if (error.status >= 400 && error.code !== 'REQUEST_TIMEOUT' && error.code !== 'NETWORK_ERROR' && error.code !== 'REQUEST_ABORTED') {
            clearRecoveryHint(session.sessionId);
        }
        throw error;
    }
}
