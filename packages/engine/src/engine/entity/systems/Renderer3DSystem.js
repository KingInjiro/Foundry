import { System } from '../System.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { ModelRenderer } from '../components/ModelRenderer.js';
import { Light3D } from '../components/Light3D.js';
import { Sky3D } from '../components/Sky3D.js';

export class Renderer3DSystem extends System {
    update(dt) {
        // Sync MeshRenderer
        const meshes = this.manager.getComponents(MeshRenderer);
        for (let i = 0; i < meshes.length; i++) {
            const comp = meshes[i];
            if (!comp.enabled || !comp.mesh || !comp.entity || comp.entity.isDestroyed) continue; 
            
            // Sync transform
            // Note: Foundry 2D uses pixels (e.g. x=200). 3D usually uses meters (e.g. x=2).
            // We can scale it down if needed, but for now we just use the raw values or a scaling factor.
            // Let's assume 1 unit in 3D = 100 pixels in 2D.
            const scale = 1 / 100;
            
            comp.mesh.position.set(
                (comp.entity.globalX || 0) * scale,
                -(comp.entity.globalY || 0) * scale,
                (comp.entity.globalZ || 0) * scale
            );
            
            // 2D rotation maps to Z axis in 3D
            const rot = comp.entity.globalRotation || 0;
            comp.mesh.rotation.set(
                comp.entity.globalRotationX || 0,
                comp.entity.globalRotationY || 0,
                (comp.entity.globalRotationZ || 0) + rot
            );
        }
        

        // Sync ModelRenderer
        const models = this.manager.getComponents(ModelRenderer);
        for (let i = 0; i < models.length; i++) {
            const comp = models[i];
            if (!comp.enabled || !comp.model || !comp.entity || comp.entity.isDestroyed) continue; 
            
            const scale = 1 / 100;
            comp.model.position.set(
                (comp.entity.globalX || 0) * scale,
                -(comp.entity.globalY || 0) * scale,
                (comp.entity.globalZ || 0) * scale
            );
            
            const rot = comp.entity.globalRotation || 0;
            comp.model.rotation.set(
                comp.entity.globalRotationX || 0,
                comp.entity.globalRotationY || 0,
                (comp.entity.globalRotationZ || 0) + rot
            );
            

            comp.model.scale.set(
                comp.entity.globalScaleX || comp.entity.scaleX || 1,
                comp.entity.globalScaleY || comp.entity.scaleY || 1,
                comp.entity.globalScaleZ || comp.entity.scaleZ || 1
            );
            
            // Update animations
            if (comp.mixer) {
                comp.mixer.update(dt);
            }
        }

        // Sync Light3D
        const lights = this.manager.getComponents(Light3D);
        for (let i = 0; i < lights.length; i++) {
            const comp = lights[i];
            if (!comp.enabled || !comp.light || !comp.entity || comp.entity.isDestroyed) continue; 
            
            if (comp.light.type !== 'AmbientLight') {
                const scale = 1 / 100;
                comp.light.position.set(
                    (comp.entity.globalX || 0) * scale,
                    -(comp.entity.globalY || 0) * scale,
                    (comp.entity.globalZ || 0) * scale
                );
            }
        }
        
        // Update Sky3D
        const skies = this.manager.getComponents(Sky3D);
        for (let i = 0; i < skies.length; i++) {
            const comp = skies[i];
            if (comp.enabled) {
                comp.update(dt);
            }
        }
    }
    
    // We render after all updates
    render(renderer, camera) {
        // We actually use renderer3D to render
        const engine = this.manager.engine;
        if (engine.renderer3D && engine.world.scene3D && engine.camera3D) {
            engine.renderer3D.render(engine.world.scene3D, engine.camera3D.camera);
        }
    }
}
