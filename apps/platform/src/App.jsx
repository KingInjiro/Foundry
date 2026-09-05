import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './platform/auth/AuthContext.jsx';
import { LandingPage } from './platform/LandingPage.jsx';

const DeveloperDashboard = lazy(() => import('./platform/developer/DeveloperDashboard.jsx').then(module => ({ default: module.DeveloperDashboard })));
const PlayerPlatform = lazy(() => import('./platform/player/PlayerPlatform.jsx').then(module => ({ default: module.PlayerPlatform })));
const EditorRoute = lazy(() => import('./platform/editor/EditorRoute.jsx'));
const ModerationDashboard = lazy(() => import('./platform/moderation/ModerationDashboard.jsx'));

function RouteFallback() {
    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-400 flex items-center justify-center" role="status" aria-live="polite">
            <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-neutral-700 border-t-blue-500 rounded-full animate-spin" />
                Opening Foundry…
            </div>
        </div>
    );
}

export default function App() {
    return (
        <AuthProvider>
        <BrowserRouter>
            <Suspense fallback={<RouteFallback />}>
                <Routes>
                    <Route path="/" element={<LandingPage />} />
                    <Route path="/developer/*" element={<DeveloperDashboard />} />
                    <Route path="/player/*" element={<PlayerPlatform />} />
                    <Route path="/editor" element={<EditorRoute />} />
                    <Route path="/editor/*" element={<Navigate to="/editor" replace />} />
                    <Route path="/moderation" element={<ModerationDashboard />} />
                    <Route path="/moderation/*" element={<Navigate to="/moderation" replace />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </Suspense>
        </BrowserRouter>
        </AuthProvider>
    );
}
