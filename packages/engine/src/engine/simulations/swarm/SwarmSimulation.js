import { Simulation } from '../../simulation/Simulation.js';
import { BoidEntity } from './BoidEntity.js';
import boidsWasmUrl from '../../../../assets/boids.wasm?url';


export class SwarmSimulation extends Simulation {
    onInitialize() {
        this.separationWeight = 1.5;
        this.alignmentWeight = 1.0;
        this.cohesionWeight = 1.0;
        this.perceptionRadius = 50;
        this.zoomLevel = 1;
        this.numBoids = 2000;
        
        this.wasmInstance = null;
        this.wasmMemory = null;
        this.useWasm = true;
        
        fetch(boidsWasmUrl)
            .then(response => response.arrayBuffer())
            .then(bytes => WebAssembly.instantiate(bytes, {
                env: {
                    abort: () => console.log("Abort!")
                }
            }))
            .then(results => {
                this.wasmInstance = results.instance;
                this.wasmMemory = new Float32Array(this.wasmInstance.exports.memory.buffer);
                console.log("WASM Boids loaded successfully!");
            });
    }
    
    onStart() {
        this.world.gravityY = 0;
        this.world.gravityX = 0;
        this.world.isInfinite = false;
        
        for (let i = 0; i < this.numBoids; i++) {
            this.world.spawn(BoidEntity, this);
        }
    }
    
        onRender(r, camera) {
        // Instanced rendering always active
        
        // Use instanced rendering
        const boids = this.world.getByTag('boid');
        const count = boids.length;
        if (count === 0) return;
        
        // We use WebGLRenderer2D directly for instancing
        const renderer = this.engine.renderer;
        if (!renderer || !renderer.drawInstanced) return;
        
        // Reuse or create transformData buffer
        if (!this.instData || this.instData.length < count * 14) {
            this.instData = new Float32Array(count * 14 * 1.5); // Allocate with some room
        }
        
        const data = this.instData;
        
        // The base quad in drawInstanced is 1x1, so scale should be roughly boid size (e.g. 20x20)
        // Since Boid uses a 10px triangle, base quad 20x20 covers it. 
        // We will just draw a colored box or use a boid texture.
        // For colored box, we set whiteTex (image = null), texIdx handled internally.
        
        for (let i = 0; i < count; i++) {
            const b = boids[i];
            const p = i * 14;
            
            const cos = Math.cos(b.rotation);
            const sin = Math.sin(b.rotation);
            const scaleX = 20;
            const scaleY = 15;
            
            // Mat3 construction (column-major in shader, we pass rows)
            // Wait, our shader expects rows.
            // Row 0: scaleX*cos, -scaleY*sin, tx
            // Row 1: scaleX*sin, scaleY*cos, ty
            // Row 2: 0, 0, 1
            data[p + 0] = scaleX * cos; data[p + 1] = scaleX * sin; data[p + 2] = 0;
            data[p + 3] = -scaleY * sin; data[p + 4] = scaleY * cos; data[p + 5] = 0;
            data[p + 6] = b.x;            data[p + 7] = b.y;            data[p + 8] = 1;
            
            // Color (stored as HSL string in Boid, we need RGBA)
            // Hack: just parse it or pre-parse it
            if (!b._colorR) {
               const c = renderer.parseColor(b.color);
               b._colorR = c[0]; b._colorG = c[1]; b._colorB = c[2]; b._colorA = c[3];
            }
            data[p + 9] = b._colorR;
            data[p + 10] = b._colorG;
            data[p + 11] = b._colorB;
            data[p + 12] = b._colorA;
            
            // TexIdx (0 for whiteTex usually)
            data[p + 13] = 0;
        }
        
                const maxInstances = renderer.MAX_INSTANCES || 20000;
        let drawn = 0;
        while (drawn < count) {
            const toDraw = Math.min(count - drawn, maxInstances);
            const subData = data.subarray(drawn * 14, (drawn + toDraw) * 14);
            renderer.drawInstanced(null, toDraw, subData, 20, 15);
            drawn += toDraw;
        }
    }

