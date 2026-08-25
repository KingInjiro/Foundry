import { Entity } from '../entity/Entity.js';

function parseColor(colorStr) {
    let r = 1, g = 1, b = 1;
    if (colorStr.startsWith('#')) {
        let hex = colorStr.substring(1);
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        r = parseInt(hex.substring(0,2), 16) / 255;
        g = parseInt(hex.substring(2,4), 16) / 255;
        b = parseInt(hex.substring(4,6), 16) / 255;
    }
    return [r, g, b];
}

export class ParticleEmitter extends Entity {
    constructor(config = {}) {
        super();
        this.cullRadius = config.cullRadius || 500;
        
        this.maxParticles = config.maxParticles || 1000;
        this.emissionRate = config.emissionRate || 10;
        this.emitTimer = 0;
        this.isEmitting = config.isEmitting !== undefined ? config.isEmitting : true;
        this.oneShot = config.oneShot || false;
        
        this.lifeMin = config.lifeMin || 1;
        this.lifeMax = config.lifeMax || 2;
        this.speedMin = config.speedMin || 50;
        this.speedMax = config.speedMax || 100;
        this.angleMin = config.angleMin || 0;
        this.angleMax = config.angleMax || Math.PI * 2;
        
        this.gravityX = config.gravityX || 0;
        this.gravityY = config.gravityY || 0;
        
        this.sizeStart = config.sizeStart || 5;
        this.sizeEnd = config.sizeEnd || 1;
        
        this.alphaStart = config.alphaStart !== undefined ? config.alphaStart : 1;
        this.alphaEnd = config.alphaEnd !== undefined ? config.alphaEnd : 0;
        
        this.color = config.color || '#ffffff';
        this.blendMode = config.blendMode || 'source-over';
        
        this.pool = []; // For CPU fallback
        for (let i = 0; i < this.maxParticles; i++) {
            this.pool.push({
                x: 0, y: 0, vx: 0, vy: 0,
                life: 0, maxLife: 1, size: 1, alpha: 1, active: false
            });
        }
        
        this.gpuInit = false;
        this.time = 0;
        this.timeStopped = -1.0;
    }
    
