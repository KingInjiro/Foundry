/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtectedRouteGate } from '../../../src/platform/auth/ProtectedRouteGate.jsx';

const auth = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock('../../../src/platform/auth/AuthContext.jsx', () => ({ useAuth: () => auth }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Location() {
    const { pathname, search } = useLocation();
    return <output>{pathname}{search}</output>;
}

describe('protected route public navigation', () => {
    let container, root;
    const destination = '/developer/project/private-project?tab=versions';

    beforeEach(async () => {
        auth.login.mockReset();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        await act(async () => root.render(
            <MemoryRouter initialEntries={[destination]}>
                <Location />
                <Routes>
                    <Route path="/developer/*" element={<ProtectedRouteGate area="Developer Dashboard" />} />
                    <Route path="/" element={<h1>Foundry home</h1>} />
                    <Route path="/player" element={<h1>Catalog</h1>} />
                </Routes>
            </MemoryRouter>
        ));
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    it.each([
        { label: 'Back to Home', path: '/', heading: 'Foundry home' },
        { label: 'Browse Catalog', path: '/player', heading: 'Catalog' }
    ])('allows $label without starting authentication', async ({ label, path, heading }) => {
        const link = [...container.querySelectorAll('a')].find(node => node.textContent === label);
        expect(link.getAttribute('href')).toBe(path);
        await act(async () => link.click());
        expect(container.querySelector('output').textContent).toBe(path);
        expect(container.querySelector('h1').textContent).toBe(heading);
        expect(auth.login).not.toHaveBeenCalled();
    });

    it('preserves a deep link after dialog dismissal and allows sign-in to be reopened', async () => {
        let dismiss;
        auth.login.mockImplementation(() => new Promise(resolve => { dismiss = resolve; }));
        const signIn = container.querySelector('button');
        await act(async () => signIn.click());
        expect(signIn.disabled).toBe(true);
        await act(async () => dismiss(null));
        expect(container.querySelector('output').textContent).toBe(destination);
        expect(signIn.disabled).toBe(false);
        expect(container.querySelector('[role="alert"]').textContent).toContain('browse without signing in');
        await act(async () => signIn.click());
        expect(auth.login).toHaveBeenCalledTimes(2);
        await act(async () => dismiss(null));
        await act(async () => container.querySelector('a[href="/player"]').click());
        expect(container.querySelector('h1').textContent).toBe('Catalog');
    });

    it('keeps a public exit usable when sign-in fails', async () => {
        auth.login.mockRejectedValue(new Error('Sign-in is unavailable.'));
        await act(async () => container.querySelector('button').click());
        expect(container.querySelector('[role="alert"]').textContent).toBe('Sign-in is unavailable.');
        expect(container.querySelector('output').textContent).toBe(destination);
        await act(async () => container.querySelector('a[href="/"]').click());
        expect(container.querySelector('h1').textContent).toBe('Foundry home');
    });
});
