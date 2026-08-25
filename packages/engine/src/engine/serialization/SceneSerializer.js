import { DefaultTypeRegistry } from '../core/TypeRegistry.js';

export class SceneSerializer {
    /**
     * Serializes all root entities in the world to a JSON string.
     * @param {import('../world/World.js').World} world 
     * @returns {string} JSON string representing the scene
     */
    static serialize(world) {
        const scene = {
            version: 1,
            type: "Scene",
            entities: []
        };
        
        const activeEntities = world.entities.entities;
        for (let i = 0; i < activeEntities.length; i++) {
            const entity = activeEntities[i];
            if (!entity.parent && !entity.isDestroyed) { // Only serialize root entities
                scene.entities.push(entity.serialize());
            }
        }
        
        return JSON.stringify(scene, null, 2);
    }

    /**
     * Deserializes a JSON string or object and populates the world.
     * Uses a multi-pass approach to handle references.
     * @param {string|Object} data 
     * @param {import('../world/World.js').World} world 
     * @param {import('../core/TypeRegistry.js').TypeRegistry} [registry=DefaultTypeRegistry]
     */
    static deserialize(data, world, registry = DefaultTypeRegistry) {
        const sceneData = typeof data === 'string' ? JSON.parse(data) : data;
        
        world.clear();
        const entityLookup = new Map();
        const componentLookup = new Map();
        const allEntities = [];
        
        // Pass 1: Instantiation (Create all entities without components or children structure yet)
        // We'll flatten the hierarchy for instantiation, then reconstruct it.
        const flattenData = (entData) => {
            const flat = [entData];
            if (entData.children) {
                for (const childData of entData.children) {
                    flat.push(...flattenData(childData));
                }
            }
            return flat;
        };

        const rootDataNodes = sceneData.entities || [];
        let allDataNodes = [];
        for (const rootNode of rootDataNodes) {
            allDataNodes.push(...flattenData(rootNode));
        }

        // Pass 1: Create Entities
        for (const entData of allDataNodes) {
            const entity = registry.createEntity(entData.class);
            if (entity) {
                // Restore basic properties
                entity.id = entData.id || entity.id;
                entity.tag = entData.tag !== undefined ? entData.tag : entity.tag;
                entity.layer = entData.layer !== undefined ? entData.layer : entity.layer;
                entity.x = entData.x !== undefined ? entData.x : entity.x;
                entity.y = entData.y !== undefined ? entData.y : entity.y;
                entity.z = entData.z !== undefined ? entData.z : entity.z;
                entity.rotation = entData.rotation !== undefined ? entData.rotation : entity.rotation;
                entity.scaleX = entData.scaleX !== undefined ? entData.scaleX : entity.scaleX;
                entity.scaleY = entData.scaleY !== undefined ? entData.scaleY : entity.scaleY;
                entity.active = entData.active !== undefined ? entData.active : entity.active;
                entity.visible = entData.visible !== undefined ? entData.visible : entity.visible;
                entity.isStatic = entData.isStatic !== undefined ? entData.isStatic : entity.isStatic;
                
                if (entity.deserializeData) {
                    entity.deserializeData(entData);
                }
                
                entityLookup.set(entity.id, entity);
                allEntities.push({ entity, data: entData });
            } else {
                console.warn(`[SceneSerializer] Missing Entity class: ${entData.class}. Skipping.`);
            }
        }

        // Pass 2: Components (Data Hydration)
        for (const { entity, data } of allEntities) {
            // Keep track of which pre-existing components we've already matched
            const matchedComponents = new Set();
            
            if (data.components) {
                for (const compData of data.components) {
                    // Try to find a matching component that was created by the constructor
                    let comp = null;
                    for (const existingComp of entity.components) {
                        if (existingComp.constructor.name === compData.class && !matchedComponents.has(existingComp)) {
                            comp = existingComp;
                            matchedComponents.add(existingComp);
                            break;
                        }
                    }

                    // If not found, instantiate a new one
                    let isNew = false;
                    if (!comp) {
                        comp = registry.createComponent(compData.class);
                        isNew = true;
                    }

                    if (comp) {
                        comp.id = compData.id || comp.id;
                        comp.enabled = compData.enabled !== undefined ? compData.enabled : true;
                        componentLookup.set(comp.id, comp);
                        
                        // Hydrate component data
                        if (comp.deserialize) {
                            comp.deserialize(compData.data);
                        } else if (compData.data) {
                            Object.assign(comp, compData.data);
                        }
                        
                        if (isNew) {
                            entity.addComponent(comp);
                        }
                    } else {
                        console.warn(`[SceneSerializer] Missing Component class: ${compData.class} on Entity (id: ${entity.id}). Skipping.`);
                    }
                }
            }
        }

        // Pass 3: Hierarchy & Reference Resolution
        for (const { entity, data } of allEntities) {
            // Reconstruct children
            if (data.children) {
                for (const childData of data.children) {
                    if (childData.id) {
                        const child = entityLookup.get(childData.id);
                        if (child) {
                            entity.addChild(child);
                        }
                    }
                }
            }

            // Optional: Component reference resolution
            for (const comp of entity.components) {
                // Auto-resolve entity and component references
                for (const key in comp) {
                    const val = comp[key];
                    if (val && typeof val === 'object') {
                        if (val.$ref) {
                            comp[key] = entityLookup.get(val.$ref) || null;
                        } else if (val.$refComp) {
                                                        comp[key] = componentLookup.get(val.$refComp) || null;
                        } else if (Array.isArray(val)) {
                            for (let i = 0; i < val.length; i++) {
                                if (val[i] && typeof val[i] === 'object') {
                                    if (val[i].$ref) {
                                        val[i] = entityLookup.get(val[i].$ref) || null;
                                    } else if (val[i].$refComp) {
                                        val[i] = componentLookup.get(val[i].$refComp) || null;
                                    }
                                }
                            }
                        }
                    }
                }
                
                if (comp.onResolveReferences) {
                    comp.onResolveReferences(entityLookup);
                }
            }
            if (entity.onResolveReferences) {
                entity.onResolveReferences(entityLookup);
            }
        }

        // Pass 4: onAfterDeserialize
        for (const { entity } of allEntities) {
            if (entity.onAfterDeserialize) {
                entity.onAfterDeserialize();
            }
            for (const comp of entity.components) {
                if (comp.onAfterDeserialize) {
                    comp.onAfterDeserialize();
                }
            }
        }

        // Pass 5: Add root entities to world (this will trigger onSpawn down the hierarchy)
        for (const { entity } of allEntities) {
            if (!entity.parent) {
                world.add(entity);
            }
        }
    }

