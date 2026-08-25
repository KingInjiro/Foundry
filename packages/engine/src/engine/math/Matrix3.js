export class Matrix3 {
    constructor() {
        this.data = new Float32Array([
            1, 0, 0,
            0, 1, 0,
            0, 0, 1
        ]);
    }
    
    identity() {
        this.data[0] = 1; this.data[1] = 0; this.data[2] = 0;
        this.data[3] = 0; this.data[4] = 1; this.data[5] = 0;
        this.data[6] = 0; this.data[7] = 0; this.data[8] = 1;
        return this;
    }
    
    // Pooling system
    static _pool = [];
    
    static get() {
        if (this._pool.length > 0) {
            return this._pool.pop().identity();
        }
        return new Matrix3();
    }
    
    release() {
        Matrix3._pool.push(this);
    }
}
