import Matter from 'matter-js';
import { Component } from '../entity/Component.js';

/**
 * A component that creates a Matter.js constraint (joint or spring).
 * Can connect this entity's PhysicsBody to another entity's PhysicsBody, or to a fixed point in the world.
 */
export class PhysicsConstraint extends Component {
    constructor(options = {}) {
        super();
        this.init(options);
    }

    init(options = {}) {
        this.options = options;
        this.constraint = null;
        this.targetEntity = options.targetEntity || null;
        this.pointA = options.pointA || { x: 0, y: 0 };
        this.pointB = options.pointB || { x: 0, y: 0 };
        this.stiffness = options.stiffness !== undefined ? options.stiffness : 1;
        this.damping = options.damping !== undefined ? options.damping : 0.1;
        this.length = options.length;
    }

    onAwake() {
        // We delay constraint creation slightly to ensure other entities have had their bodies created
        setTimeout(() => {
            if (this.entity && !this.entity.isDestroyed) {
                this.createConstraint();
            }
        }, 0);
    }
    
    createConstraint() {
        if (this.constraint && this.entity.engine && this.entity.engine.world) {
            Matter.Composite.remove(this.entity.engine.world.physicsWorld, this.constraint);
        }

        let bA = null;
        let bB = null;

        if (this.entity) {
            const pb = this.entity.getComponent('PhysicsBody');
            if (pb) bA = pb.body;
        }

        if (this.targetEntity) {
            const pb = this.targetEntity.getComponent('PhysicsBody');
            if (pb) bB = pb.body;
        }

        const options = {
            pointA: this.pointA,
            pointB: this.pointB,
            stiffness: this.stiffness,
            damping: this.damping,
            ...this.options
        };
        
        if (this.length !== undefined) {
            options.length = this.length;
        }

        if (bA) options.bodyA = bA;
        if (bB) options.bodyB = bB;
        
        // If neither body is specified, Matter constraint treats points as world coordinates.
        // We at least want one body connected.
        if (!bA && !bB && !options.bodyA && !options.bodyB) {
            console.warn("PhysicsConstraint: At least one connected body is required.");
            return;
        }

        this.constraint = Matter.Constraint.create(options);
        
        if (this.entity.engine && this.entity.engine.world) {
            Matter.Composite.add(this.entity.engine.world.physicsWorld, this.constraint);
        }
    }

    onDestroy() {
        if (this.constraint && this.entity.engine && this.entity.engine.world) {
            Matter.Composite.remove(this.entity.engine.world.physicsWorld, this.constraint);
        }
        this.constraint = null;
    }
}
