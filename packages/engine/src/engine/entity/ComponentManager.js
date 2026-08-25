export class ComponentManager {
    constructor() {
        this.componentsByType = new Map();
        this.systems = [];
    }

    registerSystem(system) {
        this.systems.push(system);
        system.manager = this;
        if (system.init) system.init();
    }

    addComponent(component) {
        const type = component.constructor;
        let arr = this.componentsByType.get(type);
        if (!arr) {
            arr = [];
            this.componentsByType.set(type, arr);
        }
        arr.push(component);
    }

    removeComponent(component) {
        const type = component.constructor;
        let arr = this.componentsByType.get(type);
        if (arr) {
            const idx = arr.indexOf(component);
            if (idx !== -1) {
                const last = arr[arr.length - 1];
                arr[idx] = last;
                arr.pop();
            }
        }
    }

    getComponents(type) {
        return this.componentsByType.get(type) || [];
    }

    // Typical ECS phases
    
    preUpdate(dt) {
        for (let i = 0; i < this.systems.length; i++) {
            if (this.systems[i].preUpdate) this.systems[i].preUpdate(dt);
        }
    }

    fixedUpdate(dt) {
        for (let i = 0; i < this.systems.length; i++) {
            if (this.systems[i].fixedUpdate) this.systems[i].fixedUpdate(dt);
        }
    }

    update(dt) {
        for (let i = 0; i < this.systems.length; i++) {
            if (this.systems[i].update) this.systems[i].update(dt);
        }
    }
    
    render(renderer, camera) {
        for (let i = 0; i < this.systems.length; i++) {
            if (this.systems[i].render) this.systems[i].render(renderer, camera);
        }
    }
}
