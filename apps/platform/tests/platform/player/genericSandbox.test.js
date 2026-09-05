/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import {
    createInstrumentedGameDocument,
    normalizeInnerRuntimeMessage
} from '@foundry/player/generic-sandbox';

describe('generic web runtime bootstrap', () => {
    it('injects a published base URL and reports booting/ready through the controlled loader', () => {
        const documentSource = createInstrumentedGameDocument('<html><head><title>Game</title></head><body>ok</body></html>', {
            gameUrl: 'https://play.foundry.test/api/cdn/games/g/versions/v/extracted/index.html',
            launchId: 'launch-1'
        });

        expect(documentSource).toContain('<base href="https://play.foundry.test/api/cdn/games/g/versions/v/extracted/index.html">');
        expect(documentSource).toContain("send('booting')");
        expect(documentSource).toContain("send('ready')");
        expect(documentSource).toContain("send('error'");
    });

    it('accepts runtime state only from the exact nested game window and launch', () => {
        const frameWindow = {};
        expect(normalizeInnerRuntimeMessage({ source: frameWindow, data: { type: 'ready', launchId: 'launch-1' } }, frameWindow, 'launch-1'))
            .toEqual({ type: 'ready', message: '' });
        expect(normalizeInnerRuntimeMessage({ source: {}, data: { type: 'ready', launchId: 'launch-1' } }, frameWindow, 'launch-1')).toBeNull();
        expect(normalizeInnerRuntimeMessage({ source: frameWindow, data: { type: 'ready', launchId: 'other' } }, frameWindow, 'launch-1')).toBeNull();
        expect(normalizeInnerRuntimeMessage({ source: frameWindow, data: { type: 'forged', launchId: 'launch-1' } }, frameWindow, 'launch-1')).toBeNull();
    });
});
