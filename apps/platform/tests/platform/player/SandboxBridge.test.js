/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SandboxBridge } from '../../../src/platform/player/SandboxBridge.js';

const EXPECTED_ORIGIN = 'https://play.foundry.test';

afterEach(() => {
    vi.restoreAllMocks();
});

function makeBridge() {
    const contentWindow = { postMessage: vi.fn() };
    const iframe = { contentWindow };
    return { bridge: new SandboxBridge(iframe, EXPECTED_ORIGIN), contentWindow };
}

describe('SandboxBridge', () => {
    it('delivers payloads only from the configured iframe and origin', () => {
        const { bridge, contentWindow } = makeBridge();
        const handler = vi.fn();
        bridge.on('GAME_READY', handler);

        bridge.handleMessage({
            origin: EXPECTED_ORIGIN,
            source: contentWindow,
            data: { type: 'GAME_READY', payload: { runtime: 'foundry' } }
        });
        bridge.handleMessage({
            origin: 'https://attacker.test',
            source: contentWindow,
            data: { type: 'GAME_READY', payload: { runtime: 'forged-origin' } }
        });
        bridge.handleMessage({
            origin: EXPECTED_ORIGIN,
            source: {},
            data: { type: 'GAME_READY', payload: { runtime: 'forged-frame' } }
        });

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith({ runtime: 'foundry' });
        bridge.destroy();
    });

    it('sends typed payloads to the exact configured origin', () => {
        const { bridge, contentWindow } = makeBridge();
        expect(bridge.send('RUN_GAME', { launchId: 'launch-1' })).toBe(true);
        expect(contentWindow.postMessage).toHaveBeenCalledWith(
            { type: 'RUN_GAME', payload: { launchId: 'launch-1' } },
            EXPECTED_ORIGIN
        );
        bridge.destroy();
    });

    it('separates the accepted origin from the postMessage target for opaque frames', () => {
        const contentWindow = { postMessage: vi.fn() };
        const bridge = new SandboxBridge({ contentWindow }, 'null', '*');
        const handler = vi.fn();
        bridge.on('GAME_READY', handler);

        bridge.handleMessage({
            origin: 'null',
            source: contentWindow,
            data: { type: 'GAME_READY', payload: { ok: true } }
        });
        bridge.handleMessage({
            origin: 'https://navigated-away.test',
            source: contentWindow,
            data: { type: 'GAME_READY', payload: { ok: false } }
        });
        bridge.send('RUN_GAME', {});

        expect(handler).toHaveBeenCalledTimes(1);
        expect(contentWindow.postMessage).toHaveBeenCalledWith({ type: 'RUN_GAME', payload: {} }, '*');
        bridge.destroy();
    });

    it('supports unsubscribe and idempotent destruction', () => {
        const { bridge, contentWindow } = makeBridge();
        const handler = vi.fn();
        const unsubscribe = bridge.on('GAME_READY', handler);
        unsubscribe();

        bridge.handleMessage({
            origin: EXPECTED_ORIGIN,
            source: contentWindow,
            data: { type: 'GAME_READY', payload: {} }
        });
        expect(handler).not.toHaveBeenCalled();

        bridge.destroy();
        bridge.destroy();
        expect(bridge.send('RUN_GAME', {})).toBe(false);
    });

    it('isolates a failing listener from the remaining listeners', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { bridge, contentWindow } = makeBridge();
        const second = vi.fn();
        bridge.on('GAME_READY', () => { throw new Error('listener failed'); });
        bridge.on('GAME_READY', second);

        bridge.handleMessage({
            origin: EXPECTED_ORIGIN,
            source: contentWindow,
            data: { type: 'GAME_READY', payload: { ok: true } }
        });

        expect(second).toHaveBeenCalledWith({ ok: true });
        bridge.destroy();
    });
});
