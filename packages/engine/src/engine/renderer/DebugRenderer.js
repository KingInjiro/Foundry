
export class DebugRenderer {
    /**
     * @param {import('../core/Engine.js').Engine} engine 
     */
    constructor(engine) {
        this.engine = engine;
        this.enabled = false;
        
        // Raycasts for the current frame
        this.raycasts = [];

        this.onPostRenderWorld = this.onPostRenderWorld.bind(this);
        this.onFixedUpdate = this.onFixedUpdate.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        
        this.engine.events.on('postRenderWorld', this.onPostRenderWorld);
        this.engine.events.on('fixedUpdate', this.onFixedUpdate);
        
        if (this.engine.input && this.engine.input.keyboard) {
            window.addEventListener('keydown', this.onKeyDown);
        }
    }

    onKeyDown(e) {
        if (e.code === 'F3') {
            this.enabled = !this.enabled;
            e.preventDefault();
        }
    }

    _drawQuadTree(r, node, bounds) {
        if (!node) return;
        
        // Only draw if intersects camera bounds
        const hw = node.bounds.width / 2;
        const hh = node.bounds.height / 2;
        if (Math.abs(node.bounds.x - (bounds.xMin + bounds.xMax)/2) > hw + (bounds.xMax - bounds.xMin)/2) return;
        if (Math.abs(node.bounds.y - (bounds.yMin + bounds.yMax)/2) > hh + (bounds.yMax - bounds.yMin)/2) return;

        r.strokeRect(node.bounds.x - hw, node.bounds.y - hh, node.bounds.width, node.bounds.height);
        
        for (let i = 0; i < node.nodes.length; i++) {
            this._drawQuadTree(r, node.nodes[i], bounds);
        }
    }

    addRaycast(x1, y1, x2, y2, hit, hitPoint) {
        if (!this.enabled) return;
        this.raycasts.push({ x1, y1, x2, y2, hit, hitPoint });
    }

    onFixedUpdate() {
        // We now clear raycasts in onPostRenderWorld to sync with requestAnimationFrame
    }

    /**
     * @param {import('../renderer/Renderer2D.js').Renderer2D} r 
     * @param {import('../camera/Camera2D.js').Camera2D} camera 
     */
    onPostRenderWorld(r, camera) {
        if (!this.enabled) return;

        const bounds = camera.getBounds();
        
        // 0. Draw uniform world grid (every 100 pixels)
        const gridSize = 100;
        r.setStrokeStyle('rgba(255, 255, 255, 0.05)');
        r.setLineWidth(1);
        const startX = Math.floor(bounds.xMin / gridSize) * gridSize;
        const endX = Math.ceil(bounds.xMax / gridSize) * gridSize;
        const startY = Math.floor(bounds.yMin / gridSize) * gridSize;
        const endY = Math.ceil(bounds.yMax / gridSize) * gridSize;

        for (let x = startX; x <= endX; x += gridSize) {
            r.drawLine(x, bounds.yMin, x, bounds.yMax);
        }
        for (let y = startY; y <= endY; y += gridSize) {
            r.drawLine(bounds.xMin, y, bounds.xMax, y);
        }

        // 1. Draw SpatialHash Grid Bounds (QuadTree)
        r.setStrokeStyle('rgba(0, 150, 255, 0.15)'); // Make QuadTree blue-ish so it's distinct
        r.setLineWidth(1);
        
        const grid = this.engine.world.grid;
        if (grid) {
            this._drawQuadTree(r, grid, bounds);
        }

        // 2. Draw Physics Bodies
        const physicsBodies = this.engine.world.entities.getComponents('PhysicsBody');
        const bodies = physicsBodies.filter(b => b.enabled && b.body).map(b => b.body);
        r.setStrokeStyle('rgba(255, 0, 0, 0.8)');
        r.setLineWidth(2);
        
        for (let i = 0; i < bodies.length; i++) {
            const body = bodies[i];
            
            // Body bounds (AABB)
            r.setStrokeStyle('rgba(255, 100, 0, 0.3)');
            r.strokeRect(body.bounds.min.x, body.bounds.min.y, body.bounds.max.x - body.bounds.min.x, body.bounds.max.y - body.bounds.min.y);
            
            r.setStrokeStyle('rgba(255, 0, 0, 0.8)');
            for (let j = 0; j < body.parts.length; j++) {
                const part = body.parts[j];
                const vertices = part.vertices;
                for (let k = 0; k < vertices.length; k++) {
                    const v1 = vertices[k];
                    const v2 = vertices[(k + 1) % vertices.length];
                    r.drawLine(v1.x, v1.y, v2.x, v2.y);
                }
            }
        }

        // 3. Draw Entity Hitboxes
        const entities = this.engine.world.entities.entities;
        r.setStrokeStyle('rgba(0, 255, 0, 0.8)');
        for (let i = 0; i < entities.length; i++) {
            const e = entities[i];
            if (!e.active || e.isDestroyed || !e.hasCollision) continue;
            
            // Only draw if within bounds
            if (e.x + (e.cullRadius || 100) < bounds.xMin || e.x - (e.cullRadius || 100) > bounds.xMax) continue;

            r.begin();
            if (e.colliderType === 'box') {
                const hw = (e.width || 50) / 2;
                const hh = (e.height || 50) / 2;
                r.strokeRect(e.x - hw, e.y - hh, e.width, e.height);
            } else if (e.colliderType === 'circle') {
                r.strokeCircle(e.x, e.y, e.radius || 25);
            }
            r.end();
        }

        // 4. Draw active raycasts
        for (let i = 0; i < this.raycasts.length; i++) {
            const ray = this.raycasts[i];
            if (ray.hit) {
                // Draw green until hit, then red dot
                r.setStrokeStyle('rgba(0, 255, 0, 0.8)');
                r.drawLine(ray.x1, ray.y1, ray.hitPoint.x, ray.hitPoint.y);
                
                // Hit point
                r.setFillStyle('rgba(255, 0, 0, 1)');
                r.fillCircle(ray.hitPoint.x, ray.hitPoint.y, 4);
                
                // Draw rest of ray in faint red
                r.setStrokeStyle('rgba(255, 0, 0, 0.3)');
                r.drawLine(ray.hitPoint.x, ray.hitPoint.y, ray.x2, ray.y2);
            } else {
                r.setStrokeStyle('rgba(0, 255, 0, 0.8)');
                r.drawLine(ray.x1, ray.y1, ray.x2, ray.y2);
            }
        }
        
        // Clear raycasts after rendering them so they don't accumulate between frames
        this.raycasts.length = 0;
    }
    
    destroy() {
        this.engine.events.off('postRenderWorld', this.onPostRenderWorld);
        this.engine.events.off('fixedUpdate', this.onFixedUpdate);
        window.removeEventListener('keydown', this.onKeyDown);
    }
}
