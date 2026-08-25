console.log("Generic Web Game initializing...");
// Notify platform that the game is ready
if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'GAME_READY', payload: { status: 'ok' } }, '*');
}
