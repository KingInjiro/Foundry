import { Component } from '../Component.js';

export class LightSource extends Component {
    constructor() {
        super();
        this.radius = 150;
        this.color = '#ffffff';
        this.intensity = 1.0;
        this.flicker = false;
        this.flickerSpeed = 10;
        this.flickerIntensity = 0.1;
        this.offsetX = 0;
        this.offsetY = 0;
    }

    serialize() {
        return {
            radius: this.radius,
            color: this.color,
            intensity: this.intensity,
            flicker: this.flicker,
            flickerSpeed: this.flickerSpeed,
            flickerIntensity: this.flickerIntensity,
            offsetX: this.offsetX,
            offsetY: this.offsetY
        };
    }

    deserialize(data) {
        if (data.radius !== undefined) this.radius = data.radius;
        if (data.color !== undefined) this.color = data.color;
        if (data.intensity !== undefined) this.intensity = data.intensity;
        if (data.flicker !== undefined) this.flicker = data.flicker;
        if (data.flickerSpeed !== undefined) this.flickerSpeed = data.flickerSpeed;
        if (data.flickerIntensity !== undefined) this.flickerIntensity = data.flickerIntensity;
        if (data.offsetX !== undefined) this.offsetX = data.offsetX;
        if (data.offsetY !== undefined) this.offsetY = data.offsetY;
    }
}
