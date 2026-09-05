import React, { useCallback, useMemo, useState } from 'react';
import EditorApp from '@foundry/engine/editor';
import { polyfill } from 'mobile-drag-drop';
import 'mobile-drag-drop/default.css';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/apiClient.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { EditorPlatformHandoffModal } from './EditorPlatformHandoffModal.jsx';

let browserWorkaroundsInstalled = false;

function installEditorBrowserWorkarounds() {
    if (browserWorkaroundsInstalled || typeof window === 'undefined') return;
    browserWorkaroundsInstalled = true;

    polyfill({ dragImageCenterOnTouch: true });
    window.addEventListener('touchmove', () => {}, { passive: false });

    const NativeResizeObserver = window.ResizeObserver;
    if (NativeResizeObserver) {
        window.ResizeObserver = class ResizeObserver extends NativeResizeObserver {
            constructor(callback) {
                super((entries, observer) => {
                    window.requestAnimationFrame(() => {
                        try {
                            callback(entries, observer);
                        } catch {
                            // Monaco can dispatch a stale observer callback while unmounting.
                        }
                    });
                });
            }
        };
    }

    window.addEventListener('error', event => {
        if (event.message?.includes('ResizeObserver')) {
            event.stopImmediatePropagation();
            event.preventDefault();
        }
    });

    window.addEventListener('unhandledrejection', event => {
        if (event.reason?.message?.includes('ResizeObserver')) {
            event.stopImmediatePropagation();
            event.preventDefault();
        }
    });
}

installEditorBrowserWorkarounds();

export default function EditorRoute() {
    const navigate = useNavigate();
    const { user, login } = useAuth();
    const [handoff, setHandoff] = useState(null);
    const [linkedProject, setLinkedProject] = useState(null);

    const ensureSignedIn = useCallback(async () => {
        if (user) return user;
        const signedIn = await login();
        if (!signedIn) throw new Error('Sign in is required for private cloud saves and Platform publishing.');
        return signedIn;
    }, [user, login]);

    const cloudProjectAdapter = useMemo(() => ({
        initialProjectId: typeof localStorage === 'undefined' ? '' : localStorage.getItem('foundry_editor_project_id') || '',
        async save({ id, files, title }) {
            await ensureSignedIn();
            const project = id
                ? await apiClient.json.put(`/api/editor-projects/${encodeURIComponent(id)}`, { files, ...(title && { title }) })
                : await apiClient.json.post('/api/editor-projects', { files, title: title || 'Foundry Editor Project' });
            localStorage.setItem('foundry_editor_project_id', project.id);
            setLinkedProject(project.platformGameId ? { gameId: project.platformGameId } : null);
            return project;
        },
        async load(id) {
            await ensureSignedIn();
            const project = await apiClient.json.get(`/api/editor-projects/${encodeURIComponent(id)}`);
            localStorage.setItem('foundry_editor_project_id', project.id);
            setLinkedProject(project.platformGameId ? { gameId: project.platformGameId } : null);
            return project;
        }
    }), [ensureSignedIn]);

    const openPlatformHandoff = useCallback(async snapshot => {
        await ensureSignedIn();
        return new Promise(resolve => setHandoff({ snapshot, resolve }));
    }, [ensureSignedIn]);

    const closeHandoff = useCallback(() => {
        setHandoff(current => {
            current?.resolve?.(null);
            return null;
        });
    }, []);

    const finishHandoff = useCallback(result => {
        if (result.editorProjectId) localStorage.setItem('foundry_editor_project_id', result.editorProjectId);
        setLinkedProject({ gameId: result.gameId, versionId: result.versionId });
        setHandoff(current => {
            current?.resolve?.(result);
            return null;
        });
        navigate(`/developer/project/${result.gameId}`);
    }, [navigate]);

    return (
        <>
            <EditorApp
                cloudProjectAdapter={cloudProjectAdapter}
                hostIntegration={{
                    actionLabel: 'Send to Platform',
                    onSend: openPlatformHandoff,
                    statusLabel: linkedProject
                        ? `Linked Platform project: ${linkedProject.gameId}${linkedProject.versionId ? ` · READY ${linkedProject.versionId}` : ''}`
                        : 'Not linked to a Platform project'
                }}
            />
            {handoff && (
                <EditorPlatformHandoffModal
                    snapshot={handoff.snapshot}
                    cloudAdapter={cloudProjectAdapter}
                    onCancel={closeHandoff}
                    onReady={finishHandoff}
                />
            )}
        </>
    );
}
