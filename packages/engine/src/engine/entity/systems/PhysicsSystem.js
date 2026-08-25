import { System } from '../System.js';
import { PhysicsBody } from '../../physics/PhysicsBody.js';

export class PhysicsSystem extends System {
    preUpdate(dt) {
        const bodies = this.manager.getComponents(PhysicsBody);
        
        for (let i = 0; i < bodies.length; i++) {
            const comp = bodies[i];
            if (!comp.enabled || !comp.body || !comp.entity || comp.entity.isDestroyed) continue; 
            
            const e = comp.entity;
            const transform = e.transform;
            
            if (transform.positionDirty) {
                comp.setPosition(e.x, e.y);
                transform.positionDirty = false;
            }
            if (transform.rotationDirty) {
                comp.setAngle(e.rotation);
                transform.rotationDirty = false;
            }
            if (e.velocityDirty) {
                comp.setVelocity(e.vx || 0, e.vy || 0);
                e.velocityDirty = false;
            }
        }
    }

    fixedUpdate(dt) {
        const bodies = this.manager.getComponents(PhysicsBody);
        
        for (let i = 0; i < bodies.length; i++) {
            const comp = bodies[i];
            if (!comp.enabled || !comp.body || !comp.entity || comp.entity.isDestroyed) continue; 
            
            const e = comp.entity;
            const transform = e.transform;
            
            if (!comp.isStatic) {
                const pos = comp.position;
                transform.setFromPhysics(pos.x, pos.y, comp.angle);
                
                const vel = comp.velocity;
                e.setVelocityFromPhysics(vel.x, vel.y);
            }
        }
    }
}
