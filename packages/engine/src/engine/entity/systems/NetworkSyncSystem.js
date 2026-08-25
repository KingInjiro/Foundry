import { System } from '../System.js';
import * as THREE from 'three';

export class NetworkSyncSystem extends System {
    constructor() {
        super();
        this.stateBuffer = [];
        this.isServer = false;
        this.clientId = null;
    }
    
    onStateUpdate(state) {
        // Store incoming state snapshots for interpolation
        state.timestamp = performance.now();
        this.stateBuffer.push(state);
        
        // Keep only recent states
        if (this.stateBuffer.length > 10) {
            this.stateBuffer.shift();
        }
    }
    
    update(dt) {
        const engine = this.manager.engine;
        if (!engine || !engine.network) return;
        
        this.isServer = engine.isHeadless;
        this.clientId = engine.network.clientId;
        
        const entities = this.manager.getEntitiesWithComponent('NetworkTransform');
        
        if (this.isServer) {
            this.syncToClients(entities);
        } else {
            this.interpolateEntities(entities, dt);
            this.sendLocalState(entities);
        }
    }
    
    syncToClients(entities) {
        const engine = this.manager.engine;
        const now = performance.now();
        
        let stateUpdate = {};
        let shouldSync = false;
        
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i];
            const net = entity.getComponent('NetworkTransform');
            const transform3D = entity.getComponent('Transform3D');
            const transform2D = entity.getComponent('Transform');
            const transform = transform3D || transform2D;
            
            if (!net || !transform) continue;
            
            // In a real authoritative server, we might want to sync EVERYTHING to clients.
            // Check sync rate
            if (now - net._lastSyncTime >= 1000 / net.syncRate) {
                stateUpdate[net.id] = {
                    p: [transform.position.x, transform.position.y, transform.position.z !== undefined ? transform.position.z : 0],
                    r: transform.rotation !== undefined ? transform.rotation : [transform.quaternion.x, transform.quaternion.y, transform.quaternion.z, transform.quaternion.w]
                };
                net._lastSyncTime = now;
                shouldSync = true;
            }
        }
        
        if (shouldSync && engine.network) {
            engine.network.send({ type: 'sync', state: stateUpdate });
        }
    }
    
    sendLocalState(entities) {
        const engine = this.manager.engine;
        const now = performance.now();
        let stateUpdate = {};
        let shouldSync = false;
        
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i];
            const net = entity.getComponent('NetworkTransform');
            const transform3D = entity.getComponent('Transform3D');
            const transform2D = entity.getComponent('Transform');
            const transform = transform3D || transform2D;
            
            // Client only sends state for entities it owns
            if (!net || !transform || net.owner !== this.clientId) continue;
            
            if (now - net._lastSyncTime >= 1000 / net.syncRate) {
                stateUpdate[net.id] = {
                    p: [transform.position.x, transform.position.y, transform.position.z !== undefined ? transform.position.z : 0],
                    r: transform.rotation !== undefined ? transform.rotation : [transform.quaternion.x, transform.quaternion.y, transform.quaternion.z, transform.quaternion.w]
                };
                net._lastSyncTime = now;
                shouldSync = true;
            }
        }
        
        if (shouldSync && engine.network) {
            engine.network.send({ type: 'client_sync', state: stateUpdate });
        }
    }
    
    interpolateEntities(entities, dt) {
        if (this.stateBuffer.length === 0) return;
        
        const latestState = this.stateBuffer[this.stateBuffer.length - 1];
        
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i];
            const net = entity.getComponent('NetworkTransform');
            const transform3D = entity.getComponent('Transform3D');
            const transform2D = entity.getComponent('Transform');
            const transform = transform3D || transform2D;
            const is3D = !!transform3D;
            
            if (!net || !transform || net.owner === this.clientId) continue; // Don't interpolate our own entities
            
            const entityState = latestState[net.id];
            if (entityState) {
                // Initialize targets if needed
                if (!net.targetPosition) {
                    if (is3D) net.targetPosition = new THREE.Vector3();
                    else net.targetPosition = { x: 0, y: 0 };
                }
                if (is3D && !net.targetQuaternion) {
                    net.targetQuaternion = new THREE.Quaternion();
                }
                
                // Update target
                if (entityState.p) {
                    if (is3D) {
                        net.targetPosition.set(entityState.p[0], entityState.p[1], entityState.p[2]);
                    } else {
                        net.targetPosition.x = entityState.p[0];
                        net.targetPosition.y = entityState.p[1];
                    }
                }
                
                if (entityState.r !== undefined) {
                    if (is3D && Array.isArray(entityState.r)) {
                        net.targetQuaternion.set(entityState.r[0], entityState.r[1], entityState.r[2], entityState.r[3]);
                    } else {
                        net.targetRotation = entityState.r;
                    }
                }
            }
            
            if (net.targetPosition === null) continue; // No state received yet
            
            if (net.interpolate) {
                // Smooth interpolation
                if (is3D) {
                    transform.position.lerp(net.targetPosition, dt * net.smoothFactor);
                    if (net.targetQuaternion) transform.quaternion.slerp(net.targetQuaternion, dt * net.smoothFactor);
                } else {
                    transform.position.x += (net.targetPosition.x - transform.position.x) * dt * net.smoothFactor;
                    transform.position.y += (net.targetPosition.y - transform.position.y) * dt * net.smoothFactor;
                    if (net.targetRotation !== undefined) {
                        transform.rotation += (net.targetRotation - transform.rotation) * dt * net.smoothFactor;
                    }
                }
            } else {
                // Snap
                if (is3D) {
                    transform.position.copy(net.targetPosition);
                    if (net.targetQuaternion) transform.quaternion.copy(net.targetQuaternion);
                } else {
                    transform.position.x = net.targetPosition.x;
                    transform.position.y = net.targetPosition.y;
                    if (net.targetRotation !== undefined) {
                        transform.rotation = net.targetRotation;
                    }
                }
            }
        }
    }
}
