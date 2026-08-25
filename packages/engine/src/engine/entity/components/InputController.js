import { Component } from '../Component.js';
import { PhysicsBody } from '../../physics/PhysicsBody.js';

export class InputController extends Component {
    constructor() {
        super();
        this.speed = 200;
        this.jumpForce = 0.05;
        this.horizontalAxis = 'Horizontal';
        this.verticalAxis = 'Vertical';
        this.jumpAction = 'Space';
        
        // Settings for platformer vs top-down
        this.isTopDown = true;
    }

    serialize() {
        return {
            speed: this.speed,
            jumpForce: this.jumpForce,
            horizontalAxis: this.horizontalAxis,
            verticalAxis: this.verticalAxis,
            jumpAction: this.jumpAction,
            isTopDown: this.isTopDown
        };
    }

    deserialize(data) {
        if (data.speed !== undefined) this.speed = data.speed;
        if (data.jumpForce !== undefined) this.jumpForce = data.jumpForce;
        if (data.horizontalAxis !== undefined) this.horizontalAxis = data.horizontalAxis;
        if (data.verticalAxis !== undefined) this.verticalAxis = data.verticalAxis;
        if (data.jumpAction !== undefined) this.jumpAction = data.jumpAction;
        if (data.isTopDown !== undefined) this.isTopDown = data.isTopDown;
    }
}
