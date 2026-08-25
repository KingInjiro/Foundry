import { Component } from '../Component.js';
import * as CANNON from 'cannon-es';
import { PhysicsBody3D } from './PhysicsBody3D.js';

export class PhysicsConstraint3D extends Component {
    constructor(options = {}) {
        super();
        this.type = options.type || 'hinge'; // 'hinge', 'pointToPoint', 'distance', 'lock', 'coneTwist'
        this.targetEntityId = options.targetEntityId || null;
        
        this.pivotA = options.pivotA || { x: 0, y: 0, z: 0 };
        this.pivotB = options.pivotB || { x: 0, y: 0, z: 0 };
        this.axisA = options.axisA || { x: 1, y: 0, z: 0 };
        this.axisB = options.axisB || { x: 1, y: 0, z: 0 };
        
        this.distance = options.distance !== undefined ? options.distance : null; // For distance constraint
        
        // ConeTwist specifics
        this.angle = options.angle !== undefined ? options.angle : Math.PI / 4;
        this.twistAngle = options.twistAngle !== undefined ? options.twistAngle : Math.PI / 4;
        
        this.maxForce = options.maxForce !== undefined ? options.maxForce : 1e6;
        
        this.constraint = null;
    }
    
    onAwake() {
        if (!this.entity || !this.entity.world) return;
        this.createConstraint();
    }
    
    createConstraint() {
        if (this.constraint) {
            this.entity.world.physicsWorld3D.removeConstraint(this.constraint);
            this.constraint = null;
        }
        
        if (!this.targetEntityId) return;
        
        const myBodyComp = this.entity.getComponent(PhysicsBody3D);
        if (!myBodyComp || !myBodyComp.body) return;
        
        const targetEntity = this.entity.world.getEntityById(this.targetEntityId);
        if (!targetEntity) return;
        
        const targetBodyComp = targetEntity.getComponent(PhysicsBody3D);
        if (!targetBodyComp || !targetBodyComp.body) return;
        
        const bodyA = myBodyComp.body;
        const bodyB = targetBodyComp.body;
        
        const pivotA = new CANNON.Vec3(this.pivotA.x, this.pivotA.y, this.pivotA.z);
        const pivotB = new CANNON.Vec3(this.pivotB.x, this.pivotB.y, this.pivotB.z);
        
        if (this.type === 'pointToPoint') {
            this.constraint = new CANNON.PointToPointConstraint(bodyA, pivotA, bodyB, pivotB, this.maxForce);
        } else if (this.type === 'hinge') {
            const axisA = new CANNON.Vec3(this.axisA.x, this.axisA.y, this.axisA.z);
            const axisB = new CANNON.Vec3(this.axisB.x, this.axisB.y, this.axisB.z);
            this.constraint = new CANNON.HingeConstraint(bodyA, bodyB, {
                pivotA: pivotA,
                pivotB: pivotB,
                axisA: axisA,
                axisB: axisB,
                maxForce: this.maxForce
            });
        } else if (this.type === 'distance') {
            let dist = this.distance;
            if (dist === null) {
                // Calculate distance based on current positions
                dist = bodyA.position.distanceTo(bodyB.position);
            }
            this.constraint = new CANNON.DistanceConstraint(bodyA, bodyB, dist, this.maxForce);
        } else if (this.type === 'lock') {
            this.constraint = new CANNON.LockConstraint(bodyA, bodyB, { maxForce: this.maxForce });
        } else if (this.type === 'coneTwist') {
            const axisA = new CANNON.Vec3(this.axisA.x, this.axisA.y, this.axisA.z);
            const axisB = new CANNON.Vec3(this.axisB.x, this.axisB.y, this.axisB.z);
            this.constraint = new CANNON.ConeTwistConstraint(bodyA, bodyB, {
                pivotA: pivotA,
                pivotB: pivotB,
                axisA: axisA,
                axisB: axisB,
                angle: this.angle,
                twistAngle: this.twistAngle,
                maxForce: this.maxForce
            });
        }
        
        if (this.constraint) {
            this.entity.world.physicsWorld3D.addConstraint(this.constraint);
        }
    }
    
    onDestroy() {
        if (this.constraint && this.entity && this.entity.world && this.entity.world.physicsWorld3D) {
            this.entity.world.physicsWorld3D.removeConstraint(this.constraint);
            this.constraint = null;
        }
    }
}
