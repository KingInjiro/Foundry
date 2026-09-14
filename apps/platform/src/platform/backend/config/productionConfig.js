import fs from 'node:fs';
import path from 'node:path';
import { DEPLOYMENT_MODES, resolveDeploymentMode } from './deploymentMode.js';
import { profileSupportsStorage, resolveStorageProvider, resolveR2ObjectPrefix, r2UploadOrigins } from './storageConfig.js';

const BOOLEAN_VALUES = new Set(['true', 'false']);
const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

function hasValue(value) {
    return typeof value === 'string' && value.trim() !== '';
}

function parseInteger(env, key, { fallback, min, max, errors }) {
    if (!hasValue(env[key])) return fallback;
    const value = Number(env[key]);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        errors.push(`${key} must be an integer from ${min} to ${max}.`);
        return fallback;
    }
    return value;
}

function validateBoolean(env, key, errors) {
    if (hasValue(env[key]) && !BOOLEAN_VALUES.has(env[key])) {
        errors.push(`${key} must be exactly true or false.`);
    }
}

function parseHttpsUrl(value, key, errors, { allowPath = false } = {}) {
    if (!hasValue(value)) {
        errors.push(`${key} is required.`);
        return null;
    }
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
            throw new Error('unsafe URL');
        }
        if (!allowPath && url.pathname !== '/') throw new Error('path not allowed');
        return url;
    } catch {
        errors.push(`${key} must be an HTTPS URL without credentials, query, or fragment${allowPath ? '' : ' and without a path'}.`);
        return null;
    }
}

function validateWritableDirectory(directory, label, errors) {
    const stat = fs.statSync(directory, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) {
        errors.push(`${label} must reference an existing directory.`);
        return false;
    }
    try {
        fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
        return true;
    } catch {
        errors.push(`${label} must be readable and writable by the Platform process.`);
        return false;
    }
}

