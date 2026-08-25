import { Component } from '../Component.js';
import { StateMachine } from '../../simulation/StateMachine.js';

export class FSM extends Component {
    constructor() {
        super();
        this.machine = null;
    }

    onAdd() {
        this.machine = new StateMachine(this.entity);
    }

    addState(name, stateClass) {
        if (this.machine) this.machine.addState(name, stateClass);
    }

    changeState(name) {
        if (this.machine) this.machine.changeState(name);
    }

    update(dt) {
        if (this.machine) this.machine.update(dt);
    }
}
