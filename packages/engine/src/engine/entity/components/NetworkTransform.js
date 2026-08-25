import { Component } from '../Component.js';

export class NetworkTransform extends Component {
    constructor(options = {}) {
        super();
        this.id = options.id || null;
        this.owner = options.owner || 'server'; // 'server', or client id string
        this.interpolate = options.interpolate !== undefined ? options.interpolate : true;
        this.syncRate = options.syncRate || 10; // Hz
        this.smoothFactor = options.smoothFactor || 10.0;
        
        // These will be initialized properly depending on 2D/3D in the system
        this.targetPosition = null; 
        this.targetQuaternion = null;
        this.targetRotation = 0;
        
        this._lastSyncTime = 0;
    }
    
    serialize() {
        return {
            id: this.id,
            owner: this.owner,
            interpolate: this.interpolate,
            syncRate: this.syncRate,
            smoothFactor: this.smoothFactor
        };
    }
}
