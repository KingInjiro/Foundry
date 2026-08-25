import { StreamingRuntimeController } from './streaming/StreamingRuntimeController.ts';
import { ChunkFetcher } from './streaming/ChunkFetcher.ts';
import { MemoryBudgetManager } from './streaming/MemoryBudgetManager.ts';
import { StreamingObservability } from './streaming/StreamingObservability.ts';
import { StreamingEngineBridge } from './streaming/EngineBridge.ts';
import { IndexedDBPersistentChunkCache } from './streaming/IndexedDBPersistentChunkCache.ts';
import { PersistentStorageEvictionController } from './streaming/PersistentStorageEvictionController.ts';
import {
    createInlineGameModuleSource,
    getGameConstructor,
    prepareSimulationLifecycle
} from './runtimeGameModule.js';
import Matter from 'matter-js';
import { Foundry } from '@foundry/engine';














import decomp from 'poly-decomp';
self.decomp = decomp;
self.Matter = Matter;
Matter.Common.setDecomp(decomp);




const FoundryAPI = Foundry;
const MAX_AUTOSAVE_BYTES = 5 * 1024 * 1024;

function sanitizeForPostMessage(obj, depth = 0) {
    if (depth > 3) return null;
    if (obj === null || obj === undefined) return obj;
    const t = typeof obj;
    if (t === 'string' || t === 'number' || t === 'boolean') return obj;
    if (t === 'function' || t === 'symbol' || obj instanceof Promise) return undefined;
    
    // Ignore complex browser objects
    if (typeof OffscreenCanvas !== 'undefined' && obj instanceof OffscreenCanvas) return undefined;
    if (typeof ImageBitmap !== 'undefined' && obj instanceof ImageBitmap) return undefined;
    
    if (Array.isArray(obj)) {
        return obj.map(v => sanitizeForPostMessage(v, depth + 1));
    }
    
    if (t === 'object') {
        if (obj.constructor && obj.constructor.name !== 'Object' && obj.constructor.name !== 'Array') {
            return undefined;
        }
        const res = {};
        for (const k in obj) {
            const val = sanitizeForPostMessage(obj[k], depth + 1);
            if (val !== undefined) res[k] = val;
        }
        return res;
    }
    return undefined;
}



let engineInstance = null;

// Mock DOM for worker
self.window = self;
self.document = {
    createElement: () => ({ style: {}, appendChild: () => {}, getBoundingClientRect: () => ({left:0,top:0}) }),
    fonts: { add: () => {} }
};
self.devicePixelRatio = 1;

// Override AudioContext in worker (dummy)
self.AudioContext = class {
    createGain() { return { connect: () => {}, gain: { value: 1 } }; }
    decodeAudioData() { return Promise.resolve({}); }
};

// Override localStorage in worker
self.localStorage = {
    _data: {},
    setItem: function(k, v) { this._data[k] = String(v); },
    getItem: function(k) { return this._data.hasOwnProperty(k) ? this._data[k] : null; }
};

self.addEventListener('error', (e) => {
    self.postMessage({ type: 'error', msg: e.message, stack: e.error ? e.error.stack : null, filename: e.filename, lineno: e.lineno });
});

self.addEventListener('unhandledrejection', (e) => {
    self.postMessage({ type: 'error', msg: 'Unhandled Promise Rejection: ' + (e.reason ? e.reason.message || e.reason : 'Unknown'), stack: e.reason ? e.reason.stack : null });
});

