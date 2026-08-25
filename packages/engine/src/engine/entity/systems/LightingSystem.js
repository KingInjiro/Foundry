import { System } from '../System.js';
import { LightSource } from '../components/LightSource.js';
import { PhysicsBody } from '../../physics/PhysicsBody.js';

export class LightingSystem extends System {

    _hexToRgb(hex) {
        let r = 255, g = 255, b = 255;
        if (hex.startsWith('#')) {
            if (hex.length === 4) {
                r = parseInt(hex[1] + hex[1], 16);
                g = parseInt(hex[2] + hex[2], 16);
                b = parseInt(hex[3] + hex[3], 16);
            } else if (hex.length === 7) {
                r = parseInt(hex.substring(1, 3), 16);
                g = parseInt(hex.substring(3, 5), 16);
                b = parseInt(hex.substring(5, 7), 16);
            }
        } else if (hex.startsWith('rgb')) {
            const match = hex.match(/\d+/g);
            if (match && match.length >= 3) {
                r = parseInt(match[0]);
                g = parseInt(match[1]);
                b = parseInt(match[2]);
            }
        }
        return {r, g, b};
    }

    constructor() {
        super();
        this.ambientColor = 'rgba(10, 10, 15, 0.9)';
        this.enabled = true;
        this.drawShadows = true;
    }
    
    render(renderer, camera) {
        return;
        if (!this.enabled || this.manager.engine.config.headless) return;
        
        const lights = this.manager.getComponents(LightSource);
        if (lights.length === 0) return;
        
        const ctx = renderer.ctx2d || renderer.ctx || renderer;
        if (ctx && !ctx.setTransform) { throw new Error("LightingSystem: ctx is " + (ctx.constructor ? ctx.constructor.name : typeof ctx) + ", renderer is " + (renderer.constructor ? renderer.constructor.name : typeof renderer)); }
        if (!ctx) return;

        const w = renderer.width || (renderer.canvasManager && renderer.canvasManager.canvas2D ? renderer.canvasManager.canvas2D.width : (renderer.canvas ? renderer.canvas.width : 800));
        const h = renderer.height || (renderer.canvasManager && renderer.canvasManager.canvas2D ? renderer.canvasManager.canvas2D.height : (renderer.canvas ? renderer.canvas.height : 600));
        
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0); 
        
        if (!this.lightCanvas) {
            this.lightCanvas = (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : (function(){let c = document.createElement('canvas'); c.width = w; c.height = h; return c;})());
            this.lightCtx = this.lightCanvas.getContext('2d');
            this.maskCanvas = (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : (function(){let c = document.createElement('canvas'); c.width = w; c.height = h; return c;})());
            this.maskCtx = this.maskCanvas.getContext('2d');
            this.tempCanvas = (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : (function(){let c = document.createElement('canvas'); c.width = w; c.height = h; return c;})());
            this.tempCtx = this.tempCanvas.getContext('2d');
        }
        
        if (this.lightCanvas.width !== w || this.lightCanvas.height !== h) {
            this.lightCanvas.width = w; this.lightCanvas.height = h;
            this.maskCanvas.width = w; this.maskCanvas.height = h;
            this.tempCanvas.width = w; this.tempCanvas.height = h;
        }
        
        const lctx = this.lightCtx;
        const mctx = this.maskCtx;
        const tctx = this.tempCtx;
        
        // 1. Clear mask to fully black (0 light)
        mctx.globalCompositeOperation = 'source-over';
        mctx.clearRect(0, 0, w, h);
        
        // Get potential shadow casters
        const bodies = this.drawShadows ? this.manager.getComponents(PhysicsBody) : [];
        
