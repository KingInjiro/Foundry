import { Component } from '../Component.js';
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export class Sky3D extends Component {
    constructor(options = {}) {
        super();
        this.time = options.time || 12; // 0 to 24
        this.timeScale = options.timeScale || 0.1; // hours per second
        
        this.turbidity = options.turbidity || 10;
        this.rayleigh = options.rayleigh || 3;
        this.mieCoefficient = options.mieCoefficient || 0.005;
        this.mieDirectionalG = options.mieDirectionalG || 0.7;
        this.elevation = options.elevation || 2;
        this.azimuth = options.azimuth || 180;
        
        this.sky = null;
        this.sun = null;
        this.sunLight = null;
    }
    
    onAdd() {
        if (!this.entity || !this.entity.world || !this.entity.world.scene3D) return;
        
        this.sky = new Sky();
        this.sky.scale.setScalar(450000);
        
        this.sun = new THREE.Vector3();
        
        // Try to find an existing directional light to act as the sun
        this.entity.world.scene3D.traverse((child) => {
            if (child.isDirectionalLight && !this.sunLight) {
                this.sunLight = child;
            }
        });
        
        if (!this.sunLight) {
            this.sunLight = new THREE.DirectionalLight(0xffffff, 1);
            this.sunLight.castShadow = true;
            this.sunLight.shadow.camera.top = 50;
            this.sunLight.shadow.camera.bottom = -50;
            this.sunLight.shadow.camera.left = -50;
            this.sunLight.shadow.camera.right = 50;
            this.sunLight.shadow.camera.near = 0.1;
            this.sunLight.shadow.camera.far = 200;
            this.sunLight.shadow.bias = -0.001;
            this.sunLight.shadow.mapSize.width = 2048;
            this.sunLight.shadow.mapSize.height = 2048;
            this.entity.world.scene3D.add(this.sunLight);
        }
        
        this.updateSky();
        this.entity.world.scene3D.add(this.sky);
    }
    
    update(dt) {
        if (!this.sky) return;
        
        if (this.timeScale > 0) {
            this.time += this.timeScale * dt;
            if (this.time >= 24) this.time -= 24;
            
            // Map time (0-24) to elevation (-90 to 90)
            // 6am = 0, 12pm = 90, 6pm = 0, 12am = -90
            this.elevation = 90 * Math.sin((this.time - 6) * Math.PI / 12);
            this.updateSky();
        }
    }
    
    updateSky() {
        const uniforms = this.sky.material.uniforms;
        uniforms['turbidity'].value = this.turbidity;
        uniforms['rayleigh'].value = this.rayleigh;
        uniforms['mieCoefficient'].value = this.mieCoefficient;
        uniforms['mieDirectionalG'].value = this.mieDirectionalG;

        const phi = THREE.MathUtils.degToRad(90 - this.elevation);
        const theta = THREE.MathUtils.degToRad(this.azimuth);

        this.sun.setFromSphericalCoords(1, phi, theta);
        uniforms['sunPosition'].value.copy(this.sun);
        
        if (this.sunLight) {
            this.sunLight.position.copy(this.sun).multiplyScalar(100);
            
            // Adjust light intensity based on elevation
            let intensity = Math.max(0, Math.sin((this.time - 6) * Math.PI / 12));
            this.sunLight.intensity = intensity;
            
            // Adjust ambient light if exists
            if (this.entity && this.entity.world) {
                this.entity.world.scene3D.traverse((child) => {
                    if (child.isAmbientLight) {
                        child.intensity = 0.2 + (intensity * 0.3);
                    }
                });
            }
        }
    }
    
    onDestroy() {
        if (this.sky && this.entity && this.entity.world) {
            this.entity.world.scene3D.remove(this.sky);
            if (this.sunLight) {
                this.entity.world.scene3D.remove(this.sunLight);
            }
        }
    }
}
