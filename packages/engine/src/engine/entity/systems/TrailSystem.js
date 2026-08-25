import { System } from '../System.js';
import { TrailRenderer } from '../components/TrailRenderer.js';

export class TrailSystem extends System {
    update(dt) {
        const trails = this.manager.getComponents(TrailRenderer);
        for (let i = 0; i < trails.length; i++) {
            const trail = trails[i];
            if (!trail.enabled || !trail.entity ) continue;
            
            trail.points.push({ x: trail.entity.globalX, y: trail.entity.globalY });
            if (trail.points.length > trail.length) {
                trail.points.shift();
            }
        }
    }

    render(renderer, camera) {
        const trails = this.manager.getComponents(TrailRenderer);
        if (trails.length === 0) return;
        
        for (let i = 0; i < trails.length; i++) {
            const trail = trails[i];
            if (!trail.enabled || trail.points.length < 2) continue;
            

            
            // We use engine.renderer API for safety
            renderer.setStrokeStyle(trail.color);
            renderer.setLineWidth(trail.width);
            renderer.setGlobalAlpha(0.7);
            
            const points = trail.points;
            let lastX = points[0].x;
            let lastY = points[0].y;
            
            for (let j = 1; j < points.length; j++) {
                renderer.setGlobalAlpha((j / points.length) * 0.7);
                renderer.drawLine(lastX, lastY, points[j].x, points[j].y);
                lastX = points[j].x;
                lastY = points[j].y;
            }
            renderer.setGlobalAlpha(1.0);
        }
    }
}
