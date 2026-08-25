import { PhysicsBody3D } from '../components/PhysicsBody3D.js';
import { SoftBody3D } from '../components/SoftBody3D.js';
import * as CANNON from 'cannon-es';

import { System } from '../System.js';

export class PhysicsSystem3D extends System {
    constructor() {
        super();
        this.vehicles = []; // Raycast vehicles
    }
    
    addVehicle(vehicle) {
        this.vehicles.push(vehicle);
    }
    
    removeVehicle(vehicle) {
        const idx = this.vehicles.indexOf(vehicle);
        if (idx !== -1) {
            this.vehicles.splice(idx, 1);
        }
    }
    
    fixedUpdate(dt) {
        if (!this.manager || !this.manager.world) return;
        const world = this.manager.world;
        const entities = world.getEntities();
        for (let i = 0; i < entities.length; i++) {
            const e = entities[i];
            if (!e.active) continue;
            
            const p = e.getComponent(PhysicsBody3D);
            if (p && p.enabled && p.body && !p.isStatic) {
                // Read from body to entity
                e.x = p.body.position.x;
                e.y = p.body.position.y;
                e.z = p.body.position.z;
                
                // Get euler angles from quaternion
                const euler = new CANNON.Vec3();
                p.body.quaternion.toEuler(euler, 'YXZ');
                e.rotationX = euler.x;
                e.rotationY = euler.y;
                e.rotationZ = euler.z;
            } else if (p && p.enabled && p.body && p.isStatic) {
                // Read from entity to body (so moving static platforms works)
                p.body.position.set(e.x, e.y, e.z || 0);
                p.body.quaternion.setFromEuler(e.rotationX || 0, e.rotationY || 0, e.rotationZ || 0, 'YXZ');
            }
            
            // Soft body sync
            const soft = e.getComponent(SoftBody3D);
            if (soft && soft.enabled) {
                soft.updateVisuals();
            }
        }
        
        // Update vehicles
        for(let i=0; i<this.vehicles.length; i++) {
            const default_dt = (world.physicsWorld3D && world.physicsWorld3D.default_dt) ? world.physicsWorld3D.default_dt : (1/60);
            this.vehicles[i].updateVehicle(default_dt);
        }
    }
}
