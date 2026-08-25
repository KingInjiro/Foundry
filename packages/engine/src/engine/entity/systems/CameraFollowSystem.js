import { System } from '../System.js';
import { CameraFollow } from '../components/CameraFollow.js';

export class CameraFollowSystem extends System {
    update(dt) {
        const components = this.manager.getComponents(CameraFollow);
        const camera = components.length > 0 && components[0].entity ? components[0].entity.engine.camera : null;
        
        if (!camera || components.length === 0) return;

        // In a real game, you might only want one active camera follower.
        // We'll just use the first enabled one we find.
        for (let i = 0; i < components.length; i++) {
            const comp = components[i];
            if (comp.enabled && comp.entity) {
                const targetX = comp.entity.globalX + comp.offsetX;
                const targetY = comp.entity.globalY + comp.offsetY;

                // Lerp camera position
                camera.x += (targetX - camera.x) * comp.lerpSpeed * dt;
                camera.y += (targetY - camera.y) * comp.lerpSpeed * dt;
                break; // Only follow one entity
            }
        }
    }
}
