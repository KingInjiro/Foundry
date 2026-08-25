import { System } from '../System.js';
import { Tilemap } from '../components/Tilemap.js';

export class TilemapSystem extends System {
    render(renderer, camera) {
        if (!renderer || !camera) return;

        const bounds = camera.getBounds();
        const tilemaps = this.manager.getComponents(Tilemap);

        for (let i = 0; i < tilemaps.length; i++) {
            const tm = tilemaps[i];
            const entity = tm.entity;

            if (!tm.tileset || !tm.data || tm.data.length === 0 || !entity) continue;

            const image = this.engine.assets.images.get(tm.tileset);
            if (!image || !image.complete) continue;

            const colsInTileset = Math.floor(image.width / tm.tileSize);
            if (colsInTileset === 0) continue;

            const entityX = entity.globalX !== undefined ? entity.globalX : entity.x;
            const entityY = entity.globalY !== undefined ? entity.globalY : entity.y;

            // Camera bounds in local tilemap space
            // Assuming entity position is top-left of the tilemap for simplicity
            const minCol = Math.max(0, Math.floor((bounds.xMin - entityX) / tm.tileSize));
            const maxCol = Math.min(tm.cols - 1, Math.floor((bounds.xMax - entityX) / tm.tileSize));
            const minRow = Math.max(0, Math.floor((bounds.yMin - entityY) / tm.tileSize));
            const maxRow = Math.min(tm.rows - 1, Math.floor((bounds.yMax - entityY) / tm.tileSize));

            renderer.begin();
            // We could apply a transform here if rotation/scale is needed
            // But tilemaps are usually axis-aligned, so we can just draw them.
            // If scale is needed, we'd wrap this in save/restore.
            
            for (let row = minRow; row <= maxRow; row++) {
                for (let col = minCol; col <= maxCol; col++) {
                    const tileIndex = tm.data[row * tm.cols + col];
                    
                    if (tileIndex <= 0) continue; // 0 is empty

                    // Tiled format usually uses 1-based indices
                    const index = tileIndex - 1;
                    
                    const srcX = (index % colsInTileset) * tm.tileSize;
                    const srcY = Math.floor(index / colsInTileset) * tm.tileSize;

                    const dstX = entityX + col * tm.tileSize;
                    const dstY = entityY + row * tm.tileSize;

                    renderer.drawImage(
                        image,
                        srcX, srcY, tm.tileSize, tm.tileSize,
                        dstX, dstY, tm.tileSize, tm.tileSize
                    );
                }
            }
            renderer.end();
        }
    }
}
