import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';

export class Renderer3D {
    constructor(canvasManager) {
        this.canvasManager = canvasManager;
        this.engine = canvasManager.engine;
        
        if (!canvasManager.canvas3D) {
            return;
        }

        this.renderer = new THREE.WebGLRenderer({
            canvas: canvasManager.canvas3D,
            alpha: false,
            antialias: true // Antialiasing is generally disabled when using EffectComposer unless using SMAAPass, but we'll leave it for standard render fallback
        });
        
        // Tone mapping for better PBR realism
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
        this.renderer.setSize(this.engine.window.width, this.engine.window.height);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.engine.events.on('resize', (w, h) => {
            if(this.renderer) this.renderer.setSize(w, h);
            if (this.composer) {
                this.composer.setSize(w, h);
            }
        });
        
        this.useComposer = false;
        this.composer = null;
        this.renderPass = null;
        this.bloomPass = null;
        this.outputPass = null;
    }

    setEnvironment(scene, url, options = {}) {
        if (!url) {
            scene.environment = null;
            if (options.background) scene.background = null;
            return;
        }

        const isHDR = url.endsWith('.hdr') || url.endsWith('.hdri');
        
        if (isHDR) {
            new RGBELoader().load(url, (texture) => {
                texture.mapping = THREE.EquirectangularReflectionMapping;
                scene.environment = texture;
                if (options.background) {
                    scene.background = texture;
                }
            });
        } else {
            new THREE.TextureLoader().load(url, (texture) => {
                texture.mapping = THREE.EquirectangularReflectionMapping;
                texture.colorSpace = THREE.SRGBColorSpace;
                scene.environment = texture;
                if (options.background) {
                    scene.background = texture;
                }
            });
        }
    }
    
    setupPostProcessing(scene, camera, options = {}) {
        if (!this.renderer) return;
        if (!this.composer) {
            this.composer = new EffectComposer(this.renderer);
            this.renderPass = new RenderPass(scene, camera);
            this.composer.addPass(this.renderPass);
            
            // Setup Bloom
            this.bloomPass = new UnrealBloomPass(new THREE.Vector2(this.engine.window.width, this.engine.window.height), 1.5, 0.4, 0.85);
            this.composer.addPass(this.bloomPass);
            
            // Setup Bokeh (Depth of Field)
            this.bokehPass = new BokehPass(scene, camera, {
                focus: 10.0,
                aperture: 0.025,
                maxblur: 0.01,
                width: this.engine.window.width,
                height: this.engine.window.height
            });
            this.bokehPass.enabled = false;
            this.composer.addPass(this.bokehPass);
            
            // Setup Output (Tone mapping, Color space conversion)
            this.outputPass = new OutputPass();
            this.composer.addPass(this.outputPass);
        } else {
            this.renderPass.scene = scene;
            this.renderPass.camera = camera;
        }

        this.useComposer = options.enabled;
        
        if (options.bloom) {
            this.bloomPass.enabled = true;
            this.bloomPass.strength = options.bloom.strength !== undefined ? options.bloom.strength : 1.5;
            this.bloomPass.radius = options.bloom.radius !== undefined ? options.bloom.radius : 0.4;
            this.bloomPass.threshold = options.bloom.threshold !== undefined ? options.bloom.threshold : 0.85;
        } else {
            this.bloomPass.enabled = false;
        }
        
        if (options.dof) {
            this.bokehPass.enabled = true;
            if (options.dof.focus !== undefined) this.bokehPass.uniforms['focus'].value = options.dof.focus;
            if (options.dof.aperture !== undefined) this.bokehPass.uniforms['aperture'].value = options.dof.aperture;
            if (options.dof.maxblur !== undefined) this.bokehPass.uniforms['maxblur'].value = options.dof.maxblur;
        } else if (this.bokehPass) {
            this.bokehPass.enabled = false;
        }
        
        if (options.exposure !== undefined) {
            this.renderer.toneMappingExposure = options.exposure;
        }
    }

    render(scene, camera) {
        if (!this.renderer || !scene || !camera) return;
        
        if (this.useComposer && this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(scene, camera);
        }
    }
}