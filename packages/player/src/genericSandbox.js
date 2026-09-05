import {
    SANDBOX_MESSAGE_TYPES,
    createSandboxMessage,
    resolvePublishedGameUrl
} from './sandboxProtocol.js';

// This document is platform-owned and is the same-origin outer loader. The
// untrusted game always lives one level deeper in its own opaque-origin
// sandbox. Do not derive this from document.referrer: the Platform correctly
// serves a no-referrer policy.
const parentOrigin = window.location.origin;

let activeLaunchId = null;
let activeFrame = null;

function post(type, payload = {}) {
    if (!parentOrigin) return;
    window.parent.postMessage(createSandboxMessage(type, payload), parentOrigin);
}

function escapeHtmlAttribute(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function createInstrumentedGameDocument(html, { gameUrl, launchId }) {
    const bootstrap = `<script>(function(){
var launchId=${JSON.stringify(launchId)};var failed=false;
function send(type,payload){parent.postMessage({type:type,launchId:launchId,payload:payload||{}},'*');}
addEventListener('error',function(event){failed=true;send('error',{message:event.message||'Game script failed during boot.'});});
addEventListener('unhandledrejection',function(event){failed=true;var reason=event.reason;send('error',{message:reason&&reason.message?reason.message:'Game promise rejected during boot.'});});
send('booting');
addEventListener('load',function(){setTimeout(function(){if(!failed)send('ready');},50);},{once:true});
})();<\/script>`;
    const base = `<base href="${escapeHtmlAttribute(gameUrl)}">`;
    const source = String(html || '');
    if (/<head(?:\s[^>]*)?>/i.test(source)) {
        return source.replace(/<head(?:\s[^>]*)?>/i, match => `${match}${base}${bootstrap}`);
    }
    return `<!doctype html><html><head>${base}${bootstrap}</head><body>${source}</body></html>`;
}

export function normalizeInnerRuntimeMessage(event, frameWindow, launchId) {
    if (event.source !== frameWindow || !event.data || event.data.launchId !== launchId) return null;
    if (!['booting', 'ready', 'error'].includes(event.data.type)) return null;
    return {
        type: event.data.type,
        message: typeof event.data.payload?.message === 'string' ? event.data.payload.message.slice(0, 500) : ''
    };
}

async function launch(payload) {
    const launchId = typeof payload?.launchId === 'string' ? payload.launchId : '';
    if (!launchId || launchId.length > 128) throw new Error('Generic game launch ID is invalid.');
    const gameUrl = resolvePublishedGameUrl(payload.gameUrl, parentOrigin);
    activeLaunchId = launchId;
    activeFrame?.remove();

    const response = await fetch(gameUrl, { credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error(`Game document returned HTTP ${response.status}.`);
    const html = await response.text();
    if (activeLaunchId !== launchId) return;

    const frame = document.createElement('iframe');
    const capabilities = Array.isArray(payload.capabilities) ? payload.capabilities : [];
    const sandboxTokens = ['allow-scripts'];
    if (capabilities.includes('pointer-lock')) sandboxTokens.push('allow-pointer-lock');
    if (capabilities.includes('downloads')) sandboxTokens.push('allow-downloads');
    frame.setAttribute('sandbox', sandboxTokens.join(' '));
    const permissions = [];
    if (capabilities.includes('audio')) permissions.push('autoplay');
    if (capabilities.includes('fullscreen')) permissions.push('fullscreen');
    if (permissions.length) frame.setAttribute('allow', permissions.join('; '));
    if (capabilities.includes('fullscreen')) frame.setAttribute('allowfullscreen', '');
    frame.title = 'Published web game';
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:#000';
    frame.srcdoc = createInstrumentedGameDocument(html, { gameUrl, launchId });
    document.body.replaceChildren(frame);
    activeFrame = frame;
}

window.addEventListener('message', event => {
    if (event.source === window.parent) {
        if (!parentOrigin || event.origin !== parentOrigin || event.data?.type !== SANDBOX_MESSAGE_TYPES.RUN_WEB_GAME) return;
        void launch(event.data.payload).catch(error => {
            post(SANDBOX_MESSAGE_TYPES.GAME_ERROR, { launchId: event.data?.payload?.launchId || null, message: error.message || 'Generic game loader failed.' });
        });
        return;
    }

    const message = normalizeInnerRuntimeMessage(event, activeFrame?.contentWindow, activeLaunchId);
    if (!message) return;
    if (message.type === 'booting') post(SANDBOX_MESSAGE_TYPES.GAME_BOOTING, { launchId: activeLaunchId });
    if (message.type === 'ready') post(SANDBOX_MESSAGE_TYPES.GAME_READY, { launchId: activeLaunchId });
    if (message.type === 'error') post(SANDBOX_MESSAGE_TYPES.GAME_ERROR, { launchId: activeLaunchId, message: message.message || 'Generic game failed during boot.' });
});

post(SANDBOX_MESSAGE_TYPES.SANDBOX_READY, { runtime: 'web' });
