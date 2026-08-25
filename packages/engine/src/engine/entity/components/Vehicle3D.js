import { Component } from '../Component.js';
import { PhysicsBody3D } from './PhysicsBody3D.js';
import * as CANNON from 'cannon-es';

export class Vehicle3D extends Component {
    constructor(options = {}) {
        super();
        this.chassisMass = options.chassisMass || 1500;
        this.wheelOptions = options.wheelOptions || {
            radius: 0.5,
            directionLocal: new CANNON.Vec3(0, -1, 0),
            suspensionStiffness: 30,
            suspensionRestLength: 0.3,
            frictionSlip: 5,
            dampingRelaxation: 2.3,
            dampingCompression: 4.4,
            maxSuspensionForce: 100000,
            rollInfluence: 0.01,
            axleLocal: new CANNON.Vec3(0, 0, 1),
            chassisConnectionPointLocal: new CANNON.Vec3(1, 1, 0),
            maxSuspensionTravel: 0.3,
            customSlidingRotationalSpeed: -30,
            useCustomSlidingRotationalSpeed: true
        };
        this.vehicle = null;
        this.wheelBodies = [];
        this.wheelVisuals = [];
        this.wheelPositions = options.wheelPositions || [
            new CANNON.Vec3(-1, 0, 1), // front left
            new CANNON.Vec3(-1, 0, -1), // front right
            new CANNON.Vec3(1, 0, 1), // back left
            new CANNON.Vec3(1, 0, -1)  // back right
        ];
    }
    
    onAwake() {
        if(!this.entity.hasComponent(PhysicsBody3D)) {
            this.entity.addComponent(PhysicsBody3D, { mass: this.chassisMass, type: 'box', size: {x: 2, y: 0.5, z: 1} });
        }
    }
    
    onAdd() {
        if (!this.entity || !this.entity.engine || !this.entity.engine.physics3D || !this.entity.engine.physics3D.world) return;
        
        const chassisBody = this.entity.getComponent(PhysicsBody3D).body;
        
        this.vehicle = new CANNON.RaycastVehicle({
            chassisBody: chassisBody,
        });
        
        for(let i=0; i<this.wheelPositions.length; i++) {
            let opts = Object.assign({}, this.wheelOptions);
            opts.chassisConnectionPointLocal = this.wheelPositions[i];
            this.vehicle.addWheel(opts);
        }
        
        this.vehicle.addToWorld(this.entity.engine.physics3D.world);
        
        const physSys = this.entity.world.getSystem('PhysicsSystem3D');
        if (physSys) physSys.addVehicle(this);
    }
    
    updateVehicle(dt) {
        for (let i = 0; i < this.vehicle.wheelInfos.length; i++) {
            this.vehicle.updateWheelTransform(i);
            const t = this.vehicle.wheelInfos[i].worldTransform;
            if (this.wheelVisuals[i]) {
                this.wheelVisuals[i].x = t.position.x;
                this.wheelVisuals[i].y = t.position.y;
                this.wheelVisuals[i].z = t.position.z;
                
                const euler = new CANNON.Vec3();
                t.quaternion.toEuler(euler, 'YXZ');
                this.wheelVisuals[i].rotationX = euler.x;
                this.wheelVisuals[i].rotationY = euler.y;
                this.wheelVisuals[i].rotationZ = euler.z;
            }
        }
    }
    
    setSteeringValue(value, wheelIndex) {
        if (this.vehicle) this.vehicle.setSteeringValue(value, wheelIndex);
    }
    
    applyEngineForce(value, wheelIndex) {
        if (this.vehicle) this.vehicle.applyEngineForce(value, wheelIndex);
    }
    
    setBrake(value, wheelIndex) {
        if (this.vehicle) this.vehicle.setBrake(value, wheelIndex);
    }
    
    onDestroy() {
        if (this.vehicle && this.entity && this.entity.engine && this.entity.engine.physics3D) {
            this.vehicle.removeFromWorld(this.entity.engine.physics3D.world);
        }
        const physSys = this.entity.world.getSystem('PhysicsSystem3D');
        if (physSys) physSys.removeVehicle(this);
    }
}
