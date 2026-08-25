export class GameRuntimeAdapter {
    async prepareLaunchConfig(manifest, storageRef) {
        throw new Error("Method not implemented.");
    }
}

export const SUPPORTED_CAPABILITIES = Object.freeze([
    'audio',
    'storage',
    'pointer-lock',
    'fullscreen',
    'downloads'
]);

const SUPPORTED_CAPABILITY_SET = new Set(SUPPORTED_CAPABILITIES);

export const RUNTIME_CAPABILITIES = Object.freeze({
    // Generic games remain in an opaque-origin iframe. Granting same-origin in
    // order to expose browser storage would let same-origin game code weaken
    // its own sandbox, so persistent storage is intentionally Foundry-only.
    web: Object.freeze(['audio', 'pointer-lock', 'fullscreen', 'downloads']),
    foundry: SUPPORTED_CAPABILITIES
});

export function normalizeCapabilities(capabilities) {
    if (!Array.isArray(capabilities)) return [];
    return [...new Set(capabilities.filter(capability => SUPPORTED_CAPABILITY_SET.has(capability)))];
}

export function runtimeSupportsCapability(runtime, capability) {
    return Boolean(RUNTIME_CAPABILITIES[runtime]?.includes(capability));
}

export function joinRuntimeUrl(location, entry) {
    if (typeof location !== 'string' || location.trim() === '') {
        throw new Error('Published runtime location is missing.');
    }
    if (typeof entry !== 'string' || entry.trim() === '') {
        throw new Error('Published runtime entry is missing.');
    }

    const encodedEntry = entry
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/');
    return `${location.replace(/\/+$/, '')}/${encodedEntry}`;
}

function createSandboxPolicy(runtime, capabilities) {
    const granted = normalizeCapabilities(capabilities)
        .filter(capability => runtimeSupportsCapability(runtime, capability));
    const sandboxTokens = ['allow-scripts'];

    if (runtime === 'foundry') sandboxTokens.push('allow-same-origin');
    if (granted.includes('pointer-lock')) sandboxTokens.push('allow-pointer-lock');
    if (granted.includes('downloads')) sandboxTokens.push('allow-downloads');

    const permissions = [];
    if (granted.includes('audio')) permissions.push('autoplay');
    if (granted.includes('fullscreen')) permissions.push('fullscreen');

    return {
        capabilities: granted,
        sandboxAttributes: sandboxTokens.join(' '),
        permissionsPolicy: permissions.join('; '),
        allowFullScreen: granted.includes('fullscreen')
    };
}

export class FoundryRuntimeAdapter extends GameRuntimeAdapter {
    async prepareLaunchConfig(manifest, storageRef, streamingManifest = null) {
        const policy = createSandboxPolicy('foundry', manifest.capabilities);
        return {
            type: 'foundry',
            // Points to sandbox.html, we will send the postMessage to launch the gameUrl
            entryUrl: '/sandbox.html',
            gameUrl: joinRuntimeUrl(storageRef.location, manifest.entry),
            streamingManifest: streamingManifest,
            ...policy
        };
    }
}

export class WebGameRuntimeAdapter extends GameRuntimeAdapter {
    async prepareLaunchConfig(manifest, storageRef) {
        const policy = createSandboxPolicy('web', manifest.capabilities);
        return {
            type: 'web',
            entryUrl: joinRuntimeUrl(storageRef.location, manifest.entry || 'index.html'),
            ...policy
        };
    }
}
