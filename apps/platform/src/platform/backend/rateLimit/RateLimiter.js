export class RateLimiter {
    async consume(uid, operation) {
        const limit = await this.checkLimit(uid, operation);
        if (limit.allowed) await this.recordOperation(uid, operation);
        return { ...limit, consumed: limit.allowed };
    }
    async checkLimit(uid, operation) {
        throw new Error('Not implemented');
    }
    async recordOperation(uid, operation) {
        throw new Error('Not implemented');
    }
}