        // 2. Accumulate lights on mask
        for (let i = 0; i < lights.length; i++) {
            const light = lights[i];
            if (!light.enabled || !light.entity || light.entity.isDestroyed) continue; 
            
            const time = Date.now() / 1000;
            let currentRadius = light.radius;
            let currentIntensity = light.intensity;
            
            if (light.flicker) {
                const noise = Math.sin(time * light.flickerSpeed) * Math.cos(time * light.flickerSpeed * 0.7);
                currentRadius += noise * light.flickerIntensity * light.radius;
                currentIntensity += noise * light.flickerIntensity;
            }
            
            const screenPos = camera.worldToScreen((light.entity.globalX + (light.offsetX || 0)), (light.entity.globalY + (light.offsetY || 0)));
            
            if (screenPos.x + currentRadius < 0 || screenPos.x - currentRadius > w ||
                screenPos.y + currentRadius < 0 || screenPos.y - currentRadius > h) {
                continue;
            }
            
            // Draw light to temp canvas
            tctx.globalCompositeOperation = 'source-over';
            tctx.clearRect(0, 0, w, h);
            
            const gradient = tctx.createRadialGradient(screenPos.x, screenPos.y, 0, screenPos.x, screenPos.y, currentRadius);
            gradient.addColorStop(0, `rgba(255, 255, 255, ${currentIntensity})`);
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            
            tctx.fillStyle = gradient;
            tctx.beginPath();
            tctx.arc(screenPos.x, screenPos.y, currentRadius, 0, Math.PI * 2);
            tctx.fill();
            
            // Cast shadows
            if (this.drawShadows) {
                tctx.globalCompositeOperation = 'destination-out';
                tctx.fillStyle = '#ffffff';
                
                for (let j = 0; j < bodies.length; j++) {
                    const bodyComponent = bodies[j];
                    const body = bodyComponent.body;
                    if (!body || !body.vertices) continue;
                    
                    const verts = body.vertices;
                    let boundsDistSq = 0;
                    
                    // Simple distance check to light
                    const dx = body.position.x - (light.entity.globalX + (light.offsetX || 0));
                    const dy = body.position.y - (light.entity.globalY + (light.offsetY || 0));
                    const distSq = dx * dx + dy * dy;
                    const r = currentRadius + 200; // max size of body roughly
                    if (distSq > r * r) continue;
                    
                    tctx.beginPath();
                    // Basic shadow casting projection
                    const lx = (light.entity.globalX + (light.offsetX || 0));
                    const ly = (light.entity.globalY + (light.offsetY || 0));
                    
                    for (let k = 0; k < verts.length; k++) {
                        const v1 = verts[k];
                        const v2 = verts[(k + 1) % verts.length];
                        
                        // Check if edge is facing away from light
                        const edgeNormalX = v2.y - v1.y;
                        const edgeNormalY = -(v2.x - v1.x);
                        const lightDirX = v1.x - lx;
                        const lightDirY = v1.y - ly;
                        
                        // If dot product is > 0, edge faces away from light
                        if (edgeNormalX * lightDirX + edgeNormalY * lightDirY > 0) {
                            const sv1 = camera.worldToScreen(v1.x, v1.y);
                            const sv2 = camera.worldToScreen(v2.x, v2.y);
                            
                            const dir1x = v1.x - lx;
                            const dir1y = v1.y - ly;
                            const dir2x = v2.x - lx;
                            const dir2y = v2.y - ly;
                            
                            const p1x = camera.worldToScreen(v1.x + dir1x * 100).x;
                            const p1y = camera.worldToScreen(v1.y + dir1y * 100).y;
                            const p2x = camera.worldToScreen(v2.x + dir2x * 100).x;
                            const p2y = camera.worldToScreen(v2.y + dir2y * 100).y;
                            
                            tctx.moveTo(sv1.x, sv1.y);
                            tctx.lineTo(p1x, p1y);
                            tctx.lineTo(p2x, p2y);
                            tctx.lineTo(sv2.x, sv2.y);
                        }
                    }
                    tctx.fill();
                }
            }
            
            // Add to mask using screen/lighter
            mctx.globalCompositeOperation = 'lighter';
            mctx.drawImage(this.tempCanvas, 0, 0);
        }
        
        // 3. Draw ambient darkness on light canvas
        lctx.globalCompositeOperation = 'source-over';
        lctx.clearRect(0, 0, w, h);
        lctx.fillStyle = this.ambientColor;
        lctx.fillRect(0, 0, w, h);
        
        // 4. Punch out lights
        lctx.globalCompositeOperation = 'destination-out';
        lctx.drawImage(this.maskCanvas, 0, 0);
        
        // 5. Draw light overlay to main canvas
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(this.lightCanvas, 0, 0);
        ctx.restore();
    }
}
