/**
 * Window resize event system.
 */
export class WindowHandler {
    /**
     * @param {import('./Engine.js').Engine} engine 
     */
    constructor(engine) {
        this.engine = engine;
        this.width = engine.config.width || window.innerWidth || 800;
        this.height = engine.config.height || window.innerHeight || 600;
        
        this.onResize = this.onResize.bind(this);
        window.addEventListener('resize', this.onResize);
        
        // Initial setup timeout to allow DOM to attach
        setTimeout(this.onResize, 0);
    }

    /**
     * Triggered on window resize.
     */
    onResize() {
        if (this.engine.canvas && this.engine.canvas.element && this.engine.canvas.element.parentElement) {
            const rect = this.engine.canvas.element.parentElement.getBoundingClientRect();
            this.width = rect.width;
            this.height = rect.height;
        } else if (!this.engine.config.isWorker) {
            this.width = window.innerWidth || 800;
            this.height = window.innerHeight || 600;
        }
        this.engine.events.emit('resize', this.width, this.height);
    }

    /**
     * Cleans up event listeners.
     */
    dispose() {
        window.removeEventListener('resize', this.onResize);
    }
}
