import { Component } from '../Component.js';

export class NavAgent extends Component {
    constructor() {
        super();
        this.speed = 100;
        this.path = [];
        this.target = null; // {x, y}
        
        this.currentWaypointIndex = 0;
        this.stopDistance = 5;
        this.isMoving = false;
        
        this.walkableTiles = [0]; // Array of tile indices that are walkable
        this.tilemapEntityName = ''; // Optional specific tilemap
        
        this.diagonal = true;
        
        /** @private */
        this._needsPath = false;
        this._repathTimer = 0;
        this.repathInterval = 0.5;
    }

    setDestination(x, y) {
        this.target = { x, y };
        this._needsPath = true;
        this.isMoving = true;
    }

    stop() {
        this.target = null;
        this.path = [];
        this.isMoving = false;
        this._needsPath = false;
    }

    serialize() {
        return {
            speed: this.speed,
            stopDistance: this.stopDistance,
            walkableTiles: this.walkableTiles,
            tilemapEntityName: this.tilemapEntityName,
            diagonal: this.diagonal,
            repathInterval: this.repathInterval
        };
    }

    deserialize(data) {
        if (data.speed !== undefined) this.speed = data.speed;
        if (data.stopDistance !== undefined) this.stopDistance = data.stopDistance;
        if (data.walkableTiles !== undefined) this.walkableTiles = data.walkableTiles;
        if (data.tilemapEntityName !== undefined) this.tilemapEntityName = data.tilemapEntityName;
        if (data.diagonal !== undefined) this.diagonal = data.diagonal;
        if (data.repathInterval !== undefined) this.repathInterval = data.repathInterval;
    }
}
