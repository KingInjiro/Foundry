import { Component } from '../Component.js';
import * as THREE from 'three';

export class InstancedMesh3D extends Component {
    constructor(options = {}) {
        super();
        this.count = options.count || 1000;
        this.geometry = options.geometry || new THREE.BoxGeometry(1, 1, 1);
        this.material = options.material || new THREE.MeshStandardMaterial({ color: 0x00ff00 });
        
        // [{ position: {x,y,z}, rotation: {x,y,z}, scale: {x,y,z}, color: 0x... }]
        this.instances = options.instances || []; 
        
        this.mesh = null;
    }
    
    onAdd() {
        if (!this.entity || !this.entity.world || !this.entity.world.scene3D) return;
        
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.count);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        
        const dummy = new THREE.Object3D();
        const color = new THREE.Color();
        
        for (let i = 0; i < this.count; i++) {
            const data = this.instances[i] || {};
            const pos = data.position || { x: 0, y: 0, z: 0 };
            const rot = data.rotation || { x: 0, y: 0, z: 0 };
            const scl = data.scale || { x: 1, y: 1, z: 1 };
            
            dummy.position.set(pos.x, pos.y, pos.z);
            dummy.rotation.set(rot.x, rot.y, rot.z);
            dummy.scale.set(scl.x, scl.y, scl.z);
            dummy.updateMatrix();
            
            this.mesh.setMatrixAt(i, dummy.matrix);
            
            if (data.color !== undefined) {
                color.setHex(data.color);
                this.mesh.setColorAt(i, color);
            }
        }
        
        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
        
        this.mesh.position.set(this.entity.x, this.entity.y, this.entity.z || 0);
        this.entity.world.scene3D.add(this.mesh);
    }
    
    onDestroy() {
        if (this.mesh && this.entity && this.entity.world) {
            this.entity.world.scene3D.remove(this.mesh);
            this.mesh.dispose();
        }
    }
}
