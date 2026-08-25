import { System } from '../System.js';
import { Animator } from '../components/Animator.js';
import { Sprite } from '../components/Sprite.js';

export class AnimatorSystem extends System {
    update(dt) {
        const animators = this.manager.getComponents(Animator);
        
        for (let i = 0; i < animators.length; i++) {
            const animator = animators[i];
            if (!animator.enabled || !animator.isPlaying || !animator.entity || animator.entity.isDestroyed) continue; 
            
            const sprite = animator.entity.getComponent(Sprite);
            if (!sprite) continue;
            
            const anim = animator.animations.get(animator.currentAnimation);
            if (!anim) continue;
            
            animator.frameTimer += dt;
            if (animator.frameTimer >= anim.frameDuration) {
                animator.frameTimer = 0;
                animator.currentFrameIndex++;
                
                if (animator.currentFrameIndex >= anim.frames.length) {
                    if (anim.loop) {
                        animator.currentFrameIndex = 0;
                    } else {
                        animator.currentFrameIndex = anim.frames.length - 1;
                        animator.isPlaying = false;
                    }
                }
                
                // Update sprite
                const frameIndex = anim.frames[animator.currentFrameIndex];
                
                // Assuming spritesheet is organized sequentially left to right, top to bottom
                // We need to know columns, or assume frameWidth/Height is enough if texture is loaded.
                // For a robust system, we assume 1D array index or {x, y} frames.
                
                if (typeof frameIndex === 'number') {
                    // We need the texture to know cols.
                    if (sprite.texture && sprite.texture.width) {
                        const cols = Math.floor(sprite.texture.width / animator.frameWidth);
                        const row = Math.floor(frameIndex / cols);
                        const col = frameIndex % cols;
                        
                        sprite.sourceX = col * animator.frameWidth;
                        sprite.sourceY = row * animator.frameHeight;
                        sprite.sourceWidth = animator.frameWidth;
                        sprite.sourceHeight = animator.frameHeight;
                    }
                } else if (frameIndex && typeof frameIndex.x === 'number') {
                    // Frame object with x,y,w,h
                    sprite.sourceX = frameIndex.x;
                    sprite.sourceY = frameIndex.y;
                    sprite.sourceWidth = frameIndex.width || animator.frameWidth;
                    sprite.sourceHeight = frameIndex.height || animator.frameHeight;
                }
            }
        }
    }
}
