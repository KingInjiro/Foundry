import { Transform } from '../math/Transform.js';
import { Utils } from '../core/Utils.js';


/**
 * Base class for all simulation objects within the World.
 */
import { EventEmitter } from "../core/EventEmitter.js";
import { Component } from './Component.js';
export class Entity extends EventEmitter {


        constructor() {
        super();
        this.id = Utils.generateUUID();
        this.tag = 'entity';
        
        this.transform = new Transform();
        
        // Physics / Layering
        this.layer = 0;
        this._vx = 0;
        this._vy = 0;
        this._vz = 0;
        this.velocityDirty = false;
        
        // Engine tags
        this.isStatic = false; // Used for broadphase spatial grid caching
        
        this.active = true;
        this.visible = true;
        this.isDestroyed = false;
        this.body = null;
        
        // Defines circular bounding area for frustum culling
        this.cullRadius = 0; 
        
        /** @type {import('../world/World.js').World} */
        this.world = null;
        /** @type {import('../core/Engine.js').Engine} */
        this.engine = null;
        
        /** @type {import('./Component.js').Component[]} */
        this.components = [];
        this.parent = null;
        this.children = [];
        
        // Coroutines
        this.coroutines = [];
    }

    /**
     * Attaches a component to this entity.
     * @param {import('./Component.js').Component} component 
     * @returns {import('./Component.js').Component}
     */


    
    get camera() { return this.engine ? this.engine.camera : null; }
    get input() { return this.engine ? this.engine.input : null; }
    get audio() { return this.engine ? this.engine.audio : null; }
    get renderer() { return this.engine ? this.engine.renderer : null; }
    get physicsWorld() { return this.engine ? this.engine.physics : null; }
    get simulation() { return this.engine && this.engine.simulations ? this.engine.simulations.activeSimulation : null; }

    overlaps(other) {
        if (!this.width || !this.height || !other.width || !other.height) return false;
        return Math.abs(this.x - other.x) * 2 < (this.width + other.width) &&
               Math.abs(this.y - other.y) * 2 < (this.height + other.height);
    }
    
    get physics() {
        return this.getComponent('PhysicsBody');
    }
    
        get x() { return this.transform.x; }
    set x(v) { this.transform.x = v; }
    
    get y() { return this.transform.y; }
    set y(v) { this.transform.y = v; }
    
    get z() { return this.transform.z; }
    set z(v) { this.transform.z = v; }
    
    
    get vx() { return this._vx; }
    set vx(v) { if(this._vx !== v) { this._vx = v; this.velocityDirty = true; } }
    
    get vy() { return this._vy; }
    set vy(v) { if(this._vy !== v) { this._vy = v; this.velocityDirty = true; } }
    
    get vz() { return this._vz; }
    set vz(v) { if(this._vz !== v) { this._vz = v; this.velocityDirty = true; } }
    
    setVelocityFromPhysics(x, y) {
        this._vx = x;
        this._vy = y;
    }

    get depth() { return this.transform.z; }
    set depth(v) { this.transform.z = v; }
    
    get rotation() { return this.transform.rotation; }
    set rotation(v) { this.transform.rotation = v; }
    
    get scaleX() { return this.transform.scaleX; }
    set scaleX(v) { this.transform.scaleX = v; }
    
    get scaleY() { return this.transform.scaleY; }
    set scaleY(v) { this.transform.scaleY = v; }
    
    get globalX() { return this.transform.globalX; }
    get globalY() { return this.transform.globalY; }
    get globalZ() { return this.transform.globalZ; }
    get globalRotation() { return this.transform.globalRotation; }
    get globalScaleX() { return this.transform.globalScaleX; }
    get globalScaleY() { return this.transform.globalScaleY; }

    get scaleZ() { return this.transform.scaleZ; }
    set scaleZ(v) { this.transform.scaleZ = v; }


    get rotationX() { return this.transform.rotationX; }
    set rotationX(v) { this.transform.rotationX = v; }
    get rotationY() { return this.transform.rotationY; }
    set rotationY(v) { this.transform.rotationY = v; }
    get rotationZ() { return this.transform.rotationZ; }
    set rotationZ(v) { this.transform.rotationZ = v; }
    
    get globalRotationX() { return this.transform.globalRotationX; }
    get globalRotationY() { return this.transform.globalRotationY; }
    get globalRotationZ() { return this.transform.globalRotationZ; }

    
    get _prevX() { return this.x; }
    get _prevY() { return this.y; }
    get _prevRotation() { return this.rotation; }
    get _prevScaleX() { return this.scaleX; }
    get _prevScaleY() { return this.scaleY; }
    get _prevZ() { return this.z; }
    set _prevX(v) {}
    set _prevY(v) {}
    set _prevRotation(v) {}
    set _prevScaleX(v) {}
    set _prevScaleY(v) {}
    set _prevZ(v) {}

