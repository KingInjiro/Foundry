import { Utils } from '../core/Utils.js';

/**
 * Base class for all Components that can be attached to Entities.
 * Mirrors Unity's MonoBehaviour structure.
 */
export class Component {
    constructor() {
        this.id = Utils.generateUUID();
        /** @type {import('./Entity.js').Entity} */
        this.entity = null;
        this.enabled = true;
    }

    /** 
     * Called when the component is retrieved from a pool or created. 
     * Use this instead of constructor for runtime values.
     */
    init(...args) {}

    /** Called when the component is added to an entity that is in the world, or when the entity is added to the world. */
    onAwake() {}
    
    /** Called before the first update. */
    onStart() {}

    /** Called every frame. */
    onUpdate(dt) {}

    /** Called every fixed physics frame. */
    onFixedUpdate(fixedDelta) {}

    /** Called when rendering. */
    onRender(renderer, camera) {}

    /** Called when component is removed or entity destroyed. */
    onDestroy() {}
}
