export class State {
    constructor(stateMachine) {
        this.sm = stateMachine;
        this.entity = stateMachine.entity;
    }
    
    enter() {}
    update(dt) {}
    exit() {}
}

export class StateMachine {
    constructor(entity) {
        this.entity = entity;
        this.states = {};
        this.currentState = null;
        this.currentStateName = null;
    }
    
    addState(name, stateClass) {
        this.states[name] = new stateClass(this);
    }
    
    changeState(name) {
        if (!this.states[name] || this.currentStateName === name) return;
        
        if (this.currentState) {
            this.currentState.exit();
        }
        
        this.currentStateName = name;
        this.currentState = this.states[name];
        this.currentState.enter();
    }
    
    update(dt) {
        if (this.currentState) {
            this.currentState.update(dt);
        }
    }
}
