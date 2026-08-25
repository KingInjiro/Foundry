import * as THREE from 'three';

export class Camera3D {
    constructor(engine) {
        this.engine = engine;
        this.camera = new THREE.PerspectiveCamera(75, engine.window.width / engine.window.height, 0.1, 1000);
        
        this.camera.position.z = 5;
        this.camera.position.y = 2;
        this.camera.lookAt(0, 0, 0);

        this.engine.events.on('resize', (w, h) => {
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
        });
    }
}
