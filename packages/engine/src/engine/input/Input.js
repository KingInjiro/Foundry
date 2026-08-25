import { Keyboard } from './Keyboard.js';
import { Mouse } from './Mouse.js';
import { GamepadManager } from './Gamepad.js';
import { VirtualControls } from './VirtualControls.js';

/**
 * Encapsulates Keyboard and Mouse input managers.
 */
export class Input {
    /**
     * @param {import('../core/Engine.js').Engine} engine 
     */
    constructor(engine) {
        this.engine = engine;
        this.keyboard = new Keyboard();
        this.mouse = new Mouse(engine.canvas.element, engine);
        this.gamepad = new GamepadManager();
        this.virtual = new VirtualControls(engine);
        this.bindings = {};
        
        this.axes = {
            'Horizontal': { negative: ['ArrowLeft', 'KeyA'], positive: ['ArrowRight', 'KeyD'] },
            'Vertical': { negative: ['ArrowUp', 'KeyW'], positive: ['ArrowDown', 'KeyS'] }
        };
        
        // Intercept events.emit to ensure postUpdate runs exactly at the end 
        // of the render cycle, after all other systems have read input.
        const originalEmit = engine.events.emit;
        engine.events.emit = (event, ...args) => {
            originalEmit.call(engine.events, event, ...args);
            if (event === 'render' || (this.engine && this.engine.isPaused && event === 'update')) {
                this.postUpdate();
                
            }
        };
    }

    /**
     * Clears single-frame states across all input managers.
     */
    postUpdate() {
        this.keyboard.reset();
        this.mouse.reset();
        this.gamepad.update();
        this.virtual.reset();
    }

    /**
     * Disposes input managers and removes DOM listeners.
     */
    dispose() {
        this.keyboard.dispose();
        this.mouse.dispose();
        this.gamepad.dispose();
        this.virtual.disable();
    }

    bind(action, keys) {
        if (!Array.isArray(keys)) keys = [keys];
        this.bindings[action] = keys;
    }
    
    bindAxis(name, negativeKeys, positiveKeys) {
        if (!Array.isArray(negativeKeys)) negativeKeys = [negativeKeys];
        if (!Array.isArray(positiveKeys)) positiveKeys = [positiveKeys];
        this.axes[name] = { negative: negativeKeys, positive: positiveKeys };
    }

    action(name) {
        return this.isActionDown(name);
    }
    
    _isKeyOrButtonDown(k) {
        if (k.startsWith('Mouse')) {
            if (k === 'MouseLeft' && this.mouse.leftDown) return true;
            if (k === 'MouseRight' && this.mouse.rightDown) return true;
            if (k === 'MouseMiddle' && this.mouse.middleDown) return true;
        } else if (k.startsWith('Gamepad')) {
            // Ignore for now
        } else if (k.startsWith('Virtual')) {
            return this.virtual.virtualButtonsDown[k] || false;
        } else if (this.keyboard.isKeyDown(k)) {
            return true;
        }
        return false;
    }

    isActionDown(name) {
        const keys = this.bindings[name];
        if (!keys) return false;
        
        // Virtual buttons
        if (this.virtual.virtualButtonsDown[name]) return true;

        for (let i = 0; i < keys.length; i++) {
            if (this._isKeyOrButtonDown(keys[i])) return true;
        }
        return false;
    }

    isActionPressed(name) {
        const keys = this.bindings[name];
        if (!keys) return false;
        
        // Virtual buttons
        if (this.virtual.virtualButtonsPressed[name]) return true;

        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (k.startsWith('Mouse')) {
                if (k === 'MouseLeft' && this.mouse.leftPressed) return true;
                if (k === 'MouseRight' && this.mouse.rightPressed) return true;
                if (k === 'MouseMiddle' && this.mouse.middlePressed) return true;
            } else if (k.startsWith('Virtual')) {
                if (this.virtual.virtualButtonsPressed[k]) return true;
            } else if (this.keyboard.isKeyPressed(k)) {
                return true;
            }
        }
        return false;
    }

    isKeyDown(key) { return this.keyboard.isKeyDown(key); }
    key(code) { return this.keyboard.isKeyDown(code); }
    down(code) { return this.keyboard.isKeyDown(code); }
    
    axis(name) {
        let val = 0;

        // Virtual joystick
        if (name === 'Horizontal' && this.virtual.joystick.active) {
            val += this.virtual.virtualAxes.Horizontal;
        }
        if (name === 'Vertical' && this.virtual.joystick.active) {
            val += this.virtual.virtualAxes.Vertical;
        }

        const ax = this.axes[name];
        if (!ax) return Math.max(-1, Math.min(1, val));
        
        for (let i = 0; i < ax.negative.length; i++) {
            if (this._isKeyOrButtonDown(ax.negative[i])) {
                val -= 1;
                break;
            }
        }
        
        for (let i = 0; i < ax.positive.length; i++) {
            if (this._isKeyOrButtonDown(ax.positive[i])) {
                val += 1;
                break;
            }
        }
        
        return Math.max(-1, Math.min(1, val));
    }

    isKeyPressed(key) { return this.keyboard.isKeyPressed(key); }
    isKeyReleased(key) { return this.keyboard.isKeyReleased(key); }
}
