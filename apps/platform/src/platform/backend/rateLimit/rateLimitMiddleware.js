export const createRateLimitMiddleware = (rateLimiter, operation) => {
    return async (req, res, next) => {
        try {
            const uid = req.auth.uid;
            
            const limit = await rateLimiter.consume(uid, operation);
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
            console.error('Rate limit error:', err);
            return res.status(503).json({
                success: false,
                error: { code: 'RATE_LIMIT_UNAVAILABLE', message: 'Rate limiting is temporarily unavailable.' }
            });
        }
    };
};
