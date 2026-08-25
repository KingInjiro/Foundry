const getEnvNumber = (key, fallback) => {
    if (typeof process !== 'undefined' && process.env) {
        const parsed = Number(process.env[key]);
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return fallback;
};

export const QuotaConfig = {
    // Storage (Platform Hosted)
    PLATFORM_MAX_STORAGE_BYTES_PER_USER: getEnvNumber('PLATFORM_MAX_STORAGE_BYTES_PER_USER', 1024 * 1024 * 1024), // 1 GB
    PLATFORM_MAX_ACTIVE_UPLOADS_PER_USER: getEnvNumber('PLATFORM_MAX_ACTIVE_UPLOADS_PER_USER', 10),
    PLATFORM_MAX_GAME_VERSIONS_PER_USER: getEnvNumber('PLATFORM_MAX_GAME_VERSIONS_PER_USER', 100),

    // Limits per package
    PLATFORM_MAX_PACKAGE_SIZE_BYTES: getEnvNumber('PLATFORM_MAX_PACKAGE_SIZE_BYTES', 50 * 1024 * 1024), // 50 MB
    PLATFORM_MAX_FILES_PER_PACKAGE: getEnvNumber('PLATFORM_MAX_FILES_PER_PACKAGE', 1000),
    PLATFORM_MAX_EXTRACTED_FILES_PER_PACKAGE: getEnvNumber('PLATFORM_MAX_EXTRACTED_FILES_PER_PACKAGE', 1000),
    PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES: getEnvNumber('PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES', 100 * 1024 * 1024), // 100 MB

    // Limits per individual file
    PLATFORM_MAX_FILE_SIZE_BYTES: getEnvNumber('PLATFORM_MAX_FILE_SIZE_BYTES', 20 * 1024 * 1024), // 20 MB

    // Timeouts and Limits
    UPLOAD_SESSION_EXPIRATION_MS: getEnvNumber('UPLOAD_SESSION_EXPIRATION_MS', 24 * 60 * 60 * 1000), // 24 hours
    COMPLETED_UPLOAD_RETENTION_MS: getEnvNumber('COMPLETED_UPLOAD_RETENTION_MS', 7 * 24 * 60 * 60 * 1000), // 7 days to publish/retry
    MAX_PUBLISH_ATTEMPTS: getEnvNumber('MAX_PUBLISH_ATTEMPTS', 3)
};
