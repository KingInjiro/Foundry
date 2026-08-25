import Matter from 'matter-js';

const _tempEntities = [];
const _tempStaticEntities = [];
const _p1 = { x: 0, y: 0 };
const _p2 = { x: 0, y: 0 };

/**
 * Perform a 2D raycast against both the spatial hash entities and Matter.js bodies.
 * @param {import('../world/World.js').World} world
 * @param {number} originX
 * @param {number} originY
 * @param {number} angle
 * @param {number} maxDistance
 * @param {Object} outResult
 * @param {boolean} outResult.hit
 * @param {number} outResult.distance
 * @param {Object} outResult.point
 * @param {number} outResult.point.x
 * @param {number} outResult.point.y
 * @param {import('../entity/Entity.js').Entity|Matter.Body} [outResult.entity]
 * @param {boolean} [outResult.isMatterBody]
 */
export function raycast(world, originX, originY, angle, maxDistance, outResult) {
    outResult.hit = false;
    outResult.distance = maxDistance;
    if (!outResult.point) outResult.point = { x: originX, y: originY };
    outResult.point.x = originX;
    outResult.point.y = originY;
    outResult.entity = null;
    outResult.isMatterBody = false;

    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    const endX = originX + nx * maxDistance;
    const endY = originY + ny * maxDistance;

    // 1. Query Matter.js bodies
    _p1.x = originX;
    _p1.y = originY;
    _p2.x = endX;
    _p2.y = endY;

    // Matter.Query.ray returns an array of collisions
    const matterHits = Matter.Query.ray(Matter.Composite.allBodies(world.physicsWorld), _p1, _p2);
    
    for (let i = 0; i < matterHits.length; i++) {
        const hit = matterHits[i];
        const body = hit.bodyA;
        
        // Calculate intersection point roughly (Matter.Query.ray doesn't give exact point)
        // We'll use the body position and ray to find a closer approximation or just use closest bounds point
        // For accurate point, we can do segment-AABB intersection or segment-circle.
        // For now, let's find the distance to the center and subtract some radius to get a rough hit distance.
        // A better approach for accurate Raycast in Matter is Raycast against the body parts.
        
        // We can do a line intersection with body bounds
        let t = lineAABBIntersect(originX, originY, nx, ny, maxDistance, body.bounds.min.x, body.bounds.min.y, body.bounds.max.x, body.bounds.max.y);
        
        if (t !== null && t < outResult.distance) {
            outResult.hit = true;
            outResult.distance = t;
            outResult.entity = body;
            outResult.isMatterBody = true;
            outResult.point.x = originX + nx * t;
            outResult.point.y = originY + ny * t;
        }
    }

    // 2. Query Entity Spatial Hash
    if (world.grid.queryRay) {
        world.grid.queryRay(originX, originY, endX, endY, _tempEntities);
    } else {
        const minX = Math.min(originX, endX);
        const minY = Math.min(originY, endY);
        const maxX = Math.max(originX, endX);
        const maxY = Math.max(originY, endY);
        const width = maxX - minX;
        const height = maxY - minY;
        const centerX = minX + width / 2;
        const centerY = minY + height / 2;
        world.grid.queryAABB(centerX, centerY, width, height, _tempEntities);
    }
    
    // Add static entities to the array
    if (world.staticGrid) {
        _tempStaticEntities.length = 0;
        if (world.staticGrid.queryRay) {
            world.staticGrid.queryRay(originX, originY, endX, endY, _tempStaticEntities);
        } else {
            const minX = Math.min(originX, endX);
            const minY = Math.min(originY, endY);
            const maxX = Math.max(originX, endX);
            const maxY = Math.max(originY, endY);
            const width = maxX - minX;
            const height = maxY - minY;
            const centerX = minX + width / 2;
            const centerY = minY + height / 2;
            world.staticGrid.queryAABB(centerX, centerY, width, height, _tempStaticEntities);
        }
        for (let i = 0; i < _tempStaticEntities.length; i++) {
            _tempEntities.push(_tempStaticEntities[i]);
        }
    }

    for (let i = 0; i < _tempEntities.length; i++) {
        const e = _tempEntities[i];
        if (!e.active || e.isDestroyed || !e.hasCollision) continue;

        if (e.colliderType === 'circle') {
            const ex = e.globalX - originX;
            const ey = e.globalY - originY;
            
            let t = (ex * nx + ey * ny);
            if (t < 0) continue;
            if (t > maxDistance) continue;
            
            const px = originX + nx * t;
            const py = originY + ny * t;
            const distSq = (e.globalX - px) * (e.globalX - px) + (e.globalY - py) * (e.globalY - py);
            const r = e.radius;
            
            if (distSq <= r * r) {
                // Actual intersection distance is t - sqrt(r*r - distSq)
                const hitDist = t - Math.sqrt(r * r - distSq);
                if (hitDist >= 0 && hitDist < outResult.distance) {
                    outResult.hit = true;
                    outResult.distance = hitDist;
                    outResult.entity = e;
                    outResult.isMatterBody = false;
                    outResult.point.x = originX + nx * hitDist;
                    outResult.point.y = originY + ny * hitDist;
                }
            }
        } else if (e.colliderType === 'box') {
            const hw = e.width / 2;
            const hh = e.height / 2;
            let t = lineAABBIntersect(originX, originY, nx, ny, maxDistance, e.globalX - hw, e.globalY - hh, e.globalX + hw, e.globalY + hh);
            if (t !== null && t < outResult.distance) {
                outResult.hit = true;
                outResult.distance = t;
                outResult.entity = e;
                outResult.isMatterBody = false;
                outResult.point.x = originX + nx * t;
                outResult.point.y = originY + ny * t;
            }
        }
    }
}

/**
 * @returns {number|null}
 */
function lineAABBIntersect(ox, oy, nx, ny, maxDist, minX, minY, maxX, maxY) {
    let tmin = -Infinity, tmax = Infinity;

    if (nx !== 0) {
        const tx1 = (minX - ox) / nx;
        const tx2 = (maxX - ox) / nx;
        tmin = Math.max(tmin, Math.min(tx1, tx2));
        tmax = Math.min(tmax, Math.max(tx1, tx2));
    } else if (ox < minX || ox > maxX) {
        return null;
    }

    if (ny !== 0) {
        const ty1 = (minY - oy) / ny;
        const ty2 = (maxY - oy) / ny;
        tmin = Math.max(tmin, Math.min(ty1, ty2));
        tmax = Math.min(tmax, Math.max(ty1, ty2));
    } else if (oy < minY || oy > maxY) {
        return null;
    }

    if (tmax >= tmin && tmax >= 0 && tmin <= maxDist) {
        return tmin < 0 ? 0 : tmin;
    }

    return null;
}
