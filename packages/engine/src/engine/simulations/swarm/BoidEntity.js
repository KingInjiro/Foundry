import { Entity } from '../../entity/Entity.js';

export class BoidEntity extends Entity {
    /**
     * @param {import('./SwarmSimulation.js').SwarmSimulation} swarm 
     */
    constructor(swarm) {
        super();
        this.tag = 'boid';
        this.swarm = swarm;
        this.cullRadius = 15;
        
        this.maxSpeed = 300;
        this.maxForce = 1000;
        
        this.ax = 0;
        this.ay = 0;
        
        this.color = `hsl(${Math.random() * 360}, 80%, 60%)`;
        this.rotation = 0;
    }
    
    onSpawn(world) {
        const hw = world.width / 2;
        const hh = world.height / 2;
        this.x = (Math.random() * 2 - 1) * hw;
        this.y = (Math.random() * 2 - 1) * hh;
        
        const angle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(angle) * this.maxSpeed;
        this.vy = Math.sin(angle) * this.maxSpeed;
    }
    
    onUpdate(dt) {
        if (this.swarm.useWasm && this.swarm.wasmInstance) return; // Handled in batch by WASM
        
        // Flocking behavior
        this.flock();
        
        // Apply acceleration
        this.vx += this.ax * dt;
        this.vy += this.ay * dt;
        
        // Limit speed
        const speedSq = this.vx * this.vx + this.vy * this.vy;
        if (speedSq > this.maxSpeed * this.maxSpeed) {
            const speed = Math.sqrt(speedSq);
            this.vx = (this.vx / speed) * this.maxSpeed;
            this.vy = (this.vy / speed) * this.maxSpeed;
        }
        
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        
        // Update rotation for rendering
        this.rotation = Math.atan2(this.vy, this.vx);
        
        // Reset acceleration
        this.ax = 0;
        this.ay = 0;
        
        // Wrap around bounds
        const hw = this.world.width / 2;
        const hh = this.world.height / 2;
        if (this.x < -hw) this.x = hw;
        else if (this.x > hw) this.x = -hw;
        
        if (this.y < -hh) this.y = hh;
        else if (this.y > hh) this.y = -hh;
    }
    
    /**
     * Applies Craig Reynolds' Separation, Alignment, and Cohesion forces.
     * 
     * To achieve zero-allocation (avoiding Garbage Collection pauses), this 
     * algorithm uses inline scalar math rather than instantiating Vector objects 
     * for intermediate calculations.
     */
    flock() {
        const boids = this.world.entities.entities;
        const perceptionRadius = this.swarm.perceptionRadius;
        const perceptionRadiusSq = perceptionRadius * perceptionRadius;
        
        // Separation: Steer to avoid crowding local flockmates
        let sepX = 0, sepY = 0;
        let sepCount = 0;
        
        // Alignment: Steer towards the average heading of local flockmates
        let aliX = 0, aliY = 0;
        let aliCount = 0;
        
        // Cohesion: Steer to move toward the average position of local flockmates
        let cohX = 0, cohY = 0;
        let cohCount = 0;
        
        // Zero-allocation Spatial Grid Query
        const grid = this.world.grid;
        
        // This returns a shared buffer array, which is fast and allocates 0 garbage
        const candidates = grid.queryArea(this.x, this.y, perceptionRadius);
        
        for (let i = 0; i < candidates.length; i++) {
            const other = candidates[i];
            
            // Skip self and destroyed entities
            if (other === this || other.tag !== 'boid' || other.isDestroyed) continue;
            
            // Inline distance calculation
            const dx = this.x - other.x;
            const dy = this.y - other.y;
            const distSq = dx * dx + dy * dy;
            
            if (distSq > 0 && distSq < perceptionRadiusSq) {
                        const dist = Math.sqrt(distSq);
                        
                        // Separation - Repel inversely proportional to distance
                        sepX += (dx / dist) / dist;
                        sepY += (dy / dist) / dist;
                        sepCount++;
                        
                        // Alignment - Sum up velocities
                        aliX += other.vx;
                        aliY += other.vy;
                        aliCount++;
                        
                        // Cohesion - Sum up positions to find center of mass
                        cohX += other.x;
                        cohY += other.y;
                        cohCount++;
                    }
                }
        
        // Apply Separation
        if (sepCount > 0) {
            sepX /= sepCount;
            sepY /= sepCount;
            // Normalize and scale to maxSpeed
            const mag = Math.sqrt(sepX * sepX + sepY * sepY);
            if (mag > 0) {
                sepX = (sepX / mag) * this.maxSpeed;
                sepY = (sepY / mag) * this.maxSpeed;
                
                // Steering = Desired - Velocity
                let steerX = sepX - this.vx;
                let steerY = sepY - this.vy;
                
                // Limit force
                const steerMag = Math.sqrt(steerX * steerX + steerY * steerY);
                if (steerMag > this.maxForce) {
                    steerX = (steerX / steerMag) * this.maxForce;
                    steerY = (steerY / steerMag) * this.maxForce;
                }
                
                this.ax += steerX * this.swarm.separationWeight;
                this.ay += steerY * this.swarm.separationWeight;
            }
        }
        
        // Apply Alignment
        if (aliCount > 0) {
            aliX /= aliCount;
            aliY /= aliCount;
            
            const mag = Math.sqrt(aliX * aliX + aliY * aliY);
            if (mag > 0) {
                aliX = (aliX / mag) * this.maxSpeed;
                aliY = (aliY / mag) * this.maxSpeed;
                
                let steerX = aliX - this.vx;
                let steerY = aliY - this.vy;
                
                const steerMag = Math.sqrt(steerX * steerX + steerY * steerY);
                if (steerMag > this.maxForce) {
                    steerX = (steerX / steerMag) * this.maxForce;
                    steerY = (steerY / steerMag) * this.maxForce;
                }
                
                this.ax += steerX * this.swarm.alignmentWeight;
                this.ay += steerY * this.swarm.alignmentWeight;
            }
        }
        
        // Apply Cohesion
        if (cohCount > 0) {
            cohX /= cohCount;
            cohY /= cohCount;
            
            // Vector towards center of mass
            let desiredX = cohX - this.x;
            let desiredY = cohY - this.y;
            
            const mag = Math.sqrt(desiredX * desiredX + desiredY * desiredY);
            if (mag > 0) {
                desiredX = (desiredX / mag) * this.maxSpeed;
                desiredY = (desiredY / mag) * this.maxSpeed;
                
                let steerX = desiredX - this.vx;
                let steerY = desiredY - this.vy;
                
                const steerMag = Math.sqrt(steerX * steerX + steerY * steerY);
                if (steerMag > this.maxForce) {
                    steerX = (steerX / steerMag) * this.maxForce;
                    steerY = (steerY / steerMag) * this.maxForce;
                }
                
                this.ax += steerX * this.swarm.cohesionWeight;
                this.ay += steerY * this.swarm.cohesionWeight;
            }
        }
    }
    
    onRender(r, camera) {
        return; // Rendered by SwarmSimulation using Instancing
        const ctx = r.ctx;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        
        r.setFillStyle(this.color);
        
        // Draw directional triangle
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(-6, 5);
        ctx.lineTo(-6, -5);
        ctx.closePath();
        ctx.fill();
        
        ctx.restore();
    }
}
