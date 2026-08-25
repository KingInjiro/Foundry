import { Simulation } from '../../simulation/Simulation.js';

/**
 * Cosmic Attractors Particle System.
 * Demonstrates high-performance zero-allocation arrays (30,000+ particles) 
 * with beautiful visual additive blending and trails.
 * Perfect for a visually engaging YouTube demonstration.
 */
export class CosmicSimulation extends Simulation {
    /**
     * @param {import('../../core/Engine.js').Engine} engine 
     */
    constructor(engine) {
        super(engine);
        // Smooth trails and dark background
        this.clearAlpha = 0.08; 
        this.clearColor = '#020205';
        
        this.numParticles = 30000;
        
        // Zero-allocation Structure of Arrays (SoA) for maximum CPU cache hit rate
        this.x = new Float32Array(this.numParticles);
        this.y = new Float32Array(this.numParticles);
        this.vx = new Float32Array(this.numParticles);
        this.vy = new Float32Array(this.numParticles);
        
        this.friction = 0.985;
        this.gravity = 15000;
        this.time = 0;
        this.attractorSpeed = 0.5;
    }

    onStart() {
        this.engine.camera.set(0, 0, 1);
        
        // Spawn particles in a circular burst
        for (let i = 0; i < this.numParticles; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 600;
            this.x[i] = Math.cos(angle) * radius;
            this.y[i] = Math.sin(angle) * radius;
            this.vx[i] = 0;
            this.vy[i] = 0;
        }
        this.time = 0;
    }
    
    onUpdate(dt) {
        // Prevent huge jumps if tab was inactive
        if (dt > 0.1) dt = 0.1;
        
        this.time += dt * this.attractorSpeed;
        
        // Calculate 3 moving attractors forming Lissajous curves
        const ax1 = Math.cos(this.time * 1.1) * 300;
        const ay1 = Math.sin(this.time * 1.3) * 300;
        
        const ax2 = Math.cos(this.time * 0.7 + 2) * 400;
        const ay2 = Math.sin(this.time * 0.9 + 1) * 400;
        
        const ax3 = Math.cos(this.time * 0.5 + 4) * 500;
        const ay3 = Math.sin(this.time * 0.6 + 3) * 500;
        
        const g = this.gravity;
        const f = this.friction;
        
        // Main particle loop - extremely hot path
        for(let i = 0; i < this.numParticles; i++) {
            let px = this.x[i];
            let py = this.y[i];
            let pvx = this.vx[i];
            let pvy = this.vy[i];
            
            // Attractor 1
            let dx = ax1 - px; 
            let dy = ay1 - py;
            let dSq = dx*dx + dy*dy + 800; // +800 softens the gravity well center
            pvx += (dx / dSq) * g * dt; 
            pvy += (dy / dSq) * g * dt;
            
            // Attractor 2
            dx = ax2 - px; 
            dy = ay2 - py;
            dSq = dx*dx + dy*dy + 800;
            pvx += (dx / dSq) * g * dt; 
            pvy += (dy / dSq) * g * dt;

            // Attractor 3
            dx = ax3 - px; 
            dy = ay3 - py;
            dSq = dx*dx + dy*dy + 800;
            pvx += (dx / dSq) * g * dt; 
            pvy += (dy / dSq) * g * dt;
            
            // Apply friction and update position
            pvx *= f;
            pvy *= f;
            
            this.vx[i] = pvx;
            this.vy[i] = pvy;
            this.x[i] = px + pvx * dt;
            this.y[i] = py + pvy * dt;
        }
    }
    
    onRender(r, camera) {
        // Additive blending for that glowing cosmic effect
        r.setGlobalCompositeOperation('lighter');
        
        const third = Math.floor(this.numParticles / 3);
        
        // Fast batch rendering in Canvas2D is done via building one massive path
        // and filling it once per color.
        
        // Pass 1: Cyan
        r.setFillStyle('#22d3ee');
        r.ctx.beginPath();
        for(let i = 0; i < third; i++) {
            r.ctx.rect(this.x[i], this.y[i], 1.5, 1.5);
        }
        r.ctx.fill();
        
        // Pass 2: Fuchsia
        r.setFillStyle('#e879f9');
        r.ctx.beginPath();
        for(let i = third; i < third * 2; i++) {
            r.ctx.rect(this.x[i], this.y[i], 1.5, 1.5);
        }
        r.ctx.fill();
        
        // Pass 3: Royal Blue
        r.setFillStyle('#3b82f6');
        r.ctx.beginPath();
        for(let i = third * 2; i < this.numParticles; i++) {
            r.ctx.rect(this.x[i], this.y[i], 1.5, 1.5);
        }
        r.ctx.fill();
        
        r.setGlobalCompositeOperation('source-over');
    }
    
    onUI(ui) {
        ui.panel(10, 50, 320, 210, 'rgba(10, 10, 15, 0.85)');
        ui.text('Cosmic Attractors', 20, 70, '#22d3ee', 'bold 16px monospace');
        
        const pUpdate = this.engine.profiler.get('update').toFixed(2);
        const pRender = this.engine.profiler.get('render').toFixed(2);
        
        ui.text(`FPS: ${this.engine.time.fps}`, 20, 95);
        ui.text(`Particles: ${this.numParticles.toLocaleString()}`, 150, 95);
        
        ui.text(`CPU Logic:  ${pUpdate}ms`, 20, 115, '#fca5a5');
        ui.text(`CPU Render: ${pRender}ms`, 20, 135, '#93c5fd');
        
        this.gravity = ui.slider('sl_grav', 'Gravity', 20, 155, 280, 20, 1000, 50000, this.gravity);
        this.friction = ui.slider('sl_fric', 'Friction', 20, 185, 280, 20, 0.90, 1.0, this.friction);
        
        if (ui.button('btn_reset', 'Burst / Reset', 150, 60, 120, 25)) {
            this.onStart();
        }
    }
}
