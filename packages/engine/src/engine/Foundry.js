import { Engine } from './core/Engine.js';

import { Simulation } from './simulation/Simulation.js';
import { Entity } from './entity/Entity.js';
import { Component } from './entity/Component.js';
import { ObjectPool } from './core/ObjectPool.js';
import { TypeRegistry, DefaultTypeRegistry } from './core/TypeRegistry.js';
import { Utils } from './core/Utils.js';
import { Mathf } from './core/Mathf.js';
import { Vector2 } from './math/Vector2.js';
import { Sprite } from './entity/components/Sprite.js';
import { Animator } from './entity/components/Animator.js';
import { TextRenderer } from './entity/components/TextRenderer.js';
import { ShapeRenderer } from './entity/components/ShapeRenderer.js';
import { Tilemap } from './entity/components/Tilemap.js';
import { ParticleEmitter } from './entity/components/ParticleEmitter.js';
import { PhysicsBody } from './physics/PhysicsBody.js';
import { PhysicsConstraint } from './physics/PhysicsConstraint.js';
import { AutoPolygon } from './physics/AutoPolygon.js';
import { AudioManager } from './audio/AudioManager.js';
import { StorageManager } from './core/StorageManager.js';
import { raycast } from './physics/Raycast.js';

import { TaskScheduler, TaskCategory, ExecutionStage } from './core/TaskScheduler.js';

import { Parallax } from './entity/components/Parallax.js';
import { Lifespan } from './entity/components/Lifespan.js';
import { CameraFollow } from './entity/components/CameraFollow.js';
import { NavAgent } from './entity/components/NavAgent.js';
import { InputController } from './entity/components/InputController.js';
import { FSM } from './entity/components/FSM.js';
import { State, StateMachine } from './simulation/StateMachine.js';
import { Flash } from './entity/components/Flash.js';
import { Scene } from './core/Scene.js';

import { Health } from './entity/components/Health.js';
import { DamageArea } from './entity/components/DamageArea.js';
import { TriggerArea } from './entity/components/TriggerArea.js';
import { LightSource } from './entity/components/LightSource.js';
import { TrailRenderer } from './entity/components/TrailRenderer.js';
import { JuiceSystem } from './simulation/JuiceSystem.js';
import { SoftBody } from './physics/SoftBody.js';
import { MeshRenderer } from './entity/components/MeshRenderer.js';
import { ModelRenderer } from './entity/components/ModelRenderer.js';
import { Light3D } from './entity/components/Light3D.js';
import { PhysicsBody3D } from './entity/components/PhysicsBody3D.js';
import { PhysicsConstraint3D } from './entity/components/PhysicsConstraint3D.js';
import { SoftBody3D } from './entity/components/SoftBody3D.js';
import { Vehicle3D } from './entity/components/Vehicle3D.js';
import { Terrain3D } from './entity/components/Terrain3D.js';
import { InstancedMesh3D } from './entity/components/InstancedMesh3D.js';
import { Sky3D } from './entity/components/Sky3D.js';
import { NetworkTransform } from './entity/components/NetworkTransform.js';
import { NetworkSyncSystem } from './entity/systems/NetworkSyncSystem.js';
import { UIManager, UIElement, UIPanel, UIButton, UILabel, UISlider } from './ui/DOMUI.js';
import { NetworkClient } from './network/NetworkClient.js';
import { NetworkServer } from './network/NetworkServer.js';
import { TweenManager, Easing } from './simulation/TweenSystem.js';
export const Foundry = {
    Engine,
    Simulation,
    Entity,
    Component,
    ObjectPool,
    TypeRegistry,
    DefaultTypeRegistry,
    Utils,
    TaskScheduler,
    TaskCategory,
    ExecutionStage,
    Mathf,
    Vector2,
    Sprite,
    Animator,
    TextRenderer,
    ShapeRenderer,
    Tilemap,
    ParticleEmitter,
    PhysicsBody,
    PhysicsConstraint,
    AutoPolygon,
    AudioManager,
    StorageManager,

    Parallax,
    Lifespan,
    CameraFollow,
    NavAgent,
    InputController,
    FSM,
    State,
    StateMachine,
    Flash,
    Scene,
    Health,
    DamageArea,
    TriggerArea,
    LightSource,
    TrailRenderer,
    JuiceSystem,
    SoftBody,
    MeshRenderer,
    ModelRenderer,
    Light3D,
    PhysicsBody3D,
    PhysicsConstraint3D,
    SoftBody3D,
    Vehicle3D,
    Terrain3D,
    InstancedMesh3D,
    Sky3D,
    NetworkTransform,
    TweenManager,
    Easing,
    raycast,
};
