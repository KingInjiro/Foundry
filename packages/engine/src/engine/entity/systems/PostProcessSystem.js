import { System } from '../System.js';

export class PostProcessSystem extends System {
    constructor() {
        super();
        this.enabled = true;
        this.bloom = {
            enabled: true,
            strength: 1.5,
            radius: 0.4,
            threshold: 0.85
        };
        this.dof = {
            enabled: false,
            focus: 10.0,
            aperture: 0.025,
            maxblur: 0.01
        };
        this.exposure = 1.0;
        this.environment = {
            url: null,
            background: true
        };
        this._currentEnvUrl = null;
        
        // 2D Canvas Post processing legacy (CSS filters)
        this.overlay = null;
        this.crt = false;
        this.vignette = false;
        this.chromaticAberration = false;
    }
    
    update(dt) {
        // We configure the post processing settings here
        // Rendering itself is done by Renderer3DSystem.
        const engine = this.manager.engine;
        if (engine && engine.renderer3D && engine.world.scene3D && engine.camera3D) {
            engine.renderer3D.setupPostProcessing(engine.world.scene3D, engine.camera3D.camera, {
                enabled: this.enabled,
                bloom: this.bloom.enabled ? this.bloom : false,
                dof: this.dof.enabled ? this.dof : false,
                exposure: this.exposure
            });

            if (this.environment.url !== this._currentEnvUrl) {
                this._currentEnvUrl = this.environment.url;
                engine.renderer3D.setEnvironment(engine.world.scene3D, this.environment.url, {
                    background: this.environment.background
                });
            }
        }
    }

    init() {
        const engine = this.manager.engine;
        if (engine.isHeadless) return;
        
        const container = engine.canvas.element;
        if (!container) return;

        // Apply some base filters to the WebGL canvas for 2D mode
        const glCanvas = engine.canvas.canvasGL;
        if (glCanvas) {
            let filter = '';
            if (this.bloom.enabled && !engine.renderer3D) filter += 'brightness(1.1) contrast(1.1) ';
            glCanvas.style.filter = filter;
        }

        if (this.crt || this.vignette) {
            this.overlay = document.createElement('div');
            this.overlay.style.position = 'absolute';
            this.overlay.style.top = '0';
            this.overlay.style.left = '0';
            this.overlay.style.width = '100%';
            this.overlay.style.height = '100%';
            this.overlay.style.pointerEvents = 'none';
            this.overlay.style.mixBlendMode = 'overlay';
            this.overlay.style.opacity = '0.5';
            
            // Add a style tag for the scanline animation
            if (!document.getElementById('foundry-crt-style')) {
                const style = document.createElement('style');
                style.id = 'foundry-crt-style';
                style.innerHTML = `
                    @keyframes foundry-scanlines {
                        0% { background-position: 0 0, 0 0, 0 0; }
                        100% { background-position: 0 -4px, 0 0, 0 0; }
                    }
                `;
                document.head.appendChild(style);
            }

            this.overlay.style.animation = 'foundry-scanlines 0.5s linear infinite';
            this.overlay.style.zIndex = '10';

            let bg = '';
            if (this.crt) {
                bg += 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06))';
            }
            if (this.vignette) {
                if (bg !== '') bg += ', ';
                bg += 'radial-gradient(circle at center, transparent 50%, rgba(0, 0, 0, 0.6) 100%)';
            }
            
            this.overlay.style.backgroundImage = bg;
            this.overlay.style.backgroundSize = '100% 4px, 3px 100%, 100% 100%'; // scanlines
            container.appendChild(this.overlay);
        }
    }

    onDestroy() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        if (this.manager.engine.canvas && this.manager.engine.canvas.canvasGL) {
            this.manager.engine.canvas.canvasGL.style.filter = '';
        }
    }
}