export const EXAMPLES = {

    stealth_dungeon: {
        name: "Shadow Stealth",
        description: "Showcases 2D Raycast Shadows, State Machines, Lights, and Synths.",
        files: [
            {
                id: "main",
                name: "main.js",
                code: `
class GuardStateIdle extends State {
    enter() {
        this.entity.speed = 0;
        this.timer = 1 + Math.random() * 2;
        this.entity.getComponent(LightSource).color = '#ffffff';
    }
    update(dt) {
        this.timer -= dt;
        if (this.timer <= 0) {
            this.sm.changeState('Patrol');
        }
        this.checkPlayer();
    }
    
    checkPlayer() {
        const player = this.entity.world.entities.getEntityByTag('player');
        if (!player) return;
        
        const dx = player.x - this.entity.x;
        const dy = player.y - this.entity.y;
        const dist = Math.hypot(dx, dy);
        
        if (dist < 300) {
            const angleToPlayer = Math.atan2(dy, dx);
            let diff = angleToPlayer - this.entity.rotation;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            
            // If within 30 degree cone
            if (Math.abs(diff) < Math.PI / 6) {
                const res = {};
                raycast(this.entity.world, this.entity.x, this.entity.y, angleToPlayer, dist, res);
                const hitEntity = res.isMatterBody ? res.entity.entity : res.entity;
                if (!res.hit || (hitEntity && hitEntity.tag === 'player')) {
                    this.sm.changeState('Alert');
                }
            }
        }
    }
}

class GuardStatePatrol extends GuardStateIdle {
    enter() {
        super.enter();
        this.entity.speed = 70;
        this.targetAngle = Math.random() * Math.PI * 2;
        this.timer = 2 + Math.random() * 3;
    }
    update(dt) {
        this.timer -= dt;
        let diff = this.targetAngle - this.entity.rotation;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.entity.rotation += diff * 5 * dt;

        this.entity.x += Math.cos(this.entity.rotation) * this.entity.speed * dt;
        this.entity.y += Math.sin(this.entity.rotation) * this.entity.speed * dt;

        if (this.timer <= 0) {
            this.sm.changeState('Idle');
        }
        this.checkPlayer();
    }
}

class GuardStateAlert extends State {
    enter() {
        this.entity.speed = 150;
        this.entity.getComponent(LightSource).color = '#ff0000';
        this.entity.engine.audio.playTone(800, 'square', 0.1, 0.3);
        
        // Alert particles
        this.entity.engine.particles.emit({
            x: this.entity.x, y: this.entity.y - 20,
            count: 5, color: '#ff0000', speed: 100, life: 0.5, scale: 3
        });
        
        // Hit stop and shake for juice
        if (this.entity.engine.juice) this.entity.engine.juice.hitStop(0.05);
        this.entity.engine.camera.shake(10, 0.2);
    }
    update(dt) {
        const player = this.entity.world.entities.getEntityByTag('player');
        if (!player) return;
        
        const dx = player.x - this.entity.x;
        const dy = player.y - this.entity.y;
        const dist = Math.hypot(dx, dy);
        
        if (dist > 400) {
            this.sm.changeState('Idle');
            return;
        }
        
        // Chase player
        const angle = Math.atan2(dy, dx);
        this.entity.rotation = angle;
        this.entity.x += Math.cos(angle) * this.entity.speed * dt;
        this.entity.y += Math.sin(angle) * this.entity.speed * dt;
    }
}

class Guard extends Entity {
    constructor(x, y) {
        super();
        this.x = x; this.y = y;
        this.tag = 'guard';
        this.addComponent(new Sprite({ width: 32, height: 32, color: '#ff3333' }));
        
        this.light = new LightSource({ radius: 300, intensity: 1.0 });
        this.addComponent(this.light);

        const fsm = new FSM();
        fsm.addState('Idle', GuardStateIdle);
        fsm.addState('Patrol', GuardStatePatrol);
        fsm.addState('Alert', GuardStateAlert);
        this.addComponent(fsm);
        
        this.addComponent(new PhysicsBody({ width: 32, height: 32, isStatic: false }));
    }
    
    update(dt) {
        this.light.offsetX = Math.cos(this.rotation) * 10;
        this.light.offsetY = Math.sin(this.rotation) * 10;
    }
    
    onStart() {
        this.getComponent(FSM).changeState('Idle');
    }
}

class Player extends Entity {
    constructor(x, y) {
        super();
        this.x = x; this.y = y;
        this.tag = 'player';
        this.addComponent(new Sprite({ width: 24, height: 24, color: '#33ccff' }));
        this.addComponent(new LightSource({ radius: 150, intensity: 0.5, flicker: true, flickerIntensity: 0.05 }));
        this.addComponent(new PhysicsBody({ width: 24, height: 24, isStatic: false }));
        this.addComponent(new TrailRenderer({ color: '#33ccff', width: 6, length: 10 }));
        this.speed = 200;
    }
    
    update(dt) {
        if (this.invulnTimer > 0) this.invulnTimer -= dt;
        const input = this.engine.input;
        let dx = 0, dy = 0;
        if (input.keyboard.isDown('KeyW')) dy -= 1;
        if (input.keyboard.isDown('KeyS')) dy += 1;
        if (input.keyboard.isDown('KeyA')) dx -= 1;
        if (input.keyboard.isDown('KeyD')) dx += 1;
        
        if (dx !== 0 || dy !== 0) {
            const len = Math.sqrt(dx*dx + dy*dy);
            const vx = (dx/len) * this.speed;
            const vy = (dy/len) * this.speed;
            this.getComponent(PhysicsBody).setVelocity(vx, vy);
            this.rotation = Math.atan2(vy, vx);
        } else {
            this.getComponent(PhysicsBody).setVelocity(0, 0);
        }
    }
}

class Wall extends Entity {
    constructor(x, y, w, h) {
        super();
        this.x = x; this.y = y;
        this.addComponent(new Sprite({ width: w, height: h, color: '#555555' }));
        this.addComponent(new PhysicsBody({ width: w, height: h, isStatic: true }));
    }
}

class ShadowStealth extends Simulation {
    onStart() {
        this.clearColor = '#000000';
        
        const pp = this.engine.world.components.systems.find(s => s.constructor.name === 'PostProcessSystem');
        if (pp) {
            pp.crt = true;
            pp.vignette = true;
        }
        
        const ls = this.engine.world.components.systems.find(s => s.constructor.name === 'LightingSystem');
        if (ls) {
            ls.ambientColor = 'rgba(5, 5, 8, 0.95)';
            ls.drawShadows = true;
        }

        // Level bounds
        this.world.addEntity(new Wall(500, -50, 1000, 100));
        this.world.addEntity(new Wall(500, 1050, 1000, 100));
        this.world.addEntity(new Wall(-50, 500, 100, 1000));
        this.world.addEntity(new Wall(1050, 500, 100, 1000));

        // Maze walls
        this.world.addEntity(new Wall(300, 300, 400, 50));
        this.world.addEntity(new Wall(200, 500, 50, 300));
        this.world.addEntity(new Wall(700, 400, 50, 400));
        this.world.addEntity(new Wall(500, 700, 300, 50));
        
        this.world.addEntity(new Guard(400, 200));
        this.world.addEntity(new Guard(800, 200));
        this.world.addEntity(new Guard(300, 800));

        const player = new Player(100, 100);
        this.world.addEntity(player);
        this.camera.trackEntity(player);
    }
}

export default ShadowStealth;
`
            }
        ]
    },
    soft_body: {
        name: "Jelly Physics",
        description: "Soft bodies and cloth simulation using Matter.js.",
        files: [
            {
                id: "main",
                name: "main.js",
                code: `
class Jelly extends Entity {
    constructor(x, y, cols, rows, color) {
        super();
        this.x = x; this.y = y;
        this.addComponent(new SoftBody({
            columns: cols,
            rows: rows,
            columnGap: 10,
            rowGap: 10,
            crossStiffness: 0.9,
            particleRadius: 6,
            friction: 0.1,
            restitution: 0.9,
            color: color
        }));
    }
}

class StaticBox extends Entity {
    constructor(x, y, w, h, angle = 0) {
        super();
        this.x = x; this.y = y; this.rotation = angle;
        this.addComponent(new Sprite({ width: w, height: h, color: '#333333' }));
        this.addComponent(new PhysicsBody({ width: w, height: h, isStatic: true }));
    }
}

class JellyScene extends Simulation {
    onStart() {
        this.clearColor = '#0a0a10';
        
        const pp = this.engine.world.components.systems.find(s => s.constructor.name === 'PostProcessSystem');
        if (pp) {
            pp.crt = true;
            pp.vignette = true;
        }

        const ls = this.engine.world.components.systems.find(s => s.constructor.name === 'LightingSystem');
        if (ls) {
            ls.ambientColor = 'rgba(5, 5, 8, 0.9)';
            ls.drawShadows = true;
        }

        this.engine.world.physicsEngine.gravity.y = 1;

        // Level bounds
        const w = this.engine.window.width;
        const h = this.engine.window.height;
        
        this.world.addEntity(new StaticBox(0, 400, 2000, 50));
        this.world.addEntity(new StaticBox(-400, 0, 50, 2000));
        this.world.addEntity(new StaticBox(400, 0, 50, 2000));
        
        // Slopes
        this.world.addEntity(new StaticBox(-200, 100, 300, 30, Math.PI / 6));
        this.world.addEntity(new StaticBox(200, 200, 300, 30, -Math.PI / 6));

        // Jellies
        this.world.addEntity(new Jelly(-200, -200, 6, 6, '#ff00aa'));
        this.world.addEntity(new Jelly(200, -400, 5, 5, '#00ffcc'));
        this.world.addEntity(new Jelly(0, -600, 4, 8, '#ffff00'));

        // Mouse light
        this.mouseLight = new Entity();
        this.mouseLight.addComponent(new LightSource({ radius: 300, intensity: 1.0, color: '#ffffff' }));
        this.world.addEntity(this.mouseLight);
    }
    
    update(dt) {
        super.update(dt);
        const input = this.engine.input;
        const ui = this.engine.ui;
        
        // Mouse light tracking
        const mouseWorld = this.engine.camera.screenToWorld(input.mouse.x, input.mouse.y);
        this.mouseLight.x = mouseWorld.x;
        this.mouseLight.y = mouseWorld.y;

        ui.begin();
        ui.panel(10, 10, 250, 70, 'rgba(10, 10, 20, 0.8)');
        ui.text("Jelly Physics", 20, 30, '#00ffcc', '16px monospace');
        ui.text("Drag blocks with mouse.", 20, 50, '#ffffff');
        
        if (ui.button("btn_spawn", "Spawn Jelly", 20, 70, 200, 30)) {
            this.world.addEntity(new Jelly(mouseWorld.x, mouseWorld.y, 5, 5, '#00ffcc'));
        }
        ui.end();
        
        // Click and drag physics bodies (primitive implementation)
        if (input.mouse.isButtonPressed(0) && !ui.wantsCaptureMouse) {
            // Find bodies under mouse
            const bodies = Matter.Composite.allBodies(this.engine.world.physicsWorld);
            for(let b of bodies) {
                if (Matter.Bounds.contains(b.bounds, mouseWorld)) {
                    if (Matter.Vertices.contains(b.vertices, mouseWorld)) {
                        if (!b.isStatic) {
                            this.dragBody = b;
                            break;
                        }
                    }
                }
            }
        }
        
        if (input.mouse.isButtonDown(0) && this.dragBody) {
            Matter.Body.setPosition(this.dragBody, mouseWorld);
            Matter.Body.setVelocity(this.dragBody, { x: 0, y: 0 }); // drag body handles differently?
        }
        
        if (input.mouse.isButtonReleased(0)) {
            this.dragBody = null;
        }
    }
}

export default JellyScene;
`
            }
        ]
    },
    grapple_hook: {
        name: "Grapple Hook",
        description: "Swinging physics using raycasting and constraints.",
        files: [
            {
                id: "main",
                name: "main.js",
                code: `
class Player extends Entity {
    constructor(x, y) {
        super();
        this.x = x; this.y = y;
        this.tag = 'player';
        
        this.addComponent(new Sprite({ width: 30, height: 30, color: '#ff00aa', isCircle: true }));
        this.addComponent(new PhysicsBody({ width: 30, height: 30, isStatic: false, restitution: 0.1, frictionAir: 0.02, isCircle: true }));
        this.addComponent(new TrailRenderer({ color: '#ff00aa', width: 20, length: 25 }));
        this.addComponent(new LightSource({ radius: 250, intensity: 0.8, color: '#ff00aa' }));
        
        this.hook = null;
        this.grapplePoint = null;
        this.dashTimer = 0;
    }
    
    update(dt) {
        const input = this.engine.input;
        const ui = this.engine.ui;
        if (ui.wantsCaptureMouse) return;
        
        const body = this.getComponent(PhysicsBody);
        if (!body || !body.body) return;
        
        let dx = 0;
        if (input.keyboard.isDown('KeyA')) dx -= 1;
        if (input.keyboard.isDown('KeyD')) dx += 1;
        
        // Air control
        if (dx !== 0) {
            body.applyForce({ x: dx * 0.001, y: 0 });
        }
        
        this.dashTimer -= dt;
        
        // Mouse aim
        const mouseWorld = this.engine.camera.screenToWorld(input.mouse.x, input.mouse.y);
        
        if (input.mouse.isButtonPressed(0)) {
            // Raycast towards mouse
            const dir = { x: mouseWorld.x - this.x, y: mouseWorld.y - this.y };
            const len = Math.hypot(dir.x, dir.y);
            const normDir = { x: dir.x / len, y: dir.y / len };
            
            const hit = this.engine.world.raycast(this.x, this.y, normDir.x, normDir.y, 600);
            if (hit && hit.entity && hit.entity.tag === 'wall') {
                this.grapplePoint = { x: hit.point.x, y: hit.point.y };
                
                // Add constraint
                this.hook = new PhysicsConstraint({
                    pointB: this.grapplePoint, // world space anchor
                    stiffness: 0.05,
                    damping: 0.05
                });
                this.addComponent(this.hook);
                
                this.engine.camera.shake(8, 0.15);
                this.engine.audio.playTone(600, 'square', 0.1, 0.1);
                
                // Emit particles at hit point
                this.engine.particles.emit({
                    x: this.grapplePoint.x, y: this.grapplePoint.y,
                    count: 10, speed: 200, color: '#ffff00', scale: 3
                });
            }
        }
        
        if (input.mouse.isButtonReleased(0)) {
            if (this.hook) {
                this.removeComponent(this.hook);
                this.hook = null;
                this.grapplePoint = null;
            }
        }
        
        // Draw rope
        if (this.grapplePoint) {
            const renderer = this.engine.renderer;
            renderer.save();
            renderer.setStrokeStyle('#ffff00');
            renderer.setLineWidth(3);
            renderer.beginPath();
            renderer.moveTo(this.x, this.y);
            renderer.lineTo(this.grapplePoint.x, this.grapplePoint.y);
            renderer.stroke();
            renderer.restore();
        }
        
        // Jump / Dash
        if (input.keyboard.isKeyPressed('Space') && this.dashTimer <= 0) {
            body.setVelocity(body.velocity.x, -600);
            this.dashTimer = 1.0;
            this.engine.particles.emit({
                x: this.x, y: this.y + 15,
                count: 15, speed: 100, color: '#ffffff', scale: 4
            });
            if (this.engine.juice) this.engine.juice.hitStop(0.05);
            this.engine.audio.playTone(300, 'triangle', 0.1, 0.2);
        }
    }
}

class LevelWall extends Entity {
    constructor(x, y, w, h, color='#444444') {
        super();
        this.x = x; this.y = y;
        this.tag = 'wall';
        this.addComponent(new Sprite({ width: w, height: h, color: color }));
        this.addComponent(new PhysicsBody({ width: w, height: h, isStatic: true }));
    }
}

class GrappleScene extends Simulation {
    onStart() {
        this.clearColor = '#020202';
        
        const pp = this.engine.world.components.systems.find(s => s.constructor.name === 'PostProcessSystem');
        if (pp) {
            pp.crt = true;
            pp.vignette = true;
        }
        
        const ls = this.engine.world.components.systems.find(s => s.constructor.name === 'LightingSystem');
        if (ls) {
            ls.ambientColor = 'rgba(5, 5, 8, 0.95)';
        }
        
        this.engine.world.physicsEngine.gravity.y = 1.5;
        
        // Build a cave / arena
        this.world.addEntity(new LevelWall(0, 800, 2000, 100)); // Ground
        this.world.addEntity(new LevelWall(-1000, 0, 100, 2000)); // Left
        this.world.addEntity(new LevelWall(1000, 0, 100, 2000)); // Right
        this.world.addEntity(new LevelWall(0, -1000, 2000, 100)); // Ceiling
        
        // Platforms to swing from
        this.world.addEntity(new LevelWall(-400, 300, 200, 40));
        this.world.addEntity(new LevelWall(400, 300, 200, 40));
        this.world.addEntity(new LevelWall(0, -200, 300, 40));
        this.world.addEntity(new LevelWall(-600, -500, 200, 40));
        this.world.addEntity(new LevelWall(600, -500, 200, 40));
        
        // Kill floor
        this.killY = 1200;
        
        const p = new Player(0, 600);
        this.world.addEntity(p);
        this.camera.trackEntity(p, 0, 0);
        this.camera.setDeadZone(100, 100);
        this.player = p;
    }
    
    update(dt) {
        super.update(dt);
        const ui = this.engine.ui;
        
        if (this.player && this.player.y > this.killY) {
            // Respawn
            this.player.getComponent(PhysicsBody).setPosition(0, 600);
            this.player.getComponent(PhysicsBody).setVelocity(0, 0);
        }
        
        ui.begin();
        ui.panel(10, 10, 250, 70, 'rgba(10, 10, 20, 0.8)');
        ui.text("Grappling Hook Demo", 20, 30, '#ff00aa', '16px monospace');
        ui.text("Click to shoot grapple", 20, 50, '#ffffff');
        ui.text("Space to air-dash", 20, 65, '#ffffff');
        ui.end();
    }
}

export default GrappleScene;
`
            }
        ]
    },
    physics_sandbox: {
        name: "Neon Physics Sandbox",
        description: "Showcases Physics, Lights, UI, and Juice.",
        files: [
            {
                id: "main",
                name: "main.js",
                code: `
class Ball extends Entity {
    constructor(x, y, radius, color) {
        super();
        this.x = x; this.y = y;
        this.tag = 'ball';
        
        this.addComponent(new Sprite({ width: radius*2, height: radius*2, color: color, isCircle: true }));
        this.addComponent(new PhysicsBody({ width: radius*2, height: radius*2, isStatic: false, restitution: 0.9, friction: 0.01, isCircle: true }));
        this.addComponent(new LightSource({ radius: radius * 6, intensity: 0.8, color: color }));
        this.addComponent(new TrailRenderer({ color: color, width: radius, length: 15 }));
    }
    
    onCollision(other, pair) {
        if (pair.collision.depth > 2) {
            this.engine.particles.emit({
                x: this.x, y: this.y,
                count: 5, color: this.getComponent(Sprite).color, speed: 50, life: 0.3, scale: 2
            });
            // Small tone on bounce based on size
            this.engine.audio.playTone(400 + Math.random() * 400, 'sine', 0.1, 0.1);
        }
    }
}

class Wall extends Entity {
    constructor(x, y, w, h) {
        super();
        this.x = x; this.y = y;
        this.addComponent(new Sprite({ width: w, height: h, color: '#333333' }));
        this.addComponent(new PhysicsBody({ width: w, height: h, isStatic: true, restitution: 0.5 }));
    }
}

class NeonSandbox extends Simulation {
    onStart() {
        this.clearColor = '#050505';
        
        const pp = this.engine.world.components.systems.find(s => s.constructor.name === 'PostProcessSystem');
        if (pp) {
            pp.crt = true;
            pp.vignette = true;
        }
        
        const ls = this.engine.world.components.systems.find(s => s.constructor.name === 'LightingSystem');
        if (ls) {
            ls.ambientColor = 'rgba(10, 10, 15, 0.95)';
            ls.drawShadows = true;
        }

        const w = this.engine.window.width;
        const h = this.engine.window.height;
        
        // Bounds
        this.world.addEntity(new Wall(w/2, -50, w, 100));
        this.world.addEntity(new Wall(w/2, h+50, w, 100));
        this.world.addEntity(new Wall(-50, h/2, 100, h));
        this.world.addEntity(new Wall(w+50, h/2, 100, h));
        
        // Obstacles
        this.world.addEntity(new Wall(w/2, h/2 + 100, 300, 40));
        this.world.addEntity(new Wall(w/4, h/2 - 100, 200, 40));
        this.world.addEntity(new Wall(w*0.75, h/2 - 100, 200, 40));
        
        // Settings
        this.settings = {
            gravity: 1,
            timeScale: 1,
            lightRadius: 200,
            spawnSize: 15
        };
        
        this.mouseLight = new Entity();
        this.mouseLight.addComponent(new LightSource({ radius: 200, intensity: 1.0, color: '#ffffff' }));
        this.world.addEntity(this.mouseLight);
        
        this.colors = ['#ff0055', '#00ffcc', '#ffff00', '#aa00ff'];
    }
    
    update(dt) {
        super.update(dt);
        const input = this.engine.input;
        const ui = this.engine.ui;
        
        // Mouse light
        this.mouseLight.x = input.mouse.x;
        this.mouseLight.y = input.mouse.y;
        this.mouseLight.getComponent(LightSource).radius = this.settings.lightRadius;
        
        ui.begin();
        
        ui.panel(10, 10, 250, 160, 'rgba(20, 20, 25, 0.8)');
        ui.text("Neon Sandbox Settings", 20, 30, '#00ffcc');
        
        this.settings.gravity = ui.slider('grav', 'Gravity', 20, 50, 230, 20, -2, 2, this.settings.gravity);
        this.settings.timeScale = ui.slider('time', 'Time Scale', 20, 80, 230, 20, 0.1, 3, this.settings.timeScale);
        this.settings.lightRadius = ui.slider('light', 'Mouse Light', 20, 110, 230, 20, 50, 500, this.settings.lightRadius);
        this.settings.spawnSize = ui.slider('size', 'Spawn Size', 20, 140, 230, 20, 5, 50, this.settings.spawnSize);
        
        ui.end();
        
        this.engine.world.physicsEngine.gravity.y = this.settings.gravity;
        if (!this.engine.juice.hitStopTimer && !this.engine.juice.slowMoTimer) {
            this.engine.time.timeScale = this.settings.timeScale;
        }
        
        // Spawn balls
        if (input.mouse.isButtonPressed(0) && !ui.wantsCaptureMouse) {
            const color = this.colors[Math.floor(Math.random() * this.colors.length)];
            const b = new Ball(input.mouse.x, input.mouse.y, this.settings.spawnSize, color);
            this.world.addEntity(b);
            
            this.engine.camera.shake(5, 0.1);
        }
    }
}

export default NeonSandbox;
`
            }
        ]
    },
    juicy_shooter: {
        name: "Juicy Shooter",
        description: "Showcases Hit Stop, Camera Shake, Trails, and Particles.",
        files: [
            {
                id: "main",
                name: "main.js",
                code: "class Player extends Entity {\n    constructor() {\n        super();\n        this.tag = 'player';\n        this.addComponent(new Sprite({ width: 32, height: 32, color: '#00ffcc' }));\n        this.addComponent(new TrailRenderer({ color: '#00ffcc', width: 4, length: 15 }));\n        this.addComponent(new LightSource({ radius: 200, intensity: 0.6, flicker: true }));\n        this.speed = 300;\n        \n        // Weapon\n        this.fireRate = 0.1;\n        this.fireTimer = 0;\n    }\n    \n    update(dt) {\n        const input = this.engine.input;\n        let dx = 0, dy = 0;\n        \n        if (input.keyboard.isDown('KeyW')) dy -= 1;\n        if (input.keyboard.isDown('KeyS')) dy += 1;\n        if (input.keyboard.isDown('KeyA')) dx -= 1;\n        if (input.keyboard.isDown('KeyD')) dx += 1;\n        \n        if (dx !== 0 || dy !== 0) {\n            const len = Math.sqrt(dx*dx + dy*dy);\n            this.x += (dx/len) * this.speed * dt;\n            this.y += (dy/len) * this.speed * dt;\n        }\n        \n        // Mouse look\n        const mouseWorld = this.engine.camera.screenToWorld(input.mouse.x, input.mouse.y);\n        const angle = Math.atan2(mouseWorld.y - this.y, mouseWorld.x - this.x);\n        this.rotation = angle;\n        \n        // Shoot\n        this.fireTimer -= dt;\n        if (input.mouse.leftDown && this.fireTimer <= 0) {\n            this.fireTimer = this.fireRate;\n            this.shoot(mouseWorld.x, mouseWorld.y);\n        }\n    }\n    \n    shoot(mx, my) {\n        // Screen shake on shoot\n        this.engine.camera.shake(3, 0.1);\n        \n        // Spawn bullet\n        const b = new Bullet(this.x, this.y, this.rotation);\n        this.world.addEntity(b);\n    }\n}\n\nclass Bullet extends Entity {\n    constructor(x, y, angle) {\n        super();\n        this.x = x;\n        this.y = y;\n        this.rotation = angle;\n        this.tag = 'bullet';\n        this.addComponent(new Sprite({ width: 12, height: 4, color: '#ffff00' }));\n        this.addComponent(new TrailRenderer({ color: '#ffff00', width: 2, length: 5 }));\n        this.addComponent(new Lifespan({ duration: 2.0 }));\n        this.addComponent(new LightSource({ radius: 50, intensity: 1.0 }));\n        \n        const speed = 1000;\n        this.vx = Math.cos(angle) * speed;\n        this.vy = Math.sin(angle) * speed;\n    }\n    \n    update(dt) {\n        this.x += this.vx * dt;\n        this.y += this.vy * dt;\n        \n        // Check collisions with enemies\n        const enemies = this.world.entities.getEntitiesByTag('enemy');\n        for(let e of enemies) {\n            const dist = Math.hypot(e.x - this.x, e.y - this.y);\n            if (dist < 25) {\n                e.hit();\n                this.destroy();\n                break;\n            }\n        }\n    }\n}\n\nclass Enemy extends Entity {\n    constructor(x, y) {\n        super();\n        this.x = x;\n        this.y = y;\n        this.tag = 'enemy';\n        this.addComponent(new Sprite({ width: 24, height: 24, color: '#ff0044' }));\n        this.addComponent(new TrailRenderer({ color: '#ff0044', width: 8, length: 10 }));\n        this.health = 3;\n        this.addComponent(new Flash());\n    }\n    \n    update(dt) {\n        const player = this.world.entities.getEntityByTag('player');\n        if (player) {\n            const angle = Math.atan2(player.y - this.y, player.x - this.x);\n            this.rotation = angle;\n            this.x += Math.cos(angle) * 150 * dt;\n            this.y += Math.sin(angle) * 150 * dt;\n        }\n    }\n    \n    hit() {\n        this.health--;\n        // Hit stop!\n        if (this.engine.juice) this.engine.juice.hitStop(0.05);\n        this.engine.camera.shake(10, 0.2);\n        \n        // Particles\n        this.engine.particles.emit({\n            x: this.x, y: this.y,\n            count: 15,\n            speed: 300,\n            life: 0.5,\n            color: '#ff0044',\n            scale: 5\n        });\n        \n        if (this.health <= 0) {\n            this.destroy();\n        }\n    }\n}\n\nclass Spawner extends Entity {\n    constructor() {\n        super();\n        this.timer = 0;\n    }\n    update(dt) {\n        this.timer -= dt;\n        if (this.timer <= 0) {\n            this.timer = 1.0;\n            const r = Math.random() * Math.PI * 2;\n            const dist = 600;\n            const player = this.world.entities.getEntityByTag('player');\n            if (player) {\n                this.world.addEntity(new Enemy(player.x + Math.cos(r) * dist, player.y + Math.sin(r) * dist));\n            }\n        }\n    }\n}\n\nclass JuicyShooter extends Simulation {\n    onStart() {\n        this.clearColor = '#050510';\n        // Add parallax background\n        for(let i=0; i<50; i++) {\n            const star = new Entity();\n            star.x = (Math.random() - 0.5) * 2000;\n            star.y = (Math.random() - 0.5) * 2000;\n            star.addComponent(new Sprite({ width: 3, height: 3, color: '#ffffff', opacity: 0.5 }));\n            star.addComponent(new Parallax({ scrollFactorX: 0.1, scrollFactorY: 0.1 }));\n            this.world.addEntity(star);\n        }\n        \n        const p = new Player();\n        this.engine.world.components.systems.find(s => s.constructor.name === 'PostProcessSystem').crt = true;\n        this.world.addEntity(p);\n        this.camera.trackEntity(p);\n        this.world.addEntity(new Spawner());\n    }\n}\n\nexport default JuicyShooter;\n"
            }
        ]
    },
    
    cube_runner: { 
        name: "Cube Runner", 
        description: "Infinite runner platformer with procedural generation.", 
        files: [
            {
                id: 'main',
                name: 'main.js',
                code: `
class Player extends Entity {
    constructor(x, y) {
        super();
        this.x = x; this.y = y;
        this.tag = 'player';
        this.width = 30; this.height = 30; this.colliderType = 'box';
        this.addComponent(new Sprite({ width: 30, height: 30, color: '#00ffcc' }));
        this.addComponent(new PhysicsBody({ width: 30, height: 30, restitution: 0, friction: 0 }));
        this.addComponent(new TrailRenderer({ color: '#00ffcc', width: 25, length: 15 }));
        this.addComponent(new LightSource({ radius: 200, intensity: 0.8, color: '#00ffcc' }));
        
        this.vx = 400;
        this.isDead = false;
    }
    
    update(dt) {
        if (this.isDead) return;
        if (this.y > 2000) return this.die('fell out of world');
        const body = this.getComponent(PhysicsBody);
        if (!body || !body.body) return;
        
        // Force constant right velocity
        body.setVelocity(this.vx, body.velocity.y);
        
        // Check if on ground
        let onGround = false;
        const start = { x: this.x, y: this.y };
        const hit = this.engine.world.raycast(this.x, this.y, this.x, this.y + 25, 0, this);
        if (hit) console.log('Raycast hit:', hit.tag, 'dist to ground?', this.y - hit.y);
        if (hit && hit.tag === 'ground') {
            onGround = true;
            // Snap rotation
            const targetRot = Math.round(this.rotation / (Math.PI/2)) * (Math.PI/2);
            body.setAngle(targetRot);
            body.setAngularVelocity(0);
        } else {
            // Spin in air
            body.setAngularVelocity((Math.PI * 1.5) / 60);
        }
        
        const input = this.engine.input;
        if ((input.keyboard.isKeyDown('Space') || input.mouse.isButtonDown(0)) && onGround) {
            body.setVelocity(this.vx, -650);
            this.engine.particles.emit({
                x: this.x, y: this.y + 15,
                count: 15, speed: 100, color: '#ffffff', scale: 3
            });
            this.engine.audio.playTone(300, 'square', 0.1, 0.1);
        }
    }
    
    onCollision(other, pair) {
        if (this.isDead) return;
        // Check if we hit a wall sideways
        if (other.tag === 'ground') {
            if (this.x < other.x - other.width/2 - 10 && this.y > other.y - other.height/2 + 5) {
                this.die("collision with " + other.tag, other);
            }
        } else if (other.tag === 'spike') {
            this.die("collision with " + other.tag, other);
        }
    }
    
    die(reason, other) {
        if (this.isDead) return;
        this.isDead = true;
        const body = this.getComponent(PhysicsBody);
        if (body) {
             body.setVelocity(0, 0);
             body.setAngularVelocity(0);
             body.setStatic(true);
        }
        this.deathReason = reason + " P_y:" + Math.round(this.y) + (other ? " O_y:" + Math.round(other.y) : "");
        this.engine.camera.shake(15, 0.4);
        if (this.engine.juice) this.engine.juice.hitStop(0.1);
        this.engine.audio.playTone(150, 'sawtooth', 0.1, 0.4);
        
        this.engine.particles.emit({
            x: this.x, y: this.y,
            count: 30, speed: 200, color: '#00ffcc', scale: 5
        });
        
        this.getComponent(Sprite).enabled = false;
        
        // Wait then restart
        setTimeout(() => {
            if (this.engine) this.engine.simulations.activeSimulation.restart();
        }, 1000);
    }
}

class Block extends Entity {
    constructor(x, y, w, h, isSpike = false) {
        super();
        this.x = x; this.y = y;
        this.width = w; this.height = h; this.colliderType = 'box';
        this.tag = isSpike ? 'spike' : 'ground';
        
        if (isSpike) {
            this.addComponent(new Sprite({ width: w, height: h, color: '#ff0044' })); // Replace with polygon if needed
            this.addComponent(new PhysicsBody({ width: w, height: h, isStatic: true }));
        } else {
            this.addComponent(new Sprite({ width: w, height: h, color: '#333333' }));
            this.addComponent(new PhysicsBody({ width: w, height: h, isStatic: true, friction: 0 }));
        }
    }
}

class CubeRunner extends Simulation {
    onStart() {
        this.clearColor = '#050508';
        this.engine.world.physicsEngine.gravity.y = 2.5;
        
        const pp = this.engine.world.components.systems.find(s => s.constructor.name === 'PostProcessSystem');
        if (pp) {
            pp.crt = true;
            pp.vignette = true;
        }

        const ls = this.engine.world.components.systems.find(s => s.constructor.name === 'LightingSystem');
        if (ls) {
            ls.ambientColor = 'rgba(10, 10, 15, 0.9)';
            ls.drawShadows = true;
        }
        
        this.restart();
    }
    
    restart() {
        this.world.entities.clear();
        
        this.player = new Player(0, -100);
        this.world.addEntity(this.player);
        this.camera.trackEntity(this.player, 200, -100);
        
        // Generate Level
        let cursorX = -500;
        let groundY = 200;
        
        for(let i=0; i<100; i++) {
            // Ground chunk
            const width = 500 + Math.random() * 800;
            this.world.addEntity(new Block(cursorX + width/2, groundY, width, 100));
            
            // Add some spikes or blocks
            if (i > 1) {
                const type = Math.random();
                if (type < 0.3) {
                    // Spike
                    this.world.addEntity(new Block(cursorX + width/2, groundY - 65, 30, 30, true));
                } else if (type < 0.6) {
                    // Block jump
                    this.world.addEntity(new Block(cursorX + width/2, groundY - 65, 30, 30, false));
                }
            }
            
            cursorX += width;
            
            // Gap
            if (Math.random() < 0.4 && i > 0) {
                cursorX += 150 + Math.random() * 150;
            }
            
            // Height change
            if (Math.random() < 0.5) {
                groundY += (Math.random() > 0.5 ? 1 : -1) * (50 + Math.random() * 100);
            }
        }
    }
    
    update(dt) {
        super.update(dt);
        const ui = this.engine.ui;
        ui.begin();
        ui.text("CUBE RUNNER - Click/Space to Jump", 20, 30, '#00ffcc', '20px monospace');
        ui.end();
        
        if (this.player && this.player.y > 2000) {
            this.player.die();
        }
    }
}

export default CubeRunner;
`
            }
        ]
    }
};
