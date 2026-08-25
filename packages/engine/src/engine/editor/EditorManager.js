import Matter from 'matter-js';

export class EditorManager {
    constructor(engine) {
        this.engine = engine;
        this.enabled = false; // Disabled by default
        
        this.selectedEntity = null;
        this.hoveredEntity = null;
        this.activeHandle = null; // 'x', 'y', 'xy', 'rot'
        
        this.isDragging = false;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
        this.dragStartAngle = 0;
        this.entityStartRotation = 0;
        
        this.onUpdate = this.onUpdate.bind(this);
        this.onPostRenderWorld = this.onPostRenderWorld.bind(this);
        
        this.engine.events.on('update', this.onUpdate);
        this.engine.events.on('postRenderWorld', this.onPostRenderWorld);
        
        this.wasMouseDown = false;
        this.history = [];
        this.historyIndex = -1;
        this.prevMouseX = 0;
        this.prevMouseY = 0;
        
        this.engine.events.on('editor:undo', () => this.undo());
        this.engine.events.on('editor:redo', () => this.redo());
    }
    
    onUpdate(dt) {
        if (!this.enabled) return;
        
        const input = this.engine.input;
        const camera = this.engine.camera;
        const mouseWorld = camera.screenToWorld(input.mouse.x, input.mouse.y);

        const mx = input.mouse.x;
        const my = input.mouse.y;
        const dx = mx - this.prevMouseX;
        const dy = my - this.prevMouseY;
        this.prevMouseX = mx;
        this.prevMouseY = my;

        // 3D Orbit / Fly Camera (Right Click or Middle Click)
        if (this.engine.camera3D) {
            const cam3d = this.engine.camera3D.camera;
            if (input.mouse.isButtonDown(2) || input.mouse.isButtonDown(1)) {
                // Orbit/Look around
                const sensitivity = 0.005;
                cam3d.rotation.order = 'YXZ';
                cam3d.rotation.y -= dx * sensitivity;
                cam3d.rotation.x -= dy * sensitivity;
                
                // Fly (WASD)
                const speed = 10 * dt;
                let flyZ = 0, flyX = 0;
                if (input.keyboard.isDown('KeyW')) flyZ -= 1;
                if (input.keyboard.isDown('KeyS')) flyZ += 1;
                if (input.keyboard.isDown('KeyA')) flyX -= 1;
                if (input.keyboard.isDown('KeyD')) flyX += 1;
                
                cam3d.translateX(flyX * speed);
                cam3d.translateZ(flyZ * speed);
            }
            if (input.mouse.wheelY !== 0) {
                cam3d.translateZ(input.mouse.wheelY * 0.05);
            }
        }

        
        // Gizmo parameters
        const scale = camera.targetZoom;
        const len = 60 / scale;
        const thick = 12 / scale;
        const originSize = 16 / scale;
        const rotRadius = 70 / scale;
        
        if (this.selectedEntity && !this.selectedEntity.isDestroyed) {
                        const ex = this.selectedEntity.globalX || this.selectedEntity.x;
            const ey = this.selectedEntity.globalY || this.selectedEntity.y;
            
            const distToCenter = Math.hypot(mouseWorld.x - ex, mouseWorld.y - ey);
            
            if (!this.isDragging) {
                this.activeHandle = null;
                if (Math.abs(distToCenter - rotRadius) < thick / 2) {
                    this.activeHandle = 'rot';
                } else if (mouseWorld.x > ex && mouseWorld.x < ex + len && Math.abs(mouseWorld.y - ey) < thick) {
                    this.activeHandle = 'x';
                } else if (mouseWorld.y > ey && mouseWorld.y < ey + len && Math.abs(mouseWorld.x - ex) < thick) {
                    this.activeHandle = 'y';
                } else if (distToCenter < originSize) {
                    this.activeHandle = 'xy';
                }
            }
            
            if (input.mouse.leftDown && !this.wasMouseDown) {
                if (this.activeHandle) {
                    this.isDragging = true;
                    this.dragOffsetX = ex - mouseWorld.x;
                    this.dragOffsetY = ey - mouseWorld.y;
                    this.dragStartAngle = Math.atan2(mouseWorld.y - ey, mouseWorld.x - ex);
                    this.entityStartRotation = this.selectedEntity.rotation; // keep local rotation
                } else {
                    this.hoveredEntity = this.engine.world.raycast(mouseWorld.x, mouseWorld.y, mouseWorld.x, mouseWorld.y + 0.001, 5 / scale);
                    if (!this.hoveredEntity && this.engine.camera3D) {
                        this.hoveredEntity = this.engine.world.raycast3D(input.mouse.x, input.mouse.y, this.engine.camera3D);
                    }
                    if (this.hoveredEntity) {
                        this.selectedEntity = this.hoveredEntity;
                        this.activeHandle = 'xy';
                        this.isDragging = true;
                        this.dragOffsetX = (this.selectedEntity.globalX || this.selectedEntity.x) - mouseWorld.x;
                        this.dragOffsetY = (this.selectedEntity.globalY || this.selectedEntity.y) - mouseWorld.y;
                    } else {
                        this.selectedEntity = null;
                        this.activeHandle = null;
                    }
                }
            }
            
            if (this.isDragging) {
                if (input.mouse.leftDown) {
                    let targetGlobalX = ex;
                    let targetGlobalY = ey;
                    if (this.activeHandle === 'xy') {
                        targetGlobalX = mouseWorld.x + this.dragOffsetX;
                        targetGlobalY = mouseWorld.y + this.dragOffsetY;
                    } else if (this.activeHandle === 'x') {
                        targetGlobalX = mouseWorld.x + this.dragOffsetX;
                    } else if (this.activeHandle === 'y') {
                        targetGlobalY = mouseWorld.y + this.dragOffsetY;
                    } else if (this.activeHandle === 'rot') {
                        const currentAngle = Math.atan2(mouseWorld.y - ey, mouseWorld.x - ex);
                        this.selectedEntity.rotation = this.entityStartRotation + (currentAngle - this.dragStartAngle);
                    }
                    
                    if (this.activeHandle === 'xy' || this.activeHandle === 'x' || this.activeHandle === 'y') {
                        if (this.selectedEntity.parent) {
                            const p = this.selectedEntity.parent;
                            const pr = p.globalRotation || 0;
                            const cos = Math.cos(-pr);
                            const sin = Math.sin(-pr);
                            const dx = targetGlobalX - p.globalX;
                            const dy = targetGlobalY - p.globalY;
                            this.selectedEntity.x = (dx * cos - dy * sin) / (p.globalScaleX || 1);
                            this.selectedEntity.y = (dx * sin + dy * cos) / (p.globalScaleY || 1);
                        } else {
                            this.selectedEntity.x = targetGlobalX;
                            this.selectedEntity.y = targetGlobalY;
                        }
                    }
                    
                    if (this.selectedEntity.hasCollision && this.selectedEntity.body) {
                        Matter.Body.setPosition(this.selectedEntity.body, { x: this.selectedEntity.globalX || this.selectedEntity.x, y: this.selectedEntity.globalY || this.selectedEntity.y });
                        Matter.Body.setAngle(this.selectedEntity.body, this.selectedEntity.globalRotation || this.selectedEntity.rotation);
                    }
                } else {
                    this.isDragging = false;
                    this.pushHistory();
                }
            }
        } else {
            this.hoveredEntity = this.engine.world.raycast(mouseWorld.x, mouseWorld.y, mouseWorld.x, mouseWorld.y + 0.001, 5 / scale);
                    if (!this.hoveredEntity && this.engine.camera3D) {
                        this.hoveredEntity = this.engine.world.raycast3D(input.mouse.x, input.mouse.y, this.engine.camera3D);
                    }
            if (input.mouse.leftDown && !this.wasMouseDown) {
                if (this.hoveredEntity) {
                    this.selectedEntity = this.hoveredEntity;
                    this.activeHandle = 'xy';
                    this.isDragging = true;
                    this.dragOffsetX = this.selectedEntity.x - mouseWorld.x;
                    this.dragOffsetY = this.selectedEntity.y - mouseWorld.y;
                }
            }
        }
        
        this.wasMouseDown = input.mouse.leftDown;
    }
    
