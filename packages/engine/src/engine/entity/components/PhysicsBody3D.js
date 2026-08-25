import { Component } from '../Component.js';
import * as CANNON from 'cannon-es';

export class PhysicsBody3D extends Component {
    constructor(options = {}) {
        super();
        this.mass = options.mass !== undefined ? options.mass : 1;
        this.shapeType = options.shapeType || 'box'; // 'box', 'sphere'
        this.size = options.size || [1, 1, 1]; // for box: width, height, depth. for sphere: radius
        
        this.isStatic = options.isStatic || false;
        if (this.isStatic) this.mass = 0;
        
        this.restitution = options.restitution !== undefined ? options.restitution : 0.2;
        this.friction = options.friction !== undefined ? options.friction : 0.3;
        this.fixedRotation = options.fixedRotation || false;
        this.linearDamping = options.linearDamping !== undefined ? options.linearDamping : 0.01;
        this.angularDamping = options.angularDamping !== undefined ? options.angularDamping : 0.01;
        
        this.body = null;
    }
    
    onAdd() {
        if (!this.entity || !this.entity.world) return;
        this.createBody();
    }
    
    createBody() {
        if (this.body) {
            this.entity.world.physicsWorld3D.removeBody(this.body);
        }
        
        let shape;
        if (this.shapeType === 'sphere') {
            shape = new CANNON.Sphere(this.size[0] || this.size);
        } else {
            // box (CANNON.Box takes half-extents)
            const hx = (this.size[0] !== undefined ? this.size[0] : this.size.x || 1) / 2;
            const hy = (this.size[1] !== undefined ? this.size[1] : this.size.y || 1) / 2;
            const hz = (this.size[2] !== undefined ? this.size[2] : this.size.z || 1) / 2;
            shape = new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
        }
        
        const scaleX = this.entity.scaleX || 1;
        const scaleY = this.entity.scaleY || 1;
        const scaleZ = this.entity.scaleZ || 1;
        
        // Adjust shape for scale
        if (this.shapeType === 'box') {
            shape.halfExtents.x *= scaleX;
            shape.halfExtents.y *= scaleY;
            shape.halfExtents.z *= scaleZ;
            shape.updateConvexPolyhedronRepresentation();
            shape.updateBoundingSphereRadius();
        } else if (this.shapeType === 'sphere') {
            shape.radius *= Math.max(scaleX, scaleY, scaleZ);
            shape.updateBoundingSphereRadius();
        }

        const material = new CANNON.Material();
        material.restitution = this.restitution;
        material.friction = this.friction;

        this.body = new CANNON.Body({
            mass: this.isStatic ? 0 : this.mass,
            shape: shape,
            position: new CANNON.Vec3(this.entity.x, this.entity.y, this.entity.z || 0),
            material: material,
            fixedRotation: this.fixedRotation,
            linearDamping: this.linearDamping,
            angularDamping: this.angularDamping
        });
        
        // Convert Euler rotation to Quaternion
        const euler = new CANNON.Vec3(this.entity.rotationX || 0, this.entity.rotationY || 0, this.entity.rotationZ || 0);
        this.body.quaternion.setFromEuler(euler.x, euler.y, euler.z, 'YXZ');

        this.entity.world.physicsWorld3D.addBody(this.body);
    }
    
    serialize() {
        return {
            mass: this.mass,
            shapeType: this.shapeType,
            size: this.size,
            isStatic: this.isStatic,
            restitution: this.restitution,
            friction: this.friction,
            fixedRotation: this.fixedRotation,
            linearDamping: this.linearDamping,
            angularDamping: this.angularDamping
        };
    }

    onDestroy() {
        if (this.body && this.entity && this.entity.world) {
            this.entity.world.physicsWorld3D.removeBody(this.body);
        }
    }
}
