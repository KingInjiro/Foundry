import { Component } from '../Component.js';

export class AudioSource extends Component {
    constructor() {
        super();
        this.soundName = '';
        this.volume = 1.0;
        this.loop = false;
        this.playOnAwake = false;
        this.spatial = true;
        this.maxDistance = 1000;
        
        /** @private */
        this._instance = null;
        this.playing = false;
    }

    onStart() {
        if (this.playOnAwake && this.soundName) {
            this.play();
        }
    }

    play() {
        if (!this.soundName || !this.entity || !this.entity.engine) return;
        this.stop();
        
        let x = this.entity.globalX || 0;
        let y = this.entity.globalY || 0;
        let z = this.entity.globalZ || 0;
        
        this._instance = this.entity.engine.audio.playSound(this.soundName, this.volume, {
            spatial: this.spatial,
            maxDistance: this.maxDistance,
            x: x,
            y: y,
            z: z
        });
        this.playing = true;
        
        if (this._instance && this._instance.source) {
            this._instance.source.loop = this.loop;
        }
    }

    stop() {
        if (this._instance) {
            this._instance.stop();
            this._instance = null;
        }
        this.playing = false;
    }

    setVolume(v) {
        this.volume = v;
        if (this._instance && this._instance.setVolume) {
            this._instance.setVolume(v);
        }
    }
    
    onDestroy() {
        this.stop();
    }

    serialize() {
        return {
            soundName: this.soundName,
            volume: this.volume,
            loop: this.loop,
            playOnAwake: this.playOnAwake,
            spatial: this.spatial,
            maxDistance: this.maxDistance
        };
    }

    deserialize(data) {
        if (data.soundName !== undefined) this.soundName = data.soundName;
        if (data.volume !== undefined) this.volume = data.volume;
        if (data.loop !== undefined) this.loop = data.loop;
        if (data.playOnAwake !== undefined) this.playOnAwake = data.playOnAwake;
        if (data.spatial !== undefined) this.spatial = data.spatial;
        if (data.maxDistance !== undefined) this.maxDistance = data.maxDistance;
    }
}
