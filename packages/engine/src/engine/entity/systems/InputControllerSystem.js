import { System } from '../System.js';
import { InputController } from '../components/InputController.js';
import { PhysicsBody } from '../../physics/PhysicsBody.js';

export class InputControllerSystem extends System {
    fixedUpdate(dt) {
        const components = this.manager.getComponents(InputController);
        const input = components.length > 0 && components[0].entity ? components[0].entity.engine.input : null; if (!input) return;
        
        for (let i = 0; i < components.length; i++) {
            const comp = components[i];
            
            if (!comp.enabled || !comp.entity || comp.entity.isDestroyed) continue; 
            
            const h = input.axis(comp.horizontalAxis);
            const v = input.axis(comp.verticalAxis);
            
            const body = comp.entity.getComponent(PhysicsBody);
            
            if (comp.isTopDown) {
                if (body && !body.isStatic) {
                    body.setVelocity(h * comp.speed, v * comp.speed);
                } else {
                    comp.entity.x += h * comp.speed * dt;
                    comp.entity.y += v * comp.speed * dt;
                }
            } else {
                // Platformer
                if (body && !body.isStatic) {
                    // Only control horizontal velocity, keep existing vertical
                    const currentVel = body.body ? body.body.velocity : { x: 0, y: 0 };
                    body.setVelocity(h * comp.speed, currentVel.y);
                    
                    if (input.isKeyDown(comp.jumpAction)) { // Could use jump detection
                        // Simple jump, should add ground detection
                        body.applyForce(0, -comp.jumpForce);
                    }
                } else {
                    comp.entity.x += h * comp.speed * dt;
                }
            }
        }
    }
}