self.addEventListener('message', async (e) => {
    const data = e.data;
    if (data.type === 'init') {
        const {
            code = '',
            gameUrl = null,
            assets: receivedAssets = {},
            canvasGL,
            canvas2D,
            width,
            height,
            dpr,
            recoverState,
            streamingManifest,
            capabilities = []
        } = data;
        const assets = receivedAssets && typeof receivedAssets === 'object' && !Array.isArray(receivedAssets)
            ? receivedAssets
            : {};
        self.devicePixelRatio = dpr;
        self.postMessage({ type: 'status', status: 'initializing' });
        
        if (engineInstance) {
            engineInstance.stop();
        }
        if (self.snapshotInterval) clearInterval(self.snapshotInterval);
        if (self.autosaveInterval) clearInterval(self.autosaveInterval);
        if (self._streamingBridge) {
            self._streamingBridge.dispose();
            self._streamingBridge = null;
        }
        if (self._streamingController) {
            self._streamingController.dispose();
            self._streamingController = null;
        }
        
        const engine = new Foundry.Engine({ 
            headless: false, 
            isWorker: true,
            canvasGL: canvasGL, 
            canvas2D: canvas2D,
            width: width,
            height: height
        });
        engine.hideTopBar = true;
        engineInstance = engine;

        if (streamingManifest) {
            let controller = null;
            let streamingBridge = null;
            try {
                console.log('[Worker] Initializing StreamingRuntimeController');
                const observability = new StreamingObservability();
                const gameModuleUrl = new URL(gameUrl, self.location.href);
                const cdnBaseUrl = new URL('.', gameModuleUrl).href.replace(/\/+$/, '');
                const persistentCache = new IndexedDBPersistentChunkCache(observability);
                const persistentEviction = new PersistentStorageEvictionController(persistentCache, { maxPersistentBytes: 256 * 1024 * 1024, observability });
                const fetcher = new ChunkFetcher(streamingManifest, cdnBaseUrl, 4, observability, persistentEviction);
                const memoryManager = new MemoryBudgetManager({ maxMemoryBytes: 256 * 1024 * 1024, observability });
                controller = new StreamingRuntimeController(streamingManifest, fetcher, memoryManager, observability);
                // In a real async flow we might await this, but we can initialize synchronously for now
                // or await it if the context allows. The init listener is async.
                await controller.initialize();
                const urlMap = new Map();
                if (streamingManifest.chunks instanceof Map) {
                    for (const [chunkId, chunk] of streamingManifest.chunks.entries()) {
                        urlMap.set(chunk.url, chunkId);
                    }
                }
                streamingBridge = new StreamingEngineBridge(controller, memoryManager, urlMap, 2, `${cdnBaseUrl}/`);
                engine.streamingBridge = streamingBridge;
                self._streamingBridge = streamingBridge;
                self._streamingController = controller;
                console.log('[Worker] StreamingEngineBridge connected to AssetManager');
            } catch (err) {
                streamingBridge?.dispose();
                controller?.dispose();
                engine.streamingBridge = null;
                engine.stop();
                engineInstance = null;
                const message = `Streaming runtime initialization failed: ${err instanceof Error ? err.message : String(err)}`;
                self.postMessage({ type: 'error', msg: message, stack: err instanceof Error ? err.stack : null });
                return;
            }
        }


        // Route events to window/self for Input systems
        self.window = self;
        
        // Mock image loading in AssetManager for worker
        engine.assets.loadImage = function(name, url) {
            if (this.images.has(name)) return this.images.get(name);
            
            // Return a dummy image immediately to avoid null errors, fill it async
            const dummy = { width: 1, height: 1, complete: false };
            this.images.set(name, dummy);
            
            const promise = fetch(url)
                .then(r => r.blob())
                .then(blob => createImageBitmap(blob))
                .then(bmp => {
                    dummy.width = bmp.width;
                    dummy.height = bmp.height;
                    dummy.complete = true;
                    // For WebGL texImage2D, it accepts ImageBitmap directly!
                    // But we must expose the bitmap itself or change WebGLRenderer to use it.
                    // Actually, WebGLRenderer2D passes the object to texImage2D. 
                    // So we must trick it by making the dummy behave like an image? 
                    // No, texImage2D will fail if it's just a JS object.
                    // We must replace the map entry with the actual ImageBitmap.
                    bmp.complete = true;
                    this.images.set(name, bmp);
                    
                    // But if WebGLRenderer already cached the dummy? 
                    // Let's clear the renderer's texture cache for this dummy.
                    if (engine.renderer && engine.renderer.textureCache) {
                         engine.renderer.textureCache.delete(dummy);
                    }
                })
                .catch(e => console.error(e));
                
            this._trackPromise(promise);
            return dummy;
        };

        for (const [name, url] of Object.entries(assets)) {
            if (typeof url === 'string' && url.startsWith('data:image')) {
                engine.assets.loadImage(name, url);
            } else if (typeof url === 'string' && url.startsWith('data:audio')) {
                engine.assets.loadSound(name, url);
            }
        }
        
        try {
            self.FoundryAPI = FoundryAPI;
            self.Foundry = FoundryAPI;
            globalThis.Foundry = FoundryAPI;
            Object.keys(FoundryAPI).forEach(key => {
                globalThis[key] = FoundryAPI[key];
            });
            self.assets = assets;
            let objectUrl = null;
            let moduleUrl = gameUrl;

            if (!moduleUrl) {
                const moduleCode = createInlineGameModuleSource(code);
                const blob = new Blob([moduleCode], { type: 'text/javascript' });
                objectUrl = URL.createObjectURL(blob);
                moduleUrl = objectUrl;
            }

            try {
                const gameModule = await import(/* @vite-ignore */ moduleUrl);
                const GameClass = getGameConstructor(gameModule);
                const prepared = prepareSimulationLifecycle(new GameClass(engine));

                engine.simulations.register('CustomGame', prepared.simulation);
                engine.simulations.setActive('CustomGame');

                await prepared.waitForStart();
                if (recoverState && typeof recoverState === 'string') {
                    self.FoundryAPI.SceneSerializer.deserializeData(engine.world, recoverState);
                }
                engine.start({ splash: false });
                self.postMessage({ type: 'ready', runtime: 'foundry' });
            } finally {
                if (objectUrl) URL.revokeObjectURL(objectUrl);
            }

            if (capabilities.includes('storage')) {
                self.autosaveInterval = setInterval(() => {
                    if (engineInstance && engineInstance.world) {
                        try {
                            const state = self.FoundryAPI.SceneSerializer.serialize(engineInstance.world);
                            if (new TextEncoder().encode(state).byteLength > MAX_AUTOSAVE_BYTES) {
                                clearInterval(self.autosaveInterval);
                                self.autosaveInterval = null;
                                self.postMessage({
                                    type: 'autosave_error',
                                    msg: `Game progress exceeds the ${MAX_AUTOSAVE_BYTES}-byte save limit.`
                                });
                                return;
                            }
                            self.postMessage({ type: 'autosave', state });
                        } catch (e) {}
                    }
                }, 5000);
            }
            
            // Cache to track changes
            const lastState = new Map();
            
            self.snapshotInterval = setInterval(() => {
                if (!engineInstance) return;
                
                const changedEnts = [];
                const currentIds = new Set();
                
                const MAX_ENTITIES_TO_SEND = 1000;
                
                for (let i = 0; i < engineInstance.world.entities.entities.length; i++) {
                    const e = engineInstance.world.entities.entities[i];
                    currentIds.add(e.id);
                    
                    const old = lastState.get(e.id);
                    
                    // Quick dirty check
                    let isDirty = !old;
                    if (old) {
                        if (old.x !== e.x || old.y !== e.y || old.rotation !== e.rotation || 
                            old.scaleX !== e.scaleX || old.scaleY !== e.scaleY || old.layer !== e.layer || 
                            old.tag !== e.tag || old.isStatic !== e.isStatic) {
                            isDirty = true;
                        }
                    }
                    
                    if (isDirty) {
                        const state = {
                            id: e.id, tag: e.tag, x: e.x, y: e.y, z: e.z,
                            vx: e.vx, vy: e.vy, vz: e.vz,
                            rotation: e.rotation, scaleX: e.scaleX, scaleY: e.scaleY, scaleZ: e.scaleZ,
                            layer: e.layer, isStatic: e.isStatic,
                            parentId: e.parent ? e.parent.id : null
                        };
                        
                        if (e.components) {
                            state.components = e.components.map(c => {
                                const compData = {};


                                for (const key in c) {
                                    if (key === 'entity' || key === 'enabled') continue;
                                    const val = sanitizeForPostMessage(c[key]);
                                    if (val !== undefined) compData[key] = val;
                                }


                                return {
                                    constructor: { name: c.constructor.name },
                                    enabled: c.enabled,
                                    data: compData
                                };
                            });
                        } else {
                            state.components = [];
                        }
                        
                        changedEnts.push(state);
                        lastState.set(e.id, { ...state });
                        
                        if (changedEnts.length >= MAX_ENTITIES_TO_SEND) {
                            break;
                        }
                    }
                }
                
                // Remove deleted entities from cache
                for (const id of lastState.keys()) {
                    if (!currentIds.has(id)) {
                        lastState.delete(id);
                        changedEnts.push({ id, _deleted: true });
                    }
                }
                
                if (changedEnts.length > 0 || engineInstance.time.fps > 0) {
                    const snap = {
                        type: 'snapshot',
                        entities: changedEnts,
                        world: engineInstance.world ? {
                            gravityX: engineInstance.world.gravityX,
                            gravityY: engineInstance.world.gravityY,
                            isInfinite: engineInstance.world.isInfinite,
                            width: engineInstance.world.width,
                            height: engineInstance.world.height
                        } : null,
                        camera: engineInstance.camera ? {
                            targetX: engineInstance.camera.targetX,
                            targetY: engineInstance.camera.targetY,
                            targetZoom: engineInstance.camera.targetZoom
                        } : null,
                        time: {
                            fps: engineInstance.time.fps,
                            deltaTime: engineInstance.time.deltaTime,
                            elapsed: engineInstance.time.elapsed
                        },
                        stats: {
                            drawCalls: engineInstance.renderer ? engineInstance.renderer.drawCalls : 0,
                            entities: engineInstance.world ? engineInstance.world.entities.entities.length : 0,
                            memory: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0
                        },
                        selectedEntityId: engineInstance.editor && engineInstance.editor.selectedEntity ? engineInstance.editor.selectedEntity.id : null
                    };
                    self.postMessage(snap);
                }
            }, 150);
        } catch (err) {
            self.postMessage({ type: 'error', msg: err.message, stack: err.stack });
        }



    } else if (data.type === 'disable_autosave') {
        if (self.autosaveInterval) clearInterval(self.autosaveInterval);
        self.autosaveInterval = null;
    } else if (data.type === 'pause') {
        if (engineInstance) {
            engineInstance.isPaused = !engineInstance.isPaused;
            console.log("Worker pause toggled: ", engineInstance.isPaused);
        }
    } else if (data.type === 'stop') {
        if (engineInstance) {
            engineInstance.stop();
        }
    } else if (data.type === 'eval') {
        try {
            // Evaluates code in the context of the worker
            const result = eval(data.code);
            console.log(result);
        } catch (e) {
            console.error(e);
        }
    } else if (data.type === 'set_world_prop') {
        if (engineInstance && engineInstance.world) {
            engineInstance.world[data.prop] = data.value;
        }
    } else if (data.type === 'set_camera_prop') {
        if (engineInstance && engineInstance.camera) {
            engineInstance.camera[data.prop] = data.value;
        }
    } else if (data.type === 'set_entity_parent') {
        if (engineInstance) {
            const ent = engineInstance.world.entities.entities.find(e => e.id === data.id);
            const newParent = data.parentId ? engineInstance.world.entities.entities.find(e => e.id === data.parentId) : null;
            if (ent) {
                if (ent.parent) {
                    ent.parent.removeChild(ent);
                }
                if (newParent) {
                    newParent.addChild(ent);
                }
            }
        }
    
    } else if (data.type === 'add_component') {
        if (engineInstance) {
            const ent = engineInstance.world.entities.entities.find(e => e.id === data.id);
            if (ent && self.Foundry && self.Foundry[data.compName]) {
                ent.addComponent(new self.Foundry[data.compName]());
            }
        }
    } else if (data.type === 'set_component_prop') {
        if (engineInstance) {
            const ent = engineInstance.world.entities.entities.find(e => e.id === data.id);
            if (ent) {
                const comp = ent.components.find(c => c.constructor.name === data.compName);
                if (comp) {
                    comp[data.prop] = data.value;
                }
            }
        }
    } else if (data.type === 'set_entity_prop') {
        if (engineInstance) {
            const ent = engineInstance.world.entities.entities.find(e => e.id === data.id);
            if (ent) {
                ent[data.prop] = data.value;
                if (ent.body) {
                    if (data.prop === 'x' || data.prop === 'y') {
                        Matter.Body.setPosition(ent.body, { x: ent.x, y: ent.y });
                    } else if (data.prop === 'rotation') {
                        Matter.Body.setAngle(ent.body, ent.rotation);
                    }
                }
            }
        }
    } else if (data.type === 'set_selected') {
        if (engineInstance) {
            if (!engineInstance.editor) engineInstance.editor = {};
            if (data.id === null) {
                engineInstance.editor.selectedEntity = null;
            } else {
                const ent = engineInstance.world.entities.entities.find(e => e.id === data.id);
                engineInstance.editor.selectedEntity = ent || null;
            }
        }
    } else if (data.type === 'event') {
        // Dispatch to self so Keyboard/Mouse catch it
        if (data.event.type === 'resize') {
             engineInstance.window.width = data.event.width;
             engineInstance.window.height = data.event.height;
             engineInstance.canvas.resize(data.event.width, data.event.height);
        } else {
             // Reconstruct event
             let ev = new Event(data.event.type);
             for (const key in data.event) {
                 if (key !== 'type') {
                     try {
                         Object.defineProperty(ev, key, { value: data.event[key], enumerable: true });
                     } catch (e) {}
                 }
             }
             self.dispatchEvent(ev);
             if (engineInstance && engineInstance.input) {
                 if (ev.type === 'keydown' && engineInstance.input.keyboard) engineInstance.input.keyboard.onKeyDown(data.event);
                 if (ev.type === 'keyup' && engineInstance.input.keyboard) engineInstance.input.keyboard.onKeyUp(data.event);
                 if (ev.type === 'mousedown' && engineInstance.input.mouse) engineInstance.input.mouse.onMouseDown(data.event);
                 if (ev.type === 'mouseup' && engineInstance.input.mouse) engineInstance.input.mouse.onMouseUp(data.event);
                 if (ev.type === 'mousemove' && engineInstance.input.mouse) engineInstance.input.mouse.onMouseMove(data.event);
             }

             if (ev.type === 'keydown' && ev.code === 'KeyZ' && (ev.ctrlKey || ev.metaKey)) {
                 if (ev.shiftKey) {
                     engineInstance.events.emit('editor:redo');
                 } else {
                     engineInstance.events.emit('editor:undo');
                 }
             }
        }
    }
});
