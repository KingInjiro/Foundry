import { PhysicsBody } from '../physics/PhysicsBody.js';
import { Entity } from './Entity.js';

const _raycastCandidates = [];
const _raycastStaticCandidates = [];

/**
 * Efficiently orchestrates lifecycle updates across active entities, 
 * using flat arrays and swap-and-pop removal to prevent GC overhead.
 */
export class EntityManager {
    /**
     * @param {import('../world/World.js').World} world 
     */
    constructor(world) {
        this.world = world;
        
        /** @type {import('./Entity.js').Entity[]} */
        this.entities = [];
        /** @type {import('./Entity.js').Entity[]} */
        this.pendingAdd = [];
        
        this.pools = new Map();
        
        this.isUpdating = false;
        this.staticDirty = true;
        this.nextId = 1;
    }

    /**
     * Retrieves an entity from the pool or creates a new one.
     * Use this instead of 'new Entity()' for high-frequency objects.
     */
    spawn(EntityClass, ...args) {
        if (typeof EntityClass !== "function") return this.add(EntityClass);
        let pool = this.pools.get(EntityClass);
        let e;
        if (pool && pool.length > 0) {
            e = pool.pop();
            e.isDestroyed = false;
            e.active = true;
                        if (e.onReset) {
                e.onReset(...args);
            }
        } else {
            e = new EntityClass(...args);
        }
        this.add(e);
        return e;
    }

    add(entity) {

        
        entity.world = this.world;
        entity.engine = this.world.engine;
        
        if (this.isUpdating) {
            this.pendingAdd.push(entity);
        } else {
            this.entities.push(entity);
            entity._internalSpawn(this.world);
        }
        return entity;
    }

    /**
     * @param {number} dt 
     */
    fixedUpdate(dt) {
        this.isUpdating = true;
        
        if (this.staticDirty && this.world.staticGrid) {
            this.world.staticGrid.clear();
            for (let i = 0; i < this.entities.length; i++) {
                const e = this.entities[i];
                if (e.active && !e.isDestroyed && e.isStatic) {
                    this.world.staticGrid.insert(e);
                }
            }
            this.staticDirty = false;
        }
        
        // 1. Rebuild Spatial Grid for physics logic / raycasting
        this.world.grid.clear();
        if (this.world.isInfinite && this.world.engine && this.world.engine.camera) {
            const cb = this.world.engine.camera.getBounds();
            this.world.grid.bounds.x = (cb.xMin + cb.xMax) / 2;
            this.world.grid.bounds.y = (cb.yMin + cb.yMax) / 2;
        }
        for (let i = 0; i < this.entities.length; i++) {
            const e = this.entities[i];
            if (e.active && !e.isDestroyed && !e.isStatic) {
                this.world.grid.insert(e);
            }
        }
        
        // 2. Update Game Logic
        for (let i = 0; i < this.entities.length; i++) {
            const e = this.entities[i];
            if (e.active && !e.isDestroyed) {
                e._internalFixedUpdate(dt);
            }
        }
        
        this.isUpdating = false;
        this.processPending();
    }

    /**
     * @param {number} dt
     */
    update(dt) {
        this.isUpdating = true;
        
        if (this.staticDirty && this.world.staticGrid) {
            this.world.staticGrid.clear();
            for (let i = 0; i < this.entities.length; i++) {
                const e = this.entities[i];
                if (e.active && !e.isDestroyed && e.isStatic) {
                    this.world.staticGrid.insert(e);
                }
            }
            this.staticDirty = false;
        }
        
        // Rebuild Spatial Grid again for rendering/logic queries this frame
        this.world.grid.clear();
        if (this.world.isInfinite && this.world.engine && this.world.engine.camera) {
            const cb = this.world.engine.camera.getBounds();
            this.world.grid.bounds.x = (cb.xMin + cb.xMax) / 2;
            this.world.grid.bounds.y = (cb.yMin + cb.yMax) / 2;
        }
        for (let i = 0; i < this.entities.length; i++) {
            const e = this.entities[i];
            if (e.active && !e.isDestroyed && !e.isStatic) {
                this.world.grid.insert(e);
            }
        }
        
        for (let i = 0; i < this.entities.length; i++) {
            const e = this.entities[i];
            if (e.active && !e.isDestroyed) {
                e._internalUpdate(dt);
            }
        }
        this.isUpdating = false;
        this.processPending();
    }

