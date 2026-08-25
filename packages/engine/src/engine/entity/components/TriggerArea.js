import { Component } from '../Component.js';

export class TriggerArea extends Component {
    constructor() {
        super();
        this.radius = 50;
        this.targetTag = '';
        this.eventName = 'TriggerEnter';
        this.triggerOnce = false;
        
        /** @private */
        this._hasTriggered = false;
        /** @private */
        this._entitiesInRange = new Set();
    }
    
    serialize() {
        return {
            radius: this.radius,
            targetTag: this.targetTag,
            eventName: this.eventName,
            triggerOnce: this.triggerOnce
        };
    }

    deserialize(data) {
        if (data.radius !== undefined) this.radius = data.radius;
        if (data.targetTag !== undefined) this.targetTag = data.targetTag;
        if (data.eventName !== undefined) this.eventName = data.eventName;
        if (data.triggerOnce !== undefined) this.triggerOnce = data.triggerOnce;
    }
}
