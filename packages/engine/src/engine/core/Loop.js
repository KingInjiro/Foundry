/**
 * Fixed update and variable update/render loops emitting lifecycle events.
 */
export class Loop {
    /**
     * @param {import('./Engine.js').Engine} engine 
     */
    constructor(engine) {
        this.engine = engine;
        this.fixedTimeStep = 1 / 60;
        this.accumulator = 0;
        this.running = false;
        this.rafId = null;
        this.tick = this.tick.bind(this);
    }

    /**
     * Starts the game loop.
     */
    start() {
        if (this.running) return;
        this.running = true;
        
        const perf = typeof performance !== 'undefined' ? performance : Date;
        this.engine.time.lastTime = perf.now();
        
        if (!this.engine.isHeadless && typeof requestAnimationFrame !== 'undefined') {
            this.rafId = requestAnimationFrame(this.tick);
        } else {
            // Headless fallback using setInterval
            this.timerId = setInterval(() => {
                this.tick(perf.now());
            }, this.fixedTimeStep * 1000);
        }
    }

    /**
     * Stops the game loop.
     */
    stop() {
        this.running = false;
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
    }

    /**
     * Main loop tick.
     * @param {number} timestamp 
     */
    tick(timestamp) {
        if (!this.running) return;

        if (!this.engine.isHeadless && typeof requestAnimationFrame !== 'undefined') {
            this.rafId = requestAnimationFrame(this.tick);
        }

        // Frame limiting logic
        if (this.engine.config.targetFps) {
            const frameTime = 1000 / this.engine.config.targetFps;
            const elapsedSinceLastTick = timestamp - this.engine.time.now;
            
            // Allow a small threshold (1ms) to avoid dropping frames that are slightly early
            if (elapsedSinceLastTick < frameTime - 1) {
                return;
            }
        }

        const time = this.engine.time;
        time.update(timestamp);

        this.step(time.deltaTime);
    }

    /**
     * Manually advances the simulation by a given delta time.
     * Useful for fast-forwarding or AI training in headless mode.
     * @param {number} dt Delta time in seconds
     */
    step(dt) {
        const events = this.engine.events;
        const profiler = this.engine.profiler;
        profiler.update();

        if (this.engine.isPaused) {
            profiler.begin('render');
            events.emit('render');
            profiler.end('render');
            return;
        }

        this.accumulator += dt;
        
        // Prevent spiral of death
        if (this.accumulator > 0.25) this.accumulator = 0.25;

        while (this.accumulator >= this.fixedTimeStep) {
            profiler.begin('fixedUpdate');
            events.emit('fixedUpdate', this.fixedTimeStep);
            profiler.end('fixedUpdate');
            this.accumulator -= this.fixedTimeStep;
        }

        profiler.begin('update');
        events.emit('update', dt);
        profiler.end('update');
        
        // Only render if not headless, or if specifically requested?
        // Let's emit render anyway, renderer stubs will ignore it.
        profiler.begin('render');
        events.emit('render');
        profiler.end('render');
    }
}
