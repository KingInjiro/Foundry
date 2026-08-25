import { Component } from '../Component.js';

export class ParticleEmitter extends Component {
    constructor() {
        super();
        this.rate = 10; // particles per second
        this.accumulator = 0;
        this.config = {
            life: [0.5, 1.5],
            startSize: [5, 10],
            endSize: [0, 2],
            speed: [50, 150],
            angle: [0, Math.PI * 2],
            startColor: { r: 255, g: 255, b: 255, a: 1 },
            endColor: { r: 255, g: 255, b: 255, a: 0 }
        };
        this.playing = true;
    }

    serialize() {
        return {
            rate: this.rate,
            config: this.config,
            playing: this.playing
        };
    }

    deserialize(data) {
        if (data.rate !== undefined) this.rate = data.rate;
        if (data.config !== undefined) this.config = data.config;
        if (data.playing !== undefined) this.playing = data.playing;
    }
}
