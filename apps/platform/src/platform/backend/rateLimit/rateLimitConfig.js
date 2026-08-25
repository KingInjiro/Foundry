export const RATE_LIMIT_CONFIG = Object.freeze({
    create_version: Object.freeze({ max: 10, windowMs: 60 * 1000 }),
    complete_upload: Object.freeze({ max: 10, windowMs: 60 * 1000 }),
    publish_version: Object.freeze({ max: 5, windowMs: 60 * 1000 }),
    release_lifecycle: Object.freeze({ max: 10, windowMs: 60 * 1000 }),
    discovery_event: Object.freeze({ max: 120, windowMs: 60 * 1000 })
});

export function getRateLimitConfig(operation) {
    return RATE_LIMIT_CONFIG[operation] || { max: 100, windowMs: 60 * 1000 };
}
