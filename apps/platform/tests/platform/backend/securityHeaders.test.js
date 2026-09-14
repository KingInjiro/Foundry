import { describe, expect, it } from 'vitest';
import { getSecurityHeaders } from '../../../src/platform/backend/security/securityHeaders.js';

describe('surface-specific production security headers', () => {
    it('permits only exact R2 upload origins on Platform while leaving sandbox, scripts and auth policies intact', () => {
        const origin = 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com';
        const options = { storageUploadOrigins: [origin] };
        const before = getSecurityHeaders('/');
        const after = getSecurityHeaders('/', options);
        expect(after['Content-Security-Policy']).toBe(before['Content-Security-Policy'].replace("connect-src 'self'", `connect-src 'self' ${origin}`));
        for (const surface of ['/sandbox.html', '/generic-sandbox.html', '/api/auth/local/session']) {
            expect(getSecurityHeaders(surface, options)).toEqual(getSecurityHeaders(surface));
        }
    });

    it.each(['https://*.r2.cloudflarestorage.com', 'https://evil.example.test', 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/path'])('rejects unsafe upload CSP origin %s', origin => {
        expect(() => getSecurityHeaders('/', { storageUploadOrigins: [origin] })).toThrow();
    });

    it('keeps the Platform SPA non-frameable and free of unsafe script execution', () => {
        const headers = getSecurityHeaders('/developer');
        expect(headers['X-Frame-Options']).toBe('DENY');
        expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
        expect(headers['Content-Security-Policy']).not.toContain("'unsafe-eval'");
        expect(headers['Content-Security-Policy']).not.toContain("script-src 'self' 'unsafe-inline'");
    });

    it('gives the Foundry sandbox only self/blob execution required by its module Worker', () => {
        const headers = getSecurityHeaders('/sandbox.html');
        expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
        expect(headers['Content-Security-Policy']).toContain("worker-src 'self' blob:");
        expect(headers['Content-Security-Policy']).not.toContain("'unsafe-eval'");
    });

    it('contains generic compatibility exceptions on the nested generic surface only', () => {
        const generic = getSecurityHeaders('/generic-sandbox.html');
        expect(generic['Content-Security-Policy']).toContain("'unsafe-inline'");
        expect(generic['Content-Security-Policy']).toContain("'unsafe-eval'");
        expect(getSecurityHeaders('/')['Content-Security-Policy']).not.toContain("'unsafe-eval'");
    });

    it('marks private APIs no-store and CDN assets cross-origin', () => {
        expect(getSecurityHeaders('/api/games')['Cache-Control']).toBe('private, no-store');
        const cdn = getSecurityHeaders('/api/cdn/games/a/versions/b/extracted/main.js');
        expect(cdn['Cache-Control']).toBeUndefined();
        expect(cdn['Cross-Origin-Resource-Policy']).toBe('cross-origin');
    });

    it('emits HSTS only when HTTPS termination is explicitly confirmed', () => {
        expect(getSecurityHeaders('/', { hstsEnabled: false })['Strict-Transport-Security']).toBeUndefined();
        expect(getSecurityHeaders('/', { hstsEnabled: true })['Strict-Transport-Security']).toBe('max-age=31536000');
    });

    it('scopes Vite preamble and HMR exceptions to an explicit development profile', () => {
        const production = getSecurityHeaders('/');
        const development = getSecurityHeaders('/', { development: true });
        expect(production['Content-Security-Policy']).not.toContain("script-src 'self' 'unsafe-inline'");
        expect(production['Content-Security-Policy']).not.toContain('ws://localhost:*');
        expect(development['Content-Security-Policy']).toContain("script-src 'self' 'unsafe-inline'");
        expect(development['Content-Security-Policy']).toContain('ws://localhost:*');
        expect(development['Content-Security-Policy']).not.toContain("'unsafe-eval'");
    });
});
