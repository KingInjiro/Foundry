import {
    SANDBOX_MESSAGE_TYPES,
    createSandboxMessage,
    isTrustedParentMessage,
    normalizeRunRequest
} from './sandboxProtocol.js';

const OriginalResizeObserver = window.ResizeObserver;
if (OriginalResizeObserver) {
    window.ResizeObserver = class ResizeObserver extends OriginalResizeObserver {
        constructor(callback) {
            super((entries, observer) => {
                window.requestAnimationFrame(() => {
                    try {
                        callback(entries, observer);
                    } catch (e) {}
                });
            });
        }
    };
}


const SAB_PROPS = {
    x: 0, y: 1, vx: 2, vy: 3, rotation: 4, scaleX: 5, scaleY: 6, z: 7, vz: 8, scaleZ: 9,
    layer: 10, isStatic: 11, isKinematic: 12, mass: 13, restitution: 14
};



class SandboxAudio {
    constructor(assets = {}) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        try {
            this.context = AudioContextClass ? new AudioContextClass() : null;
        } catch (error) {
            console.warn('Web Audio is unavailable for this game session.', error);
            this.context = null;
        }
        this.buffers = new Map();
        this.activeSounds = new Map();
        this.currentMusicSource = null;

        if (!this.context) return;

        this.masterGain = this.context.createGain();
        this.masterGain.connect(this.context.destination);
        this.musicGain = this.context.createGain();
        this.musicGain.connect(this.masterGain);
        this.sfxGain = this.context.createGain();
        this.sfxGain.connect(this.masterGain);
        
        for (const [name, url] of Object.entries(assets)) {
            if (typeof url === 'string' && url.startsWith('data:audio')) {
                this.loadSound(name, url);
            }
        }
        
        const resumeAudio = () => {
            if (this.context.state === 'suspended') {
                Promise.resolve(this.context.resume()).catch(() => {});
            }
        };
        window.addEventListener('click', resumeAudio, { once: true });
        document.addEventListener('keydown', resumeAudio, { once: true });
        window.addEventListener('touchstart', resumeAudio, { once: true });
    }
    
    async loadSound(name, dataUrl) {
        if (!this.context) return;
        try {
            const base64 = dataUrl.split(',')[1];
            const binaryString = window.atob(base64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const buffer = await this.context.decodeAudioData(bytes.buffer);
            this.buffers.set(name, buffer);
        } catch (e) {
            console.error('Failed to load sound', name, e);
        }
    }
    
    handleCommand(data) {
        if (!this.context) return;
        const cmd = data.cmd;
        if (cmd === 'setGlobalVolume') this.masterGain.gain.value = data.volume;
        else if (cmd === 'setMusicVolume') this.musicGain.gain.value = data.volume;
        else if (cmd === 'setSfxVolume') this.sfxGain.gain.value = data.volume;
        else if (cmd === 'playMusic') {
            if (this.currentMusicSource) {
                try { this.currentMusicSource.stop(); } catch (e) {}
                this.currentMusicSource.disconnect();
                this.currentMusicSource = null;
            }
            const buffer = this.buffers.get(data.name);
            if (buffer) {
                const source = this.context.createBufferSource();
                source.buffer = buffer;
                source.loop = data.loop;
                source.connect(this.musicGain);
                source.start(0);
                this.currentMusicSource = source;
            }
        }
        else if (cmd === 'stopMusic') {
            if (this.currentMusicSource) {
                try { this.currentMusicSource.stop(); } catch (e) {}
                this.currentMusicSource.disconnect();
                this.currentMusicSource = null;
            }
        }
        else if (cmd === 'playSound') {
            const buffer = this.buffers.get(data.name);
            if (buffer) {
                const source = this.context.createBufferSource();
                source.buffer = buffer;
                const gainNode = this.context.createGain();
                gainNode.gain.value = data.volume;
                source.connect(gainNode);
                gainNode.connect(this.sfxGain);
                source.onended = () => {
                    source.disconnect();
                    gainNode.disconnect();
                    this.activeSounds.delete(data.soundId);
                };
                source.start(0);
                this.activeSounds.set(data.soundId, { source, gainNode });
            }
        }
        else if (cmd === 'stopSound') {
            const sound = this.activeSounds.get(data.soundId);
            if (sound) {
                try { sound.source.stop(); } catch (e) {}
                sound.source.disconnect();
                sound.gainNode.disconnect();
                this.activeSounds.delete(data.soundId);
            }
        }
        else if (cmd === 'stopAllSounds') {
            this.stopAllSounds();
        }
        else if (cmd === 'playTone') {
            if (this.context.state === 'suspended') this.context.resume();
            const osc = this.context.createOscillator();
            const gain = this.context.createGain();
            osc.type = data.oscillatorType || 'sine';
            osc.frequency.setValueAtTime(data.frequency, this.context.currentTime);
            gain.gain.setValueAtTime(0, this.context.currentTime);
            gain.gain.linearRampToValueAtTime(data.volume, this.context.currentTime + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + data.duration);
            osc.connect(gain);
            gain.connect(this.sfxGain);
            osc.start(this.context.currentTime);
            osc.stop(this.context.currentTime + data.duration);
        } else if (cmd === 'resume') {
            if (this.context && this.context.state === 'suspended') {
                this.context.resume().catch(e => console.error("Audio resume failed:", e));
            }
        }
    }

    stopAllSounds() {
        for (const sound of this.activeSounds.values()) {
            try { sound.source.stop(); } catch (e) {}
            sound.source.disconnect();
            sound.gainNode.disconnect();
        }
        this.activeSounds.clear();
    }

    dispose() {
        this.stopAllSounds();
        if (this.currentMusicSource) {
            try { this.currentMusicSource.stop(); } catch (e) {}
            this.currentMusicSource.disconnect();
        }
        if (this.context && this.context.state !== 'closed') {
            Promise.resolve(this.context.close()).catch(() => {});
        }
    }
}

