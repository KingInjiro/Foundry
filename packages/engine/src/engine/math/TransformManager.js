export class TransformManager {
    constructor(capacity = 50000) {
        this.capacity = capacity;
        
        // Structure of Arrays (SoA) for better cache locality and SIMD potential
        this.localX = new Float32Array(capacity);
        this.localY = new Float32Array(capacity);
        this.localZ = new Float32Array(capacity);
        this.localRotationX = new Float32Array(capacity);
        this.localRotationY = new Float32Array(capacity);
        this.localRotationZ = new Float32Array(capacity);
        this.localScaleX = new Float32Array(capacity);
        this.localScaleY = new Float32Array(capacity);
        this.localScaleZ = new Float32Array(capacity);
        
        // Fill defaults
        this.localScaleX.fill(1);
        this.localScaleY.fill(1);
        this.localScaleZ.fill(1);
        
        // Single continuous buffer for cache locality of matrices
        this.buffer = new ArrayBuffer(capacity * 16 * 4 * 2); // 16 floats * 4 bytes * 2 matrices per transform
        
        this.localMatrices = new Float32Array(this.buffer, 0, capacity * 16);
        this.worldMatrices = new Float32Array(this.buffer, capacity * 16 * 4, capacity * 16);
        
        this._nextId = 1; // 0 is reserved/null
        this.freeIds = [];
    }
    
    allocate() {
        const id = this.freeIds.length > 0 ? this.freeIds.pop() : this._nextId++;
        if (id >= this.capacity) throw new Error("Transform capacity exceeded");
        
        this.localX[id] = 0;
        this.localY[id] = 0;
        this.localZ[id] = 0;
        this.localRotationX[id] = 0;
        this.localRotationY[id] = 0;
        this.localRotationZ[id] = 0;
        this.localScaleX[id] = 1;
        this.localScaleY[id] = 1;
        this.localScaleZ[id] = 1;
        
        // Initialize identity matrices
        const offset = id * 16;
        this.localMatrices.fill(0, offset, offset + 16);
        this.worldMatrices.fill(0, offset, offset + 16);
        
        this.localMatrices[offset] = 1; this.localMatrices[offset + 5] = 1; this.localMatrices[offset + 10] = 1; this.localMatrices[offset + 15] = 1;
        this.worldMatrices[offset] = 1; this.worldMatrices[offset + 5] = 1; this.worldMatrices[offset + 10] = 1; this.worldMatrices[offset + 15] = 1;
        
        return id;
    }
    
    free(id) {
        this.freeIds.push(id);
    }
    
    getLocalMatrixView(id) {
        return new Float32Array(this.buffer, id * 16 * 4, 16);
    }
    
    getWorldMatrixView(id) {
        return new Float32Array(this.buffer, (this.capacity * 16 * 4) + (id * 16 * 4), 16);
    }
}

export const GlobalTransforms = new TransformManager();
