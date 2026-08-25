import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CCDIKSolver } from 'three/examples/jsm/animation/CCDIKSolver.js';
import { Component } from '../Component.js';

export class ModelRenderer extends Component {
    constructor(options = {}) {
        super();
        this.modelName = options.modelName || '';
        this.color = options.color !== undefined ? options.color : null;
        
        // PBR extensions
        this.metalness = options.metalness !== undefined ? options.metalness : null;
        this.roughness = options.roughness !== undefined ? options.roughness : null;
        this.emissive = options.emissive !== undefined ? options.emissive : null;
        this.emissiveIntensity = options.emissiveIntensity !== undefined ? options.emissiveIntensity : null;
        this.envMapIntensity = options.envMapIntensity !== undefined ? options.envMapIntensity : null;
        this.wireframe = options.wireframe !== undefined ? options.wireframe : false;
        
        this.model = null;
        
        this.mixer = null;
        this.actions = {};
        this.currentAction = null;
        
        // IK
        this.ikSolver = null;
        this.iks = options.iks || []; // array of IK configurations
    }

    onAdd() {
        this.loadModel();
    }
    
    onAwake() {
        if (!this.model) {
            this.loadModel();
        }
    }
    
    loadModel() {
        if (this.model || !this.modelName || !this.entity || !this.entity.world || !this.entity.engine) return;
        
        const gltf = this.entity.engine.assets.getGLTF(this.modelName);
        if (gltf && gltf.scene) {
            // Use SkeletonUtils to correctly clone skinned meshes and their skeletons
            this.model = SkeletonUtils.clone(gltf.scene);
            
            this.model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    if (this.color !== null || this.metalness !== null || this.roughness !== null || this.emissive !== null || this.emissiveIntensity !== null || this.envMapIntensity !== null || this.wireframe) {
                        child.material = child.material.clone();
                        if (this.color !== null) child.material.color.setHex(this.color);
                        if (this.metalness !== null) child.material.metalness = this.metalness;
                        if (this.roughness !== null) child.material.roughness = this.roughness;
                        if (this.emissive !== null) child.material.emissive.setHex(this.emissive);
                        if (this.emissiveIntensity !== null) child.material.emissiveIntensity = this.emissiveIntensity;
                        if (this.envMapIntensity !== null) child.material.envMapIntensity = this.envMapIntensity;
                        if (this.wireframe) child.material.wireframe = this.wireframe;
                        child.material.needsUpdate = true;
                    }
                }
            });
            
            // Set up animation mixer
            if (gltf.animations && gltf.animations.length > 0) {
                this.mixer = new THREE.AnimationMixer(this.model);
                gltf.animations.forEach((clip) => {
                    this.actions[clip.name] = this.mixer.clipAction(clip);
                });
            }
            
            // Set up IK
            if (this.iks.length > 0) {
                this.model.traverse((child) => {
                    if (child.isSkinnedMesh && !this.ikSolver) {
                        this.ikSolver = new CCDIKSolver(child, this.iks);
                    }
                });
            }
            
            this.entity.world.scene3D.add(this.model);
        }
    }

    update(dt) {
        if (this.mixer) {
            this.mixer.update(dt);
        }
        if (this.ikSolver) {
            this.ikSolver.update();
        }
    }

    updateMaterial() {
        if (!this.model) return;
        this.model.traverse((child) => {
            if (child.isMesh) {
                if (this.color !== null || this.metalness !== null || this.roughness !== null || this.emissive !== null || this.emissiveIntensity !== null || this.envMapIntensity !== null || this.wireframe) {
                    if (this.color !== null) child.material.color.setHex(this.color);
                    if (this.metalness !== null) child.material.metalness = this.metalness;
                    if (this.roughness !== null) child.material.roughness = this.roughness;
                    if (this.emissive !== null) child.material.emissive.setHex(this.emissive);
                    if (this.emissiveIntensity !== null) child.material.emissiveIntensity = this.emissiveIntensity;
                    if (this.envMapIntensity !== null) child.material.envMapIntensity = this.envMapIntensity;
                    child.material.wireframe = this.wireframe;
                    child.material.needsUpdate = true;
                }
            }
        });
    }

    /**
     * Set a custom IK configuration and initialize the solver.
     */
    setIK(iks) {
        this.iks = iks;
        if (this.model) {
            this.ikSolver = null;
            this.model.traverse((child) => {
                if (child.isSkinnedMesh && !this.ikSolver) {
                    this.ikSolver = new CCDIKSolver(child, this.iks);
                }
            });
        }
    }

    /**
     * Stops the currently playing animation.
     * @param {number} fadeDuration - Optional fade out duration in seconds.
     */
    stopAnimation(fadeDuration = 0.2) {
        if (this.currentAction) {
            this.currentAction.fadeOut(fadeDuration);
            this.currentAction = null;
        }
    }
    
    /**
     * Blends two animations together based on a weight (0.0 to 1.0).
     */
    blendAnimations(animA, animB, weight) {
        if (!this.mixer) return;
        const actionA = this.actions[animA];
        const actionB = this.actions[animB];
        
        if (!actionA || !actionB) return;
        
        if (!actionA.isRunning()) actionA.play();
        if (!actionB.isRunning()) actionB.play();
        
        actionA.setEffectiveWeight(1.0 - weight);
        actionB.setEffectiveWeight(weight);
        
        this.currentAction = null; // Clear standard crossfade tracking
    }


    serialize() {
        return {
            modelName: this.modelName,
            color: this.color,
            metalness: this.metalness,
            roughness: this.roughness,
            emissive: this.emissive,
            emissiveIntensity: this.emissiveIntensity,
            envMapIntensity: this.envMapIntensity,
            wireframe: this.wireframe,
            availableAnimations: Object.keys(this.actions)
        };
    }

    onDestroy() {
        if (this.model && this.entity && this.entity.world) {
            this.entity.world.scene3D.remove(this.model);
            
            // Clean up cloned materials/geometries if modified
            this.model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    if (this.color !== null || this.metalness !== null || this.roughness !== null || this.emissive !== null || this.emissiveIntensity !== null || this.envMapIntensity !== null || this.wireframe) {
                        child.material = child.material.clone();
                        if (this.color !== null) child.material.color.setHex(this.color);
                        if (this.metalness !== null) child.material.metalness = this.metalness;
                        if (this.roughness !== null) child.material.roughness = this.roughness;
                        if (this.emissive !== null) child.material.emissive.setHex(this.emissive);
                        if (this.emissiveIntensity !== null) child.material.emissiveIntensity = this.emissiveIntensity;
                        if (this.envMapIntensity !== null) child.material.envMapIntensity = this.envMapIntensity;
                        if (this.wireframe) child.material.wireframe = this.wireframe;
                        child.material.needsUpdate = true;
                    }
                }
            });
        }
        
        if (this.mixer) {
            this.mixer.stopAllAction();
            this.mixer.uncacheRoot(this.mixer.getRoot());
            this.mixer = null;
        }
        this.actions = {};
        this.currentAction = null;
        this.model = null;
    }
}
