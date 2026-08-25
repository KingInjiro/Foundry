import * as THREE from 'three';
export class Particle {
    constructor() {
        this.active = false;
        this.x = 0;
        this.y = 0;
        this.vx = 0;
        this.vy = 0;
        this.life = 0;
        this.maxLife = 1;
        this.startSize = 10;
        this.endSize = 0;
        this.startColor = { r: 255, g: 255, b: 255, a: 1 };
        this.endColor = { r: 255, g: 255, b: 255, a: 0 };
        this.color = { r: 255, g: 255, b: 255, a: 1 };
        this.size = 10;
        this.isFluid = false;
    }
}

export class ParticleSystem {
    constructor(engine) {
        this.engine = engine;
        this.particles = [];
        this.pool = [];
        this.maxParticles = 50000;

        for (let i = 0; i < this.maxParticles; i++) {
            this.pool.push(new Particle());
        }

        this.engine.events.on('update', (dt) => this.update(dt));
        this.engine.events.on('postRenderWorld', (renderer, camera) => this.render(renderer, camera));
    }

    emit(config) {
        if (this.pool.length === 0) return;
        const count = config.count || 1;
        
        for (let i = 0; i < count; i++) {
            if (this.pool.length === 0) break;
            
            const p = this.pool.pop();
            p.active = true;
            p.x = config.x || 0;
            p.y = config.y || 0;
            p.z = config.z || 0;
            
            let vx = config.vx || 0;
            let vy = config.vy || 0;
            let vz = config.vz || 0;
            
            if (config.speed) {
                const angle = Math.random() * Math.PI * 2;
                const speed = config.speed * (0.5 + Math.random() * 0.5);
                vx = Math.cos(angle) * speed;
                vy = Math.sin(angle) * speed;
            } else if (count > 1) {
                vx += (Math.random() - 0.5) * 50;
                vy += (Math.random() - 0.5) * 50;
            }
            
            p.vx = vx;
            p.vy = vy;
            p.vz = vz;
            p.maxLife = config.life || 1;
            p.life = p.maxLife * (0.8 + Math.random() * 0.4);
            p.startSize = config.startSize !== undefined ? config.startSize : (config.scale || 10);
            p.endSize = config.endSize !== undefined ? config.endSize : 0;
            p.isFluid = config.isFluid || false;
            p.is3D = config.is3D || false;
            
            let c = config.color;
            if (typeof c === 'string') {
                if (c.startsWith('#')) {
                    let hex = c.substring(1);
                    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
                    p.startColor = {
                        r: parseInt(hex.substring(0,2), 16),
                        g: parseInt(hex.substring(2,4), 16),
                        b: parseInt(hex.substring(4,6), 16),
                        a: 1
                    };
                }
            } else {
                p.startColor = config.startColor || { r: 255, g: 255, b: 255, a: 1 };
            }
            p.endColor = config.endColor || { ...p.startColor, a: 0 };
            
            p.size = p.startSize;
            p.color.r = p.startColor.r;
            p.color.g = p.startColor.g;
            p.color.b = p.startColor.b;
            p.color.a = p.startColor.a;
            
            this.particles.push(p);
        }
    }

    update(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life -= dt;
            
            if (p.life <= 0) {
                p.active = false;
                this.pool.push(p);
                
                // Swap and pop for O(1) removal
                const last = this.particles.length - 1;
                if (i !== last) {
                    this.particles[i] = this.particles[last];
                }
                this.particles.pop();
                i--; // Check the swapped element in the next iteration
                continue;
            }


            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.z !== undefined && p.vz !== undefined) p.z += p.vz * dt;


            const t = 1 - (p.life / p.maxLife);
            p.size = p.startSize + (p.endSize - p.startSize) * t;
            p.color.r = p.startColor.r + (p.endColor.r - p.startColor.r) * t;
            p.color.g = p.startColor.g + (p.endColor.g - p.startColor.g) * t;
            p.color.b = p.startColor.b + (p.endColor.b - p.startColor.b) * t;
            p.color.a = p.startColor.a + (p.endColor.a - p.startColor.a) * t;
        }
    }


    render(renderer, camera) {
        const bounds = camera.getBounds();
        const hw = (renderer.width || (renderer.canvasManager && renderer.canvasManager.canvas2D ? renderer.canvasManager.canvas2D.width : (renderer.canvas ? renderer.canvas.width : 800))) / 2;
        const hh = (renderer.height || (renderer.canvasManager && renderer.canvasManager.canvas2D ? renderer.canvasManager.canvas2D.height : (renderer.canvas ? renderer.canvas.height : 600))) / 2;
        
        let pos3D = new THREE.Vector3();
        let use3D = !!this.engine.camera3D;

        // Simple culling
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            let size = p.size;
            
            let px = p.x;
            let py = p.y;
            
            if (p.is3D && use3D) {
                pos3D.set(p.x / 100, -p.y / 100, (p.z || 0) / 100);
                pos3D.project(this.engine.camera3D.camera);
                
                if (pos3D.z >= 1.0) continue; // behind camera
                
                const screenX = (pos3D.x * 0.5 + 0.5) * this.engine.window.width;
                const screenY = -(pos3D.y * 0.5 - 0.5) * this.engine.window.height;
                const worldPos = camera.screenToWorld(screenX, screenY);
                px = worldPos.x;
                py = worldPos.y;
                
                const distScale = Math.max(0.1, 1 - pos3D.z);
                size *= distScale;
            } else {
                if (px + size < bounds.xMin || px - size > bounds.xMax ||
                    py + size < bounds.yMin || py - size > bounds.yMax) {
                    continue;
                }
            }

            if (renderer.pushQuad) {
                const texIdx = renderer.getTextureIndex(renderer.whiteTex);
                renderer.pushQuad(
                    px - size, py - size, 0, 0,
                    px + size, py - size, 1, 0,
                    px + size, py + size, 1, 1,
                    px - size, py + size, 0, 1,
                    texIdx, p.color.r / 255, p.color.g / 255, p.color.b / 255, p.color.a
                );
            } else {
                renderer.setFillStyle(`rgba(${Math.floor(p.color.r)}, ${Math.floor(p.color.g)}, ${Math.floor(p.color.b)}, ${p.color.a})`);
                renderer.fillRect(px - size, py - size, size * 2, size * 2);
            }
        }
    }

}