let sandboxAudio = null;

let entityMap = new Map();

function updateSnapshot(snap) {
    if (!window.engine) {
        window.engine = {
            time: { fps: 0, deltaTime: 0, elapsed: 0 },
            world: { gravityX: 0, gravityY: 0, isInfinite: false, width: 0, height: 0, entities: { entities: [] } },
            camera: { targetX: 0, targetY: 0, targetZoom: 1 },
            editor: {
                get selectedEntity() { return window._selectedEntity; },
                set selectedEntity(ent) { 
                    window._selectedEntity = ent;
                    if (engineWorker) engineWorker.postMessage({ type: 'set_selected', id: ent ? ent.id : null });
                }
            }
        };
    }
    

    window.engine.time = snap.time;
    

    if (snap.world) {
        if (!window.engine.world.__defined) {
            window.engine.world.__defined = true;
            for (const key of ['gravityX', 'gravityY', 'isInfinite', 'width', 'height']) {
                Object.defineProperty(window.engine.world, key, {
                    get: () => window.engine.world['_'+key],
                    set: (val) => {
                        window.engine.world['_'+key] = val;
                        if (engineWorker) engineWorker.postMessage({ type: 'set_world_prop', prop: key, value: val });
                    },
                    enumerable: true,
                    configurable: true
                });
            }
        }
        window.engine.world._gravityX = snap.world.gravityX;
        window.engine.world._gravityY = snap.world.gravityY;
        window.engine.world._isInfinite = snap.world.isInfinite;
        window.engine.world._width = snap.world.width;
        window.engine.world._height = snap.world.height;
    }

    if (snap.camera) {
        if (!window.engine.camera.__defined) {
            window.engine.camera.__defined = true;
            for (const key of ['targetX', 'targetY', 'targetZoom']) {
                Object.defineProperty(window.engine.camera, key, {
                    get: () => window.engine.camera['_'+key],
                    set: (val) => {
                        window.engine.camera['_'+key] = val;
                        if (engineWorker) engineWorker.postMessage({ type: 'set_camera_prop', prop: key, value: val });
                    },
                    enumerable: true,
                    configurable: true
                });
            }
        }
        window.engine.camera._targetX = snap.camera.targetX;
        window.engine.camera._targetY = snap.camera.targetY;
        window.engine.camera._targetZoom = snap.camera.targetZoom;
    }

    
    // update entities
    if (!window.engine.world.entities.entities) {
        window.engine.world.entities.entities = [];
    }
    const currentEntities = window.engine.world.entities.entities;
    
    for (const s of snap.entities) {
        if (s._deleted) {
            entityMap.delete(s.id);
            const idx = currentEntities.findIndex(e => e.id === s.id);
            if (idx !== -1) currentEntities.splice(idx, 1);
            continue;
        }
        
        let ent = entityMap.get(s.id);
        if (!ent) {
            ent = { id: s.id, _data: {} };
            entityMap.set(s.id, ent);
            currentEntities.push(ent);
        }
        
        // Merge data
        for (const key in s) {
            ent._data[key] = s[key];
        }
        
        for (const key in s) {
            if (key === 'id' || key === '_data' || key === 'components') continue;
            if (!(key in ent)) {
                Object.defineProperty(ent, key, {
                    get: () => ent._data[key],
                    set: (val) => {
                        ent._data[key] = val;
                        if (engineWorker) engineWorker.postMessage({ type: 'set_entity_prop', id: s.id, prop: key, value: val });
                    },
                    enumerable: true,
                    configurable: true
                });
            }
        }
        
        if (s.components) {
            ent.components = s.components;
        }
    }
    
    // Reconstruct hierarchy
    for (const ent of currentEntities) {
        ent.children = [];
        ent.parent = null;
    }
    for (const ent of currentEntities) {
        if (ent._data.parentId) {
            const parent = entityMap.get(ent._data.parentId);
            if (parent) {
                ent.parent = parent;
                parent.children.push(ent);
            }
        }
        if (!ent.addChild) {
            ent.addChild = (child) => {
                if (engineWorker) engineWorker.postMessage({ type: 'set_entity_parent', id: child.id, parentId: ent.id });
            };
            ent.removeChild = (child) => {
                if (engineWorker) engineWorker.postMessage({ type: 'set_entity_parent', id: child.id, parentId: null });
            };
        }
    }
    
    if (snap.selectedEntityId !== undefined) {
        window._selectedEntity = currentEntities.find(e => e.id === snap.selectedEntityId) || null;
    }
    
    if (!window.addComponentToEntity) {
        window.addComponentToEntity = (entityId, compName) => {
            if (engineWorker) {
                engineWorker.postMessage({ type: 'add_component', id: entityId, compName });
            }
        };
    }

    if (!window.updateComponentProperty) {
        window.updateComponentProperty = (entityId, compName, prop, value) => {
            if (engineWorker) {
                engineWorker.postMessage({ type: 'set_component_prop', id: entityId, compName, prop, value });
            }
        };
    }
}






