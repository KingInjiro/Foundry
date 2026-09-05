import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/platform/auth/AuthContext.jsx', () => ({
    getAuthToken: vi.fn(async () => 'firebase-token'),
    getCsrfToken: vi.fn(() => 'csrf-token'),
    getDevAuthUserId: vi.fn(() => 'dev-user')
}));

import { ApiError, requestJson } from '../../../src/platform/api/apiClient.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('shared API client', () => {
    it('adds auth context and returns normalized data', async () => {
        const fetchMock = vi.fn(async (url, options) => {
            expect(url).toBe('/api/example');
            expect(options.headers.get('authorization')).toBe('Bearer firebase-token');
            expect(options.headers.get('x-dev-uid')).toBe('dev-user');
            expect(options.headers.get('x-csrf-token')).toBe('csrf-token');
            expect(options.credentials).toBe('same-origin');
            return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
                status: 200,
                headers: { 'x-request-id': 'request-1' }
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(requestJson('/api/example', { method: 'POST', body: '{}' })).resolves.toEqual({ ok: true });
    });

    it('normalizes Platform errors with code, status, details, and request id', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            success: false,
            error: { code: 'VALIDATION_FAILED', message: 'Invalid package.', details: [{ path: 'manifest.json' }] }
        }), { status: 422, headers: { 'x-request-id': 'request-422' } })));

        await expect(requestJson('/api/example')).rejects.toMatchObject({
            name: 'ApiError',
            code: 'VALIDATION_FAILED',
            message: 'Invalid package.',
            status: 422,
            details: [{ path: 'manifest.json' }],
            requestId: 'request-422'
        });
    });

    it('rejects invalid JSON responses instead of leaking a parser exception', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>proxy error</html>', { status: 502 })));
        await expect(requestJson('/api/example')).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE', status: 502 });
    });

    it('aborts timed-out requests with a stable error code', async () => {
        vi.stubGlobal('fetch', vi.fn((url, options) => new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        })));
        await expect(requestJson('/api/slow', { timeoutMs: 5 })).rejects.toEqual(expect.objectContaining({
            constructor: ApiError,
            code: 'REQUEST_TIMEOUT'
        }));
    });
});