    initGPU(gl) {
        if (this.gpuInit) return;
        this.gpuInit = true;
        this.ext = gl.vertexAttribDivisor ? { 
            vertexAttribDivisorANGLE: gl.vertexAttribDivisor.bind(gl), 
            drawArraysInstancedANGLE: gl.drawArraysInstanced.bind(gl) 
        } : gl.getExtension('ANGLE_instanced_arrays');
        
        if (!this.ext) {
            console.warn('Instancing not supported, falling back to CPU particles');
            return;
        }
        
        const vsSource = `
            attribute vec2 aQuadPos;
            attribute float aParticleId;
            
            uniform float uTime;
            uniform vec2 uEmitterPos;
            uniform vec2 uGravity;
            uniform float uEmissionRate;
            uniform float uMaxParticles;
            uniform float uSizeStart;
            uniform float uSizeEnd;
            uniform vec2 uResolution;
            uniform mat3 uTransform;
            
            uniform vec2 uLifeRange;
            uniform vec2 uSpeedRange;
            uniform vec2 uAngleRange;
            
            uniform float uTimeStopped;
            
            varying float vAge;
            
            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
            }
            
            void main() {
                float id = aParticleId;
                
                float cycleDuration = uMaxParticles / uEmissionRate;
                float timeOffset = id / uEmissionRate;
                float timeSinceFirstCycle = uTime - timeOffset;
                
                float cycleNum = floor(max(0.0, timeSinceFirstCycle) / cycleDuration);
                if (timeSinceFirstCycle < 0.0) cycleNum = -1.0;
                
                float seed = id + cycleNum * uMaxParticles;
                float lifeTime = mix(uLifeRange.x, uLifeRange.y, hash(vec2(seed, 0.1)));
                
                float age = timeSinceFirstCycle - cycleNum * cycleDuration;
                
                // If it spawned after emission stopped, hide it
                float spawnTime = uTime - age;
                if (cycleNum < 0.0 || age > lifeTime || (uTimeStopped > 0.0 && spawnTime > uTimeStopped)) {
                    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                    return;
                }
                
                float normalizedAge = age / lifeTime;
                vAge = normalizedAge;
                
                float angle = mix(uAngleRange.x, uAngleRange.y, hash(vec2(seed, 0.2)));
                float speed = mix(uSpeedRange.x, uSpeedRange.y, hash(vec2(seed, 0.3)));
                
                vec2 startVel = vec2(cos(angle), sin(angle)) * speed;
                vec2 pos = uEmitterPos + startVel * age + 0.5 * uGravity * age * age;
                
                float size = mix(uSizeStart, uSizeEnd, normalizedAge);
                vec3 worldPos = uTransform * vec3(pos + aQuadPos * size, 1.0);
                vec2 clipSpace = (worldPos.xy / uResolution) * 2.0 - 1.0;
                gl_Position = vec4(clipSpace * vec2(1, -1), 0.0, 1.0);
            }
        `;
        
        const fsSource = `
            precision mediump float;
            varying float vAge;
            uniform vec4 uColorStart;
            uniform vec4 uColorEnd;
            
            void main() {
                if (vAge < 0.0 || vAge > 1.0) discard;
                gl_FragColor = mix(uColorStart, uColorEnd, vAge);
            }
        `;
        
        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vsSource);
        gl.compileShader(vs);
        
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, fsSource);
        gl.compileShader(fs);
        
        this.shader = gl.createProgram();
        gl.attachShader(this.shader, vs);
        gl.attachShader(this.shader, fs);
        gl.linkProgram(this.shader);
        
        if (!gl.getProgramParameter(this.shader, gl.LINK_STATUS)) {
            console.error('Particle Shader Link Error:', gl.getProgramInfoLog(this.shader));
        }
        
        this.locs = {
            aQuadPos: gl.getAttribLocation(this.shader, "aQuadPos"),
            aParticleId: gl.getAttribLocation(this.shader, "aParticleId"),
            
            uTime: gl.getUniformLocation(this.shader, "uTime"),
            uEmitterPos: gl.getUniformLocation(this.shader, "uEmitterPos"),
            uGravity: gl.getUniformLocation(this.shader, "uGravity"),
            uEmissionRate: gl.getUniformLocation(this.shader, "uEmissionRate"),
            uMaxParticles: gl.getUniformLocation(this.shader, "uMaxParticles"),
            uSizeStart: gl.getUniformLocation(this.shader, "uSizeStart"),
            uSizeEnd: gl.getUniformLocation(this.shader, "uSizeEnd"),
            uResolution: gl.getUniformLocation(this.shader, "uResolution"),
            uTransform: gl.getUniformLocation(this.shader, "uTransform"),
            
            uLifeRange: gl.getUniformLocation(this.shader, "uLifeRange"),
            uSpeedRange: gl.getUniformLocation(this.shader, "uSpeedRange"),
            uAngleRange: gl.getUniformLocation(this.shader, "uAngleRange"),
            uTimeStopped: gl.getUniformLocation(this.shader, "uTimeStopped"),
            
            uColorStart: gl.getUniformLocation(this.shader, "uColorStart"),
            uColorEnd: gl.getUniformLocation(this.shader, "uColorEnd")
        };
        
        this.quadVBO = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -0.5, -0.5,
             0.5, -0.5,
            -0.5,  0.5,
             0.5,  0.5
        ]), gl.STATIC_DRAW);
        
        this.instanceVBO = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
        
        const ids = new Float32Array(this.maxParticles);
        for (let i = 0; i < this.maxParticles; i++) {
            ids[i] = i;
        }
        gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW);
    }
    
    emit(count) {
        if (!this.ext) {
            let emitted = 0;
            for (let i = 0; i < this.pool.length; i++) {
                if (!this.pool[i].active) {
                    const p = this.pool[i];
                    p.active = true;
                    
                    p.x = this.globalX || this.x;
                    p.y = this.globalY || this.y;
                    
                    const angle = this.angleMin + Math.random() * (this.angleMax - this.angleMin);
                    const speed = this.speedMin + Math.random() * (this.speedMax - this.speedMin);
                    
                    p.vx = Math.cos(angle) * speed;
                    p.vy = Math.sin(angle) * speed;
                    
                    p.maxLife = this.lifeMin + Math.random() * (this.lifeMax - this.lifeMin);
                    p.life = p.maxLife;
                    
                    emitted++;
                    if (emitted >= count) break;
                }
            }
        }
    }
    
    onUpdate(dt) {
        this.time += dt;
        
        if (this.isEmitting) {
            this.timeStopped = -1.0;
            this.emitTimer += dt;
            const emitInterval = 1 / this.emissionRate;
            
            if (this.emitTimer >= emitInterval) {
                const count = Math.floor(this.emitTimer / emitInterval);
                this.emitTimer -= count * emitInterval;
                this.emit(count);
                
                if (this.oneShot) {
                    this.isEmitting = false;
                    this.timeStopped = this.time;
                }
            }
        } else if (this.timeStopped < 0) {
            this.timeStopped = this.time;
        }
        
        if (!this.ext) {
            for (let i = 0; i < this.pool.length; i++) {
                const p = this.pool[i];
                if (!p.active) continue;
                
                p.life -= dt;
                if (p.life <= 0) {
                    p.active = false;
                    continue;
                }
                
                p.vx += this.gravityX * dt;
                p.vy += this.gravityY * dt;
                
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                
                const t = 1 - (p.life / p.maxLife);
                p.size = this.sizeStart + (this.sizeEnd - this.sizeStart) * t;
                p.alpha = this.alphaStart + (this.alphaEnd - this.alphaStart) * t;
            }
        }
    }
    
    onRender(r) {
        if (r.gl) {
            this.initGPU(r.gl);
        }
        
        if (this.ext) {
            const gl = r.gl;
            r.flush();
            
            gl.useProgram(this.shader);
            
            gl.uniform1f(this.locs.uTime, this.time);
            gl.uniform2f(this.locs.uEmitterPos, this.globalX || this.x, this.globalY || this.y);
            gl.uniform2f(this.locs.uGravity, this.gravityX, this.gravityY);
            gl.uniform1f(this.locs.uEmissionRate, this.emissionRate);
            gl.uniform1f(this.locs.uMaxParticles, this.maxParticles);
            gl.uniform1f(this.locs.uSizeStart, this.sizeStart);
            gl.uniform1f(this.locs.uSizeEnd, this.sizeEnd);
            
            gl.uniform2f(this.locs.uResolution, r.width, r.height);
            gl.uniformMatrix3fv(this.locs.uTransform, false, r.currentMatrix);
            
            gl.uniform2f(this.locs.uLifeRange, this.lifeMin, this.lifeMax);
            gl.uniform2f(this.locs.uSpeedRange, this.speedMin, this.speedMax);
            gl.uniform2f(this.locs.uAngleRange, this.angleMin, this.angleMax);
            gl.uniform1f(this.locs.uTimeStopped, this.timeStopped);
            
            const [cr, cg, cb] = parseColor(this.color);
            gl.uniform4f(this.locs.uColorStart, cr, cg, cb, this.alphaStart * (r.currentGlobalAlpha || 1));
            gl.uniform4f(this.locs.uColorEnd, cr, cg, cb, this.alphaEnd * (r.currentGlobalAlpha || 1));
            
            gl.enable(gl.BLEND);
            if (this.blendMode === 'lighter') {
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
            } else {
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            }
            
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
            gl.enableVertexAttribArray(this.locs.aQuadPos);
            gl.vertexAttribPointer(this.locs.aQuadPos, 2, gl.FLOAT, false, 0, 0);
            
            gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
            gl.enableVertexAttribArray(this.locs.aParticleId);
            gl.vertexAttribPointer(this.locs.aParticleId, 1, gl.FLOAT, false, 0, 0);
            this.ext.vertexAttribDivisorANGLE(this.locs.aParticleId, 1);
            
            this.ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, this.maxParticles);
            
            this.ext.vertexAttribDivisorANGLE(this.locs.aParticleId, 0);
            gl.disableVertexAttribArray(this.locs.aParticleId);
            gl.disableVertexAttribArray(this.locs.aQuadPos);
            
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            
            if (r.vbo) {
                gl.bindBuffer(gl.ARRAY_BUFFER, r.vbo);
                if (r.setupAttributes) r.setupAttributes();
            }
        } else {
            r.ctx.save();
            r.ctx.globalCompositeOperation = this.blendMode;
            
            for (let i = 0; i < this.pool.length; i++) {
                const p = this.pool[i];
                if (!p.active) continue;
                
                r.ctx.globalAlpha = Math.max(0, p.alpha) * (r.currentGlobalAlpha !== undefined ? r.currentGlobalAlpha : 1);
                r.setFillStyle(this.color);
                r.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
            }
            
            r.ctx.restore();
        }
    }
}
