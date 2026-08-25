/**
 * Common math utility functions similar to Unity's Mathf.
 */
export class Mathf {
    static clamp(value, min, max) {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }
    
    static clamp01(value) {
        return Mathf.clamp(value, 0, 1);
    }
    
    static lerp(a, b, t) {
        return a + (b - a) * Mathf.clamp01(t);
    }
    
    static lerpUnclamped(a, b, t) {
        return a + (b - a) * t;
    }
    
    static moveTowards(current, target, maxDelta) {
        if (Math.abs(target - current) <= maxDelta) {
            return target;
        }
        return current + Math.sign(target - current) * maxDelta;
    }
    
    static pingPong(t, length) {
        t = t % (length * 2);
        return length - Math.abs(t - length);
    }
    
    static smoothStep(from, to, t) {
        t = Mathf.clamp01(t);
        t = -2.0 * t * t * t + 3.0 * t * t;
        return to * t + from * (1.0 - t);
    }
    
    static deg2Rad(deg) {
        return deg * (Math.PI / 180.0);
    }
    
    static rad2Deg(rad) {
        return rad * (180.0 / Math.PI);
    }
}

export { Vector2 } from '../math/Vector2.js';
export { Matrix3 } from '../math/Matrix3.js';