    /**
     * Renders visible entities within the camera bounds.
     * @param {import('../renderer/Renderer2D.js').Renderer2D} renderer 
     * @param {import('../camera/Camera2D.js').Camera2D} camera 
     */
    render(renderer, camera) {
        const bounds = camera.getBounds();
        const cx = (bounds.xMin + bounds.xMax) / 2;
        const cy = (bounds.yMin + bounds.yMax) / 2;
        const cRadius = Math.sqrt(Math.pow(bounds.xMax - cx, 2) + Math.pow(bounds.yMax - cy, 2));
        
        const visibleEntities = this.world.grid.queryArea(cx, cy, cRadius);
        
        if (this.world.staticGrid) {
            const staticVisible = this.world.staticGrid.queryArea(cx, cy, cRadius);
            for (let i = 0; i < staticVisible.length; i++) {
                visibleEntities.push(staticVisible[i]);
            }
        }
        
        // Fast-path: Skip O(N log N) sort if we have a massive number of entities and no explicit depth sorting is enabled
        // In a real engine, we would use bucket sort by layer and only sort buckets that have dirty depths.
        if (visibleEntities.length < 1000) {
            visibleEntities.sort((a, b) => {
                if (a.layer !== b.layer) return (a.layer || 0) - (b.layer || 0);
                return (a.depth || 0) - (b.depth || 0);
            });
        }
        
        for (let i = 0; i < visibleEntities.length; i++) {
            const e = visibleEntities[i];
            if (e.active && e.visible && !e.isDestroyed) {
                if (e.globalX + e.cullRadius >= bounds.xMin && 
                    e.globalX - e.cullRadius <= bounds.xMax && 
                    e.globalY + e.cullRadius >= bounds.yMin && 
                    e.globalY - e.cullRadius <= bounds.yMax) {
                    
                    e._internalRender(renderer, camera);
                }
            }
        }
        
        if (this.world.components) {
            this.world.components.render(renderer, camera);
        }
    }

    /**
     * Processes deferred additions and removes destroyed entities.
     * Uses swap-and-pop array removal to avoid allocations.
     */
    processPending() {
        for (let i = 0; i < this.pendingAdd.length; i++) {
            const e = this.pendingAdd[i];
            // Auto-attach PhysicsBody if entity requested collision but lacks one
            if (e.hasCollision && !e.components.some(c => c instanceof PhysicsBody || c.constructor.name === 'PhysicsBody')) {
                const shape = e.colliderType === 'circle' ? 'circle' : (e.colliderType === 'polygon' ? 'polygon' : 'rectangle');
                e.addComponent(new PhysicsBody({
                    shape: shape,
                    width: e.width || 32,
                    height: e.height || 32,
                    radius: e.radius || 16,
                    isStatic: e.isStatic || false
                }));
            }
            
            this.entities.push(e);
            e._internalSpawn(this.world);
            if (e.isStatic) this.staticDirty = true;
        }
        this.pendingAdd.length = 0;

        for (let i = this.entities.length - 1; i >= 0; i--) {
            const e = this.entities[i];
            if (e.isDestroyed) {
                if (e.isStatic) this.staticDirty = true;
                e._internalDestroy();
                
                // Return to pool
                const EntityClass = e.constructor;
                let pool = this.pools.get(EntityClass);
                if (!pool) {
                    pool = [];
                    this.pools.set(EntityClass, pool);
                }
                pool.push(e);
                
                // Swap with the last element and pop
                const lastIdx = this.entities.length - 1;
                if (i !== lastIdx) {
                    this.entities[i] = this.entities[lastIdx];
                }
                this.entities.pop();
            }
        }
    }

    
    /**
     * Clears all entities and returns them to the pool.
     */
    getEntitiesByTag(tag) {
        let res = [];
        for (let i = 0; i < this.entities.length; i++) {
            if (this.entities[i].tag === tag && !this.entities[i].isDestroyed) {
                res.push(this.entities[i]);
            }
        }
        return res;
    }

    getEntityByTag(tag) {
        for (let i = 0; i < this.entities.length; i++) {
            if (this.entities[i].tag === tag && !this.entities[i].isDestroyed) {
                return this.entities[i];
            }
        }
        return null;
    }

    clear() {
        for (let i = 0; i < this.entities.length; i++) {
            const e = this.entities[i];
            e._internalDestroy();
            
            const EntityClass = e.constructor;
            let pool = this.pools.get(EntityClass);
            if (!pool) {
                pool = [];
                this.pools.set(EntityClass, pool);
            }
            pool.push(e);
        }
        this.entities.length = 0;
        this.pendingAdd.length = 0;
        this.staticDirty = true;
    }

    /**
     * Gets all entities with the given tag.
     * @param {string} tag 
     * @returns {import('./Entity.js').Entity[]}
     */
    getByTag(tag) {
        const result = [];
        for (let i = 0; i < this.entities.length; i++) {
            if (this.entities[i].tag === tag && !this.entities[i].isDestroyed) {
                result.push(this.entities[i]);
            }
        }
        for (let i = 0; i < this.pendingAdd.length; i++) {
            if (this.pendingAdd[i].tag === tag && !this.pendingAdd[i].isDestroyed) {
                result.push(this.pendingAdd[i]);
            }
        }
        return result;
    }

