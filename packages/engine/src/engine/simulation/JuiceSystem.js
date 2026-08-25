export class JuiceSystem {
    constructor(engine) {
        this.engine = engine;
        this.hitStopTimer = 0;
        this.slowMoTimer = 0;
        this.slowMoTarget = 1;
        this.originalTimeScale = 1;
        this.flashTimer = 0;
        this.flashColor = "rgba(255, 255, 255, 1)";
        
        this.engine.events.on('update', this.update.bind(this));
    }

    /**
     * Pauses the game logic entirely for a brief moment (e.g. on landing a heavy hit)
     * @param {number} duration In seconds (unscaled time)
     */
    /**
     * Flashes the screen with a color.
     * @param {string} color 
     * @param {number} duration 
     */
    flash(color = "rgba(255, 255, 255, 1)", duration = 0.1) {
        this.flashColor = color;
        this.flashTimer = duration;
    }
    
    hitStop(duration = 0.1) {
        this.hitStopTimer = duration;
        this.originalTimeScale = this.engine.time.timeScale;
        this.engine.time.timeScale = 0.001; // nearly zero
    }

    /**
     * Enters slow motion for a duration
     * @param {number} scale The timescale (0.1 = 10% speed)
     * @param {number} duration In seconds (unscaled)
     */
    slowMo(scale = 0.2, duration = 1.0) {
        this.slowMoTimer = duration;
        this.slowMoTarget = scale;
        this.originalTimeScale = 1.0;
        this.engine.time.timeScale = scale;
    }

    render(renderer) {
        if (this.flashTimer > 0) {
            renderer.save();
            renderer.setTransform(1, 0, 0, 1, 0, 0); // reset transform for screen space
            
            // extract alpha from color if possible, or just fade it
            let a = this.flashTimer * 10;
            if (a > 1) a = 1;
            
            renderer.ctx2d.globalCompositeOperation = 'source-over';
            renderer.ctx2d.fillStyle = this.flashColor;
            renderer.ctx2d.globalAlpha = a;
            renderer.ctx2d.fillRect(0, 0, (renderer.width || (renderer.canvasManager && renderer.canvasManager.canvas2D ? renderer.canvasManager.canvas2D.width : (renderer.canvas ? renderer.canvas.width : 800))), (renderer.height || (renderer.canvasManager && renderer.canvasManager.canvas2D ? renderer.canvasManager.canvas2D.height : (renderer.canvas ? renderer.canvas.height : 600))));
            renderer.restore();
        }
    }
    
    update(dt) {
        const unscaledDt = this.engine.time.unscaledDeltaTime;
        
        if (this.hitStopTimer > 0) {
            this.hitStopTimer -= unscaledDt;
            if (this.hitStopTimer <= 0) {
                // Restore time scale, unless we were in slowmo before
                this.engine.time.timeScale = this.slowMoTimer > 0 ? this.slowMoTarget : 1.0;
            }
            return;
        }

        if (this.flashTimer > 0) {
            this.flashTimer -= unscaledDt;
        }
        
        if (this.slowMoTimer > 0) {
            this.slowMoTimer -= unscaledDt;
            if (this.slowMoTimer <= 0) {
                // Smoothly lerp back to normal? Or just snap.
                this.engine.time.timeScale = 1.0;
            }
        }
    }
}
