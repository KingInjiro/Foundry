const COMMON_HEADERS = Object.freeze({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Origin-Agent-Cluster': '?1',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()'
});

const PLATFORM_CSP = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "script-src 'self'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "connect-src 'self' https://*.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com",
    "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com"
].join('; ');

const FOUNDRY_SANDBOX_CSP = [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "script-src 'self' blob:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:"
].join('; ');

// Generic packages run in a nested opaque-origin iframe. Its srcdoc inherits
// this policy, so user-authored browser games require inline/eval compatibility
// here. The outer loader contains no untrusted DOM injection and the inner
// iframe deliberately has no allow-same-origin token.
const GENERIC_SANDBOX_CSP = [
    "default-src 'self' data: blob: https:",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https:",
    "worker-src 'self' blob: https:",
    "connect-src 'self' https:",
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "frame-src 'self' data: blob: https:"
].join('; ');

function developmentCsp(csp) {
    // Vite injects an inline React-refresh preamble and uses a localhost
    // WebSocket for HMR. These exceptions are selected only by the explicit
    // non-production server profile; production headers remain unchanged.
    let value = csp;
    if (!value.includes("script-src 'self' 'unsafe-inline'")) {
        value = value.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
    }
    return value.replace(
        "connect-src 'self'",
        "connect-src 'self' ws://localhost:* ws://127.0.0.1:*"
    );
}

export function getSecurityHeaders(pathname, { hstsEnabled = false, development = false } = {}) {
    const isFoundrySandbox = pathname === '/sandbox.html';
    const isGenericSandbox = pathname === '/generic-sandbox.html';
    const isApi = pathname === '/api' || pathname.startsWith('/api/');
    const isCdn = pathname.startsWith('/api/cdn/');
    const headers = {
        ...COMMON_HEADERS,
        'Cross-Origin-Opener-Policy': isFoundrySandbox || isGenericSandbox ? 'same-origin' : 'same-origin-allow-popups',
        'Cross-Origin-Resource-Policy': isCdn ? 'cross-origin' : 'same-origin',
        'X-Frame-Options': isFoundrySandbox || isGenericSandbox ? 'SAMEORIGIN' : 'DENY'
    };

    if (isFoundrySandbox) headers['Content-Security-Policy'] = FOUNDRY_SANDBOX_CSP;
    else if (isGenericSandbox) headers['Content-Security-Policy'] = GENERIC_SANDBOX_CSP;
    else if (!isApi) headers['Content-Security-Policy'] = PLATFORM_CSP;
    if (development && headers['Content-Security-Policy']) {
        headers['Content-Security-Policy'] = developmentCsp(headers['Content-Security-Policy']);
    }

    if (isApi && !isCdn) headers['Cache-Control'] = 'private, no-store';
    if (hstsEnabled) headers['Strict-Transport-Security'] = 'max-age=31536000';
    return headers;
}

export function applySecurityHeaders(options = {}) {
    return (req, res, next) => {
        const headers = getSecurityHeaders(req.path, options);
        for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
        next();
    };
}
