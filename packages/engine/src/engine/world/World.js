import { PhysicsSystem } from '../entity/systems/PhysicsSystem.js';
import { SpriteSystem } from '../entity/systems/SpriteSystem.js';
import { AnimatorSystem } from '../entity/systems/AnimatorSystem.js';
import { TextSystem } from '../entity/systems/TextSystem.js';
import { ShapeSystem } from '../entity/systems/ShapeSystem.js';
import { ParticleEmitterSystem } from '../entity/systems/ParticleEmitterSystem.js';
import { TilemapSystem } from '../entity/systems/TilemapSystem.js';
import { AudioSystem } from '../entity/systems/AudioSystem.js';
import { NavigationSystem } from '../entity/systems/NavigationSystem.js';
import { CameraFollowSystem } from '../entity/systems/CameraFollowSystem.js';
import { ParallaxSystem } from '../entity/systems/ParallaxSystem.js';
import { TrailSystem } from '../entity/systems/TrailSystem.js';
import { PostProcessSystem } from '../entity/systems/PostProcessSystem.js';
import { LifespanSystem } from '../entity/systems/LifespanSystem.js';
import { InputControllerSystem } from '../entity/systems/InputControllerSystem.js';
import { HealthSystem } from '../entity/systems/HealthSystem.js';
import { DamageSystem } from '../entity/systems/DamageSystem.js';
import { TriggerSystem } from '../entity/systems/TriggerSystem.js';
import { SoftBodySystem } from '../entity/systems/SoftBodySystem.js';
import { LightingSystem } from '../entity/systems/LightingSystem.js';
import { FluidSystem } from '../entity/systems/FluidSystem.js';
import { Renderer3DSystem } from '../entity/systems/Renderer3DSystem.js';
import { PhysicsSystem3D } from '../entity/systems/PhysicsSystem3D.js';
import { ComponentManager } from '../entity/ComponentManager.js';
import Matter from 'matter-js';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { EntityManager } from '../entity/EntityManager.js';
import { QuadTree } from './QuadTree.js';
import { raycast } from '../physics/Raycast.js';

/**
 * Spatial container for simulation and engine objects.
 * Manages boundaries, global forces, and spatial lifecycle.
 */
export class World {
    /**
     * @param {import('../core/Engine.js').Engine} engine 
     */
    constructor(engine) {
        this.engine = engine;
        
        this.isInfinite = false;
        this.width = 4000;
        this.height = 4000;
        
        this.gravityX = 0;
        this.gravityY = 400; // Standard pixel gravity
        this.drawGrid = true;
        
        // Spatial grid for O(1) neighbor lookups
        this.grid = new QuadTree(0, 0, this.width, this.height);
        this.staticGrid = new QuadTree(0, 0, this.width, this.height);
        
        // Entity System
        this.entities = new EntityManager(this);
        this.components = new ComponentManager();
        this.components.engine = this.engine;
        this.components.world = this;
        this.components.engine = engine;
        this.components.registerSystem(new AnimatorSystem());
        this.components.registerSystem(new SpriteSystem());
        this.components.registerSystem(new TextSystem());
        this.components.registerSystem(new ShapeSystem());
        this.components.registerSystem(new TilemapSystem());
        this.components.registerSystem(new PhysicsSystem());
        this.components.registerSystem(new ParticleEmitterSystem());
        this.components.registerSystem(new AudioSystem());
        this.components.registerSystem(new NavigationSystem());
        this.components.registerSystem(new CameraFollowSystem());
        this.components.registerSystem(new LifespanSystem());
        this.components.registerSystem(new InputControllerSystem());
        this.components.registerSystem(new HealthSystem());
        this.components.registerSystem(new DamageSystem());
        this.components.registerSystem(new TriggerSystem());
        this.components.registerSystem(new LightingSystem());
        this.components.registerSystem(new ParallaxSystem());
        this.components.registerSystem(new Renderer3DSystem());
        this.components.registerSystem(new PhysicsSystem3D());
        this.components.registerSystem(new TrailSystem());
        this.components.registerSystem(new PostProcessSystem());
        
        this.onFixedUpdate = this.onFixedUpdate.bind(this);
        this.onUpdate = this.onUpdate.bind(this);
        
        
        this.scene3D = new THREE.Scene();

        this.physicsWorld3D = new CANNON.World();
        this.physicsWorld3D.gravity.set(0, -9.81, 0); // Standard Earth gravity downwards in Y

        this.physicsEngine = Matter.Engine.create({
            gravity: { x: 0, y: 1, scale: 0.001 }
        });
        this.physicsWorld = this.physicsEngine.world;

        const handleCollisions = (event) => {
            const pairs = event.pairs;
            for (let i = 0; i < pairs.length; i++) {
                const pair = pairs[i];
                const entityA = pair.bodyA.entity;
                const entityB = pair.bodyB.entity;
                if (entityA && entityA.onCollision) {
                    entityA.onCollision(entityB, pair);
                }
                if (entityB && entityB.onCollision) {
                    entityB.onCollision(entityA, pair);
                }
            }
        };
        Matter.Events.on(this.physicsEngine, 'collisionStart', handleCollisions);
        Matter.Events.on(this.physicsEngine, 'collisionActive', handleCollisions);

        this.engine.events.on('fixedUpdate', this.onFixedUpdate);

        this.engine.events.on('update', this.onUpdate);
    }

