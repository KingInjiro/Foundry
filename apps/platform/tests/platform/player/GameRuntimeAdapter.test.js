import { describe, expect, it } from 'vitest';
import {
    FoundryRuntimeAdapter,
    WebGameRuntimeAdapter,
    joinRuntimeUrl,
    runtimeSupportsCapability
} from '../../../src/platform/backend/runtime/GameRuntimeAdapter.js';

describe('GameRuntimeAdapter', () => {
    it('encodes each entry path segment without changing the published base path', () => {
        expect(joinRuntimeUrl('/api/cdn/games/g/versions/v/extracted/', 'levels/first #1.js')).toBe(
            '/api/cdn/games/g/versions/v/extracted/levels/first%20%231.js'
        );
    });

    it('applies declared Foundry permissions to the controlled sandbox', async () => {
        const config = await new FoundryRuntimeAdapter().prepareLaunchConfig({
            entry: 'main.js',
            capabilities: ['audio', 'storage', 'pointer-lock', 'fullscreen', 'downloads']
        }, { location: '/api/cdn/games/g/versions/v/extracted' });

        expect(config.capabilities).toEqual(['audio', 'storage', 'pointer-lock', 'fullscreen', 'downloads']);
        expect(config.sandboxAttributes.split(' ')).toEqual(expect.arrayContaining([
            'allow-scripts', 'allow-same-origin', 'allow-pointer-lock', 'allow-downloads'
        ]));
        expect(config.permissionsPolicy).toBe('autoplay; fullscreen');
        expect(config.allowFullScreen).toBe(true);
    });

    it('keeps generic games opaque-origin and fails closed on unsupported storage', async () => {
        const config = await new WebGameRuntimeAdapter().prepareLaunchConfig({
            entry: 'index.html',
            capabilities: ['storage', 'downloads']
        }, { location: '/api/cdn/games/g/versions/v/extracted' });

        expect(config.capabilities).toEqual(['downloads']);
        expect(config.entryUrl).toBe('/generic-sandbox.html');
        expect(config.gameUrl).toBe('/api/cdn/games/g/versions/v/extracted/index.html');
        expect(config.sandboxAttributes).toBe('allow-scripts allow-downloads allow-same-origin');
        expect(config.entryUrl).toBe('/generic-sandbox.html');
        expect(runtimeSupportsCapability('web', 'storage')).toBe(false);
    });

    it('rejects incomplete runtime locations and entries', () => {
        expect(() => joinRuntimeUrl('', 'index.html')).toThrow('location');
        expect(() => joinRuntimeUrl('/api/cdn/runtime', '')).toThrow('entry');
    });
});
