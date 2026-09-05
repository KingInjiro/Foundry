export const RATE_LIMIT_CONFIG = Object.freeze({
    auth_register_ip: Object.freeze({ max: 5, windowMs: 60 * 60 * 1000 }),
    auth_login_ip: Object.freeze({ max: 20, windowMs: 15 * 60 * 1000 }),
    auth_login_account: Object.freeze({ max: 10, windowMs: 15 * 60 * 1000 }),
    create_game: Object.freeze({ max: 10, windowMs: 60 * 1000 }),
    editor_write: Object.freeze({ max: 60, windowMs: 60 * 1000 }),
    create_version: Object.freeze({ max: 10, windowMs: 60 * 1000 }),
    complete_upload: Object.freeze({ max: 10, windowMs: 60 * 1000 }),
    publish_version: Object.freeze({ max: 5, windowMs: 60 * 1000 }),
    release_lifecycle: Object.freeze({ max: 10, windowMs: 60 * 1000 }),
    discovery_event: Object.freeze({ max: 120, windowMs: 60 * 1000 }),
    discovery_read: Object.freeze({ max: 120, windowMs: 60 * 1000 }),
    catalog_read: Object.freeze({ max: 240, windowMs: 60 * 1000 }),
    rating_write: Object.freeze({ max: 30, windowMs: 60 * 1000 }),
    follow_write: Object.freeze({ max: 30, windowMs: 60 * 1000 }),
    report_game: Object.freeze({ max: 5, windowMs: 60 * 60 * 1000 }),
    moderation_action: Object.freeze({ max: 60, windowMs: 60 * 1000 })
});

export function getRateLimitConfig(operation) {
    return RATE_LIMIT_CONFIG[operation] || { max: 100, windowMs: 60 * 1000 };
}
