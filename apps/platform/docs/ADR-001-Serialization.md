# ADR 001: Deep Serialization System

## 1. Status
**Proposed**

## 2. Context
Foundry Engine needs a robust Serialization and Deserialization system. The initial implementation `SceneSerializer.js` was a naive approach relying on constructors and simple `Object.assign()`. As the engine evolves, this naive approach cannot support critical features like:
- Prefabs
- Undo/Redo History
- Scene Save/Load
- Copy/Paste
- Crash Recovery & Hot Reloading
- Multiplayer Snapshots

A robust serialization architecture requires strict contracts regarding Object Instantiation, References, IDs, Versioning, and Unknown Type handling.

## 3. Goals
- Define a structured JSON format for Scenes, Entities, and Components.
- Eliminate dependency on `instanceof` and direct class constructors during deserialization.
- Guarantee stable object references across serialization cycles (Stable Entity IDs).
- Define a multi-pass deserialization lifecycle to correctly resolve references before spawning.
- Prevent engine crashes on missing or unknown component types.

## 4. Proposed Architecture

### 4.1 Runtime Type Registry
During deserialization, we must instantiate objects from string representations (e.g., `"class": "Player"`). We will introduce a global `TypeRegistry`.

```javascript
class TypeRegistry {
    registerEntity(name, classRef)
    registerComponent(name, classRef)
    createEntity(name)
    createComponent(name)
}
```
Games built on Foundry will explicitly register their custom Entities and Components before starting the engine.

### 4.2 Stable Entity IDs
Currently, entities lack a stable unique identifier. We will introduce `id` (UUIDv4 or a robust 64-bit string identifier) for every `Entity`.
- IDs are generated upon Entity creation.
- IDs are **immutable**.
- When an entity is serialized, its ID is saved.
- When it is deserialized, the exact same ID is restored.
- **Exception**: Copy/Paste or Prefab instantiation will generate new IDs for the clones, while updating their internal references.

### 4.3 Scene Format & Versioning
Every serialized payload must be strictly versioned.

```json
{
    "version": 1,
    "type": "Scene",
    "entities": [
        {
            "id": "e4f8-1123-abc",
            "class": "Player",
            "tag": "hero",
            "layer": "default",
            "active": true,
            "transform": {
                "x": 100, "y": 200, "rotation": 0, "scaleX": 1, "scaleY": 1
            },
            "components": [
                {
                    "class": "PhysicsBody",
                    "data": {
                        "mass": 10,
                        "isStatic": false
                    }
                }
            ],
            "children": [
                "a1b2-3344-cde" // child UUID
            ]
        }
    ]
}
```
If the schema changes in the future, the version bumps, and we write a migration function to upgrade old payloads.

### 4.4 Missing Type Recovery (Unknown Components)
If a JSON payload references `"class": "LaserWeapon"`, but `LaserWeapon` is not in the `TypeRegistry`:
- Do **not** crash.
- Log a structured warning: `[Serializer] Missing Component: LaserWeapon on Entity (id: e4f8...)`.
- Skip the component.
- The Scene continues loading.

### 4.5 The Deserialization Lifecycle (Multi-Pass)
Restoring a scene must happen in strict sequential passes to guarantee that cross-references can be resolved correctly.

1. **Pass 1: Instantiation (Create All)**
   Iterate through all entities in the payload. Use `TypeRegistry` to instantiate them. Assign their original `id`. Do not create components or children yet. Add them to a temporary lookup map.
2. **Pass 2: Components (Data Hydration)**
   Iterate again. Instantiate all components. Apply primitive data properties (x, y, simple config values).
3. **Pass 3: Hierarchy & Reference Resolution**
   Reconstruct parent-child relationships using the lookup map.
   If a component has a reference to another Entity (e.g., `TargetComponent.targetId = "a1b2..."`), resolve it to the actual Entity instance here.
4. **Pass 4: `onAfterDeserialize`**
   Call `onAfterDeserialize()` on all Entities and Components. This is a new lifecycle hook allowing objects to perform logic that depends on their resolved references, but before they are strictly active in the World.
5. **Pass 5: `onSpawn` (Finalize)**
   Submit all entities to the World to trigger their standard `onSpawn` hooks.

### 4.6 Asset References
Currently, Sprites and Sounds reference file paths directly (`image.png`). This breaks scenes if assets are renamed.
- Future work (Asset Manager integration): Assets should be assigned UUIDs, and the serialization payload will reference the Asset UUID, not the path.

## 5. Consequences
- **Positive:** Enables robust saving, hot-reloading, prefabs, and undo/redo. Solves reference cycles.
- **Negative:** Requires games to explicitly register types. Slightly slows down initial scene load due to multi-pass resolution. Requires strict adherence to the new lifecycle hooks.
