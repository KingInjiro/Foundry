import { System } from '../System.js';
import { DamageArea } from '../components/DamageArea.js';
import { Health } from '../components/Health.js';

export class DamageSystem extends System {
    update(dt) {
        const damageAreas = this.manager.getComponents(DamageArea);
        const healths = this.manager.getComponents(Health);
        
        for (let i = 0; i < damageAreas.length; i++) {
            const dmgArea = damageAreas[i];
            
            if (!dmgArea.enabled || !dmgArea.entity || dmgArea.entity.isDestroyed) continue; 
            
            if (dmgArea.continuous) {
                dmgArea._timer -= dt;
                if (dmgArea._timer > 0) continue;
            }
            
            let damagedSomeone = false;
            
            for (let j = 0; j < healths.length; j++) {
                const targetHealth = healths[j];
                
                if (!targetHealth.enabled || !targetHealth.entity || targetHealth.isDead) continue;
                if (dmgArea.entity === targetHealth.entity) continue; // Don't damage self
                
                const dx = dmgArea.entity.globalX - targetHealth.entity.globalX;
                const dy = dmgArea.entity.globalY - targetHealth.entity.globalY;
                const distSq = dx * dx + dy * dy;
                
                if (distSq <= dmgArea.radius * dmgArea.radius) {
                    targetHealth.takeDamage(dmgArea.damage);
                    damagedSomeone = true;
                    
                    if (dmgArea.continuous) {
                        // We damaged someone this frame, reset timer
                    }
                }
            }
            
            if (damagedSomeone) {
                if (dmgArea.continuous) {
                    dmgArea._timer = dmgArea.damageInterval;
                } else if (dmgArea.destroyOnDamage) {
                    dmgArea.entity.destroy();
                }
            }
        }
    }
}