let engineWorker = null;
let activeLaunchId = null;
let parentProtocol = 'typed';
let workerReady = false;

const PARENT_ORIGIN = window.location.origin;
const WORKER_START_TIMEOUT_MS = 30_000;
const WORKER_HEARTBEAT_TIMEOUT_MS = 5_000;

function postTypedMessage(type, payload = {}) {
    if (window.parent === window) return;
    window.parent.postMessage(createSandboxMessage(type, payload), PARENT_ORIGIN);
}

function postRuntimeMessage(type, payload, legacyMessage) {
    if (window.parent === window) return;
    if (parentProtocol === 'legacy' && legacyMessage) {
        window.parent.postMessage(legacyMessage, PARENT_ORIGIN);
        return;
    }
    postTypedMessage(type, payload);
}

function terminateWorker() {
    if (engineWorker) {
        engineWorker.terminate();
        engineWorker = null;
    }
    workerReady = false;
}

function reportRuntimeFailure(message, stack = null, legacyType = 'crashed') {
    const safeMessage = typeof message === 'string' && message.trim()
        ? message
        : 'The game runtime failed unexpectedly.';
    postRuntimeMessage(
        SANDBOX_MESSAGE_TYPES.GAME_ERROR,
        { message: safeMessage, stack, launchId: activeLaunchId },
        { type: legacyType, msg: safeMessage, stack }
    );
    document.documentElement.dataset.runtimeStatus = 'error';
    terminateWorker();
}

window.onerror = function(msg, url, lineNo, columnNo, error) {
    if (typeof msg === 'string' && msg.includes('ResizeObserver')) return true;
    if (error && error.message && error.message.includes('ResizeObserver')) return true;
    const message = `${String(msg)}\n    at ${url}:${lineNo}:${columnNo}`;
    postRuntimeMessage(
        SANDBOX_MESSAGE_TYPES.GAME_ERROR,
        { message, stack: error?.stack || null, launchId: activeLaunchId },
        { type: 'error', msg: message }
    );
    return false;
};

window.addEventListener("error", e => {
    if (e.message && e.message.includes("ResizeObserver")) {
        e.stopImmediatePropagation();
    }
});

window.addEventListener("unhandledrejection", e => {
    if (e.reason && e.reason.message && e.reason.message.includes("ResizeObserver")) {
        e.stopImmediatePropagation();
        e.preventDefault();
    }
});

// Forward console to parent
const methods = ['log', 'error', 'warn'];
methods.forEach(method => {
    const original = console[method];
    console[method] = (...args) => {
        if (args.some(arg => typeof arg === "string" && arg.includes("ResizeObserver"))) return;
        original.apply(console, args);
        const msg = args.map(a => {
            if (a instanceof Error) return a.stack || a.message;
            if (typeof a === 'object' && a !== null) {
                try { return JSON.stringify(a); } catch (e) { return String(a); }
            }
            return String(a);
        }).join(' ');
        postRuntimeMessage(
            SANDBOX_MESSAGE_TYPES.GAME_LOG,
            { level: method, message: msg, launchId: activeLaunchId },
            { type: 'log', level: method, msg }
        );
    };
});

