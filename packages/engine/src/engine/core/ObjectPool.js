/**
 * Generic Object Pool to prevent garbage collection spikes.
 * Crucial for high-performance JS game engines (particles, bullets).
 */
export class ObjectPool {
    /**
     * @param {Function} factory - Function that returns a new object.
     * @param {number} initialSize - Initial size of the pool.
     */
    constructor(factory, initialSize = 100) {
        this.factory = factory;
        this.pool = [];
        
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(this.factory());
        }
    }

    /**
     * Retrieves an object from the pool.
     * @returns {any}
     */
    get() {
        if (this.pool.length > 0) {
            return this.pool.pop();
        }
        return this.factory();
    }

    /**
     * Returns an object to the pool.
     * @param {any} obj 
     */
    release(obj) {
        this.pool.push(obj);
    }
}
