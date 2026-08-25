import { System } from '../System.js';
import { TriggerArea } from '../components/TriggerArea.js';

export class TriggerSystem extends System {
    update(dt) {
        const triggers = this.manager.getComponents(TriggerArea);
        const allEntities = this.manager.engine.world.entities.entities;
        
        for (let i = 0; i < triggers.length; i++) {
            const trigger = triggers[i];
            if (!trigger.enabled || !trigger.entity || trigger.entity.isDestroyed) continue; 
            if (trigger.triggerOnce && trigger._hasTriggered) continue;
            
            for (let j = 0; j < allEntities.length; j++) {
                const target = allEntities[j];
                
                if (target === trigger.entity || target.isDestroyed) continue;
                if (trigger.targetTag && target.tag !== trigger.targetTag) continue;
                
                const dx = trigger.entity.globalX - target.globalX;
                const dy = trigger.entity.globalY - target.globalY;
                const distSq = dx * dx + dy * dy;
                
                const inRange = distSq <= trigger.radius * trigger.radius;
                const wasInRange = trigger._entitiesInRange.has(target);
                
                if (inRange && !wasInRange) {
                    trigger._entitiesInRange.add(target);
                    trigger._hasTriggered = true;
                    this.manager.engine.events.emit(trigger.eventName, { trigger: trigger.entity, target: target });
                    if (trigger.triggerOnce) break;
                } else if (!inRange && wasInRange) {
                    trigger._entitiesInRange.delete(target);
                    this.manager.engine.events.emit(trigger.eventName + 'Exit', { trigger: trigger.entity, target: target });
                }
            }
        }
    }
}