let canvasGL = null;
let canvas2D = null;
let canvasContainer = null;

function setupEventProxy() {
    const proxyEvent = (e, overrideType) => {
        if (!engineWorker) return;
        const payload = {
            type: overrideType || e.type,
            code: e.code,
            key: e.key,
            button: e.button,
            clientX: e.clientX,
            clientY: e.clientY,
            offsetX: e.offsetX,
            offsetY: e.offsetY,
            deltaX: e.deltaX,
            deltaY: e.deltaY,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey
        };
        
        engineWorker.postMessage({ type: 'event', event: payload });
    };

    document.addEventListener('keydown', (e) => {
        if (e.code === 'F3' || e.code === 'F5' || e.key === 'F3') {
            e.preventDefault();
        }
        proxyEvent(e);
    });
    document.addEventListener('keyup', proxyEvent);
    document.addEventListener('pointermove', (e) => proxyEvent(e, 'mousemove'));
    document.addEventListener('pointerdown', (e) => { window.focus(); proxyEvent(e, 'mousedown'); });
    document.addEventListener('pointerup', (e) => proxyEvent(e, 'mouseup'));
    document.addEventListener('wheel', proxyEvent, { passive: false });
    document.addEventListener('contextmenu', (e) => { e.preventDefault(); proxyEvent(e); });
    
    window.addEventListener('resize', () => {
        if (!canvasContainer || !engineWorker) return;
        const rect = canvasContainer.getBoundingClientRect();
        engineWorker.postMessage({
            type: 'event',
            event: { type: 'resize', width: rect.width, height: rect.height }
        });
    });
}
setupEventProxy();

function startGame(runRequest) {
    parentProtocol = runRequest.mode;
    activeLaunchId = runRequest.launchId;
    workerReady = false;
    document.documentElement.dataset.runtimeStatus = 'starting';

    terminateWorker();
    if (sandboxAudio) sandboxAudio.dispose();
    sandboxAudio = runRequest.init.capabilities.includes('audio')
        ? new SandboxAudio(runRequest.init.assets)
        : null;

    canvasContainer = document.getElementById('sandbox-root');
    if (!canvasContainer) {
        throw new Error('Sandbox canvas container is unavailable.');
    }
    canvasContainer.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';

    const c1 = document.createElement('canvas');
    c1.style.position = 'absolute'; c1.style.left = '0'; c1.style.top = '0'; c1.style.width = '100%'; c1.style.height = '100%'; c1.style.touchAction = 'none'; c1.style.userSelect = 'none';

    const c2 = document.createElement('canvas');
    c2.style.position = 'absolute'; c2.style.left = '0'; c2.style.top = '0'; c2.style.width = '100%'; c2.style.height = '100%';
    c2.style.pointerEvents = 'none';

    wrapper.appendChild(c1);
    wrapper.appendChild(c2);
    canvasContainer.appendChild(wrapper);

    if (typeof c1.transferControlToOffscreen !== 'function' || typeof c2.transferControlToOffscreen !== 'function') {
        throw new Error('This browser does not support the offscreen canvas required by Foundry games.');
    }

    const offscreen1 = c1.transferControlToOffscreen();
    const offscreen2 = c2.transferControlToOffscreen();
    const rect = canvasContainer.getBoundingClientRect();

    engineWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const activeWorker = engineWorker;
    window.lastWorkerPing = Date.now();

    activeWorker.onmessage = (e) => {
        if (engineWorker !== activeWorker || !e.data || typeof e.data !== 'object') return;

        if (e.data.type === 'status' || e.data.type === 'heartbeat') {
            window.lastWorkerPing = Date.now();
        } else if (e.data.type === 'ready') {
            workerReady = true;
            window.lastWorkerPing = Date.now();
            document.documentElement.dataset.runtimeStatus = 'ready';
            postRuntimeMessage(
                SANDBOX_MESSAGE_TYPES.GAME_READY,
                { runtime: e.data.runtime || 'foundry', launchId: activeLaunchId },
                { type: 'ready', runtime: e.data.runtime || 'foundry' }
            );
        } else if (e.data.type === 'error') {
            console.error(e.data.msg);
            reportRuntimeFailure(e.data.msg, e.data.stack);
        } else if (e.data.type === 'log') {
            console[e.data.level || 'log'](e.data.msg);
            postRuntimeMessage(
                SANDBOX_MESSAGE_TYPES.GAME_LOG,
                { level: e.data.level || 'log', message: e.data.msg, launchId: activeLaunchId },
                { type: 'log', level: e.data.level || 'log', msg: e.data.msg }
            );
        } else if (e.data.type === 'snapshot') {
            window.lastWorkerPing = Date.now();
            if (e.data.time && e.data.time.deltaTime > 500) {
                reportRuntimeFailure('Simulation halted: frame exceeded 500 ms.');
                return;
            }
            if (e.data.stats && e.data.stats.memory > 500) {
                reportRuntimeFailure('Simulation halted: memory limit exceeded.');
                return;
            }
            updateSnapshot(e.data);
            postRuntimeMessage(
                SANDBOX_MESSAGE_TYPES.GAME_STATS,
                { stats: e.data.stats, time: e.data.time, launchId: activeLaunchId },
                { type: 'stats', stats: e.data.stats, time: e.data.time }
            );
        } else if (e.data.type === 'autosave') {
            postRuntimeMessage(
                SANDBOX_MESSAGE_TYPES.GAME_AUTOSAVE,
                { state: e.data.state, launchId: activeLaunchId },
                { type: 'autosave', state: e.data.state }
            );
        } else if (e.data.type === 'autosave_error') {
            postRuntimeMessage(
                SANDBOX_MESSAGE_TYPES.GAME_AUTOSAVE_ERROR,
                { message: e.data.msg || 'Game progress could not be saved.', launchId: activeLaunchId },
                { type: 'autosave_error', msg: e.data.msg }
            );
        } else if (e.data.type === 'audio_command') {
            if (sandboxAudio) sandboxAudio.handleCommand(e.data);
        }
    };

    activeWorker.onerror = (event) => {
        if (engineWorker !== activeWorker) return;
        event.preventDefault?.();
        reportRuntimeFailure(event.message || 'The game worker could not start.', event.error?.stack || null);
    };

    activeWorker.postMessage({
        type: 'init',
        ...runRequest.init,
        canvasGL: offscreen1,
        canvas2D: offscreen2,
        width: rect.width || 800,
        height: rect.height || 600,
        dpr: window.devicePixelRatio || 1
    }, [offscreen1, offscreen2]);
}

