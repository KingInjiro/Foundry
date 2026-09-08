/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameCatalog } from '../../../src/platform/player/GameCatalog.jsx';
import { apiClient } from '../../../src/platform/api/apiClient.js';

vi.mock('../../../src/platform/auth/AuthContext.jsx', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../../src/platform/discovery/PlayNowButton.jsx', () => ({ PlayNowButton: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const game = (id, name) => ({ gameId: id, name, developer: 'Test developer', description: name });
const response = (data = [], meta = {}) => ({ ok: true, json: async () => ({ success: true, data, meta }) });
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

describe('catalog search and pagination recovery', () => {
    let container, root, catalogRequest;
    const buttons = () => [...container.querySelectorAll('button')];
    const search = () => container.querySelector('input[placeholder="Search games, tags or developers"]');
    const cards = () => [...container.querySelectorAll('#all-games article h3')].map(node => node.textContent);

    beforeEach(() => {
        vi.useFakeTimers();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        catalogRequest = vi.fn(async () => response([game('alpha', 'Alpha')], { nextCursor: 'page-2' }));
        vi.spyOn(apiClient, 'get').mockImplementation((endpoint, options) => endpoint.startsWith('/api/catalog/')
            ? catalogRequest(new URL(endpoint, 'https://foundry.test'), options)
            : Promise.resolve(response()));
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    async function render() {
        await act(async () => root.render(<MemoryRouter><GameCatalog /></MemoryRouter>));
    }
    async function typeQuery(value) {
        const input = search();
        input.focus();
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => vi.advanceTimersByTimeAsync(250));
        return input;
    }
    async function loadMore() {
        await act(async () => buttons().find(button => button.textContent.includes('Load More')).click());
    }

    it('keeps search mounted and focused while results are loading', async () => {
        const pending = deferred();
        await render();
        catalogRequest.mockReturnValueOnce(pending.promise);
        const input = await typeQuery('beta');
        expect(search()).toBe(input);
        expect(document.activeElement).toBe(input);
        await act(async () => pending.resolve(response([game('beta', 'Beta')])));
        expect(cards()).toEqual(['Beta']);
        expect(document.activeElement).toBe(input);
    });

    it('keeps loaded games and retries the same page after a pagination failure', async () => {
        await render();
        catalogRequest.mockRejectedValueOnce(new Error('Could not load the next page.'));
        await loadMore();
        expect(cards()).toEqual(['Alpha']);
        expect(search()).not.toBeNull();
        expect(container.querySelector('[role="alert"]').textContent).toContain('Could not load the next page.');
        catalogRequest.mockResolvedValueOnce(response([game('beta', 'Beta')]));
        await act(async () => buttons().find(button => button.textContent.includes('Retry Load More')).click());
        expect(cards()).toEqual(['Alpha', 'Beta']);
        expect(catalogRequest.mock.calls.map(([url]) => url.searchParams.get('cursor'))).toEqual([null, 'page-2', 'page-2']);
    });

    it.each(['success', 'failure'])('ignores a previous filter pagination %s after a new search finishes', async outcome => {
        const pending = deferred();
        await render();
        catalogRequest.mockReturnValueOnce(pending.promise);
        await loadMore();
        catalogRequest.mockResolvedValueOnce(response([game('beta', 'Beta')]));
        await typeQuery('beta');
        expect(cards()).toEqual(['Beta']);
        await act(async () => outcome === 'success'
            ? pending.resolve(response([game('old', 'Old result')], { nextCursor: 'old-page-3' }))
            : pending.reject(new Error('Stale request failed')));
        expect(cards()).toEqual(['Beta']);
        expect(container.textContent).not.toContain('Stale request failed');
        expect(buttons().some(button => button.textContent.includes('Load More'))).toBe(false);
    });

    it('keeps filters usable after the first page fails and retries in place', async () => {
        catalogRequest.mockRejectedValueOnce(new Error('Catalog is temporarily unavailable.'));
        await render();
        expect(search()).not.toBeNull();
        expect(container.querySelector('[role="alert"]').textContent).toContain('Catalog is temporarily unavailable.');
        await act(async () => buttons().find(button => button.textContent === 'Try Again').click());
        expect(cards()).toEqual(['Alpha']);
    });
});
