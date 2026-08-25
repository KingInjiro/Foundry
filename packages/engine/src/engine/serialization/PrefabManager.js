import { SceneSerializer } from './SceneSerializer.js';
import { DefaultTypeRegistry } from '../core/TypeRegistry.js';
import { Utils } from '../core/Utils.js';

export class PrefabManager {
    /**
     * @param {import('../core/Engine.js').Engine} engine 
     */
    constructor(engine) {
        this.engine = engine;
        this.prefabs = new Map();
    }

    /**
     * Registers a prefab from a JSON object or string.
     * @param {string} name 
     * @param {Object|string} prefabData 
     */
    register(name, prefabData) {
        const data = typeof prefabData === 'string' ? JSON.parse(prefabData) : prefabData;
        this.prefabs.set(name, data);
    }

    /**
     * Instantiates a prefab into the world.
     * @param {string} name 
     * @param {number} x 
     * @param {number} y 
     * @param {import('../core/TypeRegistry.js').TypeRegistry} [registry=DefaultTypeRegistry]
     * @returns {import('../entity/Entity.js').Entity|null}
     */
    instantiate(name, x = 0, y = 0, registry = DefaultTypeRegistry) {
        const data = this.prefabs.get(name);
        if (!data) {
            console.warn("Prefab not found:", name);
            return null;
        }

        const world = this.engine.world;
        
        // Deep copy data to avoid mutating prefab
        const instanceData = JSON.parse(JSON.stringify(data));
        
        // Regenerate IDs
        const oldToNew = new Map();
        const regenerateIds = (node) => {
            const newId = Utils.generateUUID();
            oldToNew.set(node.id, newId);
            node.id = newId;
            if (node.children) {
                node.children.forEach(regenerateIds);
            }
        };
        regenerateIds(instanceData);
        
        // Update component references to the new IDs if needed, 
        // this can be done if components store entity IDs, but usually SceneSerializer 
        // passes a lookup map to onResolveReferences.
        
        // Override position for the root
        instanceData.x = x;
        instanceData.y = y;
        
        // Create a dummy scene to deserialize into
        const sceneData = {
            version: 1,
            type: "Scene",
            entities: [instanceData]
        };
        
        // Track entities added by taking a snapshot of pendingAdd size before and after
        const beforeCount = world.entities.pendingAdd.length;
        
        // Actually, SceneSerializer clears the world! 
        // We shouldn't use SceneSerializer.deserialize directly on the main world for a prefab.
        // We should add a new method to SceneSerializer: deserializePrefab
        // Or we can just reuse the pass logic here, but let's implement it inside SceneSerializer.
        return SceneSerializer.deserializePrefab(instanceData, world, registry);
    }

    /**
     * Creates a prefab data object from an existing entity.
     * @param {import('../entity/Entity.js').Entity} entity 
     * @returns {Object}
     */
    createFromEntity(entity) {
        const data = entity.serialize();
        // Reset absolute coordinates for a generic prefab
        data.x = 0;
        data.y = 0;
        return data;
    }
}
