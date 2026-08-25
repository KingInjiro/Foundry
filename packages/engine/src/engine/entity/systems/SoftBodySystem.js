import { System } from '../System.js';
import { SoftBody } from '../../physics/SoftBody.js';

export class SoftBodySystem extends System {
    render(renderer, camera) {
        const softBodies = this.manager.getComponents(SoftBody);
        
        renderer.save();
        
        for (let i = 0; i < softBodies.length; i++) {
            const comp = softBodies[i];
            if (!comp.enabled || !comp.composite) continue;
            
            // Draw constraints (springs)
            renderer.setStrokeStyle(comp.color);
            renderer.setLineWidth(2);
            const constraints = comp.composite.constraints;
            for (let j = 0; j < constraints.length; j++) {
                const c = constraints[j];
                const pA = c.bodyA ? { x: c.bodyA.position.x + c.pointA.x, y: c.bodyA.position.y + c.pointA.y } : c.pointA;
                const pB = c.bodyB ? { x: c.bodyB.position.x + c.pointB.x, y: c.bodyB.position.y + c.pointB.y } : c.pointB;
                
                renderer.beginPath();
                renderer.moveTo(pA.x, pA.y);
                renderer.lineTo(pB.x, pB.y);
                renderer.stroke();
            }
            
            // Draw bodies (particles)
            renderer.setFillStyle(comp.color);
            const bodies = comp.composite.bodies;
            for (let j = 0; j < bodies.length; j++) {
                const b = bodies[j];
                renderer.beginPath();
                renderer.arc(b.position.x, b.position.y, comp.particleRadius, 0, Math.PI * 2);
                renderer.fill();
            }
        }
        
        renderer.restore();
    }
}
