import { Component } from '../Component.js';

export class Tilemap extends Component {
    constructor() {
        super();
        this.cols = 10;
        this.rows = 10;
        this.tileSize = 32;
        this.tileset = null; // Image asset name
        this.data = []; // 1D array
    }

    setTiles(data, cols, rows, tileSize = 32) {
        this.data = data;
        this.cols = cols;
        this.rows = rows;
        this.tileSize = tileSize;
    }
    
    getTile(col, row) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return 0;
        return this.data[row * this.cols + col];
    }
    
    setTile(col, row, index) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
        this.data[row * this.cols + col] = index;
    }

    serialize() {
        return {
            cols: this.cols,
            rows: this.rows,
            tileSize: this.tileSize,
            tileset: this.tileset,
            data: this.data
        };
    }

    deserialize(data) {
        if (data.cols !== undefined) this.cols = data.cols;
        if (data.rows !== undefined) this.rows = data.rows;
        if (data.tileSize !== undefined) this.tileSize = data.tileSize;
        if (data.tileset !== undefined) this.tileset = data.tileset;
        if (data.data !== undefined) this.data = data.data;
    }
}
