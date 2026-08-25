import { System } from '../System.js';
import { ShapeRenderer } from '../components/ShapeRenderer.js';

export class ShapeSystem extends System {
    render(renderer, camera) {
        const shapes = this.manager.getComponents(ShapeRenderer);
        if (shapes.length === 0) return;
        
        for (let i = 0; i < shapes.length; i++) {
            const sr = shapes[i];
            if (!sr.enabled || !sr.entity || !sr.entity.visible) continue;
            
            const px = sr.entity.globalX;
            const py = sr.entity.globalY;
            const rot = sr.entity.globalRotation;
            const scaleX = sr.entity.globalScaleX;
            const scaleY = sr.entity.globalScaleY;
            
            renderer.save();
            renderer.translate(px, py);
            if (rot !== 0) renderer.rotate(rot);
            if (scaleX !== 1 || scaleY !== 1) renderer.scale(scaleX, scaleY);
            
            renderer.setGlobalAlpha(1.0);
            
            if (sr.fillStyle) renderer.setFillStyle(sr.fillStyle);
            if (sr.strokeStyle) renderer.setStrokeStyle(sr.strokeStyle);
            if (renderer.ctx) renderer.ctx.lineWidth = sr.lineWidth;
            
            const hw = sr.width / 2;
            const hh = sr.height / 2;
            
            if (sr.shape === 'rectangle') {
                if (sr.fillStyle) renderer.fillRect(-hw, -hh, sr.width, sr.height);
                if (sr.strokeStyle && renderer.ctx) renderer.ctx.strokeRect(-hw, -hh, sr.width, sr.height);
            } else if (sr.shape === 'circle') {
                if (sr.fillStyle) renderer.fillCircle(0, 0, sr.radius);
                if (sr.strokeStyle && renderer.ctx) {
                    renderer.ctx.beginPath();
                    renderer.ctx.arc(0, 0, sr.radius, 0, Math.PI * 2);
                    renderer.ctx.stroke();
                }
            } else if (sr.shape === 'line') {
                if (renderer.ctx && sr.strokeStyle) {
                    renderer.ctx.beginPath();
                    renderer.ctx.moveTo(0, 0);
                    renderer.ctx.lineTo(sr.endX, sr.endY);
                    renderer.ctx.stroke();
                }
            } else if (sr.shape === 'polygon' && sr.vertices.length > 2) {
                if (renderer.ctx) {
                    renderer.ctx.beginPath();
                    renderer.ctx.moveTo(sr.vertices[0].x, sr.vertices[0].y);
                    for (let v = 1; v < sr.vertices.length; v++) {
                        renderer.ctx.lineTo(sr.vertices[v].x, sr.vertices[v].y);
                    }
                    renderer.ctx.closePath();
                    if (sr.fillStyle) renderer.ctx.fill();
                    if (sr.strokeStyle) renderer.ctx.stroke();
                }
            }
            
            renderer.restore();
        }
    }
}