    /**
     * @param {number} dt 
     */
    onFixedUpdate(dt) {
        
        // Sync gravity
        if (this.physicsEngine.world.gravity) {
            this.physicsEngine.world.gravity.y = this.gravityY !== 0 ? 1 : 0;
            this.physicsEngine.world.gravity.scale = Math.abs(this.gravityY) * 0.0000025; // Approximate scale
            this.physicsEngine.world.gravity.x = this.gravityX !== 0 ? 1 : 0;
            if (this.gravityY === 0 && this.gravityX === 0) {
                this.physicsEngine.world.gravity.scale = 0;
            }
        }
        
        // Update physics
        if (this.components) this.components.preUpdate(dt);
        Matter.Engine.update(this.physicsEngine, dt * 1000);
        if (this.physicsWorld3D) {
            this.physicsWorld3D.step(1/60, dt, 3);
        }
        this.entities.fixedUpdate(dt);
        if (this.components) this.components.fixedUpdate(dt);

    }
    
    resize(width, height) {
        this.width = width;
        this.height = height;
        if (this.grid) {
            const GridClass = this.grid.constructor;
            if (GridClass.name === 'QuadTree') {
                this.grid = new GridClass(0, 0, width, height);
                if (this.staticGrid) {
                    this.staticGrid = new GridClass(0, 0, width, height);
                }
            } else {
                this.grid = new GridClass(width, height, 100);
            }
        }
    }
    
    setInfinite(isInfinite) {
        this.isInfinite = isInfinite;
    }
    
    getEntities() {
        return this.entities.entities;
    }
    
    addEntity(entity) { return this.add(entity); }

    add(entity) {
        return this.entities.spawn(entity);
    }
    
    spawn(type, ...args) {
        return this.entities.spawn(type, ...args);
    }
    
    /**
     * Helper to destroy an entity.
     * @param {import('../entity/Entity.js').Entity} entity 
     */
    destroy(entity) {
        if (entity) entity.destroy();
    }
    
    /**
     * Queries the world for entities within a rectangle.
     * @param {number} x 
     * @param {number} y 
     * @param {number} width 
     * @param {number} height 
     * @returns {import('../entity/Entity.js').Entity[]}
     */
    queryAABB(x, y, width, height) {
        const results = [];
        this.grid.queryAABB(x, y, width, height, results);
        if (this.staticGrid) {
            this.staticGrid.queryAABB(x, y, width, height, results);
        }
        // Filter out destroyed or inactive entities
        return results.filter(e => e.active && !e.isDestroyed);
    }
    
    /**
     * Queries the world for entities within a radius.
     * @param {number} x 
     * @param {number} y 
     * @param {number} radius 
     * @returns {import('../entity/Entity.js').Entity[]}
     */
    queryRadius(x, y, radius) {
        const results = this.queryAABB(x - radius, y - radius, radius * 2, radius * 2);
        const radiusSq = radius * radius;
        return results.filter(e => {
            const dx = e.globalX - x;
            const dy = e.globalY - y;
            return (dx * dx + dy * dy) <= radiusSq;
        });
    }

    count() {
        return this.entities.count;
    }

    /**
     * Clears all entities from the world.
     */
    
    findByTag(tag) {
        return this.entities.entities.find(e => e.tag === tag && !e.isDestroyed) || 
               this.entities.pendingAdd.find(e => e.tag === tag && !e.isDestroyed);
    }
    
    getByTag(tag) {
        return this.entities.getByTag(tag);
    }
    
    clear() {
        this.entities.clear();
        this.grid.clear();
        this.staticGrid.clear();
        Matter.World.clear(this.physicsWorld);
        Matter.Engine.clear(this.physicsEngine);
        this.scene3D.clear();

    }

    /**
     * @param {number} dt 
     */
    onUpdate(dt) {
        this.entities.update(dt);
        if (this.components) this.components.update(dt);
    }

    /**
     * Renders world background grid and entities.
     * @param {import('../renderer/Renderer2D.js').Renderer2D} renderer 
     * @param {import('../camera/Camera2D.js').Camera2D} camera 
     */

