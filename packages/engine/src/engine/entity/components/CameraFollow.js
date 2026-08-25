import { Component } from '../Component.js';

export class CameraFollow extends Component {
    constructor() {
        super();
        this.lerpSpeed = 5.0;
        this.offsetX = 0;
        this.offsetY = 0;
    }

    serialize() {
        return {
            lerpSpeed: this.lerpSpeed,
            offsetX: this.offsetX,
            offsetY: this.offsetY
        };
    }

    deserialize(data) {
        if (data.lerpSpeed !== undefined) this.lerpSpeed = data.lerpSpeed;
        if (data.offsetX !== undefined) this.offsetX = data.offsetX;
        if (data.offsetY !== undefined) this.offsetY = data.offsetY;
    }
}
