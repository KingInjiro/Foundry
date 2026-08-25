/**
 * Manages creation and binding of an HTML5 <canvas> element.
 * Automatically syncs dimensions with WindowHandler resize events.
 * Handles High DPI / Retina Display devicePixelRatio scaling.
 */
export class Canvas {
    /**
     * @param {import('../core/Engine.js').Engine} engine 
     */
    constructor(engine) {
        this.engine = engine;

        if (engine.config.isWorker) {
            this.canvasGL = engine.config.canvasGL;
            this.canvas2D = engine.config.canvas2D;
            this.element = null;
        } else {
            this.element = document.createElement('div');
            this.element.style.position = 'relative';
            
            this.canvasGL = document.createElement('canvas');
            this.canvasGL.style.position = 'absolute';
            this.canvasGL.style.left = '0';
            this.canvasGL.style.top = '0';
            this.canvasGL.style.width = '100%';
            this.canvasGL.style.height = '100%';
            
            this.canvas2D = document.createElement('canvas');
            this.canvas2D.style.position = 'absolute';
            this.canvas2D.style.left = '0';
            this.canvas2D.style.top = '0';
            this.canvas2D.style.width = '100%';
            this.canvas2D.style.height = '100%';
            this.canvas2D.style.pointerEvents = 'none';

            this.canvas3D = document.createElement('canvas');
            this.canvas3D.style.position = 'absolute';
            this.canvas3D.style.left = '0';
            this.canvas3D.style.top = '0';
            this.canvas3D.style.width = '100%';
            this.canvas3D.style.height = '100%';
            this.canvas3D.style.zIndex = '-1';

            this.element.appendChild(this.canvas3D);
            
            this.element.appendChild(this.canvasGL);
            this.element.appendChild(this.canvas2D);
        }
        
        this.gl = this.canvasGL.getContext('webgl2', { alpha: true, premultipliedAlpha: false }) || this.canvasGL.getContext('webgl', { alpha: true, premultipliedAlpha: false });
        this.context2d = this.canvas2D.getContext('2d');

        
        
        
        
        if (this.element) {
            this.element.style.width = '100%';
            this.element.style.height = '100%';
        }
        
        // Let the application manage where the canvas is injected
        // (App.jsx mounts it to its container)
        
        this.onResize = this.onResize.bind(this);
        this.engine.events.on('resize', this.onResize);
        
        // Initial sizing
        this.resize(this.engine.window.width, this.engine.window.height);
    }

    /**
     * Triggered on window resize.
     * @param {number} width 
     * @param {number} height 
     */
    onResize(width, height) {
        this.resize(width, height);
    }

    /**
     * Resizes the canvas, maintaining pixel ratio for high DPI screens.
     * @param {number} width 
     * @param {number} height 
     */
    resize(width, height) {
        const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
        this.canvasGL.width = width * dpr;
        this.canvasGL.height = height * dpr;
        if(this.canvas3D) {
            this.canvas3D.width = width * dpr;
            this.canvas3D.height = height * dpr;
        }
        this.gl.viewport(0, 0, width * dpr, height * dpr);
        
        this.canvas2D.width = width * dpr;
        this.canvas2D.height = height * dpr;
        this.context2d.setTransform(1, 0, 0, 1, 0, 0);
        this.context2d.scale(dpr, dpr);
    }
}
