import { Component } from '../Component.js';

export class Animator extends Component {
    constructor() {
        super();
        this.frameWidth = 64;
        this.frameHeight = 64;
        this.animations = new Map();
        this.currentAnimation = null;
        this.currentFrameIndex = 0;
        this.frameTimer = 0;
        this.isPlaying = false;
        
        // This will bind to the sprite on the entity
        this.sprite = null;
    }
    
    onAwake() {
        this.sprite = this.entity.getComponent('Sprite');
    }
    
    add(name, frames, fps = 10, loop = true) {
        this.animations.set(name, {
            frames,
            frameDuration: 1 / fps,
            loop
        });
    }
    
    play(name) {
        if (this.currentAnimation === name && this.isPlaying) return;
        const anim = this.animations.get(name);
        if (!anim) return;
        
        this.currentAnimation = name;
        this.currentFrameIndex = 0;
        this.frameTimer = 0;
        this.isPlaying = true;
    }
    
    stop() {
        this.isPlaying = false;
    }
    
    onUpdate(dt) {
        if (!this.isPlaying || !this.currentAnimation) return;
        
        const anim = this.animations.get(this.currentAnimation);
        this.frameTimer += dt;
        
        while (this.frameTimer >= anim.frameDuration) {
            this.frameTimer -= anim.frameDuration;
            this.currentFrameIndex++;
            
            if (this.currentFrameIndex >= anim.frames.length) {
                if (anim.loop) {
                    this.currentFrameIndex = 0;
                } else {
                    this.currentFrameIndex = anim.frames.length - 1;
                    this.isPlaying = false;
                }
            }
        }
        
        this._updateSprite();
    }
    
    _updateSprite() {
        if (!this.sprite || !this.sprite.texture) return;
        
        const img = this.sprite.texture;
        if (!img.complete) return;
        
        const cols = Math.floor(img.width / this.frameWidth) || 1;
        
        let frame = 0;
        if (this.currentAnimation) {
            const anim = this.animations.get(this.currentAnimation);
            if (anim) {
                frame = anim.frames[this.currentFrameIndex];
            }
        }
        
        const col = frame % cols;
        const row = Math.floor(frame / cols);
        
        // We will need a way to tell the sprite which sub-region to render
        this.sprite.sourceX = col * this.frameWidth;
        this.sprite.sourceY = row * this.frameHeight;
        this.sprite.sourceWidth = this.frameWidth;
        this.sprite.sourceHeight = this.frameHeight;
    }
}
