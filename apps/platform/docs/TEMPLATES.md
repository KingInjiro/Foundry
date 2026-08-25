# Foundry Engine Templates

Here are 5 diverse game templates you can paste directly into the Foundry Engine code editor to stress-test the API.

## 1. Minimal Platformer
```javascript
export class CustomGame {
    constructor(engine) {
        this.engine = engine;
    }

    start() {
        const floor = this.engine.world.spawn();
        floor.addComponent('Transform', { position: { x: 0, y: 150 }, scale: { x: 800, y: 50 } });
        floor.addComponent('SpriteRenderer', { color: '#4CAF50' });
        floor.addComponent('RigidBody', { isStatic: true });
        floor.addComponent('BoxCollider', { width: 800, height: 50 });

        const player = this.engine.world.spawn();
        player.addComponent('Transform', { position: { x: 0, y: -50 }, scale: { x: 30, y: 30 } });
        player.addComponent('SpriteRenderer', { color: '#F44336' });
        const rb = player.addComponent('RigidBody', { mass: 1, restitution: 0.0 });
        player.addComponent('BoxCollider', { width: 30, height: 30 });
        
        player.addComponent('Script', {
            update: (entity, dt, engine) => {
                const speed = 200;
                let vx = 0;
                if (engine.input.keyboard.isKey('ArrowLeft')) vx -= speed;
                if (engine.input.keyboard.isKey('ArrowRight')) vx += speed;
                rb.velocity.x = vx;
                
                if (engine.input.keyboard.isKeyDown('Space') && Math.abs(rb.velocity.y) < 1) {
                    rb.velocity.y = -350;
                }
            }
        });
    }
}
```

## 2. Idle Clicker
```javascript
export class CustomGame {
    constructor(engine) {
        this.engine = engine;
    }

    start() {
        this.score = 0;
        
        const cookie = this.engine.world.spawn();
        cookie.addComponent('Transform', { position: { x: 0, y: 0 }, scale: { x: 100, y: 100 } });
        cookie.addComponent('SpriteRenderer', { color: '#FFC107', borderRadius: 50 });
        cookie.addComponent('BoxCollider', { width: 100, height: 100 });
        cookie.addComponent('Script', {
            update: (entity, dt, engine) => {
                if (engine.input.mouse.leftDown) {
                    // Check bounds manually or use physics
                    const m = engine.input.mouse.position;
                    if (m.x > -50 && m.x < 50 && m.y > -50 && m.y < 50) {
                        this.score++;
                        console.log("Score:", this.score);
                        entity.getComponent('Transform').scale.x = 90;
                        entity.getComponent('Transform').scale.y = 90;
                    }
                } else {
                    entity.getComponent('Transform').scale.x = 100;
                    entity.getComponent('Transform').scale.y = 100;
                }
            }
        });
    }
}
```

## 3. Basic Tower Defense
```javascript
export class CustomGame {
    constructor(engine) {
        this.engine = engine;
    }

    start() {
        // Base
        const base = this.engine.world.spawn();
        base.addComponent('Transform', { position: { x: -300, y: 0 }, scale: { x: 50, y: 100 } });
        base.addComponent('SpriteRenderer', { color: '#2196F3' });

        // Spawner
        let timer = 0;
        const spawner = this.engine.world.spawn();
        spawner.addComponent('Script', {
            update: (entity, dt, engine) => {
                timer += dt;
                if (timer > 2) {
                    timer = 0;
                    const enemy = engine.world.spawn();
                    enemy.addComponent('Transform', { position: { x: 400, y: (Math.random() - 0.5) * 100 }, scale: { x: 20, y: 20 } });
                    enemy.addComponent('SpriteRenderer', { color: '#E91E63' });
                    enemy.addComponent('Script', {
                        update: (e, d, eng) => {
                            e.getComponent('Transform').position.x -= 100 * d;
                        }
                    });
                }
            }
        });
    }
}
```

## 4. Top-Down RPG Movement
```javascript
export class CustomGame {
    constructor(engine) {
        this.engine = engine;
    }

    start() {
        const hero = this.engine.world.spawn();
        hero.addComponent('Transform', { position: { x: 0, y: 0 }, scale: { x: 40, y: 40 } });
        hero.addComponent('SpriteRenderer', { color: '#9C27B0' });
        
        hero.addComponent('Script', {
            update: (entity, dt, engine) => {
                const t = entity.getComponent('Transform');
                const speed = 150;
                if (engine.input.keyboard.isKey('KeyW')) t.position.y -= speed * dt;
                if (engine.input.keyboard.isKey('KeyS')) t.position.y += speed * dt;
                if (engine.input.keyboard.isKey('KeyA')) t.position.x -= speed * dt;
                if (engine.input.keyboard.isKey('KeyD')) t.position.x += speed * dt;
            }
        });
    }
}
```

## 5. Bouncing DVD Logo (Physics Stress Test)
```javascript
export class CustomGame {
    constructor(engine) {
        this.engine = engine;
    }

    start() {
        // Walls
        const makeWall = (x, y, w, h) => {
            const wall = this.engine.world.spawn();
            wall.addComponent('Transform', { position: { x, y }, scale: { x: w, y: h } });
            wall.addComponent('SpriteRenderer', { color: '#555' });
            wall.addComponent('RigidBody', { isStatic: true });
            wall.addComponent('BoxCollider', { width: w, height: h });
        };
        
        makeWall(0, -200, 400, 20);
        makeWall(0, 200, 400, 20);
        makeWall(-200, 0, 20, 400);
        makeWall(200, 0, 20, 400);

        // Bouncer
        const logo = this.engine.world.spawn();
        logo.addComponent('Transform', { position: { x: 0, y: 0 }, scale: { x: 40, y: 20 } });
        logo.addComponent('SpriteRenderer', { color: '#00BCD4' });
        const rb = logo.addComponent('RigidBody', { mass: 1, restitution: 1.0, gravityScale: 0 });
        logo.addComponent('BoxCollider', { width: 40, height: 20 });
        rb.velocity = { x: 150, y: 120 };
    }
}
```
