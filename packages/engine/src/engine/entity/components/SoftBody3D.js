import { Component } from '../Component.js';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { ModelRenderer } from './ModelRenderer.js';
import { MeshRenderer } from './MeshRenderer.js';

export class SoftBody3D extends Component {
    constructor(options = {}) {
        super();
        this.type = options.type || 'cloth'; // 'cloth', 'volume'
        this.mass = options.mass !== undefined ? options.mass : 1;
        
        // Grid dimensions
        this.segmentsX = options.segmentsX || 10;
        this.segmentsY = options.segmentsY || 10;
        this.segmentsZ = options.segmentsZ || 10;
        
        // Physical properties
        this.stiffness = options.stiffness || 0.9;
        this.damping = options.damping || 0.1;
        this.restLength = options.restLength || 0.5;
        this.pinIndices = options.pinIndices || []; // Array of indices to pin
        
        this.particles = [];
        this.constraints = [];
        this.mesh = null;
    }
    
    onAwake() {
        if (!this.entity || !this.entity.world || !this.entity.world.physicsWorld3D) return;
        
        // Setup based on type
        if (this.type === 'cloth') {
            this.createCloth();
        } else if (this.type === 'volume') {
            this.createVolume();
        }
    }
    
    createCloth() {
        const physicsWorld = this.entity.world.physicsWorld3D;
        const particleMass = this.mass / (this.segmentsX * this.segmentsY);
        
        const shape = new CANNON.Particle();
        
        // Create particles
        for (let i = 0; i < this.segmentsX; i++) {
            this.particles.push([]);
            for (let j = 0; j < this.segmentsY; j++) {
                const isPinned = this.pinIndices.includes(i * this.segmentsY + j);
                const particle = new CANNON.Body({
                    mass: isPinned ? 0 : particleMass,
                    shape: shape,
                    position: new CANNON.Vec3(
                        this.entity.x + (i - this.segmentsX * 0.5) * this.restLength,
                        this.entity.y + (j - this.segmentsY * 0.5) * this.restLength,
                        this.entity.z || 0
                    ),
                    linearDamping: this.damping
                });
                
                this.particles[i].push(particle);
                physicsWorld.addBody(particle);
            }
        }
        
        // Connect particles
        for (let i = 0; i < this.segmentsX; i++) {
            for (let j = 0; j < this.segmentsY; j++) {
                if (i < this.segmentsX - 1) {
                    const c = new CANNON.DistanceConstraint(this.particles[i][j], this.particles[i+1][j], this.restLength);
                    this.constraints.push(c);
                    physicsWorld.addConstraint(c);
                }
                if (j < this.segmentsY - 1) {
                    const c = new CANNON.DistanceConstraint(this.particles[i][j], this.particles[i][j+1], this.restLength);
                    this.constraints.push(c);
                    physicsWorld.addConstraint(c);
                }
            }
        }
    }
    
    createVolume() {
        // Simple volumetric soft body (box of particles)
        const physicsWorld = this.entity.world.physicsWorld3D;
        const totalParticles = this.segmentsX * this.segmentsY * this.segmentsZ;
        const particleMass = this.mass / totalParticles;
        
        const shape = new CANNON.Particle();
        this.particles = [];
        
        for (let i = 0; i < this.segmentsX; i++) {
            let plane = [];
            for (let j = 0; j < this.segmentsY; j++) {
                let row = [];
                for (let k = 0; k < this.segmentsZ; k++) {
                    const particle = new CANNON.Body({
                        mass: particleMass,
                        shape: shape,
                        position: new CANNON.Vec3(
                            this.entity.x + (i - this.segmentsX * 0.5) * this.restLength,
                            this.entity.y + (j - this.segmentsY * 0.5) * this.restLength,
                            this.entity.z + (k - this.segmentsZ * 0.5) * this.restLength
                        ),
                        linearDamping: this.damping
                    });
                    row.push(particle);
                    physicsWorld.addBody(particle);
                }
                plane.push(row);
            }
            this.particles.push(plane);
        }
        
        // Connect Volume
        for (let i = 0; i < this.segmentsX; i++) {
            for (let j = 0; j < this.segmentsY; j++) {
                for (let k = 0; k < this.segmentsZ; k++) {
                    if (i < this.segmentsX - 1) {
                        const c = new CANNON.DistanceConstraint(this.particles[i][j][k], this.particles[i+1][j][k], this.restLength);
                        this.constraints.push(c);
                        physicsWorld.addConstraint(c);
                    }
                    if (j < this.segmentsY - 1) {
                        const c = new CANNON.DistanceConstraint(this.particles[i][j][k], this.particles[i][j+1][k], this.restLength);
                        this.constraints.push(c);
                        physicsWorld.addConstraint(c);
                    }
                    if (k < this.segmentsZ - 1) {
                        const c = new CANNON.DistanceConstraint(this.particles[i][j][k], this.particles[i][j][k+1], this.restLength);
                        this.constraints.push(c);
                        physicsWorld.addConstraint(c);
                    }
                    // Diagonals for volume stability
                    if (i < this.segmentsX - 1 && j < this.segmentsY - 1 && k < this.segmentsZ - 1) {
                        const dist = Math.sqrt(3) * this.restLength;
                        const c = new CANNON.DistanceConstraint(this.particles[i][j][k], this.particles[i+1][j+1][k+1], dist);
                        this.constraints.push(c);
                        physicsWorld.addConstraint(c);
                    }
                }
            }
        }
    }
    
    updateVisuals() {
        let meshComp = this.entity.getComponent(MeshRenderer);
        if (!meshComp || !meshComp.mesh || !meshComp.mesh.geometry) return;
        
        const positionAttribute = meshComp.mesh.geometry.attributes.position;
        if (!positionAttribute) return;
        
        if (this.type === 'cloth') {
            let index = 0;
            for (let i = 0; i < this.segmentsX; i++) {
                for (let j = 0; j < this.segmentsY; j++) {
                    // Update vertex positions based on particle positions
                    // Note: Ensure geometry matches segment count
                    if (index < positionAttribute.count) {
                        const p = this.particles[i][j].position;
                        positionAttribute.setXYZ(index, p.x - this.entity.x, p.y - this.entity.y, p.z - this.entity.z);
                        index++;
                    }
                }
            }
        }
        
        positionAttribute.needsUpdate = true;
        meshComp.mesh.geometry.computeVertexNormals();
    }
    
    onDestroy() {
        if (!this.entity || !this.entity.world || !this.entity.world.physicsWorld3D) return;
        const physicsWorld = this.entity.world.physicsWorld3D;
        
        for (let c of this.constraints) {
            physicsWorld.removeConstraint(c);
        }
        this.constraints = [];
        
        const removeBodies = (arr) => {
            if (arr.length === 0) return;
            if (arr[0] instanceof CANNON.Body) {
                for (let b of arr) physicsWorld.removeBody(b);
            } else {
                for (let sub of arr) removeBodies(sub);
            }
        };
        
        removeBodies(this.particles);
        this.particles = [];
    }
}
