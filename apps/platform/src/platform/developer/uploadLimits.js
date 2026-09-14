const fields = [
    'maxPackageSizeBytes',
    'maxFileSizeBytes',
    'maxTotalExtractedSizeBytes',
    'maxFilesPerPackage',
    'maxExtractedFilesPerPackage'
];

export function parseUploadLimits(value) {
    if (!value || fields.some(field => !Number.isSafeInteger(value[field]) || value[field] < 0)) {
        throw new Error('The server returned invalid upload limits.');
    }
    return Object.fromEntries(fields.map(field => [field, value[field]]));
}

export function toValidationQuotas(value) {
    const limits = parseUploadLimits(value);
    return {
        PLATFORM_MAX_FILES_PER_PACKAGE: limits.maxFilesPerPackage,
        PLATFORM_MAX_EXTRACTED_FILES_PER_PACKAGE: limits.maxExtractedFilesPerPackage,
        PLATFORM_MAX_FILE_SIZE_BYTES: limits.maxFileSizeBytes,
        PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES: limits.maxTotalExtractedSizeBytes
    };
}
