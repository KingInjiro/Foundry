import { System } from '../System.js';
import { NavAgent } from '../components/NavAgent.js';
import { Tilemap } from '../components/Tilemap.js';
import { PhysicsBody } from '../../physics/PhysicsBody.js';
import { Pathfinding } from '../../math/Pathfinding.js';

export class NavigationSystem extends System {
    update(dt) {
        const agents = this.manager.getComponents(NavAgent);
        
        for (let i = 0; i < agents.length; i++) {
            const agent = agents[i];
            const entity = agent.entity;
            
            if (!agent.enabled || !agent.isMoving || !entity) continue;
            
            agent._repathTimer -= dt;
            
            if (agent._needsPath || (agent.target && agent._repathTimer <= 0)) {
                this._calculatePath(agent, entity);
                agent._needsPath = false;
                agent._repathTimer = agent.repathInterval;
            }
            
            if (agent.path && agent.path.length > agent.currentWaypointIndex) {
                this._moveAlongPath(agent, entity, dt);
            } else if (agent.path && agent.path.length > 0) {
                agent.stop();
            }
        }
    }
    
    _calculatePath(agent, entity) {
        if (!agent.target) return;
        
        let tilemapEntity = null;
        if (agent.tilemapEntityName) {
            tilemapEntity = agent.entity.world.entities.findByName(agent.tilemapEntityName);
        }
        
        if (!tilemapEntity) {
            const tms = this.manager.getComponents(Tilemap);
            if (tms.length > 0) tilemapEntity = tms[0].entity;
        }
        
        if (!tilemapEntity) return;
        
        const tilemap = tilemapEntity.getComponent(Tilemap);
        if (!tilemap) return;
        
        const ts = tilemap.tileSize;
        const startX = entity.globalX;
        const startY = entity.globalY;
        const tmX = tilemapEntity.globalX !== undefined ? tilemapEntity.globalX : tilemapEntity.x;
        const tmY = tilemapEntity.globalY !== undefined ? tilemapEntity.globalY : tilemapEntity.y;
        
        const startCol = Math.floor((startX - tmX) / ts);
        const startRow = Math.floor((startY - tmY) / ts);
        
        const endCol = Math.floor((agent.target.x - tmX) / ts);
        const endRow = Math.floor((agent.target.y - tmY) / ts);
        
        // Clamp to grid
        if (startCol < 0 || startCol >= tilemap.cols || startRow < 0 || startRow >= tilemap.rows) return;
        if (endCol < 0 || endCol >= tilemap.cols || endRow < 0 || endRow >= tilemap.rows) return;
        
        const isWalkable = (c, r) => {
            const index = tilemap.getTile(c, r);
            return agent.walkableTiles.includes(index);
        };
        
        const gridPath = Pathfinding.findPath(startCol, startRow, endCol, endRow, tilemap.cols, tilemap.rows, isWalkable, agent.diagonal);
        
        if (gridPath && gridPath.length > 0) {
            agent.path = gridPath.map(node => ({
                x: tmX + node.col * ts + ts / 2,
                y: tmY + node.row * ts + ts / 2
            }));
            agent.currentWaypointIndex = 1;
            if (agent.path.length === 1) agent.currentWaypointIndex = 0;
        } else {
            agent.path = [];
        }
    }
    
    _moveAlongPath(agent, entity, dt) {
        const wp = agent.path[agent.currentWaypointIndex];
        const dx = wp.x - entity.globalX;
        const dy = wp.y - entity.globalY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist <= agent.stopDistance) {
            agent.currentWaypointIndex++;
            return;
        }
        
        const nx = dx / dist;
        const ny = dy / dist;
        
        const vx = nx * agent.speed;
        const vy = ny * agent.speed;
        
        // Check for physics body
        const body = entity.getComponent('PhysicsBody');
        if (body && !body.isStatic) {
            body.setVelocity(vx, vy);
        } else {
            entity.x += vx * dt;
            entity.y += vy * dt;
        }
        
        entity.rotation = Math.atan2(vy, vx);
    }
}
