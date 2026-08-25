import { RateLimiter } from './RateLimiter.js';
import { getRateLimitConfig } from './rateLimitConfig.js';

export class LocalRateLimiter extends RateLimiter {
    constructor() {
        super();
        this.buckets = new Map();
        
    }

    _getBucket(uid, operation) {
        const key = `${uid}:${operation}`;
        if (!this.buckets.has(key)) {
            this.buckets.set(key, {
                tokens: getRateLimitConfig(operation).max,
                lastRefill: Date.now()
            });
        }
        const bucket = this.buckets.get(key);
        const config = getRateLimitConfig(operation);
        
        // Refill
        const now = Date.now();
        const elapsed = now - bucket.lastRefill;
        if (elapsed > config.windowMs) {
            bucket.tokens = config.max;
            bucket.lastRefill = now;
        } else {
            const refillAmount = Math.floor((elapsed / config.windowMs) * config.max);
            if (refillAmount > 0) {
                bucket.tokens = Math.min(config.max, bucket.tokens + refillAmount);
                bucket.lastRefill = now; 
            }
        }
        
        return { bucket, config };
    }

    async checkLimit(uid, operation) {
        const { bucket, config } = this._getBucket(uid, operation);
        
        const allowed = bucket.tokens > 0;
        let resetAfterMs = 0;
        if (!allowed) {
            const now = Date.now();
            resetAfterMs = config.windowMs - (now - bucket.lastRefill);
            if (resetAfterMs < 0) resetAfterMs = config.windowMs;
        }
        
        return {
            allowed,
            remaining: bucket.tokens,
            resetAfterMs
        };
    }

    async recordOperation(uid, operation) {
        const { bucket } = this._getBucket(uid, operation);
        if (bucket.tokens > 0) {
            bucket.tokens -= 1;
            return true;
        }
        return false;
    }

    async consume(uid, operation) {
        const limit = await this.checkLimit(uid, operation);
        if (limit.allowed) await this.recordOperation(uid, operation);
        return { ...limit, consumed: limit.allowed };
    }
}
