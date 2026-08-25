import { Component } from '../Component.js';

export class Lifespan extends Component {
    constructor() {
        super();
        this.duration = 1.0;
        
        /** @private */
        this._timer = 0;
    }

    onStart() {
        this._timer = 0;
    }

    serialize() {
        return {
            duration: this.duration
        };
    }

    deserialize(data) {
        if (data.duration !== undefined) this.duration = data.duration;
    }
}
