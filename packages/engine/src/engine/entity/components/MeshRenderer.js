import * as THREE from 'three';
import { Component } from '../Component.js';

export class MeshRenderer extends Component {
    constructor(options = {}) {
        super();
        this.geometryType = options.geometry || 'box';
        this.materialType = options.material || 'standard';
        this.color = options.color || 0x00ffcc;
        
        this.mesh = null;
    }
    
    onAwake() {
        let geo;
        switch(this.geometryType) {
            case 'box': geo = new THREE.BoxGeometry(1, 1, 1); break;
            case 'sphere': geo = new THREE.SphereGeometry(0.5, 32, 16); break;
            case 'plane': geo = new THREE.PlaneGeometry(1, 1); break;
            default: geo = new THREE.BoxGeometry(1, 1, 1);
        }
        
        let mat;
        switch(this.materialType) {
            case 'standard': mat = new THREE.MeshStandardMaterial({ color: this.color }); break;
            case 'basic': mat = new THREE.MeshBasicMaterial({ color: this.color }); break;
            case 'phong': mat = new THREE.MeshPhongMaterial({ color: this.color }); break;
            default: mat = new THREE.MeshStandardMaterial({ color: this.color });
        }
        
        this.mesh = new THREE.Mesh(geo, mat);
        if (this.geometryType === 'plane') {
            this.mesh.rotation.x = -Math.PI / 2;
            this.mesh.receiveShadow = true;
        } else {
            this.mesh.castShadow = true;
            this.mesh.receiveShadow = true;
        }
        
        // Ensure entity is linked
        if (this.entity && this.entity.engine && this.entity.engine.world) {
            this.entity.engine.world.scene3D.add(this.mesh);
        }
    }
    
    serialize() {
        return {
            geometryType: this.geometryType,
            materialType: this.materialType,
            color: this.color
        };
    }

    onDestroy() {
        if (this.mesh && this.entity && this.entity.engine && this.entity.engine.world) {
            this.entity.engine.world.scene3D.remove(this.mesh);
            if (this.mesh.geometry) this.mesh.geometry.dispose();
            if (this.mesh.material) this.mesh.material.dispose();
        }
        this.mesh = null;
    }
}
