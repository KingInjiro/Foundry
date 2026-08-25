// PUBLIC API BOUNDARY
// The Platform, Player, and Game Packages MUST ONLY import from this file.
// Internal imports (e.g. src/engine/core/...) are strictly prohibited outside the engine.

export { Engine } from './core/Engine.js';
export { SceneManager } from './core/SceneManager.js';
export { Scene } from './core/Scene.js';
export { TaskScheduler } from './core/TaskScheduler.js';
export { DefaultTypeRegistry, TypeRegistry } from './core/TypeRegistry.js';
export { EventEmitter } from './core/EventEmitter.js';

export { World } from './world/World.js';

export { Entity } from './entity/Entity.js';
export { Component } from './entity/Component.js';

export { SceneSerializer } from './serialization/SceneSerializer.js';
export { PrefabManager } from './serialization/PrefabManager.js';

export { Vector2 } from './math/Vector2.js';
export { Matrix4 } from './math/Matrix4.js';
export { Transform } from './math/Transform.js';

// Pre-registered components
export { Sprite } from './entity/components/Sprite.js';
export { Animator } from './entity/components/Animator.js';
export { TextRenderer } from './entity/components/TextRenderer.js';
export { Tilemap } from './entity/components/Tilemap.js';
export { PhysicsBody } from './physics/PhysicsBody.js';
export { PhysicsConstraint } from './physics/PhysicsConstraint.js';
export { AudioSource } from './entity/components/AudioSource.js';
export { ParticleEmitter } from './entity/components/ParticleEmitter.js';
export { Lifespan } from './entity/components/Lifespan.js';
export { InputController } from './entity/components/InputController.js';
export { CameraFollow } from './entity/components/CameraFollow.js';

// 3D
export { MeshRenderer } from './entity/components/MeshRenderer.js';
export { ModelRenderer } from './entity/components/ModelRenderer.js';
export { Light3D } from './entity/components/Light3D.js';
export { PhysicsBody3D } from './entity/components/PhysicsBody3D.js';

// Utilities
// export { Mathf } from './core/Mathf.js';


// Legacy/public facade used by the Editor and Player loader.
export { Foundry } from './Foundry.js';
export { AssetManager } from './core/AssetManager.js';
