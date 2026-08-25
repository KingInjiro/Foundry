export class SceneManager {
    /**
     * @param {import('./Engine.js').Engine} engine
     */
    constructor(engine) {
        this.engine = engine;
        this.scenes = new Map();
        /** @type {import('./Scene.js').Scene} */
        this.currentScene = null;
    }

    /**
     * Registers a scene with the manager.
     * @param {string} name 
     * @param {typeof import('./Scene.js').Scene} SceneClass 
     */
    add(name, SceneClass) {
        this.scenes.set(name, SceneClass);
    }

    /**
     * Loads a registered scene.
     * @param {string} name 
     */
    load(name) {
        if (!this.scenes.has(name)) {
            console.error(`Scene not found: ${name}`);
            return;
        }

        if (this.currentScene) {
            this.currentScene.onUnload();
        }

        this.engine.world.clear();
        this.engine.tweens.clear();
        this.engine.timers.clear();
        this.engine.scheduler.resetRegistry();
        
        const SceneClass = this.scenes.get(name);
        this.currentScene = new SceneClass();
        this.currentScene.engine = this.engine;
        this.currentScene.onLoad(this.engine.world);
    }
}
