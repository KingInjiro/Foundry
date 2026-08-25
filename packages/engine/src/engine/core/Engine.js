import { DefaultTypeRegistry } from './TypeRegistry.js';
import { AssetManager } from './AssetManager.js';
import { EventEmitter } from './EventEmitter.js';
import { Time } from './Time.js';
import { Loop } from './Loop.js';
import { TaskScheduler, TaskCategory, ExecutionStage } from './TaskScheduler.js';
import { TweenManager } from './Tween.js';
import { TimerManager } from './Timer.js';
import { WindowHandler } from './Window.js';
import { Canvas } from '../renderer/Canvas.js';
import { Renderer2D } from '../renderer/Renderer2D.js';
import { WebGLRenderer2D } from '../renderer/WebGLRenderer2D.js';
import { Renderer3D } from '../renderer/Renderer3D.js';
import { Input } from '../input/Input.js';
import { Camera2D } from '../camera/Camera2D.js';
import { Camera3D } from '../camera/Camera3D.js';
import { World } from '../world/World.js';
import { SceneManager } from './SceneManager.js';
import { UIManager as DOMUIManager } from '../ui/DOMUI.js';
import { UIContext } from '../ui/UIContext.js';
import { NetworkClient } from '../network/NetworkClient.js';
import { SimulationManager } from '../simulation/SimulationManager.js';
import { AudioManager } from '../audio/AudioManager.js';
import { StorageManager } from './StorageManager.js';
import { Profiler } from './Profiler.js';
import { SceneSerializer } from '../serialization/SceneSerializer.js';
import { PrefabManager } from '../serialization/PrefabManager.js';
import Matter from 'matter-js';
import { JuiceSystem } from "../simulation/JuiceSystem.js";
import { EditorManager } from '../editor/EditorManager.js';
import { DebugRenderer } from '../renderer/DebugRenderer.js';
import { FoundrySplash } from '../simulation/FoundrySplash.js';
import { ParticleSystem } from '../particles/ParticleSystem.js';
import '../entity/components/ParticleEmitter.js'; // Register component
import '../entity/components/Tilemap.js'; // Register component

/**
 * Central hub holding systems (events, time, loop, window).
 */
export class Engine {
    /**
     * @param {Object} config
     * @param {boolean} [config.headless=false] - If true, disables DOM/rendering dependencies.
     * @param {number} [config.width=800] - Default width for headless mode.
     * @param {number} [config.height=600] - Default height for headless mode.
     */
    constructor(config = {}) {
        this.config = Object.assign({ headless: false, width: 800, height: 600 }, config);
        this.isHeadless = this.config.headless;

        this.events = new EventEmitter();
        this.time = new Time();
        this.profiler = new Profiler();
        this.assets = new AssetManager(this);
        this.scheduler = new TaskScheduler();
        this.tweens = new TweenManager(this);
        this.timers = new TimerManager(this);
        this.particles = new ParticleSystem(this);
        this.network = new NetworkClient(this);
        this.types = DefaultTypeRegistry;
        
        const hasDOM = typeof window !== 'undefined' && typeof document !== 'undefined';
        const useDOM = !this.isHeadless && hasDOM && !this.config.isWorker;
        
        if (useDOM) {
            this.window = new WindowHandler(this);
        } else {
            this.window = { width: this.config.width, height: this.config.height, dispose: () => {} };
        }
        
        this.loop = new Loop(this);
        
        // Renderer Module
        if (useDOM || (this.config.canvasGL && this.config.canvas2D)) {
            this.canvas = new Canvas(this);
            this.renderer = new WebGLRenderer2D(this.canvas);
        this.renderer3D = new Renderer3D(this.canvas);
        } else {
            this.canvas = { width: this.config.width, height: this.config.height, element: null, dispose: () => {} };
            
            const noop = () => {};
            const dummyCtx = {
                save: noop,
                restore: noop,
                translate: noop,
                scale: noop,
                rotate: noop,
                beginPath: noop,
                closePath: noop,
                moveTo: noop,
                lineTo: noop,
                fill: noop,
                stroke: noop,
                arc: noop,
                rect: noop,
                clearRect: noop,
                fillText: noop,
                measureText: () => ({ width: 0 }),
                fillStyle: '',
                strokeStyle: '',
                lineWidth: 1,
                globalAlpha: 1,
            };
            
            this.renderer = {
                begin: noop,
                end: noop,
                setFillStyle: noop,
                setStrokeStyle: noop,
                setLineWidth: noop,
                setGlobalAlpha: noop,
                setGlobalCompositeOperation: noop,
                fillRect: noop,
                strokeRect: noop,
                fillText: noop,
                drawLine: noop,
                drawCircle: noop,
                ctx: dummyCtx, save: noop, restore: noop, translate: noop, scale: noop, rotate: noop
            };
        }

        // Input Module
        if (useDOM || this.config.isWorker) {
            this.input = new Input(this);
        } else {
            this.input = {
                keyboard: { isDown: () => false, isPressed: () => false },
                mouse: { x: 0, y: 0, deltaX: 0, deltaY: 0, wheelY: 0, leftDown: false, rightDown: false },
                postUpdate: () => {},
                dispose: () => {}
            };
        }

        // Camera Module
        this.camera = new Camera2D(this);
        this.camera3D = new Camera3D(this);
        
        // World Module
        this.world = new World(this);
        
        // Scene Module
        this.scenes = new SceneManager(this);
        
        // UI Module
        if (useDOM) {
            this.ui = new UIContext(this);
            this.domUI = new DOMUIManager(this);
            this.domUI.init();
        } else {
            // Null object pattern for UI in headless mode
            const noop = () => {};
            this.ui = {
                begin: noop, end: noop, text: noop, panel: noop, button: noop, slider: noop, progressBar: noop, checkbox: noop
            };
            this.domUI = {
                add: noop, remove: noop, clear: noop, dispose: noop, init: noop
            };
        }
        
        // Simulation Module
        this.simulations = new SimulationManager(this);
        
        // Editor Module
        if (useDOM) {
            this.editor = new EditorManager(this);
        }

        // Storage Module
        this.storage = new StorageManager(this);

        // Serialization Module
        this.prefabs = new PrefabManager(this);

        // Debug Renderer
        if (useDOM) {
            this.debugRenderer = new DebugRenderer(this);
        }

        // Audio Module
        this.audio = new AudioManager(this);
        this.juice = new JuiceSystem(this);
        


    }

    /**
     * Starts the engine.
     */
    start(options = {}) {
        if (options.splash) {
            if (!this.simulations.simulations.has('__splash__')) {
                const splash = new FoundrySplash(this);
                if (options.splashConfig) Object.assign(splash, options.splashConfig);
                this.simulations.register('__splash__', splash);
            }
            const targetSimName = this.simulations.activeSimulationName;
            this.simulations.simulations.get('__splash__').targetSimulationName = targetSimName;
            this.simulations.setActive('__splash__');
        }
        this.loop.start();
    }

    /**
     * Stops the engine.
     */
    restart() {
        if (this.simulations && this.simulations.activeSimulation) {
            this.simulations.activeSimulation.restart();
        }
    }

    stop() {
        this.loop.stop();
    }
}
