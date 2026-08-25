import { Entity } from '../entity/Entity.js';

export class Tilemap extends Entity {
    constructor(tileSize, columns, rows, tilesetImage = null) {
        super();
        this.tileSize = tileSize;
        this.columns = columns;
        this.rows = rows;
        this.tilesetImage = tilesetImage;
        
        // Large cull radius to not get culled easily
        this.cullRadius = Math.max(columns, rows) * tileSize; 
        
        // The map data: an array of tile indices (0 means empty, 1+ are tiles)
        this.data = new Array(columns * rows).fill(0);
        
        this.tilesetCols = 0;
        this.tilesetRows = 0;
        
        if (tilesetImage) {
            this.setTileset(tilesetImage);
        }
    }
    
    setTileset(image) {
        this.tilesetImage = image;
        if (image && image.complete) {
            this.updateTilesetMetrics();
        }
    }
    
    updateTilesetMetrics() {
        if (this.tilesetImage && this.tilesetImage.width > 0) {
            this.tilesetCols = Math.floor(this.tilesetImage.width / this.tileSize);
            this.tilesetRows = Math.floor(this.tilesetImage.height / this.tileSize);
        }
    }
    
    setTile(col, row, tileIndex) {
        if (col >= 0 && col < this.columns && row >= 0 && row < this.rows) {
            this.data[row * this.columns + col] = tileIndex;
        }
    }
    
    getTile(col, row) {
        if (col >= 0 && col < this.columns && row >= 0 && row < this.rows) {
            return this.data[row * this.columns + col];
        }
        return 0;
    }
    
    fill(col, row, width, height, tileIndex) {
        for (let y = row; y < row + height; y++) {
            for (let x = col; x < col + width; x++) {
                this.setTile(x, y, tileIndex);
            }
        }
    }
    
    /**
     * Generates static physics colliders for the tilemap using Greedy Meshing.
     * @param {number[]} solidIndices Array of tile indices that should be solid
     * @param {import('../simulation/Simulation.js').Simulation} simulation The simulation to add colliders to
     */
    generateColliders(solidIndices = [1], simulation = null) {
        if (!simulation) {
            console.warn("Simulation required to generate colliders");
            return;
        }

        const visited = new Array(this.columns * this.rows).fill(false);
        const rects = [];

        const isSolid = (col, row) => {
            if (col < 0 || col >= this.columns || row < 0 || row >= this.rows) return false;
            const val = this.data[row * this.columns + col];
            return solidIndices.includes(val);
        };

        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.columns; col++) {
                if (isSolid(col, row) && !visited[row * this.columns + col]) {
                    // Find max width
                    let width = 1;
                    while (col + width < this.columns && isSolid(col + width, row) && !visited[row * this.columns + col + width]) {
                        width++;
                    }

                    // Find max height
                    let height = 1;
                    let done = false;
                    while (row + height < this.rows && !done) {
                        for (let x = col; x < col + width; x++) {
                            if (!isSolid(x, row + height) || visited[(row + height) * this.columns + x]) {
                                done = true;
                                break;
                            }
                        }
                        if (!done) {
                            height++;
                        }
                    }

                    // Mark as visited
                    for (let y = row; y < row + height; y++) {
                        for (let x = col; x < col + width; x++) {
                            visited[y * this.columns + x] = true;
                        }
                    }

                    rects.push({
                        col: col,
                        row: row,
                        width: width,
                        height: height
                    });
                }
            }
        }

        // Create entities for each rectangle
        const PhysicsBody = simulation.getClass('PhysicsBody');
        const EntityClass = simulation.getClass('Entity');
        
        for (let i = 0; i < rects.length; i++) {
            const rect = rects[i];
            const e = new EntityClass();
            e.tag = 'tilemap_collider';
            e.isStatic = true;
            
            // Calculate center position
            e.x = this.globalX + rect.col * this.tileSize + (rect.width * this.tileSize) / 2;
            e.y = this.globalY + rect.row * this.tileSize + (rect.height * this.tileSize) / 2;
            e.width = rect.width * this.tileSize;
            e.height = rect.height * this.tileSize;
            
            e.hasCollision = true;
            e.colliderType = 'box';

            if (PhysicsBody) {
                const pb = new PhysicsBody({
                    isStatic: true,
                    friction: 0.1,
                    restitution: 0.1
                });
                e.addComponent(pb);
            }

            this.addChild(e);
        }
        
        return rects.length;
    }
    
    worldToGrid(worldX, worldY) {
        const lx = worldX - this.globalX;
        const ly = worldY - this.globalY;
        return {
            col: Math.floor(lx / this.tileSize),
            row: Math.floor(ly / this.tileSize)
        };
    }
    
    onRender(renderer, camera) {
        if (!this.tilesetImage || !this.tilesetImage.complete) return;
        if (this.tilesetCols <= 0) this.updateTilesetMetrics();
        if (this.tilesetCols <= 0) return;
        
        const bounds = camera.getBounds();
        
        // Calculate bounds relative to tilemap's global position
        const localXMin = bounds.xMin - this.globalX;
        const localXMax = bounds.xMax - this.globalX;
        const localYMin = bounds.yMin - this.globalY;
        const localYMax = bounds.yMax - this.globalY;
        
        const startCol = Math.max(0, Math.floor(localXMin / this.tileSize));
        const endCol = Math.min(this.columns, Math.ceil(localXMax / this.tileSize));
        const startRow = Math.max(0, Math.floor(localYMin / this.tileSize));
        const endRow = Math.min(this.rows, Math.ceil(localYMax / this.tileSize));
        
        renderer.ctx.save();
        renderer.ctx.translate(this.globalX, this.globalY);
        if (this.globalRotation !== 0) {
            renderer.ctx.rotate(this.globalRotation);
        }
        
        for (let row = startRow; row < endRow; row++) {
            for (let col = startCol; col < endCol; col++) {
                const tileIndex = this.getTile(col, row);
                if (tileIndex > 0) {
                    const tIdx = tileIndex - 1; 
                    const tCol = tIdx % this.tilesetCols;
                    const tRow = Math.floor(tIdx / this.tilesetCols);
                    
                    const sx = tCol * this.tileSize;
                    const sy = tRow * this.tileSize;
                    
                    // We render from top-left, but drawImageEx takes center, so add half tile
                    const dx = col * this.tileSize + this.tileSize / 2;
                    const dy = row * this.tileSize + this.tileSize / 2;
                    
                    renderer.drawImageEx(
                        this.tilesetImage,
                        sx, sy,
                        this.tileSize, this.tileSize,
                        dx, dy,
                        this.tileSize, this.tileSize,
                        0
                    );
                }
            }
        }
        
        renderer.ctx.restore();
    }
}
