export class Scene {
    constructor() {
        /** @type {import('../core/Engine.js').Engine} */
        this.engine = null;
    }
    
    /**
     * Called when the scene is loaded.
     * @param {import('../world/World.js').World} world
     */
    onLoad(world) {}
    
    /**
     * Called before the scene is unloaded.
     */
    onUnload() {}
    
    /**
     * Called every frame after the world update.
     */
    onUpdate(dt) {}
    
    /**
     * Called during rendering after the world renders.
     */
    onRender(renderer, camera) {}
}
