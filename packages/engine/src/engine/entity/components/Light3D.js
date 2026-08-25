import * as THREE from 'three';
import { Component } from '../Component.js';

export class Light3D extends Component {
    constructor(options = {}) {
        super();
        this.type = options.type || 'point';
        this.color = options.color || 0xffffff;
        this.intensity = options.intensity || 1;
        this.distance = options.distance || 0;
        this.angle = options.angle || Math.PI / 3;
        this.decay = options.decay !== undefined ? options.decay : 2;
        this.castShadow = options.castShadow !== undefined ? options.castShadow : true;
        this.shadowResolution = options.shadowResolution || 1024;
        this.shadowBias = options.shadowBias || -0.0001;
        this.shadowNear = options.shadowNear || 0.5;
        this.shadowFar = options.shadowFar || 500;
        this.shadowSize = options.shadowSize || 20; // For directional light orthographic camera size
        
        this.light = null;
    }
    
    onAwake() {
        this.createLight();
    }
    
    createLight() {
        if (this.light && this.entity && this.entity.engine && this.entity.engine.world) {
            this.entity.engine.world.scene3D.remove(this.light);
        }
        
        switch(this.type) {
            case 'point': 
                this.light = new THREE.PointLight(this.color, this.intensity, this.distance, this.decay); 
                break;
            case 'directional': 
                this.light = new THREE.DirectionalLight(this.color, this.intensity); 
                break;
            case 'spot': 
                this.light = new THREE.SpotLight(this.color, this.intensity, this.distance, this.angle, 0.5, this.decay); 
                break;
            case 'ambient': 
                this.light = new THREE.AmbientLight(this.color, this.intensity); 
                break;
            case 'hemisphere':
                this.light = new THREE.HemisphereLight(0xffffff, 0x444444, this.intensity);
                this.light.color.setHex(this.color);
                break;
            default:
                this.light = new THREE.PointLight(this.color, this.intensity, this.distance);
                break;
        }
        
        if (this.light.type !== 'AmbientLight' && this.light.type !== 'HemisphereLight') {
            this.light.castShadow = this.castShadow;
            if (this.castShadow) {
                this.light.shadow.mapSize.width = this.shadowResolution;
                this.light.shadow.mapSize.height = this.shadowResolution;
                this.light.shadow.bias = this.shadowBias;
                this.light.shadow.camera.near = this.shadowNear;
                this.light.shadow.camera.far = this.shadowFar;
            }
            if (this.type === 'directional' && this.castShadow) {
                this.light.shadow.camera.top = this.shadowSize;
                this.light.shadow.camera.bottom = -this.shadowSize;
                this.light.shadow.camera.left = -this.shadowSize;
                this.light.shadow.camera.right = this.shadowSize;
            }
        }
        
        if (this.entity && this.entity.engine && this.entity.engine.world) {
            this.entity.engine.world.scene3D.add(this.light);
        }
    }
    
    update(dt) {
        if (this.light && this.entity) {
            const transform = this.entity.getComponent('Transform3D');
            if (transform) {
                this.light.position.copy(transform.position);
                if (this.light.target && this.type !== 'point') {
                    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(transform.quaternion);
                    this.light.target.position.copy(transform.position).add(direction);
                    this.light.target.updateMatrixWorld();
                }
            }
        }
    }
    
    serialize() {
        return {
            type: this.type,
            color: this.color,
            intensity: this.intensity,
            distance: this.distance,
            angle: this.angle,
            decay: this.decay,
            castShadow: this.castShadow,
            shadowResolution: this.shadowResolution,
            shadowBias: this.shadowBias,
            shadowNear: this.shadowNear,
            shadowFar: this.shadowFar,
            shadowSize: this.shadowSize
        };
    }

    onDestroy() {
        if (this.light && this.entity && this.entity.engine && this.entity.engine.world) {
            this.entity.engine.world.scene3D.remove(this.light);
        }
        this.light = null;
    }
}