function isPathInside(parentPath, candidatePath) {
    const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
    return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function validateSecret(env, key, errors, minimumBytes = 32) {
    if (!hasValue(env[key])) {
        errors.push(`${key} is required in single-host production mode.`);
        return null;
    }
    const value = env[key];
    if (Buffer.byteLength(value, 'utf8') < minimumBytes) {
        errors.push(`${key} must contain at least ${minimumBytes} bytes of high-entropy secret material.`);
        return null;
    }
    return value;
}

function loadClientBuildProfile(env, deploymentMode, storageProvider, errors) {
    const configuredPath = hasValue(env.PLATFORM_CLIENT_BUILD_PROFILE)
        ? env.PLATFORM_CLIENT_BUILD_PROFILE.trim()
        : path.resolve(process.cwd(), 'dist/client/deployment-profile.json');
    let profile = null;
    if (!path.isAbsolute(configuredPath) || !fs.statSync(configuredPath, { throwIfNoEntry: false })?.isFile()) {
        errors.push('PLATFORM_CLIENT_BUILD_PROFILE must reference the generated deployment-profile.json file.');
        return { path: configuredPath, profile };
    }
    try {
        profile = JSON.parse(fs.readFileSync(configuredPath, 'utf8'));
        if (!profileSupportsStorage(profile, deploymentMode, storageProvider)) {
            errors.push('The built client deployment profile does not match FOUNDRY_DEPLOYMENT_MODE or the selected storage provider. Rebuild the client for this environment.');
        }
    } catch {
        errors.push('PLATFORM_CLIENT_BUILD_PROFILE is not valid JSON.');
    }
    return { path: configuredPath, profile };
}

function validateDatabasePath(databasePath, errors) {
    if (!databasePath) {
        errors.push('PLATFORM_DB_PATH is required.');
        return;
    }
    if (!path.isAbsolute(databasePath) || databasePath === path.parse(databasePath).root || databasePath === ':memory:') {
        errors.push('PLATFORM_DB_PATH must be an absolute non-root persistent file path.');
        return;
    }
    validateWritableDirectory(path.dirname(databasePath), 'The PLATFORM_DB_PATH parent directory', errors);
}

export function validateProductionConfiguration(env = process.env) {
    const production = env.NODE_ENV === 'production';
    const errors = [];
    let deploymentMode;
    try {
        deploymentMode = resolveDeploymentMode(env, { requireExplicit: production });
    } catch (error) {
        errors.push(error.message);
        deploymentMode = DEPLOYMENT_MODES.CLOUD;
    }

    let storageProvider;
    try { storageProvider = resolveStorageProvider(env, deploymentMode); }
    catch (error) { errors.push(error.message); }

    const trustProxyHops = parseInteger(env, 'TRUST_PROXY_HOPS', {
        fallback: 0, min: 0, max: 3, errors
    });
    const shutdownGraceMs = parseInteger(env, 'SHUTDOWN_GRACE_MS', {
        fallback: 30_000, min: 5_000, max: 120_000, errors
    });

    validateBoolean(env, 'ENABLE_HSTS', errors);
    validateBoolean(env, 'R2_DIRECT_DOWNLOADS', errors);
    validateBoolean(env, 'FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS', errors);
    validateBoolean(env, 'ALLOW_UNREADY_STARTUP', errors);
    validateBoolean(env, 'SINGLE_HOST_ALLOW_EXTERNAL_DB_PATH', errors);

    if (!production) {
        if (errors.length) {
            const error = new Error(`Invalid runtime configuration:\n- ${errors.join('\n- ')}`);
            error.code = 'INVALID_RUNTIME_CONFIGURATION';
            error.details = errors;
            throw error;
        }
        return {
            production: false,
            deploymentMode,
            trustProxyHops,
            shutdownGraceMs,
            hstsEnabled: false
        };
    }

    if (env.ALLOW_UNREADY_STARTUP === 'true') {
        errors.push('ALLOW_UNREADY_STARTUP cannot be enabled in production.');
    }
    if (!hasValue(env.TRUST_PROXY_HOPS)) {
        errors.push('TRUST_PROXY_HOPS must be set explicitly in production (0 for direct TLS, otherwise the exact trusted proxy hop count).');
    }

    const publicBaseUrl = parseHttpsUrl(env.PLATFORM_PUBLIC_BASE_URL, 'PLATFORM_PUBLIC_BASE_URL', errors);
    const port = parseInteger(env, 'PORT', { fallback: 3000, min: 1, max: 65535, errors });
    const jobMode = hasValue(env.JOB_MODE) ? env.JOB_MODE.trim() : 'async';
    if (jobMode !== 'async') errors.push('JOB_MODE must be async in production.');
    const logLevel = hasValue(env.LOG_LEVEL) ? env.LOG_LEVEL.trim() : 'info';
    if (!LOG_LEVELS.has(logLevel)) errors.push('LOG_LEVEL must be debug, info, warn, or error.');

    parseInteger(env, 'JOB_LEASE_MS', { fallback: 60_000, min: 5_000, max: 3_600_000, errors });
    parseInteger(env, 'MAX_JOB_ATTEMPTS', { fallback: 3, min: 1, max: 20, errors });
    parseInteger(env, 'UPLOAD_CLEANUP_INTERVAL_MS', { fallback: 900_000, min: 60_000, max: 86_400_000, errors });
    parseInteger(env, 'UPLOAD_SESSION_EXPIRATION_MS', { fallback: 86_400_000, min: 300_000, max: 604_800_000, errors });
    parseInteger(env, 'COMPLETED_UPLOAD_RETENTION_MS', { fallback: 604_800_000, min: 3_600_000, max: 7_776_000_000, errors });
    parseInteger(env, 'MAX_PUBLISH_ATTEMPTS', { fallback: 3, min: 1, max: 20, errors });

    const quotaValues = {
        storage: parseInteger(env, 'PLATFORM_MAX_STORAGE_BYTES_PER_USER', { fallback: 1_073_741_824, min: 1_048_576, max: 1_099_511_627_776, errors }),
        activeUploads: parseInteger(env, 'PLATFORM_MAX_ACTIVE_UPLOADS_PER_USER', { fallback: 10, min: 1, max: 1000, errors }),
        versions: parseInteger(env, 'PLATFORM_MAX_GAME_VERSIONS_PER_USER', { fallback: 100, min: 1, max: 10_000, errors }),
        packageSize: parseInteger(env, 'PLATFORM_MAX_PACKAGE_SIZE_BYTES', { fallback: 52_428_800, min: 1_048_576, max: 2_147_483_648, errors }),
        packageFiles: parseInteger(env, 'PLATFORM_MAX_FILES_PER_PACKAGE', { fallback: 1000, min: 1, max: 100_000, errors }),
        extractedFiles: parseInteger(env, 'PLATFORM_MAX_EXTRACTED_FILES_PER_PACKAGE', { fallback: 1000, min: 1, max: 100_000, errors }),
        extractedSize: parseInteger(env, 'PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES', { fallback: 104_857_600, min: 1_048_576, max: 4_294_967_296, errors }),
        fileSize: parseInteger(env, 'PLATFORM_MAX_FILE_SIZE_BYTES', { fallback: 20_971_520, min: 1, max: 2_147_483_648, errors })
    };
    if (quotaValues.packageSize > quotaValues.storage) errors.push('PLATFORM_MAX_PACKAGE_SIZE_BYTES cannot exceed PLATFORM_MAX_STORAGE_BYTES_PER_USER.');
    if (quotaValues.fileSize > quotaValues.extractedSize) errors.push('PLATFORM_MAX_FILE_SIZE_BYTES cannot exceed PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES.');

    const corsOrigins = String(env.CORS_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
    for (const origin of corsOrigins) {
        const parsed = parseHttpsUrl(origin, 'CORS_ALLOWED_ORIGINS entry', errors);
        if (parsed && publicBaseUrl && parsed.origin === publicBaseUrl.origin) {
            errors.push('Do not add the same-origin PLATFORM_PUBLIC_BASE_URL to CORS_ALLOWED_ORIGINS.');
        }
    }

    let databasePath = hasValue(env.PLATFORM_DB_PATH) ? env.PLATFORM_DB_PATH.trim() : '';
    let dataDirectory = null;
    let objectStoragePath = null;
    let backupPath = null;
    let firebaseProjectId = null;
    let r2Endpoint = null;
    let uploadUrlTtlSeconds = 900;
    let downloadUrlTtlSeconds = 120;
    let localAuthSessionTtlSeconds = 604_800;
    let localStorageUploadUrlTtlSeconds = 900;

    if (deploymentMode === DEPLOYMENT_MODES.SINGLE_HOST) {
        dataDirectory = hasValue(env.FOUNDRY_DATA_DIR) ? path.resolve(env.FOUNDRY_DATA_DIR.trim()) : '';
        if (!dataDirectory || !path.isAbsolute(env.FOUNDRY_DATA_DIR?.trim() || '') || dataDirectory === path.parse(dataDirectory).root) {
            errors.push('FOUNDRY_DATA_DIR must be an absolute non-root persistent directory in single-host mode.');
        } else {
            validateWritableDirectory(dataDirectory, 'FOUNDRY_DATA_DIR', errors);
            objectStoragePath = storageProvider === 'local-disk' ? path.join(dataDirectory, 'objects') : null;
            backupPath = path.join(dataDirectory, 'backups');
            if (objectStoragePath) validateWritableDirectory(objectStoragePath, 'The single-host objects directory', errors);
            validateWritableDirectory(backupPath, 'The single-host backups directory', errors);
            if (!databasePath) databasePath = path.join(dataDirectory, 'platform.db');
            if (!isPathInside(dataDirectory, databasePath) && env.SINGLE_HOST_ALLOW_EXTERNAL_DB_PATH !== 'true') {
                errors.push('PLATFORM_DB_PATH must stay inside FOUNDRY_DATA_DIR unless SINGLE_HOST_ALLOW_EXTERNAL_DB_PATH=true is set deliberately.');
            }
        }
        validateDatabasePath(databasePath, errors);

        const host = hasValue(env.HOST) ? env.HOST.trim() : '';
        if (!new Set(['127.0.0.1', '::1', 'localhost']).has(host)) {
            errors.push('HOST must be a loopback address in single-host production mode; terminate HTTPS in the same-server reverse proxy.');
        }
        if (corsOrigins.length) {
            errors.push('CORS_ALLOWED_ORIGINS must remain empty in single-host mode because local cookie authentication is same-origin only.');
        }

        const sessionSecret = validateSecret(env, 'LOCAL_AUTH_SESSION_SECRET', errors);
        const storageSecret = storageProvider === 'local-disk'
            ? validateSecret(env, 'LOCAL_STORAGE_SIGNING_SECRET', errors) : null;
        if (sessionSecret && storageSecret && sessionSecret === storageSecret) {
            errors.push('LOCAL_AUTH_SESSION_SECRET and LOCAL_STORAGE_SIGNING_SECRET must be distinct secrets.');
        }
        localAuthSessionTtlSeconds = parseInteger(env, 'LOCAL_AUTH_SESSION_TTL_SECONDS', {
            fallback: 604_800, min: 300, max: 2_592_000, errors
        });
        localStorageUploadUrlTtlSeconds = parseInteger(env, 'LOCAL_STORAGE_UPLOAD_URL_TTL_SECONDS', {
            fallback: 900, min: 60, max: 3600, errors
        });
    } else {
        validateDatabasePath(databasePath, errors);

        firebaseProjectId = hasValue(env.FIREBASE_PROJECT_ID) ? env.FIREBASE_PROJECT_ID.trim() : '';
        if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(firebaseProjectId)) {
            errors.push('FIREBASE_PROJECT_ID is required and must be a valid Firebase project ID.');
        }
        const credentialsPath = hasValue(env.GOOGLE_APPLICATION_CREDENTIALS)
            ? path.resolve(env.GOOGLE_APPLICATION_CREDENTIALS.trim())
            : null;
        const deliberateAdc = env.FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS === 'true';
        if (!credentialsPath && !deliberateAdc) {
            errors.push('Configure GOOGLE_APPLICATION_CREDENTIALS or explicitly set FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS=true for workload identity.');
        }
        if (credentialsPath) {
            const credentialStat = fs.statSync(credentialsPath, { throwIfNoEntry: false });
            if (!path.isAbsolute(env.GOOGLE_APPLICATION_CREDENTIALS.trim()) || !credentialStat?.isFile()) {
                errors.push('GOOGLE_APPLICATION_CREDENTIALS must reference an existing absolute regular file.');
            } else {
                try { fs.accessSync(credentialsPath, fs.constants.R_OK); } catch { errors.push('GOOGLE_APPLICATION_CREDENTIALS must be readable by the Platform process.'); }
            }
        }

    }

    if (storageProvider === 'r2') {
        try { resolveR2ObjectPrefix(env, deploymentMode === DEPLOYMENT_MODES.SINGLE_HOST); }
        catch (error) { errors.push(error.message); }
        if (env.R2_DIRECT_DOWNLOADS === 'true') {
            errors.push('R2_DIRECT_DOWNLOADS must remain false in production because issued signed URLs cannot be revoked immediately by moderation.');
        }
        const requiredR2 = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_ENDPOINT'];
        for (const key of requiredR2) {
            if (!hasValue(env[key])) errors.push(`${key} is required.`);
        }
        if (hasValue(env.R2_ACCOUNT_ID) && !/^[a-f0-9]{32}$/i.test(env.R2_ACCOUNT_ID.trim())) {
            errors.push('R2_ACCOUNT_ID must be a 32-character Cloudflare account ID.');
        }
        if (hasValue(env.R2_BUCKET_NAME) && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET_NAME.trim())) {
            errors.push('R2_BUCKET_NAME must be a valid 3 to 63 character R2 bucket name.');
        }
        r2Endpoint = hasValue(env.R2_ENDPOINT)
            ? parseHttpsUrl(env.R2_ENDPOINT, 'R2_ENDPOINT', errors)
            : null;
        if (r2Endpoint && hasValue(env.R2_ACCOUNT_ID)) {
            const expectedHost = `${env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`;
            if (r2Endpoint.hostname !== expectedHost) {
                errors.push(`R2_ENDPOINT must use the account endpoint ${expectedHost}.`);
            }
        }
        uploadUrlTtlSeconds = parseInteger(env, 'R2_UPLOAD_URL_TTL_SECONDS', {
            fallback: 900, min: 60, max: 3600, errors
        });
        downloadUrlTtlSeconds = parseInteger(env, 'R2_DOWNLOAD_URL_TTL_SECONDS', {
            fallback: 120, min: 30, max: 900, errors
        });
    }

    const clientBuild = loadClientBuildProfile(env, deploymentMode, storageProvider, errors);
    if (
        deploymentMode === DEPLOYMENT_MODES.CLOUD
        && clientBuild.profile
        && clientBuild.profile.firebaseProjectId !== firebaseProjectId
    ) {
        errors.push('The built Firebase client project does not match FIREBASE_PROJECT_ID. Rebuild the client for this environment.');
    }
    if (deploymentMode === DEPLOYMENT_MODES.SINGLE_HOST && clientBuild.profile?.firebaseProjectId) {
        errors.push('A single-host client deployment profile must not contain a Firebase project identity.');
    }

    if (errors.length) {
        const error = new Error(`Invalid production configuration:\n- ${errors.join('\n- ')}`);
        error.code = 'INVALID_PRODUCTION_CONFIGURATION';
        error.details = errors;
        throw error;
    }

    return {
        production: true,
        deploymentMode,
        authProvider: deploymentMode === DEPLOYMENT_MODES.CLOUD ? 'firebase' : 'local',
        storageProvider,
        publicBaseUrl: publicBaseUrl.origin,
        databasePath,
        dataDirectory,
        objectStoragePath,
        backupPath,
        firebaseProjectId,
        clientBuildProfilePath: clientBuild.path,
        r2Endpoint: r2Endpoint?.href || null,
        r2UploadOrigins: r2Endpoint ? r2UploadOrigins(r2Endpoint.href, env.R2_BUCKET_NAME.trim()) : [],
        port,
        trustProxyHops,
        shutdownGraceMs,
        hstsEnabled: env.ENABLE_HSTS === 'true',
        uploadUrlTtlSeconds,
        downloadUrlTtlSeconds,
        localAuthSessionTtlSeconds,
        localStorageUploadUrlTtlSeconds,
        jobMode,
        logLevel,
        corsOrigins
    };
}
