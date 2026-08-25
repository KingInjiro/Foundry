/**
 * 2D Camera system providing spatial transformations.
 */
export class Camera2D {
    /**
     * @param {import('../core/Engine.js').Engine} engine 
     */
    constructor(engine) {
        this.engine = engine;
        
        this.x = 0;
        this.y = 0;
        this.zoom = 1;
        
        this.targetX = 0;
        this.targetY = 0;
        this.targetZoom = 1;
        
        // Entity tracking
        this.targetEntity = null;
        this.lookAhead = { x: 0, y: 0 };
        this.deadZone = null; // { w, h }
        this.limits = null; // { xMin, xMax, yMin, yMax }
        
        // Shake
        this.shakeIntensity = 0;
        this.shakeDuration = 0;
        this.shakeTimer = 0;
        this.currentShakeX = 0;
        this.currentShakeY = 0;

        this.lerpSpeed = 10;
        this.zoomLerpSpeed = 10;
        
        /** @private */
        this._bounds = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };

        this.update = this.update.bind(this);
        this.engine.events.on('update', this.update);
    }

    /**
     * Smoothly interpolates camera position and zoom towards targets.
     * @param {number} dt 
     */
    update(dt) {
        if (this.targetEntity && !this.targetEntity.isDestroyed) {
            let tx = this.targetEntity.globalX + this.lookAhead.x;
            let ty = this.targetEntity.globalY + this.lookAhead.y;
            
            if (this.deadZone) {
                const dx = tx - this.targetX;
                const dy = ty - this.targetY;
                const dw = this.deadZone.w / 2;
                const dh = this.deadZone.h / 2;
                
                if (dx > dw) this.targetX = tx - dw;
                else if (dx < -dw) this.targetX = tx + dw;
                
                if (dy > dh) this.targetY = ty - dh;
                else if (dy < -dh) this.targetY = ty + dh;
            } else {
                this.targetX = tx;
                this.targetY = ty;
            }
        }
        
        // Apply limits to target
        if (this.limits) {
            const w = (this.engine.window.width * 0.5) / this.zoom;
            const h = (this.engine.window.height * 0.5) / this.zoom;
            
            if (this.targetX - w < this.limits.xMin) this.targetX = this.limits.xMin + w;
            if (this.targetX + w > this.limits.xMax) this.targetX = this.limits.xMax - w;
            if (this.targetY - h < this.limits.yMin) this.targetY = this.limits.yMin + h;
            if (this.targetY + h > this.limits.yMax) this.targetY = this.limits.yMax - h;
        }

        this.x += (this.targetX - this.x) * this.lerpSpeed * dt;
        this.y += (this.targetY - this.y) * this.lerpSpeed * dt;
        this.zoom += (this.targetZoom - this.zoom) * this.zoomLerpSpeed * dt;
        
        if (this.shakeTimer > 0) {
            this.shakeTimer -= dt;
            const ratio = this.shakeTimer / this.shakeDuration;
            this.currentShakeX = (Math.random() - 0.5) * 2 * this.shakeIntensity * ratio;
            this.currentShakeY = (Math.random() - 0.5) * 2 * this.shakeIntensity * ratio;
            
            if (this.shakeTimer <= 0) {
                this.currentShakeX = 0;
                this.currentShakeY = 0;
            }
        }
    }

    /**
     * Sets the target position for smooth tracking.
     * @param {number} x 
     * @param {number} y 
     */
    follow(x, y) {
        this.targetEntity = null;
        this.targetX = x;
        this.targetY = y;
    }
    
    /**
     * Sets the camera to track an entity smoothly.
     */
    trackEntity(entity, lookAheadX = 0, lookAheadY = 0) {
        this.targetEntity = entity;
        this.lookAhead.x = lookAheadX;
        this.lookAhead.y = lookAheadY;
    }
    
    /**
     * Sets a dead zone where the target can move without moving the camera.
     */
    setDeadZone(width, height) {
        this.deadZone = { w: width, h: height };
    }
    
    /**
     * Sets hard boundaries for the camera viewport.
     */
    setLimits(xMin, xMax, yMin, yMax) {
        this.limits = { xMin, xMax, yMin, yMax };
    }
    
    /**
     * Triggers a screen shake effect.
     */
    shake(intensity = 10, duration = 0.5) {
        this.shakeIntensity = intensity;
        this.shakeDuration = duration;
        this.shakeTimer = duration;
    }

    /**
     * Sets the target zoom level.
     * @param {number} zoom 
     */
    zoomTo(zoom) {
        this.targetZoom = zoom;
    }

    /**
     * Sets position and zoom instantly.
     * @param {number} x 
     * @param {number} y 
     * @param {number} zoom 
     */
    set(x, y, zoom = this.zoom) {
        this.x = x;
        this.targetX = x;
        this.y = y;
        this.targetY = y;
        this.zoom = zoom;
        this.targetZoom = zoom;
        this.targetEntity = null;
    }

    /**
     * Begins the camera viewport transformation.
     */
    begin() {
        const ctx = this.engine.renderer;
        const w = this.engine.window.width;
        const h = this.engine.window.height;
        
        ctx.save();
        ctx.translate(w * 0.5, h * 0.5);
        ctx.scale(this.zoom, this.zoom);
        ctx.translate(-this.x + this.currentShakeX, -this.y + this.currentShakeY);
    }

    /**
     * Ends the camera viewport transformation.
     */
    end() {
        this.engine.renderer.restore();
    }

    /**
     * Converts screen coordinates to world coordinates.
     * @param {number} screenX 
     * @param {number} screenY 
     * @param {{x: number, y: number}} out 
     * @returns {{x: number, y: number}}
     */
    screenToWorld(screenX, screenY, out = {}) {
        const w = this.engine.window.width;
        const h = this.engine.window.height;
        out.x = (screenX - w * 0.5) / this.zoom + this.x - this.currentShakeX;
        out.y = (screenY - h * 0.5) / this.zoom + this.y - this.currentShakeY;
        return out;
    }

    /**
     * Converts world coordinates to screen coordinates.
     * @param {number} worldX 
     * @param {number} worldY 
     * @param {{x: number, y: number}} out 
     * @returns {{x: number, y: number}}
     */
    worldToScreen(worldX, worldY, out = {}) {
        const w = this.engine.window.width;
        const h = this.engine.window.height;
        out.x = (worldX - (this.x - this.currentShakeX)) * this.zoom + w * 0.5;
        out.y = (worldY - (this.y - this.currentShakeY)) * this.zoom + h * 0.5;
        return out;
    }

    /**
     * Returns the visible world bounding box.
     * @returns {{xMin: number, yMin: number, xMax: number, yMax: number}}
     */
    getBounds() {
        const w = this.engine.window.width * 0.5;
        const h = this.engine.window.height * 0.5;
        const cx = this.x - this.currentShakeX;
        const cy = this.y - this.currentShakeY;
        this._bounds.xMin = cx - w / this.zoom;
        this._bounds.xMax = cx + w / this.zoom;
        this._bounds.yMin = cy - h / this.zoom;
        this._bounds.yMax = cy + h / this.zoom;
        return this._bounds;
    }
}