    /**
     * Gets all entities that have a specific component.
     * @param {string} componentName The class name of the component
     * @returns {import('./Entity.js').Entity[]}
     */
    getByComponent(componentName) {
        const result = [];
        for (let i = 0; i < this.entities.length; i++) {
            const e = this.entities[i];
            if (!e.isDestroyed && e.components && e.components.some(c => c.constructor.name === componentName)) {
                result.push(e);
            }
        }
        for (let i = 0; i < this.pendingAdd.length; i++) {
            const e = this.pendingAdd[i];
            if (!e.isDestroyed && e.components && e.components.some(c => c.constructor.name === componentName)) {
                result.push(e);
            }
        }
        return result;
    }
    
    /**
     * Raycast against all colliders
     * @param {number} x1 
     * @param {number} y1 
     * @param {number} x2 
     * @param {number} y2 
     * @param {number} radius Thickness of the ray
     * @returns {import('./Entity.js').Entity | null} First hit entity
     */
    raycast(x1, y1, x2, y2, radius = 0, ignoreEntity = null) {
        let closest = null;
        let closestDist = Infinity;
        
        const dx = x2 - x1;
        const dy = y2 - y1;
        const rayLen = Math.sqrt(dx * dx + dy * dy);
        if (rayLen === 0) return null;
        const nx = dx / rayLen;
        const ny = dy / rayLen;
        
        // 1. Broadphase: query spatial grid using line intersection
        const candidates = _raycastCandidates;
        if (this.world.grid.queryRay) {
            this.world.grid.queryRay(x1, y1, x2, y2, candidates);
        } else {
            const minX = Math.min(x1, x2) - radius;
            const maxX = Math.max(x1, x2) + radius;
            const minY = Math.min(y1, y2) - radius;
            const maxY = Math.max(y1, y2) + radius;
            const width = maxX - minX;
            const height = maxY - minY;
            const cx = minX + width / 2;
            const cy = minY + height / 2;
            this.world.grid.queryAABB(cx, cy, width, height, candidates);
        }
        
        if (this.world.staticGrid) {
            const staticCandidates = _raycastStaticCandidates;
            if (this.world.staticGrid.queryRay) {
                this.world.staticGrid.queryRay(x1, y1, x2, y2, staticCandidates);
            } else {
                const minX = Math.min(x1, x2) - radius;
                const maxX = Math.max(x1, x2) + radius;
                const minY = Math.min(y1, y2) - radius;
                const maxY = Math.max(y1, y2) + radius;
                const width = maxX - minX;
                const height = maxY - minY;
                const cx = minX + width / 2;
                const cy = minY + height / 2;
                this.world.staticGrid.queryAABB(cx, cy, width, height, staticCandidates);
            }
            for (let i = 0; i < staticCandidates.length; i++) {
                candidates.push(staticCandidates[i]);
            }
        }
        
        // 3. Narrow phase
        for (let i = 0; i < candidates.length; i++) {
            const e = candidates[i];
            if (!e.active || e.isDestroyed || !e.hasCollision) continue;
            
            if (e.colliderType === 'circle') {
                const ex = e.globalX - x1;
                const ey = e.globalY - y1;
                let t = (ex * nx + ey * ny);
                if (t < 0) t = 0;
                if (t > rayLen) t = rayLen;
                
                const px = x1 + nx * t;
                const py = y1 + ny * t;
                const distSq = (e.globalX - px) * (e.globalX - px) + (e.globalY - py) * (e.globalY - py);
                const r = e.radius + radius;
                
                if (distSq <= r * r) {
                    const actualDist = Math.sqrt((e.globalX - x1) * (e.globalX - x1) + (e.globalY - y1) * (e.globalY - y1));
                    if (actualDist < closestDist) {
                        closestDist = actualDist;
                        closest = e;
                    }
                }
            } else if (e.colliderType === 'box') {
                const hw = e.width / 2 + radius;
                const hh = e.height / 2 + radius;
                
                let tmin = -Infinity, tmax = Infinity;
                
                if (nx !== 0) {
                    let tx1 = (e.globalX - hw - x1) / nx;
                    let tx2 = (e.globalX + hw - x1) / nx;
                    tmin = Math.max(tmin, Math.min(tx1, tx2));
                    tmax = Math.min(tmax, Math.max(tx1, tx2));
                } else if (x1 < e.globalX - hw || x1 > e.globalX + hw) {
                    continue;
                }
                
                if (ny !== 0) {
                    let ty1 = (e.globalY - hh - y1) / ny;
                    let ty2 = (e.globalY + hh - y1) / ny;
                    tmin = Math.max(tmin, Math.min(ty1, ty2));
                    tmax = Math.min(tmax, Math.max(ty1, ty2));
                } else if (y1 < e.globalY - hh || y1 > e.globalY + hh) {
                    continue;
                }
                
                if (tmax >= tmin && tmax >= 0 && tmin <= rayLen) {
                    let t = tmin < 0 ? 0 : tmin;
                    if (t < closestDist) {
                        closestDist = t;
                        closest = e;
                    }
                }
            }
        }
        
        return closest;
    }

    /**
     * Returns the total active and pending entity count.
     * @returns {number}
     */
    get count() {
        return this.entities.length + this.pendingAdd.length;
    }
}
