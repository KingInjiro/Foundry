/**
 * Zero-allocation Uniform Spatial Grid.
 * Groups entities into cells to accelerate spatial queries (O(1) neighbor lookups).
 */
export class SpatialGrid {
    /**
     * @param {number} worldWidth 
     * @param {number} worldHeight 
     * @param {number} cellSize 
     */
    constructor(worldWidth, worldHeight, cellSize) {
        this.cellSize = cellSize;
        this.width = worldWidth;
        this.height = worldHeight;
        this.hw = worldWidth / 2;
        this.hh = worldHeight / 2;
        
        this.cols = Math.ceil(worldWidth / cellSize);
        this.rows = Math.ceil(worldHeight / cellSize);
        
        this.cells = new Array(this.cols * this.rows);
        for (let i = 0; i < this.cells.length; i++) {
            this.cells[i] = [];
        }
        
        /** @type {import('../entity/Entity.js').Entity[]} */
        this.queryResult = [];
        this.queryId = 0;
    }

    /**
     * Clears all cells. Should be called at the start of the frame.
     */
    clear() {
        for (let i = 0; i < this.cells.length; i++) {
            this.cells[i].length = 0; // Zero-allocation clear
        }
    }

    /**
     * Inserts an entity into all cells it overlaps.
     * @param {import('../entity/Entity.js').Entity} entity 
     */
    insert(entity) {
        let r = entity.cullRadius || 0;
        if (entity.hasCollision) {
            let colR = (entity.colliderType === 'box' || entity.colliderType === 'rect') ? Math.max(entity.width || 0, entity.height || 0)/2 : (entity.radius || 100);
            r = Math.max(r, colR);
        }
        
        let startX = Math.floor((entity.globalX - r + this.hw) / this.cellSize);
        let startY = Math.floor((entity.globalY - r + this.hh) / this.cellSize);
        let endX = Math.floor((entity.globalX + r + this.hw) / this.cellSize);
        let endY = Math.floor((entity.globalY + r + this.hh) / this.cellSize);
        
        // Clamp to grid boundaries
        if (startX < 0) startX = 0;
        if (startY < 0) startY = 0;
        if (endX >= this.cols) endX = this.cols - 1;
        if (endY >= this.rows) endY = this.rows - 1;
        
        for (let cy = startY; cy <= endY; cy++) {
            for (let cx = startX; cx <= endX; cx++) {
                const idx = cx + cy * this.cols;
                this.cells[idx].push(entity);
            }
        }
    }
    
    /**
     * Queries all entities in cells overlapping the given bounding area.
     * Note: Returns a shared array to avoid allocation. Do not store the reference.
     * @param {number} x 
     * @param {number} y 
     * @param {number} radius 
     * @returns {import('../entity/Entity.js').Entity[]}
     */
    queryArea(x, y, radius) {
        this.queryId++;
        this.queryResult.length = 0;
        
        let startX = Math.floor((x - radius + this.hw) / this.cellSize);
        let startY = Math.floor((y - radius + this.hh) / this.cellSize);
        let endX = Math.floor((x + radius + this.hw) / this.cellSize);
        let endY = Math.floor((y + radius + this.hh) / this.cellSize);
        
        if (startX < 0) startX = 0;
        if (startY < 0) startY = 0;
        if (endX >= this.cols) endX = this.cols - 1;
        if (endY >= this.rows) endY = this.rows - 1;
        
        for (let cy = startY; cy <= endY; cy++) {
            for (let cx = startX; cx <= endX; cx++) {
                const idx = cx + cy * this.cols;
                const cell = this.cells[idx];
                for (let i = 0; i < cell.length; i++) {
                    const e = cell[i];
                    if (e._gridQueryId !== this.queryId) {
                        e._gridQueryId = this.queryId;
                        this.queryResult.push(e);
                    }
                }
            }
        }
        
        return this.queryResult;
    }
    
    /**
     * Resizes the grid.
     */
    resize(worldWidth, worldHeight, cellSize) {
        this.cellSize = cellSize;
        this.width = worldWidth;
        this.height = worldHeight;
        this.hw = worldWidth / 2;
        this.hh = worldHeight / 2;
        
        this.cols = Math.ceil(worldWidth / cellSize);
        this.rows = Math.ceil(worldHeight / cellSize);
        
        this.cells = new Array(this.cols * this.rows);
        for (let i = 0; i < this.cells.length; i++) {
            this.cells[i] = [];
        }
    }
}