    /**
     * Deserializes a single prefab entity and its children into the world.
     * @param {Object} rootData 
     * @param {import('../world/World.js').World} world 
     * @param {import('../core/TypeRegistry.js').TypeRegistry} [registry=DefaultTypeRegistry]
     * @returns {import('../entity/Entity.js').Entity|null}
     */
    static deserializePrefab(rootData, world, registry = DefaultTypeRegistry) {
        const entityLookup = new Map();
        const componentLookup = new Map();
        const allEntities = [];
        
        const flattenData = (entData) => {
            const flat = [entData];
            if (entData.children) {
                for (const childData of entData.children) {
                    flat.push(...flattenData(childData));
                }
            }
            return flat;
        };
        
        const allDataNodes = flattenData(rootData);
        
        for (const entData of allDataNodes) {
            const entity = registry.createEntity(entData.class);
            if (entity) {
                entity.id = entData.id || entity.id;
                entity.tag = entData.tag !== undefined ? entData.tag : entity.tag;
                entity.layer = entData.layer !== undefined ? entData.layer : entity.layer;
                entity.x = entData.x !== undefined ? entData.x : entity.x;
                entity.y = entData.y !== undefined ? entData.y : entity.y;
                entity.z = entData.z !== undefined ? entData.z : entity.z;
                entity.rotation = entData.rotation !== undefined ? entData.rotation : entity.rotation;
                entity.scaleX = entData.scaleX !== undefined ? entData.scaleX : entity.scaleX;
                entity.scaleY = entData.scaleY !== undefined ? entData.scaleY : entity.scaleY;
                entity.active = entData.active !== undefined ? entData.active : entity.active;
                entity.visible = entData.visible !== undefined ? entData.visible : entity.visible;
                entity.isStatic = entData.isStatic !== undefined ? entData.isStatic : entity.isStatic;
                
                if (entity.deserializeData) {
                    entity.deserializeData(entData);
                }
                
                entityLookup.set(entity.id, entity);
                allEntities.push({ entity, data: entData });
            }
        }
        
        for (const { entity, data } of allEntities) {
            const matchedComponents = new Set();
            if (data.components) {
                for (const compData of data.components) {
                    let comp = null;
                    for (const existingComp of entity.components) {
                        if (existingComp.constructor.name === compData.class && !matchedComponents.has(existingComp)) {
                            comp = existingComp;
                            matchedComponents.add(existingComp);
                            break;
                        }
                    }
                    let isNew = false;
                    if (!comp) {
                        comp = registry.createComponent(compData.class);
                        isNew = true;
                    }
                    if (comp) {
                        comp.id = compData.id || comp.id;
                        comp.enabled = compData.enabled !== undefined ? compData.enabled : true;
                                                componentLookup.set(comp.id, comp);
                        
                        if (comp.deserialize) {
                            comp.deserialize(compData.data);
                        } else if (compData.data) {
                            Object.assign(comp, compData.data);
                        }
                        
                        if (isNew) {
                            entity.addComponent(comp);
                        }
                    }
                }
            }
        }
        
        for (const { entity, data } of allEntities) {
            if (data.children) {
                for (const childData of data.children) {
                    if (childData.id) {
                        const child = entityLookup.get(childData.id);
                        if (child) {
                            entity.addChild(child);
                        }
                    }
                }
            }
            for (const comp of entity.components) {
                // Auto-resolve entity and component references
                for (const key in comp) {
                    const val = comp[key];
                    if (val && typeof val === 'object') {
                        if (val.$ref) {
                            comp[key] = entityLookup.get(val.$ref) || null;
                        } else if (val.$refComp) {
                            comp[key] = componentLookup.get(val.$refComp) || null;
                        } else if (Array.isArray(val)) {
                            for (let i = 0; i < val.length; i++) {
                                if (val[i] && typeof val[i] === 'object') {
                                    if (val[i].$ref) {
                                        val[i] = entityLookup.get(val[i].$ref) || null;
                                    } else if (val[i].$refComp) {
                                        val[i] = componentLookup.get(val[i].$refComp) || null;
                                    }
                                }
                            }
                        }
                    }
                }
                
                if (comp.onResolveReferences) {
                    comp.onResolveReferences(entityLookup);
                }
            }
            if (entity.onResolveReferences) {
                entity.onResolveReferences(entityLookup);
            }
        }
        
        for (const { entity } of allEntities) {
            if (entity.onAfterDeserialize) {
                entity.onAfterDeserialize();
            }
            for (const comp of entity.components) {
                if (comp.onAfterDeserialize) {
                    comp.onAfterDeserialize();
                }
            }
        }
        
        for (const { entity } of allEntities) {
            if (!entity.parent) {
                world.add(entity);
            }
        }
        
        return entityLookup.get(rootData.id) || null;
    }
}
