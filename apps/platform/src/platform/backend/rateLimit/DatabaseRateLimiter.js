import { RateLimiter } from './RateLimiter.js';
import { getRateLimitConfig } from './rateLimitConfig.js';

/**
 * Fixed-window limiter backed by the metadata database. The provider performs
 * each consume atomically, so every API process sharing that database observes
 * the same counters.
 */
export class DatabaseRateLimiter extends RateLimiter {
    constructor(database, now = () => Date.now()) {
        super();
        this.database = database;
        this.now = now;
    }

    async consume(identity, operation) {
        return this.database.consumeRateLimit(
            identity,
            operation,
            getRateLimitConfig(operation),
            this.now()
        );
    }

    async checkLimit(identity, operation) {
        const result = await this.consume(identity, operation);
        return { ...result, consumed: true };
    }

    async recordOperation() {
        // checkLimit consumes atomically; retained for the legacy interface.
        return true;
    }
}
