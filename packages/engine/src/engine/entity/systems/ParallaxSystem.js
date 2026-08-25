import { System } from '../System.js';
import { Parallax } from '../components/Parallax.js';

export class ParallaxSystem extends System {
    constructor() {
        super();
        this.cameraPos = { x: 0, y: 0 };
    }

    update(dt) {
        const camera = this.manager.engine.camera;
        const cx = camera.x;
        const cy = camera.y;

        const components = this.manager.getComponents(Parallax);
        
        for (let i = 0; i < components.length; i++) {
            const parallax = components[i];
            const entity = parallax.entity;
            if (!entity.active ) continue;

            if (!parallax.initialized) {
                parallax.baseX = entity.x;
                parallax.baseY = entity.y;
                parallax.initialized = true;
            }

            // Calculate apparent position based on camera movement
            const targetX = parallax.baseX + (cx * (1 - parallax.scrollFactorX));
            const targetY = parallax.baseY + (cy * (1 - parallax.scrollFactorY));
            
            // Note: repetition wrapping is usually done in the renderer by drawing the sprite multiple times.
            // For this simple version, we just offset the entity.
            entity.x = targetX;
            entity.y = targetY;
        }
    }
}
