export class State {
    constructor(machine) {
        this.machine = machine;
    }
    enter(previousState) {}
    update(dt) {}
    exit(nextState) {}
}

export class StateMachine {
    constructor(context) {
        this.context = context;
        this.states = new Map();
        this.currentState = null;
        this.currentStateName = null;
    }

    add(name, stateClass) {
        this.states.set(name, stateClass);
        return this;
    }

    change(name, ...args) {
        if (!this.states.has(name)) {
            console.warn(`State '${name}' not found.`);
            return false;
        }

        const previousStateName = this.currentStateName;
        
        if (this.currentState) {
            this.currentState.exit(name);
        }

        this.currentStateName = name;
        const StateClass = this.states.get(name);
        this.currentState = new StateClass(this, ...args);
        
        this.currentState.enter(previousStateName);
        return true;
    }

    update(dt) {
        if (this.currentState) {
            this.currentState.update(dt);
        }
    }
}