    onUpdate(dt) {
        const mouse = this.engine.input.mouse;
        const camera = this.engine.camera;
        
        if (this.useWasm && this.wasmInstance) {
            this.engine.profiler.begin('wasm_boids');
            
            // Gather boids
            const boids = this.world.getByTag('boid');
            const count = boids.length;
            
            // Ensure WASM memory is large enough (16 bytes per boid = 4 floats)
            // AssemblyScript defaults to 1 page (64KB), which holds 4096 boids. 
            // If we have more, we'd need memory.grow(), but we're at 2000-3000 max for this demo.
            if (count * 4 > this.wasmMemory.length) {
                // Ignore for now or grow. For demo, we assume < 4000 boids
            } else {
                // Copy to WASM
                for (let i = 0; i < count; i++) {
                    const b = boids[i];
                    let p = i * 4;
                    this.wasmMemory[p] = b.x;
                    this.wasmMemory[p + 1] = b.y;
                    this.wasmMemory[p + 2] = b.vx;
                    this.wasmMemory[p + 3] = b.vy;
                }
                
                // Execute WASM
                this.wasmInstance.exports.updateBoids(
                    0, // ptr
                    count,
                    dt,
                    this.perceptionRadius,
                    this.separationWeight,
                    this.alignmentWeight,
                    this.cohesionWeight,
                    300.0, // maxSpeed
                    1000.0, // maxForce
                    this.world.width,
                    this.world.height
                );
                
                // Copy back
                for (let i = 0; i < count; i++) {
                    const b = boids[i];
                    let p = i * 4;
                    b.x = this.wasmMemory[p];
                    b.y = this.wasmMemory[p + 1];
                    b.vx = this.wasmMemory[p + 2];
                    b.vy = this.wasmMemory[p + 3];
                    b.rotation = Math.atan2(b.vy, b.vx);
                }
            }
            
            this.engine.profiler.end('wasm_boids');
        }

        // Mouse wheel zoom
        if (mouse.wheelY !== 0) {
            this.zoomLevel -= mouse.wheelY * 0.001;
            this.zoomLevel = Math.max(0.1, Math.min(this.zoomLevel, 5));
            camera.zoomTo(this.zoomLevel);
        }
        
        camera.follow(0, 0); // Keep camera centered on world
    }
    
    onUI(ui) {
        ui.panel(10, 50, 250, 330, 'rgba(30, 30, 30, 0.8)');
        ui.text('Swarm Intelligence', 20, 70, '#4ade80', 'bold 16px monospace');
        
        ui.text(`FPS: ${this.engine.time.fps}`, 20, 95);
        ui.text(`Boids: ${this.world.count()}`, 20, 115);
        
        // Profiler Metrics
        const pUpdate = this.engine.profiler.get('update').toFixed(2);
        const pRender = this.engine.profiler.get('render').toFixed(2);
        ui.text(`CPU Logic : ${pUpdate}ms`, 20, 135, '#fca5a5');
        ui.text(`CPU Render: ${pRender}ms`, 20, 150, '#93c5fd');
        
        let wasmTime = this.engine.profiler.get('wasm_boids') || 0;
        ui.text(`WASM Time : ${wasmTime.toFixed(2)}ms`, 20, 165, '#fef08a');
        
        if (ui.button('btn_wasm', this.useWasm ? 'WASM: ON' : 'WASM: OFF', 140, 165, 100, 20)) {
            this.useWasm = !this.useWasm;
        }
        
        this.separationWeight = ui.slider('sl_sep', 'Separation', 20, 185, 230, 20, 0, 5, this.separationWeight);
        this.alignmentWeight = ui.slider('sl_ali', 'Alignment', 20, 215, 230, 20, 0, 5, this.alignmentWeight);
        this.cohesionWeight = ui.slider('sl_coh', 'Cohesion', 20, 245, 230, 20, 0, 5, this.cohesionWeight);
        this.perceptionRadius = ui.slider('sl_rad', 'Radius', 20, 275, 230, 20, 10, 200, this.perceptionRadius);
        
        if (ui.button('btn_add', 'Spawn 500', 20, 305, 110, 30)) {
            for (let i = 0; i < 500; i++) {
                this.world.spawn(BoidEntity, this);
            }
        }
        
        if (ui.button('btn_sub', 'Remove 500', 140, 305, 110, 30)) {
            let removed = 0;
            const boids = this.world.getEntities();
            for (let i = boids.length - 1; i >= 0; i--) {
                const b = boids[i];
                if (b.tag === 'boid' && !b.isDestroyed) {
                    b.destroy();
                    removed++;
                    if (removed >= 500) break;
                }
            }
        }
    }
}
