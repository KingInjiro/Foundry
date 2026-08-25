import { Component } from '../Component.js';

export class ShapeRenderer extends Component {
    constructor(options = {}) {
        super();
        this.shape = 'rectangle'; // 'rectangle', 'circle', 'polygon', 'line'
        this.width = 64;
        this.height = 64;
        this.radius = 32;
        
        // Colors
        this.fillStyle = '#ffffff';
        this.strokeStyle = ''; // Empty means no stroke
        this.lineWidth = 1;
        
        // Polygons / Lines
        this.vertices = []; // Array of {x,y}
        this.endX = 0;
        this.endY = 0;
        
        this.init(options);
    }

    init(options = {}) {
        if (options.shape !== undefined) this.shape = options.shape;
        if (options.width !== undefined) this.width = options.width;
        if (options.height !== undefined) this.height = options.height;
        if (options.radius !== undefined) this.radius = options.radius;
        if (options.fillStyle !== undefined) this.fillStyle = options.fillStyle;
        if (options.strokeStyle !== undefined) this.strokeStyle = options.strokeStyle;
        if (options.lineWidth !== undefined) this.lineWidth = options.lineWidth;
        if (options.vertices !== undefined) this.vertices = [...options.vertices];
        if (options.endX !== undefined) this.endX = options.endX;
        if (options.endY !== undefined) this.endY = options.endY;
    }

    serialize() {
        return {
            shape: this.shape,
            width: this.width,
            height: this.height,
            radius: this.radius,
            fillStyle: this.fillStyle,
            strokeStyle: this.strokeStyle,
            lineWidth: this.lineWidth,
            vertices: this.vertices,
            endX: this.endX,
            endY: this.endY
        };
    }

    deserialize(data) {
        this.init(data);
    }
}
