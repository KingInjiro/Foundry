import { System } from '../System.js';
import { ParticleEmitter } from '../components/ParticleEmitter.js';

export class ParticleEmitterSystem extends System {
    update(dt) {
        const emitters = this.manager.getComponents(ParticleEmitter);
        for (let i = 0; i < emitters.length; i++) {
            const emitter = emitters[i];
            const entity = emitter.entity;

            if (!emitter.playing || !entity) continue;

            emitter.accumulator += dt;
            const spawnInterval = 1.0 / emitter.rate;

            while (emitter.accumulator >= spawnInterval) {
                emitter.accumulator -= spawnInterval;

                // Random values within config ranges
                const life = this.randomRange(emitter.config.life[0], emitter.config.life[1]);
                const startSize = this.randomRange(emitter.config.startSize[0], emitter.config.startSize[1]);
                const endSize = this.randomRange(emitter.config.endSize[0], emitter.config.endSize[1]);
                const speed = this.randomRange(emitter.config.speed[0], emitter.config.speed[1]);
                const angle = this.randomRange(emitter.config.angle[0], emitter.config.angle[1]);

                // World position
                const x = entity.globalX !== undefined ? entity.globalX : entity.x;
                const z = entity.globalZ || 0;
                const is3D = !!(entity.getComponent('MeshRenderer') || entity.getComponent('ModelRenderer') || entity.getComponent('PhysicsBody3D'));
                const y = entity.globalY !== undefined ? entity.globalY : entity.y;

                const vx = Math.cos(angle) * speed;
                const vy = Math.sin(angle) * speed;

                this.engine.particles.emit({
                    x, y, z, is3D, vx, vy, life, startSize, endSize,
                    startColor: emitter.config.startColor,
                    endColor: emitter.config.endColor
                });
            }
        }
    }

    randomRange(min, max) {
        return min + Math.random() * (max - min);
    }
}
