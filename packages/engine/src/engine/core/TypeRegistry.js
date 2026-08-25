import { Entity } from '../entity/Entity.js';
import { Sprite } from '../entity/components/Sprite.js';
import { Component } from '../entity/Component.js';
import { SpriteAnimator } from '../graphics/SpriteAnimator.js';
import { Animator } from '../entity/components/Animator.js';
import { TextRenderer } from '../entity/components/TextRenderer.js';
import { ShapeRenderer } from '../entity/components/ShapeRenderer.js';
import { Tilemap } from '../entity/components/Tilemap.js';
import { ParticleEmitter } from '../entity/components/ParticleEmitter.js';
import { AudioSource } from '../entity/components/AudioSource.js';
import { NavAgent } from '../entity/components/NavAgent.js';
import { CameraFollow } from '../entity/components/CameraFollow.js';
import { Parallax } from '../entity/components/Parallax.js';
import { Lifespan } from '../entity/components/Lifespan.js';
import { InputController } from '../entity/components/InputController.js';
import { Health } from '../entity/components/Health.js';
import { DamageArea } from '../entity/components/DamageArea.js';
import { TriggerArea } from '../entity/components/TriggerArea.js';
import { LightSource } from '../entity/components/LightSource.js';
import { PhysicsBody } from '../physics/PhysicsBody.js';
import { PhysicsConstraint } from '../physics/PhysicsConstraint.js';
import { AutoPolygon } from '../physics/AutoPolygon.js';

import { MeshRenderer } from '../entity/components/MeshRenderer.js';
import { ModelRenderer } from '../entity/components/ModelRenderer.js';
import { Light3D } from '../entity/components/Light3D.js';
import { PhysicsBody3D } from '../entity/components/PhysicsBody3D.js';


/**
 * Global registry for serializable classes.
 * Required to instantiate objects during deserialization.
 */
export class TypeRegistry {
    constructor() {
        this.entities = new Map();
        this.components = new Map();
    }

    /**
     * Registers an Entity class.
     * @param {string} name 
     * @param {Function} classRef 
     */
    registerEntity(name, classRef) {
        this.entities.set(name, classRef);
    }

    /**
     * Registers a Component class.
     * @param {string} name 
     * @param {Function} classRef 
     */
    registerComponent(name, classRef) {
        this.components.set(name, classRef);
    }

    /**
     * Instantiates an Entity by name.
     * @param {string} name 
     * @returns {import('../entity/Entity.js').Entity | null}
     */
    createEntity(name) {
        const ClassRef = this.entities.get(name);
        if (!ClassRef) return null;
        return new ClassRef();
    }

    /**
     * Instantiates a Component by name.
     * @param {string} name 
     * @returns {import('../entity/Component.js').Component | null}
     */
    createComponent(name) {
        const ClassRef = this.components.get(name);
        if (!ClassRef) return null;
        return new ClassRef();
    }
}

// Global default instance for the engine
export const DefaultTypeRegistry = new TypeRegistry();

// Register core entities and components
DefaultTypeRegistry.registerEntity('Entity', Entity);
DefaultTypeRegistry.registerComponent('Component', Component);
DefaultTypeRegistry.registerComponent('Tilemap', Tilemap);
DefaultTypeRegistry.registerComponent('Sprite', Sprite);
DefaultTypeRegistry.registerComponent('Animator', Animator);
DefaultTypeRegistry.registerComponent('TextRenderer', TextRenderer);
DefaultTypeRegistry.registerComponent('ShapeRenderer', ShapeRenderer);
DefaultTypeRegistry.registerComponent('ParticleEmitter', ParticleEmitter);
DefaultTypeRegistry.registerComponent('AudioSource', AudioSource);
DefaultTypeRegistry.registerComponent('NavAgent', NavAgent);
DefaultTypeRegistry.registerComponent('CameraFollow', CameraFollow);
DefaultTypeRegistry.registerComponent('Parallax', Parallax);
DefaultTypeRegistry.registerComponent('Lifespan', Lifespan);
DefaultTypeRegistry.registerComponent('InputController', InputController);
DefaultTypeRegistry.registerComponent('Health', Health);
DefaultTypeRegistry.registerComponent('DamageArea', DamageArea);
DefaultTypeRegistry.registerComponent('TriggerArea', TriggerArea);
DefaultTypeRegistry.registerComponent('LightSource', LightSource);
DefaultTypeRegistry.registerComponent('PhysicsBody', PhysicsBody);
DefaultTypeRegistry.registerComponent('PhysicsConstraint', PhysicsConstraint);
DefaultTypeRegistry.registerComponent('AutoPolygon', AutoPolygon);

DefaultTypeRegistry.registerComponent('MeshRenderer', MeshRenderer);
DefaultTypeRegistry.registerComponent('ModelRenderer', ModelRenderer);
DefaultTypeRegistry.registerComponent('Light3D', Light3D);
DefaultTypeRegistry.registerComponent('PhysicsBody3D', PhysicsBody3D);

// Note: SpriteAnimator and Tilemap might be entities or components depending on how they are implemented.

