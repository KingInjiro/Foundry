import { System } from '../System.js';
import { Health } from '../components/Health.js';

export class HealthSystem extends System {
    update(dt) {
        const components = this.manager.getComponents(Health);
        
        for (let i = 0; i < components.length; i++) {
            const comp = components[i];
            
            if (!comp.enabled || !comp.entity || comp.entity.isDestroyed) continue; 
            
            if (comp.isDead && comp.destroyOnDeath) {
                // To avoid modifying the array during iteration, 
                // entity.destroy() typically marks for deletion at the end of the frame
                comp.entity.destroy();
            }
        }
    }
}
