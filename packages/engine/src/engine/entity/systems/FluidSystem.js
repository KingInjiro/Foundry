import { System } from '../System.js';
import { ParticleEmitter } from '../components/ParticleEmitter.js';

export class FluidSystem extends System {
    constructor() {
        super();
        this.threshold = 120; // Alpha threshold
        this.color = '#00ffff';
    }

    render(renderer, camera) {
        if (!renderer.ctx2d) return;
        
        // This effect relies on Canvas2D's globalCompositeOperation and filter (or thresholding).
        // A common trick for 2D metaballs: draw blurred circles, then threshold the alpha channel.
        // We will apply a CSS filter to the canvas for the threshold effect.
        // Since we can't easily do it per-layer without a separate canvas, we'll use a temporary offscreen canvas.
        
        if (!this.fluidCanvas) {
            this.fluidCanvas = (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : (function(){let c = document.createElement('canvas'); c.width = w; c.height = h; return c;})());
            this.fluidCtx = this.fluidCanvas.getContext('2d', { willReadFrequently: true });
        }
        
        const w = renderer.width || (renderer.canvasManager && renderer.canvasManager.canvas2D ? renderer.canvasManager.canvas2D.width : (renderer.canvas ? renderer.canvas.width : 800));
        const h = renderer.height || (renderer.canvasManager && renderer.canvasManager.canvas2D ? renderer.canvasManager.canvas2D.height : (renderer.canvas ? renderer.canvas.height : 600));
        
        if (this.fluidCanvas.width !== w || this.fluidCanvas.height !== h) {
            this.fluidCanvas.width = w;
            this.fluidCanvas.height = h;
        }
        
        const ctx = this.fluidCtx;
        ctx.clearRect(0, 0, w, h);
        
        // Find particles marked as fluid
        const emitters = this.manager.getComponents(ParticleEmitter).filter(e => e.isFluid);
        if (emitters.length === 0) return;
        
        ctx.save();
        
        // Apply camera transform to fluid canvas
        const cam = this.manager.engine.camera;
        ctx.translate(w * 0.5, h * 0.5);
        ctx.scale(cam.zoom, cam.zoom);
        ctx.translate(-cam.x + cam.currentShakeX, -cam.y + cam.currentShakeY);
        
        // Draw fluid particles as blurred circles
        // To be performant, we don't use ctx.filter = 'blur', we just draw radial gradients
        for (let e of emitters) {
            // Wait, we need to iterate over the actual particles.
            // ParticleSystem holds them in engine.particles.particles
            const ps = this.manager.engine.particles;
            for(let i=0; i<ps.particles.length; i++) {
                const p = ps.particles[i];
                if (!p.active || !p.isFluid) continue;
                
                // Draw radial gradient
                const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
                grad.addColorStop(0, `rgba(0, 255, 255, 1)`);
                grad.addColorStop(1, `rgba(0, 255, 255, 0)`);
                
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
        
        // Thresholding
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha < this.threshold) {
                data[i + 3] = 0; // Transparent
            } else {
                data[i + 3] = 255; // Solid
                // Colorize based on this.color (assuming #00ffff for now)
                data[i] = 0;
                data[i+1] = 255;
                data[i+2] = 255;
            }
        }
        ctx.putImageData(imgData, 0, 0);
        
        // Draw back to main canvas
        renderer.ctx2d.save();
        renderer.ctx2d.setTransform(1, 0, 0, 1, 0, 0);
        renderer.ctx2d.drawImage(this.fluidCanvas, 0, 0);
        renderer.ctx2d.restore();
    }
}
