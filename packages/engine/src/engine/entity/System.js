export class System {
    constructor() {
        /** @type {import('./ComponentManager.js').ComponentManager} */
        this.manager = null;
    }
    
    // Virtual methods
    fixedUpdate(dt) {}
    update(dt) {}
    render(renderer, camera) {}
}
