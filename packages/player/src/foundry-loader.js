// This script runs INSIDE the sandboxed iframe for Foundry games.
// It acts as the bridge between the untrusted game code and the Foundry Engine (which is loaded here).
// It does NOT have access to the platform UI or state.

import { Foundry } from '@foundry/engine'; // The only place engine is imported for playback

console.log("Foundry Loader initializing...");

const parentOrigin = window.location.origin;

// Setup postMessage bridge to the parent platform
window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== parentOrigin) return;
    const data = event.data;
    if (data && data.type === 'GAME_PAUSE') {
        console.log("Foundry Game Paused via postMessage");
    }
});

// Notify platform ready
if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'GAME_READY', payload: { engine: 'foundry' } }, parentOrigin);
}

// Extract game script from URL query params (e.g. ?gameUrl=/fixtures/foundry-game/game.js)
const urlParams = new URLSearchParams(window.location.search);
const gameUrl = urlParams.get('gameUrl');

if (gameUrl) {
    const resolvedGameUrl = new URL(gameUrl, window.location.href);
    if (resolvedGameUrl.origin !== window.location.origin) {
        throw new Error('Foundry game scripts must use the loader origin.');
    }
    console.log(`Loading foundry game script from: ${resolvedGameUrl.href}`);
    const script = document.createElement('script');
    script.src = resolvedGameUrl.href;
    script.type = 'module';
    document.body.appendChild(script);
}