    addComponent(componentOrClass, ...args) {
        let component;
        if (typeof componentOrClass === 'function') {
            const CompClass = componentOrClass;
            let pool = CompClass._pool;
            if (!pool) {
                pool = [];
                CompClass._pool = pool;
            }
            if (pool.length > 0) {
                component = pool.pop();
            } else {
                component = new CompClass();
            }
            if (component.init) component.init(...args);
        } else {
            component = componentOrClass;
        }
        
        component.entity = this;
        this.components.push(component);
        if (this.world && this.world.components) {
            this.world.components.addComponent(component);
        }
        if (this.world) {
            if(typeof component.onAwake === "function") component.onAwake();
            if(typeof component.onStart === "function") component.onStart();
        }
        return component;
    }

    /**
     * Gets a component of the specified class.
     * @param {Function} componentClass 
     */
    /**
     * Removes a component from the entity.
     * @param {import('./Component.js').Component|Function} componentOrClass
     */
    removeComponent(componentOrClass) {
        const comp = typeof componentOrClass === 'function' ? this.getComponent(componentOrClass) : componentOrClass;
        if (!comp) return false;
        
        const idx = this.components.indexOf(comp);
        if (idx !== -1) {
            this.components.splice(idx, 1);
            if (typeof comp.onDestroy === "function") comp.onDestroy();
            if (this.world && this.world.components) {
                this.world.components.removeComponent(comp);
            }
            
            comp.entity = null;
            
            // Pool component
            const CompClass = comp.constructor;
            if (!CompClass._pool) {
                CompClass._pool = [];
            }
            CompClass._pool.push(comp);
            
            return true;
        }
        return false;
    }

    getComponent(componentClass) {
        for (let i = 0; i < this.components.length; i++) {
            if ((typeof componentClass === 'string' && this.components[i].constructor.name === componentClass) || (typeof componentClass !== 'string' && this.components[i] instanceof componentClass)) {
                return this.components[i];
            }
        }
        return null;
    }


    /**
     * Marks the entity for destruction. It will be removed at the end of the frame.
     */
    destroy() {
        this.isDestroyed = true;
    }

