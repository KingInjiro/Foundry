import { Entity } from '../entity/Entity.js';
import { Sprite } from '../entity/components/Sprite.js';
import { PhysicsBody } from '../physics/PhysicsBody.js';
import { Animator } from '../entity/components/Animator.js';
import { TextRenderer } from '../entity/components/TextRenderer.js';
import { ShapeRenderer } from '../entity/components/ShapeRenderer.js';
import { SceneSerializer } from '../serialization/SceneSerializer.js';

/**
 * Abstract base class for custom simulations on the Foundry Engine platform.
 */
export class Simulation {
    /**
     * @param {import('../core/Engine.js').Engine} engine 
     */
    constructor(engine) {
        this.engine = engine;
        
        /** @type {string} Background color for the simulation */
        this.clearColor = '#111111';
        
        /** @type {number} Alpha value for clearing (1 = fully clear, <1 = trails) */
        
        this.clearAlpha = 1.0;
        
        this.classRegistry = new Map();
        this.registerClass('Entity', this.engine.world.EntityClass || Entity);
        this.registerClass('Sprite', Sprite);
        this.registerClass('PhysicsBody', PhysicsBody);
        this.registerClass('Animator', Animator);
        this.registerClass('TextRenderer', TextRenderer);
        this.registerClass('ShapeRenderer', ShapeRenderer);
    }
    

    get world() { return this.engine ? this.engine.world : null; }
    get camera() { return this.engine ? this.engine.camera : null; }
    get input() { return this.engine ? this.engine.input : null; }
    get audio() { return this.engine ? this.engine.audio : null; }
    get renderer() { return this.engine ? this.engine.renderer : null; }
    get events() { return this.engine ? this.engine.events : null; }
    get physicsWorld() { return this.engine ? this.engine.physics : null; }
    get scheduler() { return this.engine ? this.engine.scheduler : null; }

    registerClass(name, cls) {
        this.classRegistry.set(name, cls);
    }
    
    getClass(name) {
        if (name === 'Entity') return Entity;
        return this.classRegistry.get(name);
    }
    
    registerPrefab(name, prefabData) {
        this.engine.prefabs.register(name, prefabData);
    }
    
    instantiatePrefab(name, x = 0, y = 0) {
        return this.engine.prefabs.instantiate(name, this, x, y);
    }
    
    loadScene(sceneData) {
        SceneSerializer.deserialize(sceneData, this.engine.world, this);
    }
    
    saveScene() {
        return SceneSerializer.serialize(this.engine.world);
    }

    /**
     * Casts a ray into the world to find intersections with entities or physics bodies.
     * @param {number} originX 
     * @param {number} originY 
     * @param {number} angle The angle in radians
     * @param {number} maxDistance 
     * @returns {{hit: boolean, distance: number, point: {x: number, y: number}, entity: any, isMatterBody: boolean}}
     */
    raycast(originX, originY, angle, maxDistance) {
        const result = { hit: false, distance: maxDistance, point: {x: originX, y: originY}, entity: null, isMatterBody: false };
        this.engine.world.raycast2D(originX, originY, angle, maxDistance, result);
        return result;
    }


    /**
     * Called once when the simulation is registered or first loaded.
     */
    onInitialize() {}

    /**
     * Called every time the simulation becomes the active simulation.
     */
    onStart() {}

    /**
     * Called on fixed physics steps.
     * @param {number} fixedDelta 
     */
    onFixedUpdate(fixedDelta) {}

    /**
     * Called every frame for logic updates.
     * @param {number} dt 
     */
    onUpdate(dt) {}

    /**
     * Called during the world rendering phase, within camera transformations.
     * @param {import('../renderer/Renderer2D.js').Renderer2D} renderer 
     * @param {import('../camera/Camera2D.js').Camera2D} camera 
     */
    onRender(renderer, camera) {}

    /**
     * Called during the screen-space rendering phase for IMGUI.
     * @param {import('../ui/UIContext.js').UIContext} ui 
     */
    onUI(ui) {}

    /**
     * Called when the simulation is swapped out or stopped.
     */
    onStop() {}

    restart() {
        if (this.engine.simulations) {
            this.engine.simulations.setActive(this.engine.simulations.activeSimulationName);
        }
    }

    /**
     * Called when the simulation is being destroyed or removed completely.
     */
    onTeardown() {}
}
