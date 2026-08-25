# Project Overview

Foundry is a browser-native game engine ecosystem. It executes game logic in a Web Worker while rendering and IDE functionalities remain on the main browser thread, communicating via SharedArrayBuffer and postMessage. The engine supports a hybrid 2D/3D Entity-Component-System (ECS) architecture, utilizing a custom WebGL2 batched renderer for 2D, Three.js for 3D rendering, Matter.js for 2D physics, and Cannon-ES for 3D physics. All development (coding, visual scripting, asset management) occurs entirely within the browser.

---

# Current Status

Current Stage:
Alpha

Core Engine:
Implemented

ECS Architecture:
Implemented

Serialization:
Implemented

2D Systems:
Implemented

3D Systems:
Implemented

Physics (2D/3D):
Implemented

Visual Scripting:
Implemented

Editor/IDE:
Implemented (Visual Scene editing with gizmos is currently missing)

Networking:
Implemented (WebSockets state sync)

Audio:
Implemented

---

# Current Architecture

## Engine
The central orchestrator running in the Web Worker. It manages the game loop, delta time calculation, input state synchronization, and execution of the TaskScheduler.

## TaskScheduler
A Directed Acyclic Graph (DAG) based execution model. Systems declare dependencies on other systems, and the scheduler resolves the execution order. It prevents race conditions between systems during a frame tick.

## World
A container for Entities and Systems. It handles the lifecycle of the scene, including spawning, destroying, and querying entities. It acts as the primary interface for serialization and deserialization of scene states.

## Entity
A lightweight container identifiable by a unique UUID. It holds a list of Components. Logic is largely deferred to Systems, though entities currently expose lifecycle hooks (`onSpawn`, `onUpdate`, `onCollision`) for rapid prototyping.

## Component
Data containers attached to entities. Components maintain serializable state.

## Renderer
Split across threads. The Web Worker holds logical transform data and pushes render commands (for 2D) or synchronizes matrix data (for 3D) to the main thread. The main thread executes WebGL2 draw calls or Three.js renders.

## Physics
Integrates Matter.js (2D) and Cannon-ES (3D) within the worker thread. Physics systems run on a fixed timestep (`fixedUpdate`) independent of the variable render frame rate.

## Input
The main thread listens to DOM events (keyboard, mouse) and buffers them into a SharedArrayBuffer. The worker reads this buffer synchronously during its frame update.

## Audio
Utilizes the Web Audio API on the main thread. The worker sends audio playback commands and spatial updates via postMessage.

## Assets
An `AssetManager` orchestrating asynchronous loading of images, audio buffers, and GLTF/GLB models. Assets are mapped by UUIDs rather than file paths to maintain stability during renames.

## Editor
A React-based UI running on the main thread. It contains a Monaco-based code editor, an Inspector for manipulating component properties, an Asset Browser utilizing local browser storage, and a React Flow-based Visual Logic editor.

---

# Implemented Systems

## Renderer2D
- **Purpose**: High-performance 2D rendering.
- **Current capabilities**: Batched WebGL rendering for primitive shapes, sprites, and text. GPU-accelerated particle system mapping. Screen-space depth projection over 3D scenes.
- **Known limitations**: Requires explicit texture atlasing or batch breaks on texture swaps.
- **Dependencies**: Native WebGL2.

## Renderer3DSystem
- **Purpose**: 3D scene rendering.
- **Current capabilities**: Renders GLTF/GLB models (`ModelRenderer`) with Skeletal Animations, Animation Blending, and Inverse Kinematics (CCDIKSolver). Renders high-count foliage via `InstancedMesh3D`. Procedural environments via `Terrain3D` (Heightmaps) and `Sky3D` (Procedural Time of Day).
- **Known limitations**: No automatic LOD generation for custom meshes.
- **Dependencies**: Three.js.

## PhysicsSystem / PhysicsSystem3D
- **Purpose**: Collision detection and resolution.
- **Current capabilities**: 2D rigid bodies (Matter.js). 3D rigid bodies (Cannon-ES), Raycast Vehicles (`Vehicle3D`), constraints (`PhysicsConstraint3D`), and Soft Bodies (`SoftBody3D`).
- **Known limitations**: 2D and 3D physics worlds are completely separate and do not interact.
- **Dependencies**: Matter.js, Cannon-ES.