    addChild(child) {
        if (child.parent) {
            child.parent.removeChild(child);
        }
        child.parent = this;
        this.children.push(child);
        if (this.world) {
            this.world.entities.add(child);
        }
    }

    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index !== -1) {
            this.children.splice(index, 1);
            child.parent = null;
        }
    }

    /** Called internally by engine */
    _internalSpawn(world) {
        this.world = world;
        this.engine = world.engine;
        this.updateWorldTransform();

        for (let i = 0; i < this.components.length; i++) {
            if (this.world.components) {
                this.world.components.addComponent(this.components[i]);
            }
            if (typeof this.components[i].onAwake === "function") this.components[i].onAwake();
            if (typeof this.components[i].onStart === "function") this.components[i].onStart();
        }
        this.onSpawn(world);
    }


    updateWorldTransform(parentDirty = false) {
        const parentMatrix = this.parent ? this.parent.transform.worldMatrix : null;
        const worldDirty = this.transform.updateWorldMatrix(parentMatrix, parentDirty);
        
        if (this.parent) {
            this.worldX = this.parent.worldX + this.x;
            this.worldY = this.parent.worldY + this.y;
            this.worldRotation = this.parent.worldRotation + this.rotation;
            this.worldScaleX = this.parent.worldScaleX * this.scaleX;
            this.worldScaleY = this.parent.worldScaleY * this.scaleY;
        } else {
            this.worldX = this.x;
            this.worldY = this.y;
            this.worldRotation = this.rotation;
            this.worldScaleX = this.scaleX;
            this.worldScaleY = this.scaleY;
        }
        
        for (let i = 0; i < this.children.length; i++) {
            this.children[i].updateWorldTransform(worldDirty);
        }
    }


    startCoroutine(generator) {
        this.coroutines.push(generator);
        return generator;
    }
    
    stopCoroutine(generator) {
        const index = this.coroutines.indexOf(generator);
        if (index > -1) {
            this.coroutines.splice(index, 1);
        }
    }

    _processCoroutines(dt) {
        for (let i = this.coroutines.length - 1; i >= 0; i--) {
            const coroutine = this.coroutines[i];
            const result = coroutine.next(dt);
            if (result.done) {
                this.coroutines.splice(i, 1);
            }
        }
    }

    /** Called internally by engine */
    _internalFixedUpdate(dt) {
        if (this.fixedUpdate) this.fixedUpdate(dt);
        this.onFixedUpdate(dt);
        for (let i = 0; i < this.components.length; i++) {
            if (this.components[i].enabled) {
                if (typeof this.components[i].onFixedUpdate === "function") this.components[i].onFixedUpdate(dt);
            }
        }
    }

    /** Called internally by engine */
    _internalUpdate(dt) {
        this.updateWorldTransform();
        this._processCoroutines(dt);
        if (this.update) this.update(dt);
        this.onUpdate(dt);
        for (let i = 0; i < this.components.length; i++) {
            if (this.components[i].enabled) {
                if (typeof this.components[i].onUpdate === "function") this.components[i].onUpdate(dt);
            }
        }
    }

    /** Called internally by engine */
    _internalRender(renderer, camera) {
        this.onRender(renderer, camera);
        for (let i = 0; i < this.components.length; i++) {
            if (this.components[i].enabled) {
                if (typeof this.components[i].onRender === "function") this.components[i].onRender(renderer, camera);
            }
        }
    }

    /** Called internally by engine */
    _internalDestroy() {
        this.onDestroy();
        if (this.transform && this.transform.destroy) {
            this.transform.destroy();
        }
        for (let i = 0; i < this.components.length; i++) {
            const comp = this.components[i];
            if (typeof comp.onDestroy === "function") comp.onDestroy();
            if (this.world && this.world.components) {
                this.world.components.removeComponent(comp);
            }
            
            // Pool component
            const CompClass = comp.constructor;
            if (!CompClass._pool) {
                CompClass._pool = [];
            }
            CompClass._pool.push(comp);
        }
        this.components.length = 0;
    }

    
    /**
     * Serializes this entity and its components into a JSON-serializable object.
     */
    serialize() {
        const data = {
            id: this.id,
            class: this.constructor.name,
            tag: this.tag,
            layer: this.layer,
            x: this.x,
            y: this.y,
            z: this.z,
            rotation: this.rotation,
            rotationX: this.rotationX,
            rotationY: this.rotationY,
            rotationZ: this.rotationZ,
            scaleX: this.scaleX,
            scaleY: this.scaleY,
            scaleZ: this.transform.scaleZ,
            active: this.active,
            visible: this.visible,
            isStatic: this.isStatic,
            components: [],
            children: []
        };
        
        for (let i = 0; i < this.components.length; i++) {
            const comp = this.components[i];
            if (comp.serialize) {
                data.components.push({
                    id: comp.id,
                    class: comp.constructor.name,
                    data: comp.serialize()
                });
            } else {
                const compData = {};
                for (const key in comp) {
                    if (key === 'id' || key === 'entity' || key === 'enabled' || typeof comp[key] === 'function') continue;
                    const val = comp[key];
                    // Handle references and skip complex objects to prevent circular JSON
                    if (val && typeof val === 'object') {
                        if (Array.isArray(val)) {
                            let hasEntity = false;
                            const mapped = val.map(item => {
                                if (item && typeof item === 'object' && item.constructor && item.constructor.name === 'Entity') {
                                    hasEntity = true;
                                    return { $ref: item.id };
                                }
                                return item;
                            });
                            compData[key] = mapped;
                            continue;
                        } else if (val.constructor && val.constructor.name === 'Entity') {
                            compData[key] = { $ref: val.id };
                            continue;
                        } else if (val instanceof Component) {
                            compData[key] = { $refComp: val.id };
                            continue;
                        } else if (val.constructor && ['World', 'Engine', 'Map', 'Set', 'HTMLImageElement', 'HTMLCanvasElement', 'CanvasRenderingContext2D', 'WebGLRenderingContext', 'WebGL2RenderingContext', 'AudioContext', 'GainNode', 'OscillatorNode', 'StateMachine'].includes(val.constructor.name)) {
                            continue;
                        }
                    }
                    compData[key] = val;
                }
                data.components.push({
                    id: comp.id,
                    class: comp.constructor.name,
                    enabled: comp.enabled,
                    data: compData
                });
            }
        }
        
        for (let i = 0; i < this.children.length; i++) {
            data.children.push(this.children[i].serialize());
        }
        
        return data;
    }

    /**
     * @deprecated Use SceneSerializer instead for robust multi-pass deserialization.
     */
    deserialize(data, sim) {
        console.warn("Entity.deserialize is deprecated. Use SceneSerializer.deserialize instead.");
    }

    /** User overridable methods */
    onSpawn(world) {}
    onFixedUpdate(fixedDelta) {}
    onUpdate(dt) {}
    onRender(renderer, camera) {}
    onDestroy() {}
}