    pushHistory() {
        const state = this.engine.FoundryAPI ? this.engine.FoundryAPI.SceneSerializer.serialize(this.engine.world) : null;
        if (!state) return;
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(state);
        if (this.history.length > 50) this.history.shift();
        this.historyIndex = this.history.length - 1;
    }
    
    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            if (this.engine.FoundryAPI) {
                this.engine.FoundryAPI.SceneSerializer.deserializeData(this.engine.world, this.history[this.historyIndex]);
            }
        }
    }
    
    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            if (this.engine.FoundryAPI) {
                this.engine.FoundryAPI.SceneSerializer.deserializeData(this.engine.world, this.history[this.historyIndex]);
            }
        }
    }
    
    onPostRenderWorld(r, camera) {
        if (!this.enabled) return;
        
        const scale = camera.targetZoom;
        const len = 60 / scale;
        const originSize = 16 / scale;
        const rotRadius = 70 / scale;
        const arrowHead = 10 / scale;
        
        // Draw hover gizmo
        if (this.hoveredEntity && !this.hoveredEntity.isDestroyed && this.hoveredEntity !== this.selectedEntity) {
            this.drawGizmo(r, this.hoveredEntity, 'rgba(255, 255, 255, 0.3)', 'rgba(255, 255, 255, 0.6)');
        }
        
        // Draw selected gizmo
        if (this.selectedEntity && !this.selectedEntity.isDestroyed) {
            this.drawGizmo(r, this.selectedEntity, 'rgba(74, 222, 128, 0.2)', 'rgba(74, 222, 128, 0.8)');
            
                        const ex = this.selectedEntity.globalX || this.selectedEntity.x;
            const ey = this.selectedEntity.globalY || this.selectedEntity.y;
            
            // X Arrow (Red)
            r.setStrokeStyle(this.activeHandle === 'x' ? '#ff6b6b' : '#cc0000');
            r.setLineWidth(3 / scale);
            r.drawLine(ex, ey, ex + len, ey);
            // arrow head (drawn with lines instead of fill for simplicity)
            r.drawLine(ex + len, ey, ex + len - arrowHead, ey - arrowHead/2);
            r.drawLine(ex + len, ey, ex + len - arrowHead, ey + arrowHead/2);
            r.drawLine(ex + len - arrowHead, ey - arrowHead/2, ex + len - arrowHead, ey + arrowHead/2);
            
            // Y Arrow (Green)
            r.setStrokeStyle(this.activeHandle === 'y' ? '#6bff6b' : '#00cc00');
            r.setLineWidth(3 / scale);
            r.drawLine(ex, ey, ex, ey + len);
            // arrow head
            r.drawLine(ex, ey + len, ex - arrowHead/2, ey + len - arrowHead);
            r.drawLine(ex, ey + len, ex + arrowHead/2, ey + len - arrowHead);
            r.drawLine(ex - arrowHead/2, ey + len - arrowHead, ex + arrowHead/2, ey + len - arrowHead);
            
            // Center (XY)
            r.setFillStyle(this.activeHandle === 'xy' ? '#ffff6b' : '#cccc00');
            r.fillRect(ex - originSize/2, ey - originSize/2, originSize, originSize);
            
            // Rotation Ring (Blue)
            r.setStrokeStyle(this.activeHandle === 'rot' ? '#6b6bff' : '#0000cc');
            r.setLineWidth(2 / scale);
            r.strokeCircle(ex, ey, rotRadius);
        }
    }
    
    drawGizmo(r, entity, fillColor, strokeColor) {
        r.setFillStyle(fillColor);
        r.setStrokeStyle(strokeColor);
        r.setLineWidth(2 / this.engine.camera.targetZoom);
        
        r.begin();
        r.translate(entity.globalX || entity.x, entity.globalY || entity.y);
        r.rotate(entity.globalRotation || entity.rotation);
        
        if (entity.colliderType === 'box' || (entity.width && entity.height)) {
            const w = entity.width || 50;
            const h = entity.height || 50;
            const w2 = w / 2;
            const h2 = h / 2;
            
            r.fillRect(-w2, -h2, w, h);
            r.strokeRect(-w2, -h2, w, h);
            
            const size = 6 / this.engine.camera.targetZoom;
            r.setFillStyle(strokeColor);
            r.fillRect(-w2 - size/2, -h2 - size/2, size, size);
            r.fillRect(w2 - size/2, -h2 - size/2, size, size);
            r.fillRect(-w2 - size/2, h2 - size/2, size, size);
            r.fillRect(w2 - size/2, h2 - size/2, size, size);
        } else if (entity.colliderType === 'circle' || entity.radius) {
            const rad = entity.radius || 25;
            r.fillCircle(0, 0, rad);
            r.strokeCircle(0, 0, rad);
            r.drawLine(0, 0, rad, 0);
        }
        
        r.end();
    }
}