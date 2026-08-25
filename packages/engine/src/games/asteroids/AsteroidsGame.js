import { Simulation } from '../../engine/simulation/Simulation.js';
import { Entity } from '../../engine/entity/Entity.js';

export class AsteroidsGame extends Simulation {
    constructor(engine) {
        super(engine);
        this.clearColor = '#050508';
        this.score = 0;
        this.lives = 3;
        this.state = 'start'; // start, playing, gameover
        
        // Ensure dummy drawPoly for headless modes
        if (typeof this.engine.renderer.drawPoly === 'undefined') {
            this.engine.renderer.drawPoly = () => {};
        }
    }
    
    onStart() {
        this.engine.camera.set(0, 0, 1);
        this.world.gravityY = 0;
        this.world.gravityX = 0;
        this.world.isInfinite = false; // We will handle wrapping manually
        
        this.score = 0;
        this.lives = 3;
        this.state = 'start';
    }
    
    startGame() {
        this.world.getEntities().length = 0; // Clear entities
        this.score = 0;
        this.lives = 3;
        this.state = 'playing';
        
        this.spawnShip();
        this.spawnAsteroid();
        this.spawnAsteroid();
        this.spawnAsteroid();
        this.spawnAsteroid();
    }
    
    spawnShip() {
        const ship = this.world.spawn(ShipEntity, this);
    }
    
    spawnAsteroid(x, y, radius = 40) {
        if (x === undefined || y === undefined) {
            // Spawn on edges
            const w = this.engine.window.width;
            const h = this.engine.window.height;
            x = (Math.random() > 0.5 ? 1 : -1) * (w/2);
            y = (Math.random() > 0.5 ? 1 : -1) * (h/2);
        }
        
        const asteroid = this.world.spawn(AsteroidEntity, this, radius);
        asteroid.x = x;
        asteroid.y = y;
    }
    
    onUpdate(dt) {
        // Handle level complete (no asteroids left)
        if (this.state === 'playing') {
            const entities = this.world.getEntities();
            let hasAsteroids = false;
            let hasShip = false;
            
            for (let i = 0; i < entities.length; i++) {
                if (entities[i] instanceof AsteroidEntity) hasAsteroids = true;
                if (entities[i] instanceof ShipEntity) hasShip = true;
            }
            
            if (!hasAsteroids) {
                // Next wave
                for(let i=0; i < 5; i++) this.spawnAsteroid();
            }
            
            if (!hasShip) {
                if (this.lives > 0) {
                    this.spawnShip();
                } else {
                    this.state = 'gameover';
                }
            }
        }
    }
    
    onRender(r, camera) {
        // The entities render themselves
    }
    
    onUI(ui) {
        const win = this.engine.window;
        
        // HUD
        ui.text(`SCORE: ${this.score}`, 20, 30, '#fff', 'bold 20px monospace');
        ui.text(`LIVES: ${this.lives}`, 20, 55, '#fff', 'bold 16px monospace');
        
        if (this.state === 'start') {
            ui.panel(win.width/2 - 150, win.height/2 - 100, 300, 200, 'rgba(10,10,10,0.9)');
            ui.text('ASTEROIDS', win.width/2 - 60, win.height/2 - 50, '#4ade80', 'bold 24px monospace');
            if (ui.button('btn_start', 'PLAY', win.width/2 - 60, win.height/2, 120, 40)) {
                this.startGame();
            }
        } else if (this.state === 'gameover') {
            ui.panel(win.width/2 - 150, win.height/2 - 100, 300, 200, 'rgba(10,10,10,0.9)');
            ui.text('GAME OVER', win.width/2 - 65, win.height/2 - 50, '#f87171', 'bold 24px monospace');
            ui.text(`Final Score: ${this.score}`, win.width/2 - 70, win.height/2 - 20, '#fff', '14px monospace');
            if (ui.button('btn_restart', 'RETRY', win.width/2 - 60, win.height/2 + 20, 120, 40)) {
                this.startGame();
            }
        }
    }
}

class ShipEntity extends Entity {
    constructor(game) {
        super();
        this.game = game;
        this.tag = 'player';
        this.cullRadius = 15;
        
        this.rotation = -Math.PI / 2;
        this.thrust = 0;
        this.cooldown = 0;
        
        this.shape = [
            15, 0,
            -10, 10,
            -5, 0,
            -10, -10
        ];
    }
    
    onUpdate(dt) {
        const kb = this.engine.input.keyboard;
        
        if (kb.isKeyDown('ArrowLeft') || kb.isKeyDown('KeyA')) {
            this.rotation -= 5 * dt;
        }
        if (kb.isKeyDown('ArrowRight') || kb.isKeyDown('KeyD')) {
            this.rotation += 5 * dt;
        }
        
        if (kb.isKeyDown('ArrowUp') || kb.isKeyDown('KeyW')) {
            this.thrust = 500;
            // Spawn thrust particles
            if (Math.random() > 0.5) {
                const px = this.x - Math.cos(this.rotation) * 15;
                const py = this.y - Math.sin(this.rotation) * 15;
                this.world.spawn(Particle, px, py, this.rotation + Math.PI + (Math.random() - 0.5) * 0.5);
            }
        } else {
            this.thrust = 0;
        }
        
        if (this.cooldown > 0) this.cooldown -= dt;
        
        if ((kb.isKeyDown('Space') || this.engine.input.mouse.isButtonDown(0)) && this.cooldown <= 0) {
            this.cooldown = 0.15;
            const bullet = this.world.spawn(Bullet, this.x + Math.cos(this.rotation)*15, this.y + Math.sin(this.rotation)*15, this.rotation);
        }
        
        this.vx += Math.cos(this.rotation) * this.thrust * dt;
        this.vy += Math.sin(this.rotation) * this.thrust * dt;
        
        this.vx *= 0.98;
        this.vy *= 0.98;
        
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        
        this.wrapBounds();
        
        // Collision with asteroids
        const others = this.world.grid.queryArea(this.x, this.y, this.cullRadius);
        for(let i=0; i<others.length; i++) {
            if (others[i].tag === 'asteroid') {
                const dx = others[i].x - this.x;
                const dy = others[i].y - this.y;
                if (dx*dx + dy*dy < Math.pow(this.cullRadius + others[i].cullRadius, 2)) {
                    // Boom
                    this.game.lives--;
                    this.destroy();
                    // Explosion
                    for(let p=0; p<30; p++) {
                        this.world.spawn(Particle, this.x, this.y, Math.random() * Math.PI * 2, 200, '#4ade80');
                    }
                    break;
                }
            }
        }
    }
    
