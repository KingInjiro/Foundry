export const createRateLimitMiddleware = (rateLimiter, operation, { identity } = {}) => {
    return async (req, res, next) => {
        try {
            const resolvedIdentity = identity ? identity(req) : req.auth?.uid;
            if (typeof resolvedIdentity !== 'string' || !resolvedIdentity.trim()) {
                throw new Error(`Rate-limit identity unavailable for ${operation}.`);
            }
            const limit = await rateLimiter.consume(resolvedIdentity, operation);
            if (!limit.allowed) {
                res.set('Retry-After', Math.ceil(limit.resetAfterMs / 1000));
                return res.status(429).json({
                    success: false,
                    error: {
                        code: 'RATE_LIMITED',
                        message: 'Rate limit exceeded',
                        retryAfterMs: limit.resetAfterMs
                    }
                });
            }
            next();
        } catch (err) {
            req.app?.locals?.logger?.error('rate_limit_failed', {
                requestId: req.requestId,
                userUid: req.auth?.uid,
                operation,
                error: err
            });
            return res.status(503).json({
                success: false,
                error: { code: 'RATE_LIMIT_UNAVAILABLE', message: 'Rate limiting is temporarily unavailable.' }
            });
        }
    };
};
