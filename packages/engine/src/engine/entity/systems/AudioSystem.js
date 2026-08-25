import { System } from '../System.js';
import { AudioSource } from '../components/AudioSource.js';

export class AudioSystem extends System {
    update(dt) {
        const sources = this.manager.getComponents(AudioSource);
        
        // Find the camera
        let camera = null;
        if (this.manager.engine && this.manager.engine.camera) {
            camera = this.manager.engine.camera;
        } else if (sources.length > 0 && sources[0].entity) {
            camera = sources[0].entity.engine.camera;
        }
        
        if (camera && this.manager.engine.audio) {
            // WebAudio PannerNode uses 3D coordinates. 
            // We map 2D (x, y) to (x, y, 0)
            this.manager.engine.audio.updateListener(camera.x, camera.y, 0);
        }

        for (let i = 0; i < sources.length; i++) {
            const comp = sources[i];
            const entity = comp.entity;
            
            if (!comp.enabled || !comp.playing || !comp._instance || !comp.spatial || !entity) {
                continue;
            }

            if (comp._instance.setPosition) {
                comp._instance.setPosition(entity.globalX || 0, entity.globalY || 0, entity.globalZ || 0);
            }
        }
    }
}