    wrapBounds() {
        const win = this.engine.window;
        const hw = win.width / 2;
        const hh = win.height / 2;
        if (this.x < -hw) this.x = hw;
        if (this.x > hw) this.x = -hw;
        if (this.y < -hh) this.y = hh;
        if (this.y > hh) this.y = -hh;
    }
    
    onRender(r, camera) {
        r.setStrokeStyle('#4ade80');
        r.setLineWidth(2);
        r.drawPoly(this.x, this.y, this.rotation, this.shape, true);
    }
}

class Bullet extends Entity {
    constructor(x, y, rotation) {
        super();
        this.onReset(x, y, rotation);
    }
    
    onReset(x, y, rotation) {
        this.tag = 'bullet';
        this.x = x;
        this.y = y;
        this.cullRadius = 2;
        
        const speed = 800;
        this.vx = Math.cos(rotation) * speed;
        this.vy = Math.sin(rotation) * speed;
        this.life = 1.0; // Seconds
    }
    
    onUpdate(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;
        
        if (this.life <= 0) this.destroy();
    }
    
    onRender(r, camera) {
        r.setFillStyle('#fff');
        r.fillCircle(this.x, this.y, 2);
    }
}

class AsteroidEntity extends Entity {
    constructor(game, radius) {
        super();
        this.game = game;
        this.tag = 'asteroid';
        this.cullRadius = radius;
        this.rotation = Math.random() * Math.PI * 2;
        this.rotSpeed = (Math.random() - 0.5) * 2;
        
        const speed = 1500 / radius;
        this.vx = (Math.random() - 0.5) * speed;
        this.vy = (Math.random() - 0.5) * speed;
        
        this.shape = [];
        const verts = Math.floor(Math.random() * 4) + 6;
        for (let i = 0; i < verts; i++) {
            const a = (i / verts) * Math.PI * 2;
            const r = radius * (0.7 + Math.random() * 0.3);
            this.shape.push(Math.cos(a) * r);
            this.shape.push(Math.sin(a) * r);
        }
    }
    
    onUpdate(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.rotation += this.rotSpeed * dt;
        
        this.wrapBounds();
        
        // Check collisions with bullets
        const others = this.world.grid.queryArea(this.x, this.y, this.cullRadius);
        for(let i=0; i<others.length; i++) {
            if (others[i].tag === 'bullet') {
                const dx = others[i].x - this.x;
                const dy = others[i].y - this.y;
                if (dx*dx + dy*dy < Math.pow(this.cullRadius + others[i].cullRadius, 2)) {
                    others[i].destroy();
                    this.split();
                    break;
                }
            }
        }
    }
    
    split() {
        this.destroy();
        this.game.score += Math.floor(1000 / this.cullRadius);
        
        // Spawn particles
        for(let p=0; p<15; p++) {
            this.world.spawn(Particle, this.x, this.y, Math.random() * Math.PI * 2, 100, '#a3a3a3');
        }
        
        if (this.cullRadius > 15) {
            this.game.spawnAsteroid(this.x, this.y, this.cullRadius / 2);
            this.game.spawnAsteroid(this.x, this.y, this.cullRadius / 2);
        }
    }
    
    wrapBounds() {
        const win = this.engine.window;
        const hw = win.width / 2;
        const hh = win.height / 2;
        if (this.x < -hw - this.cullRadius) this.x = hw + this.cullRadius;
        if (this.x > hw + this.cullRadius) this.x = -hw - this.cullRadius;
        if (this.y < -hh - this.cullRadius) this.y = hh + this.cullRadius;
        if (this.y > hh + this.cullRadius) this.y = -hh - this.cullRadius;
    }
    
    onRender(r, camera) {
        r.setStrokeStyle('#a3a3a3');
        r.setLineWidth(2);
        r.drawPoly(this.x, this.y, this.rotation, this.shape, true);
    }
}

class Particle extends Entity {
    constructor(x, y, angle, speed = 150, color = '#fb923c') {
        super();
        this.tag = 'particle';
        this.x = x;
        this.y = y;
        this.vx = Math.cos(angle) * speed * (0.5 + Math.random()*0.5);
        this.vy = Math.sin(angle) * speed * (0.5 + Math.random()*0.5);
        this.life = 0.2 + Math.random() * 0.3;
        this.color = color;
    }
    
    onUpdate(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;
        if (this.life <= 0) this.destroy();
    }
    
    onRender(r) {
        r.setFillStyle(this.color);
        r.fillCircle(this.x, this.y, 2);
    }
}
