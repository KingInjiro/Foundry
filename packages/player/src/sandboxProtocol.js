export const SANDBOX_PROTOCOL_VERSION = 1;

export const SANDBOX_MESSAGE_TYPES = Object.freeze({
    SANDBOX_READY: 'SANDBOX_READY',
    RUN_GAME: 'RUN_GAME',
    RUN_WEB_GAME: 'RUN_WEB_GAME',
    GAME_BOOTING: 'GAME_BOOTING',
    GAME_READY: 'GAME_READY',
    GAME_ERROR: 'GAME_ERROR',
    GAME_LOG: 'GAME_LOG',
    GAME_STATS: 'GAME_STATS',
    GAME_AUTOSAVE: 'GAME_AUTOSAVE',
    GAME_AUTOSAVE_ERROR: 'GAME_AUTOSAVE_ERROR',
    DISABLE_AUTOSAVE: 'DISABLE_AUTOSAVE'
});

const PUBLISHED_GAME_PREFIX = ['api', 'cdn', 'games'];
const SUPPORTED_CAPABILITIES = new Set([
    'audio',
    'storage',
    'pointer-lock',
    'fullscreen',
    'downloads'
]);

export function createSandboxMessage(type, payload = {}) {
    return {
        protocolVersion: SANDBOX_PROTOCOL_VERSION,
        type,
        payload
    };
}

export function isTrustedParentMessage(event, parentWindow, expectedOrigin) {
    return Boolean(
        event
        && event.source === parentWindow
        && typeof expectedOrigin === 'string'
        && expectedOrigin !== ''
        && event.origin === expectedOrigin
    );
}

export function resolvePublishedGameUrl(gameUrl, expectedOrigin) {
    if (typeof gameUrl !== 'string' || gameUrl.trim() === '') {
        throw new Error('Published game URL is missing.');
    }

    let url;
    try {
        url = new URL(gameUrl, `${expectedOrigin}/`);
    } catch {
        throw new Error('Published game URL is invalid.');
    }

    if (url.origin !== expectedOrigin) {
        throw new Error('Published game URL must use the Platform origin.');
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error('Published game URL must not contain credentials, a query, or a fragment.');
    }
    if (/%(?:00|2e|2f|5c)/i.test(url.pathname)) {
        throw new Error('Published game URL contains an unsafe encoded path.');
    }

    let decodedPath;
    try {
        decodedPath = decodeURIComponent(url.pathname);
    } catch {
        throw new Error('Published game URL contains invalid path encoding.');
    }

    if (decodedPath.includes('\\') || decodedPath.includes('\0')) {
        throw new Error('Published game URL contains an unsafe path.');
    }

    const segments = decodedPath.split('/').filter(Boolean);
    const hasPublishedPrefix = PUBLISHED_GAME_PREFIX.every((segment, index) => segments[index] === segment);
    const hasExpectedShape = hasPublishedPrefix
        && segments.length >= 8
        && segments[3] !== '.'
        && segments[3] !== '..'
        && segments[4] === 'versions'
        && segments[5] !== '.'
        && segments[5] !== '..'
        && segments[6] === 'extracted'
        && segments.slice(7).every(segment => segment !== '.' && segment !== '..');

    if (!hasExpectedShape) {
        throw new Error('Published game URL is outside the extracted game runtime.');
    }

    return url.href;
}

function normalizeAssets(assets) {
    if (assets === undefined || assets === null) return {};
    if (typeof assets !== 'object' || Array.isArray(assets)) {
        throw new Error('Game assets must be an object.');
    }
    return assets;
}

function normalizeCapabilities(capabilities) {
    if (capabilities === undefined || capabilities === null) return [];
    if (!Array.isArray(capabilities) || capabilities.length > SUPPORTED_CAPABILITIES.size) {
        throw new Error('Game capabilities are invalid.');
    }

    const normalized = [];
    const seen = new Set();
    for (const capability of capabilities) {
        if (typeof capability !== 'string' || !SUPPORTED_CAPABILITIES.has(capability) || seen.has(capability)) {
            throw new Error('Game capabilities are invalid.');
        }
        seen.add(capability);
        normalized.push(capability);
    }
    return normalized;
}

export function normalizeRunRequest(data, expectedOrigin) {
    if (!data || typeof data !== 'object') {
        throw new Error('Sandbox launch request is invalid.');
    }

    const typed = data.type === SANDBOX_MESSAGE_TYPES.RUN_GAME;
    const legacy = data.type === 'run';
    if (!typed && !legacy) {
        throw new Error('Unsupported sandbox launch message.');
    }

    const payload = typed ? data.payload : data;
    if (!payload || typeof payload !== 'object') {
        throw new Error('Sandbox launch payload is invalid.');
    }

    const launchId = typeof payload.launchId === 'string' ? payload.launchId.trim() : '';
    if (typed && (launchId === '' || launchId.length > 128)) {
        throw new Error('Sandbox launch ID is missing or invalid.');
    }

    const code = typeof payload.code === 'string' ? payload.code : '';
    const gameUrl = payload.gameUrl === undefined || payload.gameUrl === null
        ? null
        : resolvePublishedGameUrl(payload.gameUrl, expectedOrigin);

    if (!gameUrl && code.trim() === '') {
        throw new Error('A published game URL or inline game code is required.');
    }

    const capabilities = normalizeCapabilities(payload.capabilities);

    return {
        mode: typed ? 'typed' : 'legacy',
        launchId: launchId || null,
        init: {
            code,
            gameUrl,
            assets: normalizeAssets(payload.assets),
            capabilities,
            recoverState: capabilities.includes('storage') && typeof payload.recoverState === 'string'
                ? payload.recoverState
                : null,
            streamingManifest: payload.streamingManifest || null,
            allowEditorCommands: legacy
        }
    };
}
