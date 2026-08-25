import { Simulation } from './Simulation.js';
import { Entity } from '../entity/Entity.js';

export const Easing = {
    Linear: t => t,
    EaseInQuad: t => t * t,
    EaseOutQuad: t => t * (2 - t),
    EaseInOutQuad: t => t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    EaseOutCubic: t => 1 - Math.pow(1 - t, 3),
    EaseInOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2
};

export class Tween {
    constructor(target, props, duration, options = {}) {
        this.target = target;
        this.props = props;
        this.duration = duration;
        this.easing = options.easing || Easing.Linear;
        this.onComplete = options.onComplete || null;
        this.delay = options.delay || 0;
        
        this.elapsed = 0;
        this.startValues = {};
        this.initialized = false;
        this.isComplete = false;
    }
    
    init() {
        for (const key in this.props) {
            this.startValues[key] = this.target[key];
        }
        this.initialized = true;
    }
    
    update(dt) {
        if (this.isComplete) return true;
        
        if (this.delay > 0) {
            this.delay -= dt;
            return false;
        }
        
        if (!this.initialized) this.init();
        
        this.elapsed += dt;
        let t = this.elapsed / this.duration;
        if (t >= 1) {
            t = 1;
            this.isComplete = true;
        }
        
        const easedT = this.easing(t);
        
        for (const key in this.props) {
            const start = this.startValues[key];
            const end = this.props[key];
            this.target[key] = start + (end - start) * easedT;
        }
        
        if (this.isComplete && this.onComplete) {
            this.onComplete();
        }
        
        return this.isComplete;
    }
}

export class AnimationController {
    constructor() {
        this.tweens = [];
    }
    
    add(tween) {
        this.tweens.push(tween);
        return tween;
    }
    
    to(target, props, duration, options) {
        return this.add(new Tween(target, props, duration, options));
    }
    
    update(dt) {
        for (let i = this.tweens.length - 1; i >= 0; i--) {
            if (this.tweens[i].update(dt)) {
                this.tweens.splice(i, 1);
            }
        }
    }
    
    clear() {
        this.tweens.length = 0;
    }
}

export class FadeController {
    constructor(engine) {
        this.engine = engine;
        this.alpha = 1.0;
        this.color = '#000000';
    }
    
    onUI(ui) {
        if (this.alpha > 0) {
            const r = ui.engine.renderer;
            r.setGlobalAlpha(this.alpha);
            r.setFillStyle(this.color);
            r.fillRect(0, 0, ui.width, ui.height);
            r.setGlobalAlpha(1.0);
        }
    }
}

export class SparkEntity extends Entity {
    constructor(x, y) {
        super();
        this.x = x;
        this.y = y;
        this.alpha = 0;
        this.cullRadius = 100;
        
        // Pre-allocate trail for zero allocations
        this.maxTrail = 60;
        this.trailX = new Float32Array(this.maxTrail);
        this.trailY = new Float32Array(this.maxTrail);
        this.trailCount = 0;
        this.trailIndex = 0;
        
        this.time = 0;
        this.timeOffset = Math.random() * 100; // For noise offset
        
        this.coreColor = '#ffffff';
        this.glowColor = '#fb923c';
        this.trailColor = '#ea580c';
        
        // Initialize position in trail
        for (let i = 0; i < this.maxTrail; i++) {
            this.trailX[i] = this.x;
            this.trailY[i] = this.y;
        }
    }
    
    onUpdate(dt) {
        this.time += dt;
        
        // Gentle drift with pseudo-noise
        const noiseX = Math.sin((this.time + this.timeOffset) * 1.5) * 0.5 + Math.sin((this.time + this.timeOffset) * 0.8) * 0.5;
        const noiseY = Math.cos((this.time + this.timeOffset) * 1.2) * 0.5 + Math.sin((this.time + this.timeOffset) * 0.5) * 0.5;
        
        // Slow movement
        this.x += (30 + noiseX * 20) * dt;
        this.y += (-15 + noiseY * 25) * dt;
        
        // Record trail (ring buffer)
        this.trailIndex = (this.trailIndex - 1 + this.maxTrail) % this.maxTrail;
        this.trailX[this.trailIndex] = this.x;
        this.trailY[this.trailIndex] = this.y;
        if (this.trailCount < this.maxTrail) {
            this.trailCount++;
        }
    }
    
    onRender(r) {
        if (this.alpha <= 0) return;
        
        // Draw trail
        if (this.trailCount > 1) {
            let prevX = this.trailX[this.trailIndex];
            let prevY = this.trailY[this.trailIndex];
            
            for (let i = 1; i < this.trailCount; i++) {
                const idx = (this.trailIndex + i) % this.maxTrail;
                const currX = this.trailX[idx];
                const currY = this.trailY[idx];
                
                const t = i / this.trailCount;
                const width = (1 - t) * 3;
                const alpha = (1 - t) * this.alpha * 0.7;
                
                r.setGlobalAlpha(alpha);
                r.setStrokeStyle(this.trailColor);
                r.setLineWidth(width);
                r.drawLine(prevX, prevY, currX, currY);
                
                prevX = currX;
                prevY = currY;
            }
        }
        
        // Draw glow (multiple layers for soft look)
        // High frequency flicker
        const flicker = 0.85 + Math.sin((this.time + this.timeOffset) * 30) * 0.15;
        
        r.setGlobalAlpha(this.alpha * 0.2 * flicker);
        r.setFillStyle(this.glowColor);
        r.fillCircle(this.x, this.y, 22);
        
        r.setGlobalAlpha(this.alpha * 0.4 * flicker);
        r.fillCircle(this.x, this.y, 10);
        
        // Core
        r.setGlobalAlpha(this.alpha);
        r.setFillStyle(this.coreColor);
        r.fillCircle(this.x, this.y, 3);
        
        r.setGlobalAlpha(1.0);
    }
}

export class FoundrySplash extends Simulation {
    constructor(engine) {
        super(engine);
        this.clearColor = '#000000';
        this.targetSimulationName = null; // Set by engine before start
        
        this.animator = new AnimationController();
        this.fader = new FadeController(engine);
        
        this.spark = null;
    }

    onStart() {
        this.animator.clear();
        this.world.isInfinite = true;
        this.engine.camera.set(0, 0, 1);
        
        // Screen is initially completely black, no fade overlay needed since clearColor is black
        this.fader.alpha = 0; 

        // Initial spark position
        this.spark = new SparkEntity(-150, 50);
        this.world.add(this.spark);
        
        // 1.0 second silence (delay), then fade in the spark
        this.animator.to(this.spark, { alpha: 1.0 }, 1.5, {
            delay: 1.0,
            easing: Easing.EaseInOutSine
        });
    }
    
    skip() {
        this.animator.clear();
        if (this.targetSimulationName) {
            this.engine.simulations.setActive(this.targetSimulationName);
        }
    }

    onUpdate(dt) {
        this.animator.update(dt);
        
        // Skip handling
        const k = this.engine.input.keyboard;
        const m = this.engine.input.mouse;
        if (m.leftDown || k.isDown('Escape') || k.isDown('Space') || k.isDown('Enter')) {
            this.skip();
        }
    }

    onRender(r, camera) {
        // Spark is automatically rendered by the World
    }
    
    onUI(ui) {
        // Fader handles the final transition out (if implemented later)
        this.fader.onUI(ui);
    }
    
    onStop() {
        this.animator.clear();
    }
}
