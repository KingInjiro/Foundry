export class SpriteAnimator {
    constructor(image, frameWidth, frameHeight) {
        this.image = image;
        this.frameWidth = frameWidth;
        this.frameHeight = frameHeight;
        
        this.animations = new Map();
        this.currentAnimation = null;
        
        this.currentFrameIndex = 0;
        this.frameTimer = 0;
        this.isPlaying = false;
        
        this.cols = image ? Math.floor(image.width / frameWidth) : 1;
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
    
    update(dt) {
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
    }
    
    render(renderer, x, y, width = this.frameWidth, height = this.frameHeight, rotation = 0) {
        if (!this.image || !this.image.complete) return;
        
        if (this.cols <= 0 && this.image.width > 0) {
            this.cols = Math.floor(this.image.width / this.frameWidth);
        }
        
        let frame = 0;
        if (this.currentAnimation) {
            const anim = this.animations.get(this.currentAnimation);
            if (anim) {
                frame = anim.frames[this.currentFrameIndex];
            }
        }
        
        const col = frame % this.cols;
        const row = Math.floor(frame / this.cols);
        
        const sx = col * this.frameWidth;
        const sy = row * this.frameHeight;
        
        renderer.drawImageEx(
            this.image, 
            sx, sy, 
            this.frameWidth, this.frameHeight, 
            x, y, 
            width, height, 
            rotation
        );
    }
}
