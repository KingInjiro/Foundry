import Matter from 'matter-js';
import { Component } from '../entity/Component.js';

export class SoftBody extends Component {
    constructor(options = {}) {
        super();
        this.init(options);
    }
    init(options = {}) {
        this.options = options;
        this.composite = null;
        this.columns = options.columns || 5;
        this.rows = options.rows || 5;
        this.columnGap = options.columnGap || 10;
        this.rowGap = options.rowGap || 10;
        this.crossStiffness = options.crossStiffness !== undefined ? options.crossStiffness : 0.9;
        this.friction = options.friction || 0.1;
        this.restitution = options.restitution || 0.9;
        this.particleRadius = options.particleRadius || 5;
        this.color = options.color || '#00ffcc';
    }
    
    onAwake() {
        if (!this.entity || !this.entity.engine || !this.entity.engine.world) return;
        
        // Offset to center
        const startX = this.entity.x - (this.columns * (this.particleRadius*2 + this.columnGap))/2;
        const startY = this.entity.y - (this.rows * (this.particleRadius*2 + this.rowGap))/2;

        this.composite = Matter.Composites.softBody(
            startX, startY,
            this.columns, this.rows,
            this.columnGap, this.rowGap,
            this.crossStiffness,
            this.particleRadius,
            {
                friction: this.friction,
                restitution: this.restitution,
                render: { fillStyle: this.color }
            }
        );

        Matter.Composite.add(this.entity.engine.world.physicsWorld, this.composite);
    }

    onDestroy() {
        if (this.composite && this.entity && this.entity.engine && this.entity.engine.world) {
            Matter.Composite.remove(this.entity.engine.world.physicsWorld, this.composite);
        }
        this.composite = null;
    }
}
