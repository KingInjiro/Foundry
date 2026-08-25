import { System } from '../System.js';
import { Lifespan } from '../components/Lifespan.js';

export class LifespanSystem extends System {
    update(dt) {
        const components = this.manager.getComponents(Lifespan);
        
        for (let i = 0; i < components.length; i++) {
            const comp = components[i];
            
            if (!comp.enabled || !comp.entity || comp.entity.isDestroyed) continue; 
            
            comp._timer += dt;
            if (comp._timer >= comp.duration) {
                comp.entity.destroy();
            }
        }
    }
}