## NetworkSyncSystem
- **Purpose**: Real-time multiplayer synchronization.
- **Current capabilities**: WebSocket connections, entity state interpolation, and delta transforms (`NetworkTransform`).
- **Known limitations**: Lacks server-authoritative reconciliation logic; mostly client-authoritative state broadcasting.
- **Dependencies**: `ws` (when running in Node.js headless mode).

## AudioSystem
- **Purpose**: Sound playback and mixing.
- **Current capabilities**: 2D audio and 3D spatial audio (PannerNode), routing via volume groups (Master, SFX, Music), and basic filters.
- **Known limitations**: Playback is blocked until the user interacts with the DOM due to browser autoplay policies.
- **Dependencies**: Native Web Audio API.

---

# Editor

The Editor exists purely on the main thread and communicates with the game worker.

- **Code Editor**: Monaco editor with syntax highlighting and hot-reloading of class definitions.
- **Visual Logic Graph**: Node-based graph (React Flow) that generates executable JS state machines.
- **Inspector**: Real-time property binding. Can read/write XYZ transforms, 3D physics properties, and component fields.
- **Asset Browser**: Supports uploading and parsing scripts, images, audio, and models, persisting them in IndexedDB/localStorage.
- **Console**: Intercepts worker `console.log` and `crashed` events to display runtime errors inside the IDE.

*Missing*: Visual 3D viewport gizmos (translation/rotation arrows) inside the scene view for drag-and-drop object placement.

---

# Current API Philosophy

- **Entity Component System (ECS)**: Prefer composition over inheritance. Data lives in components; logic lives in systems.
- **TaskScheduler Frame Order**: Strict separation of input reading, pre-update, update, fixed-update (physics), post-update, and render synchronization. Systems must declare their phase.
- **Serialization Goals**: Ensure deterministic loading. Everything required to reconstruct a scene must be serializable to a plain JSON object.
- **Architecture Contracts**: The engine is agnostic to the environment; it can run in a Web Worker, on the Main Thread, or in a headless Node.js server. 

---

# Current Examples

The IDE ships with the following functional examples that stress-test the APIs:
- Cube Runner (3D Physics & Raycasting)
- Pong (2D Physics & Input)
- Platformer/RPG (2D Kinematics & Animation)
- Plinko (2D Physics stress test)
- Stealth (2D Line-of-sight & AI)
- Terraria-like (2D Grid & Generation)
- Vampire Survivor-like (2D Swarm logic)
- Juicy Shooter (2D VFX & Particles)

---

# Current Limitations

- **No visual scene gizmos**: Entities must be positioned by typing coordinates into the Inspector or via code.
- **No Prefab system**: Cannot save an entity configuration as a reusable template that updates all instances when changed.
- **Export Pipeline**: The current ZIP export creates a static HTML bundle, but it lacks a production bundler (like Vite/Rollup) step to minify or tree-shake the exported game code.
- **Plugin API**: No formal API for injecting custom editor panels or extending the IDE interface.
- **Cross-Origin Isolation**: SharedArrayBuffer usage strictly requires the server to send COOP/COEP headers, limiting deployment environments.

---

# Future Direction

- **Prefabs**: Architecture prepared for nested serialization to support reusable entity templates.
- **Scene Diffing**: Future consideration for version control of serialized scene JSON.
- **Standalone Native Export**: Under investigation (evaluating Tauri vs Electron) for building native desktop binaries.
- **Plugin API**: Planned extension system for custom IDE panels.
- **Vehicle/Ragdoll enhancements**: Planned integration of more complex suspension parameters.

---

# Appendix

## Project Folder Structure
- `/src/Foundry.js`: Core engine entry point and exports.
- `/src/core/`: Engine execution, TaskScheduler, Worker bindings.
- `/src/entity/`: ECS implementation (World, Entity, Component, Systems).
- `/src/physics/`: Matter.js and Cannon-ES integrations.
- `/src/audio/`: Web Audio integration.
- `/src/renderer/`: 2D WebGL abstractions.
- `/src/components/`: React-based IDE UI (Inspector, Editor, Graph).
- `/src/worker.js`: The Web Worker entry point.

## Core Dependencies
- `three`: 3D rendering.
- `cannon-es`: 3D physics.
- `matter-js`: 2D physics.
- `@monaco-editor/react`: Code editing.
- `@xyflow/react`: Visual node logic editing.
- `vite`: Development server and IDE building.
