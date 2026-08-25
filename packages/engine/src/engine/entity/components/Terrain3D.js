import { Component } from '../Component.js';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class Terrain3D extends Component {
    constructor(options = {}) {
        super();
        this.width = options.width || 100;
        this.depth = options.depth || 100;
        this.segmentsX = options.segmentsX || 32;
        this.segmentsZ = options.segmentsZ || 32;
        this.maxHeight = options.maxHeight || 10;
        this.heightData = options.heightData || null; // 2D array of heights
        this.generatePhysics = options.generatePhysics !== undefined ? options.generatePhysics : true;
        this.color = options.color || 0x228833;
        
        this.mesh = null;
        this.physicsBody = null;
    }
    
    onAdd() {
        this.buildTerrain();
    }
    
    buildTerrain() {
        if (!this.entity || !this.entity.world || !this.entity.world.scene3D) return;
        
        const geometry = new THREE.PlaneGeometry(this.width, this.depth, this.segmentsX, this.segmentsZ);
        geometry.rotateX(-Math.PI / 2);
        
        const vertices = geometry.attributes.position.array;
        
        // Matrix for cannon.js
        const matrix = [];
        
        if (this.heightData) {
            for (let i = 0; i <= this.segmentsX; i++) {
                matrix.push([]);
                for (let j = 0; j <= this.segmentsZ; j++) {
                    let h = 0;
                    if (this.heightData[i] && this.heightData[i][j] !== undefined) {
                        h = this.heightData[i][j];
                    }
                    matrix[i].push(h);
                    
                    // three.js plane geometry vertices order is by row
                    const vertexIndex = (j * (this.segmentsX + 1) + i) * 3;
                    vertices[vertexIndex + 1] = h;
                }
            }
        } else {
            for (let i = 0; i <= this.segmentsX; i++) {
                matrix.push([]);
                for (let j = 0; j <= this.segmentsZ; j++) {
                    matrix[i].push(0);
                }
            }
        }
        
        geometry.computeVertexNormals();
        
        const material = new THREE.MeshStandardMaterial({ 
            color: this.color,
            roughness: 0.8,
            metalness: 0.1
        });
        
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.receiveShadow = true;
        this.mesh.castShadow = true;
        
        this.mesh.position.set(this.entity.x, this.entity.y, this.entity.z || 0);
        this.entity.world.scene3D.add(this.mesh);
        
        if (this.generatePhysics && this.entity.world.physicsWorld3D) {
            // Cannon Heightfield
            const heightfieldShape = new CANNON.Heightfield(matrix, {
                elementSize: this.width / this.segmentsX
            });
            
            this.physicsBody = new CANNON.Body({ mass: 0 });
            this.physicsBody.addShape(heightfieldShape);
            
            // Offset heightfield (cannon places it starting from origin by default)
            this.physicsBody.position.set(
                this.entity.x - this.width / 2, 
                this.entity.y, 
                (this.entity.z || 0) + this.depth / 2
            );
            
            // Rotate Heightfield to match Three.js (Heightfield lies on XY plane by default in Cannon)
            this.physicsBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
            
            this.entity.world.physicsWorld3D.addBody(this.physicsBody);
        }
    }
    
    onDestroy() {
        if (this.mesh && this.entity && this.entity.world) {
            this.entity.world.scene3D.remove(this.mesh);
        }
        if (this.physicsBody && this.entity && this.entity.world && this.entity.world.physicsWorld3D) {
            this.entity.world.physicsWorld3D.removeBody(this.physicsBody);
        }
    }
}
