import { describe, expect, it } from 'vitest';
import {
    SANDBOX_MESSAGE_TYPES,
    SANDBOX_PROTOCOL_VERSION,
    createSandboxMessage,
    isTrustedParentMessage,
    normalizeRunRequest,
    resolvePublishedGameUrl
} from '../src/sandboxProtocol.js';

const ORIGIN = 'https://play.foundry.test';

describe('sandbox protocol', () => {
    it('wraps typed messages with a protocol version', () => {
        expect(createSandboxMessage(SANDBOX_MESSAGE_TYPES.GAME_READY, { runtime: 'foundry' })).toEqual({
            protocolVersion: SANDBOX_PROTOCOL_VERSION,
            type: 'GAME_READY',
            payload: { runtime: 'foundry' }
        });
    });

    it('accepts messages only from the exact parent window and origin', () => {
        const parentWindow = {};
        expect(isTrustedParentMessage({ source: parentWindow, origin: ORIGIN }, parentWindow, ORIGIN)).toBe(true);
        expect(isTrustedParentMessage({ source: {}, origin: ORIGIN }, parentWindow, ORIGIN)).toBe(false);
        expect(isTrustedParentMessage({ source: parentWindow, origin: 'https://attacker.test' }, parentWindow, ORIGIN)).toBe(false);
    });

    it('normalizes a typed published launch and supplies safe defaults', () => {
        const request = normalizeRunRequest({
            type: SANDBOX_MESSAGE_TYPES.RUN_GAME,
            payload: {
                launchId: 'launch-1',
                gameUrl: '/api/cdn/games/game-1/versions/version-1/extracted/main.js'
            }
        }, ORIGIN);

        expect(request).toEqual({
            mode: 'typed',
            launchId: 'launch-1',
            init: {
                code: '',
                gameUrl: `${ORIGIN}/api/cdn/games/game-1/versions/version-1/extracted/main.js`,
                assets: {},
                capabilities: [],
                recoverState: null,
                streamingManifest: null,
                allowEditorCommands: false
            }
        });
    });

    it('grants only a validated, unique capability list and gates recovery on storage', () => {
        const request = normalizeRunRequest({
            type: SANDBOX_MESSAGE_TYPES.RUN_GAME,
            payload: {
                launchId: 'launch-storage',
                gameUrl: '/api/cdn/games/game-1/versions/version-1/extracted/main.js',
                capabilities: ['audio', 'storage'],
                recoverState: '{"world":true}'
            }
        }, ORIGIN);

        expect(request.init.capabilities).toEqual(['audio', 'storage']);
        expect(request.init.recoverState).toBe('{"world":true}');

        expect(() => normalizeRunRequest({
            type: SANDBOX_MESSAGE_TYPES.RUN_GAME,
            payload: {
                launchId: 'launch-duplicate',
                gameUrl: '/api/cdn/games/game-1/versions/version-1/extracted/main.js',
                capabilities: ['audio', 'audio']
            }
        }, ORIGIN)).toThrow('capabilities');
    });

    it('drops recovery state when storage was not granted', () => {
        const request = normalizeRunRequest({
            type: SANDBOX_MESSAGE_TYPES.RUN_GAME,
            payload: {
                launchId: 'launch-no-storage',
                gameUrl: '/api/cdn/games/game-1/versions/version-1/extracted/main.js',
                recoverState: '{"should":"not-load"}'
            }
        }, ORIGIN);

        expect(request.init.recoverState).toBeNull();
    });

    it('keeps trusted legacy inline launches compatible with the editor', () => {
        const assets = { 'tone.wav': 'data:audio/wav;base64,AA==' };
        const request = normalizeRunRequest({
            type: 'run',
            code: 'class Game {}\nreturn Game;',
            assets
        }, ORIGIN);

        expect(request.mode).toBe('legacy');
        expect(request.launchId).toBeNull();
        expect(request.init.code).toContain('return Game');
        expect(request.init.assets).toBe(assets);
        expect(request.init.allowEditorCommands).toBe(true);
    });

    it.each([
        'https://attacker.test/api/cdn/games/g/versions/v/extracted/main.js',
        '/other/path/main.js',
        '/api/cdn/games/g/versions/v/extracted/%2Fetc.js',
        '/api/cdn/games/g/versions/v/extracted/main.js?token=secret',
        '/api/cdn/games/g/versions/v/extracted/main.js#fragment'
    ])('rejects an unsafe published game URL: %s', gameUrl => {
        expect(() => resolvePublishedGameUrl(gameUrl, ORIGIN)).toThrow();
    });

    it('rejects typed launches without an ID or executable entry', () => {
        expect(() => normalizeRunRequest({
            type: SANDBOX_MESSAGE_TYPES.RUN_GAME,
            payload: { gameUrl: '/api/cdn/games/g/versions/v/extracted/main.js' }
        }, ORIGIN)).toThrow('launch ID');

        expect(() => normalizeRunRequest({
            type: SANDBOX_MESSAGE_TYPES.RUN_GAME,
            payload: { launchId: 'launch-2' }
        }, ORIGIN)).toThrow('published game URL or inline game code');
    });
});
