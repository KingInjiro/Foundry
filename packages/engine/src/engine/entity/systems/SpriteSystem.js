import { System } from '../System.js';
import { Sprite } from '../components/Sprite.js';

export class SpriteSystem extends System {
    render(renderer, camera) {
        const sprites = this.manager.getComponents(Sprite);
        for (let i = 0; i < sprites.length; i++) {
            const sprite = sprites[i];
            if (!sprite.enabled || !sprite.visible || !sprite.entity || sprite.entity.isDestroyed) continue; 
            
            const e = sprite.entity;
            
            renderer.save();
            
            // Apply transform relative to the world
            renderer.translate(e.globalX, e.globalY);
            renderer.rotate(e.globalRotation);
            renderer.scale(e.globalScaleX, e.globalScaleY);
            
            renderer.setGlobalAlpha(sprite.alpha);
            
            const px = -sprite.width * sprite.pivotX;
            const py = -sprite.height * sprite.pivotY;
            
            if (sprite.texture) {
                // If the texture is loaded in asset manager, renderer.drawImageEx handles it
                // We'd need a reference to the image. Assuming sprite.texture is an image object or string identifier.
                // Assuming it's an Image element for now
                if (sprite.texture instanceof HTMLImageElement || sprite.texture instanceof HTMLCanvasElement) {
                    const sw = sprite.sourceWidth || sprite.texture.width;
                    const sh = sprite.sourceHeight || sprite.texture.height;
                    const dx = (0.5 - sprite.pivotX) * sprite.width;
                    const dy = (0.5 - sprite.pivotY) * sprite.height;
                    renderer.drawImageEx(sprite.texture, sprite.sourceX, sprite.sourceY, sw, sh, dx, dy, sprite.width, sprite.height, 0);
                }
            } else {
                renderer.setFillStyle(sprite.color);
                renderer.fillRect(px, py, sprite.width, sprite.height);
            }
            
            renderer.restore();
        }
    }
}