window.addEventListener('message', (event) => {
    if (!isTrustedParentMessage(event, window.parent, PARENT_ORIGIN)) return;

    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === SANDBOX_MESSAGE_TYPES.RUN_GAME || data.type === 'run') {
        parentProtocol = data.type === SANDBOX_MESSAGE_TYPES.RUN_GAME ? 'typed' : 'legacy';
        try {
            const runRequest = normalizeRunRequest(data, PARENT_ORIGIN);
            if (runRequest.mode === 'typed' && runRequest.launchId === activeLaunchId) return;
            startGame(runRequest);
        } catch (error) {
            reportRuntimeFailure(error instanceof Error ? error.message : String(error), error instanceof Error ? error.stack : null, 'error');
        }
    } else if (data.type === SANDBOX_MESSAGE_TYPES.DISABLE_AUTOSAVE) {
        if (data.payload?.launchId === activeLaunchId && engineWorker) {
            engineWorker.postMessage({ type: 'disable_autosave' });
        }
    } else if (data.type === 'eval') {
        if (parentProtocol === 'legacy' && engineWorker) engineWorker.postMessage(data);
    } else if (data.type === 'pause' || data.type === 'stop' || data.type === 'update-code') {
        if (engineWorker) engineWorker.postMessage(data);
    } else if (data.type === 'audio_command') {
        if (sandboxAudio) sandboxAudio.handleCommand(data);
    }
});

document.documentElement.dataset.runtimeStatus = 'idle';
postTypedMessage(SANDBOX_MESSAGE_TYPES.SANDBOX_READY, { runtime: 'foundry' });

const workerHealthInterval = setInterval(() => {
    if (!engineWorker || !window.lastWorkerPing) return;
    const timeout = workerReady ? WORKER_HEARTBEAT_TIMEOUT_MS : WORKER_START_TIMEOUT_MS;
    if (Date.now() - window.lastWorkerPing > timeout) {
        const message = workerReady
            ? 'Simulation stopped responding for more than 5 seconds.'
            : 'Game startup timed out after 30 seconds.';
        reportRuntimeFailure(message);
    }
}, 1000);

window.addEventListener('beforeunload', () => {
    clearInterval(workerHealthInterval);
    terminateWorker();
    sandboxAudio?.dispose();
});
