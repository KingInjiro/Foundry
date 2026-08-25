export function updateBoids(
    ptr: i32, // pointer to boids data (x, y, vx, vy) * N
    count: i32,
    dt: f32,
    perceptionRadius: f32,
    separationWeight: f32,
    alignmentWeight: f32,
    cohesionWeight: f32,
    maxSpeed: f32,
    maxForce: f32,
    width: f32,
    height: f32
): void {
    let perceptionRadiusSq = perceptionRadius * perceptionRadius;
    let hw = width / 2.0;
    let hh = height / 2.0;

    for (let i = 0; i < count; i++) {
        let pA = ptr + i * 16; // 4 floats = 16 bytes
        let x = load<f32>(pA);
        let y = load<f32>(pA + 4);
        let vx = load<f32>(pA + 8);
        let vy = load<f32>(pA + 12);

        let sepX: f32 = 0; let sepY: f32 = 0; let sepCount: f32 = 0;
        let aliX: f32 = 0; let aliY: f32 = 0; let aliCount: f32 = 0;
        let cohX: f32 = 0; let cohY: f32 = 0; let cohCount: f32 = 0;

        for (let j = 0; j < count; j++) {
            if (i == j) continue;
            let pB = ptr + j * 16;
            let ox = load<f32>(pB);
            let oy = load<f32>(pB + 4);
            let dx = x - ox;
            let dy = y - oy;
            let distSq = dx * dx + dy * dy;

            if (distSq > 0 && distSq < perceptionRadiusSq) {
                let dist = Math.sqrt(distSq) as f32;
                
                // separation
                sepX += (dx / dist) / dist;
                sepY += (dy / dist) / dist;
                sepCount += 1.0;

                // alignment
                let ovx = load<f32>(pB + 8);
                let ovy = load<f32>(pB + 12);
                aliX += ovx;
                aliY += ovy;
                aliCount += 1.0;

                // cohesion
                cohX += ox;
                cohY += oy;
                cohCount += 1.0;
            }
        }

        let ax: f32 = 0;
        let ay: f32 = 0;

        // Apply forces
        if (sepCount > 0) {
            sepX /= sepCount;
            sepY /= sepCount;
            let mag = Math.sqrt(sepX * sepX + sepY * sepY) as f32;
            if (mag > 0) {
                sepX = (sepX / mag) * maxSpeed;
                sepY = (sepY / mag) * maxSpeed;
                let steerX = sepX - vx;
                let steerY = sepY - vy;
                let steerMag = Math.sqrt(steerX * steerX + steerY * steerY) as f32;
                if (steerMag > maxForce) {
                    steerX = (steerX / steerMag) * maxForce;
                    steerY = (steerY / steerMag) * maxForce;
                }
                ax += steerX * separationWeight;
                ay += steerY * separationWeight;
            }
        }

        if (aliCount > 0) {
            aliX /= aliCount;
            aliY /= aliCount;
            let mag = Math.sqrt(aliX * aliX + aliY * aliY) as f32;
            if (mag > 0) {
                aliX = (aliX / mag) * maxSpeed;
                aliY = (aliY / mag) * maxSpeed;
                let steerX = aliX - vx;
                let steerY = aliY - vy;
                let steerMag = Math.sqrt(steerX * steerX + steerY * steerY) as f32;
                if (steerMag > maxForce) {
                    steerX = (steerX / steerMag) * maxForce;
                    steerY = (steerY / steerMag) * maxForce;
                }
                ax += steerX * alignmentWeight;
                ay += steerY * alignmentWeight;
            }
        }

        if (cohCount > 0) {
            cohX /= cohCount;
            cohY /= cohCount;
            let desX = cohX - x;
            let desY = cohY - y;
            let mag = Math.sqrt(desX * desX + desY * desY) as f32;
            if (mag > 0) {
                desX = (desX / mag) * maxSpeed;
                desY = (desY / mag) * maxSpeed;
                let steerX = desX - vx;
                let steerY = desY - vy;
                let steerMag = Math.sqrt(steerX * steerX + steerY * steerY) as f32;
                if (steerMag > maxForce) {
                    steerX = (steerX / steerMag) * maxForce;
                    steerY = (steerY / steerMag) * maxForce;
                }
                ax += steerX * cohesionWeight;
                ay += steerY * cohesionWeight;
            }
        }

        // Apply acceleration
        vx += ax * dt;
        vy += ay * dt;

        let speedSq = vx * vx + vy * vy;
        if (speedSq > maxSpeed * maxSpeed) {
            let speed = Math.sqrt(speedSq) as f32;
            vx = (vx / speed) * maxSpeed;
            vy = (vy / speed) * maxSpeed;
        }

        x += vx * dt;
        y += vy * dt;

        // Wrap around bounds
        if (x < -hw) x = hw;
        else if (x > hw) x = -hw;
        
        if (y < -hh) y = hh;
        else if (y > hh) y = -hh;

        // Store back
        store<f32>(pA, x);
        store<f32>(pA + 4, y);
        store<f32>(pA + 8, vx);
        store<f32>(pA + 12, vy);
    }
}
