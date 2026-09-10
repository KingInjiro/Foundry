/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EditorRoute from '../../../src/platform/editor/EditorRoute.jsx';

const auth = vi.hoisted(() => ({ user: null, login: vi.fn() }));
vi.mock('../../../src/platform/auth/AuthContext.jsx', () => ({ useAuth: () => auth }));
vi.mock('@foundry/engine/editor', () => ({
    default: ({ hostIntegration }) => <section aria-label="Editor">{hostIntegration.navigation}</section>
}));
vi.mock('mobile-drag-drop', () => ({ polyfill: vi.fn() }));
vi.mock('../../../src/platform/editor/EditorPlatformHandoffModal.jsx', () => ({ EditorPlatformHandoffModal: () => null }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Editor Platform exit', () => {
    let container, root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        auth.login.mockClear();
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    it.each([
        { user: { uid: 'editor-owner' }, label: 'Back to Developer Dashboard', destination: '/developer', heading: 'Developer Dashboard' },
        { user: null, label: 'Back to Platform', destination: '/', heading: 'Foundry home' }
    ])('provides $label without browser history or sign-in', async ({ user, label, destination, heading }) => {
        auth.user = user;
        await act(async () => root.render(
            <MemoryRouter initialEntries={['/editor']}>
                <Routes>
                    <Route path="/editor" element={<EditorRoute />} />
                    <Route path="/developer" element={<h1>Developer Dashboard</h1>} />
                    <Route path="/" element={<h1>Foundry home</h1>} />
                </Routes>
            </MemoryRouter>
        ));
        const exit = container.querySelector('nav[aria-label="Platform navigation"] a');
        expect(exit.textContent).toBe(label);
        expect(exit.getAttribute('href')).toBe(destination);
        await act(async () => exit.click());
        expect(container.querySelector('h1').textContent).toBe(heading);
        expect(container.querySelector('[aria-label="Editor"]')).toBeNull();
        expect(auth.login).not.toHaveBeenCalled();
    });
});
