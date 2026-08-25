export class Random {
    constructor(seed = Math.random() * 0xFFFFFFFF) {
        this.seed = seed;
    }

    /**
     * Mulberry32 PRNG
     * @returns {number} Float between 0 and 1
     */
    next() {
        let t = this.seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    /**
     * Float between min (inclusive) and max (exclusive)
     */
    range(min, max) {
        return this.next() * (max - min) + min;
    }

    /**
     * Integer between min (inclusive) and max (inclusive)
     */
    rangeInt(min, max) {
        return Math.floor(this.range(min, max + 1));
    }

    /**
     * Random element from an array
     */
    choice(array) {
        if (!array || array.length === 0) return null;
        return array[this.rangeInt(0, array.length - 1)];
    }

    /**
     * Set the seed
     */
    setSeed(seed) {
        this.seed = seed;
    }
}
