import * as THREE from 'three';
import { System } from '../System.js';
import { TextRenderer } from '../components/TextRenderer.js';

export class TextSystem extends System {
    render(renderer, camera) {
        const texts = this.manager.getComponents(TextRenderer);
        if (texts.length === 0) return;
        
        for (let i = 0; i < texts.length; i++) {
            const tr = texts[i];
            if (!tr.enabled || !tr.entity || !tr.entity.visible) continue;
            

            let px = tr.entity.globalX;
            let py = tr.entity.globalY;
            let rot = tr.entity.globalRotation;
            let scaleX = tr.entity.globalScaleX;
            let scaleY = tr.entity.globalScaleY;

            // Sync depth with 3D scene if applicable
            const engine = this.manager.engine;
            if (engine.camera3D && (tr.entity.getComponent('MeshRenderer') || tr.entity.getComponent('ModelRenderer'))) {
                const pos3D = new THREE.Vector3((px || 0) / 100, -(py || 0) / 100, (tr.entity.globalZ || 0) / 100);
                pos3D.project(engine.camera3D.camera);
                
                // Only render if in front of camera
                if (pos3D.z < 1.0) {
                    const screenX = (pos3D.x * 0.5 + 0.5) * engine.window.width;
                    const screenY = -(pos3D.y * 0.5 - 0.5) * engine.window.height;
                    const worldPos = camera.screenToWorld(screenX, screenY);
                    px = worldPos.x;
                    py = worldPos.y;
                    
                    // Scale down based on distance (pseudo depth)
                    const distScale = Math.max(0.1, 1 - pos3D.z);
                    scaleX *= distScale;
                    scaleY *= distScale;
                } else {
                    continue; // Behind camera
                }
            }

            
            renderer.save();
            renderer.translate(px, py);
            if (rot !== 0) renderer.rotate(rot);
            if (scaleX !== 1 || scaleY !== 1) renderer.scale(scaleX, scaleY);
            
            renderer.setGlobalAlpha(1.0);
            renderer.setFillStyle(tr.color);
            
            // Note: Our renderer might not have textAlign or textBaseline.
            // If it's WebGL, we might not have it. Let's see if Renderer2D has them.
            if (renderer.ctx) {
                renderer.ctx.textAlign = tr.textAlign;
                renderer.ctx.textBaseline = tr.textBaseline;
            }
            
            renderer.fillText(tr.text, 0, 0, tr.font);
            renderer.restore();
        }
    }
}
