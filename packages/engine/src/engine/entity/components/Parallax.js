export class Parallax {
    /**
     * @param {Object} data 
     * @param {number} data.scrollFactorX 0 means completely fixed to camera, 1 means moves with world
     * @param {number} data.scrollFactorY
     */
    constructor(data = {}) {
        this.scrollFactorX = data.scrollFactorX ?? 1;
        this.scrollFactorY = data.scrollFactorY ?? 1;
        this.repeatX = data.repeatX ?? false;
        this.repeatY = data.repeatY ?? false;
        this.baseX = 0;
        this.baseY = 0;
        this.initialized = false;
    }
}