    /**
     * Raycasts against all entities in the world.
     * @param {number} x1 
     * @param {number} y1 
     * @param {number} x2 
     * @param {number} y2 
     * @param {number} [radius=0] 
     * @returns {import('../entity/Entity.js').Entity | null}
     */
    raycast(x1, y1, x2, y2, radius = 0, ignoreEntity = null) {
        return this.entities.raycast(x1, y1, x2, y2, radius, ignoreEntity);
    }

    /**
     * @param {number} originX
     * @param {number} originY
     * @param {number} angle
     * @param {number} maxDistance
     * @param {Object} outResult
     */
    
    /**
     * Raycasts against 3D objects in the scene.
     * @param {number} screenX - Mouse X in screen coordinates (pixels, 0 to width)
     * @param {number} screenY - Mouse Y in screen coordinates (pixels, 0 to height)
     * @param {import('../camera/Camera3D.js').Camera3D} camera3D
     * @returns {import('../entity/Entity.js').Entity | null}
     */
    raycast3D(screenX, screenY, camera3D) {
        if (!this.scene3D || !camera3D || !camera3D.camera) return null;
        
        // Convert to Normalized Device Coordinates (NDC)
        const rect = this.engine.canvas.element.getBoundingClientRect();
        const ndcX = ((screenX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((screenY - rect.top) / rect.height) * 2 + 1;
        
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera3D.camera);
        
        const intersects = raycaster.intersectObjects(this.scene3D.children, true);
        if (intersects.length > 0) {
            // Find which entity this mesh belongs to
            for (let i = 0; i < intersects.length; i++) {
                const object = intersects[i].object;
                
                // Traverse up to find the root mesh we added to scene
                let root = object;
                while (root.parent && root.parent !== this.scene3D) {
                    root = root.parent;
                }
                
                // Find entity that has this mesh or model
                const entities = this.getEntities();
                for (let j = 0; j < entities.length; j++) {
                    const e = entities[j];
                    const meshComp = e.getComponent('MeshRenderer');
                    const modelComp = e.getComponent('ModelRenderer');
                    
                    if (meshComp && meshComp.mesh === root) return e;
                    if (modelComp && modelComp.model === root) return e;
                }
            }
        }
        return null;
    }

    raycast2D(originX, originY, angle, maxDistance, outResult) {
        raycast(this, originX, originY, angle, maxDistance, outResult);
        
        // Let DebugRenderer know
        if (this.engine.debugRenderer) {
            const hitPoint = outResult.hit ? outResult.point : null;
            const endX = originX + Math.cos(angle) * maxDistance;
            const endY = originY + Math.sin(angle) * maxDistance;
            this.engine.debugRenderer.addRaycast(originX, originY, endX, endY, outResult.hit, hitPoint);
        }
    }
    
    render(renderer, camera) {
        if (this.drawGrid) this.renderGrid(100, '#222222', 1);
        this.entities.render(renderer, camera);
        if (this.components && this.components.render) this.components.render(renderer, camera);
    }

    /**
     * Renders a background grid optimized with camera frustum culling.
     * @param {number} gridSize 
     * @param {string} color 
     * @param {number} lineWidth 
     */
    renderGrid(gridSize = 100, color = '#222222', lineWidth = 1) {
        const r = this.engine.renderer;
        const camera = this.engine.camera;
        
        r.setStrokeStyle(color);
        r.setLineWidth(lineWidth);
        
        const bounds = camera.getBounds();
        
        let startX = Math.floor(bounds.xMin / gridSize) * gridSize;
        let endX = Math.ceil(bounds.xMax / gridSize) * gridSize;
        let startY = Math.floor(bounds.yMin / gridSize) * gridSize;
        let endY = Math.ceil(bounds.yMax / gridSize) * gridSize;

        if (!this.isInfinite) {
            startX = Math.max(startX, -this.width / 2);
            endX = Math.min(endX, this.width / 2);
            startY = Math.max(startY, -this.height / 2);
            endY = Math.min(endY, this.height / 2);
        }

        for (let x = startX; x <= endX; x += gridSize) {
            r.drawLine(x, startY, x, endY);
        }
        for (let y = startY; y <= endY; y += gridSize) {
            r.drawLine(startX, y, endX, y);
        }
        
        // Draw World Origin / Boundary Box
        if (!this.isInfinite) {
            r.setStrokeStyle('#555555');
            r.setLineWidth(2);
            r.strokeRect(-this.width / 2, -this.height / 2, this.width, this.height);
        } else {
            // Draw world origin crosshair
            r.setStrokeStyle('#555555');
            r.setLineWidth(2);
            r.drawLine(-50, 0, 50, 0);
            r.drawLine(0, -50, 0, 50);
        }
    }
}
