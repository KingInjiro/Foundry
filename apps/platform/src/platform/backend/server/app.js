import { LocalRateLimiter } from '../rateLimit/LocalRateLimiter.js';
import { DatabaseRateLimiter } from '../rateLimit/DatabaseRateLimiter.js';
import { createRateLimitMiddleware } from '../rateLimit/rateLimitMiddleware.js';
import { QuotaConfig } from '../config/quotas.js';
import { GamePackageExtractor } from '../extraction/GamePackageExtractor.js';
import { UploadCleanupService } from '../storage/UploadCleanupService.js';
import crypto from 'crypto';
import mime from 'mime-types';
import { GamePackageValidator } from '../validation/GamePackageValidator.js';
import { R2PackageSource } from '../validation/R2PackageSource.js';
import express from 'express';
import { GameVersionPublishService } from '../extraction/GameVersionPublishService.js';
import { LocalJobQueue } from '../jobs/LocalJobQueue.js';
import { requireAuth, optionalAuth } from '../auth/authMiddleware.js';
import { LocalAuthError, LocalAuthService, normalizeLocalUsername } from '../auth/LocalAuthService.js';
import { GoogleOAuthService } from '../auth/GoogleOAuthService.js';
import { registerGoogleAuthRoutes } from '../auth/googleAuthRoutes.js';
import { LocalSqliteProvider } from '../database/LocalSqliteProvider.js';
import { R2StorageProvider } from '../storage/R2StorageProvider.js';
import { ReleaseLifecycleService } from '../lifecycle/ReleaseLifecycleService.js';
import { createJsonLogger } from '../observability/JsonLogger.js';
import { isFirebaseAdminConfigured } from '../auth/firebaseAdmin.js';
import { applySecurityHeaders } from '../security/securityHeaders.js';
import { DEPLOYMENT_MODES, resolveDeploymentMode } from '../config/deploymentMode.js';

export function parseByteRange(rangeHeader, contentLength) {
    if (!rangeHeader) return null;
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) return { invalid: true };
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
    if (!match || (!match[1] && !match[2])) return { invalid: true };

    let start;
    let end;
    if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || contentLength === 0) return { invalid: true };
        start = Math.max(0, contentLength - suffixLength);
        end = contentLength - 1;
    } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : contentLength - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { invalid: true };
        end = Math.min(end, contentLength - 1);
    }

    if (start < 0 || start >= contentLength || end < start) return { invalid: true };
    return { start, end };
}

export function etagMatches(ifNoneMatch, etag) {
    if (!ifNoneMatch || !etag) return false;
    return String(ifNoneMatch).split(',').some(candidate => {
        const normalized = candidate.trim();
        return normalized === '*' || normalized === etag || normalized.replace(/^W\//, '') === etag.replace(/^W\//, '');
    });
}

export function parseDiscoveryExclusions(value, limit = 50) {
    const values = Array.isArray(value) ? value : value == null ? [] : [value];
    const excluded = new Set();
    for (const rawValue of values) {
        for (const candidate of String(rawValue).split(',')) {
            const gameId = candidate.trim();
            if (!gameId || gameId.length > 128) continue;
            excluded.add(gameId);
            if (excluded.size >= limit) return excluded;
        }
    }
    return excluded;
}

const CATALOG_SORTS = new Set(['featured', 'newest', 'rating', 'popular', 'name']);
const EDITOR_PROJECT_MAX_FILES = 100;
const EDITOR_PROJECT_MAX_BYTES = 5 * 1024 * 1024;
const REPORT_CATEGORIES = new Set(['BROKEN', 'SPAM', 'HARASSMENT', 'HATE', 'SEXUAL', 'VIOLENCE', 'COPYRIGHT', 'OTHER']);
const MODERATION_STATES = new Set(['ACTIVE', 'QUARANTINED', 'HIDDEN']);
const MODERATION_REPORT_STATUSES = new Set(['OPEN', 'RESOLVED', 'DISMISSED']);
const MODERATOR_ROLES = new Set(['ADMIN', 'MODERATOR']);

export function validateEditorProjectFiles(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > EDITOR_PROJECT_MAX_FILES) {
        return { valid: false, message: `Editor project files must contain 1 to ${EDITOR_PROJECT_MAX_FILES} entries.` };
    }

    let totalBytes = 0;
    const normalized = [];
    const ids = new Set();
    const names = new Set();
    for (const candidate of value) {
        const id = typeof candidate?.id === 'string' ? candidate.id.trim() : '';
        const name = typeof candidate?.name === 'string' ? candidate.name.trim().replace(/\\/g, '/') : '';
        const code = typeof candidate?.code === 'string' ? candidate.code : null;
        const unsafeName = !name
            || name.length > 240
            || name.startsWith('/')
            || name.split('/').some(segment => !segment || segment === '.' || segment === '..');
        if (!id || id.length > 128 || ids.has(id) || unsafeName || names.has(name.toLocaleLowerCase()) || code === null) {
            return { valid: false, message: 'Editor project contains an invalid or duplicate file entry.' };
        }
        totalBytes += Buffer.byteLength(id) + Buffer.byteLength(name) + Buffer.byteLength(code);
        if (totalBytes > EDITOR_PROJECT_MAX_BYTES) {
            return { valid: false, message: `Editor project exceeds the ${EDITOR_PROJECT_MAX_BYTES}-byte storage limit.` };
        }
        ids.add(id);
        names.add(name.toLocaleLowerCase());
        normalized.push({ id, name, code });
    }

    return { valid: true, files: normalized, totalBytes };
}

function catalogCursorFingerprint(filters) {
    return crypto.createHash('sha256').update(JSON.stringify(filters)).digest('base64url').slice(0, 16);
}

export function encodeCatalogCursor(offset, filters) {
    return Buffer.from(JSON.stringify({
        version: 1,
        offset,
        fingerprint: catalogCursorFingerprint(filters)
    })).toString('base64url');
}

export function decodeCatalogCursor(cursor, filters) {
    if (!cursor) return 0;
    try {
        const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
        if (
            parsed?.version !== 1
            || parsed.fingerprint !== catalogCursorFingerprint(filters)
            || !Number.isSafeInteger(parsed.offset)
            || parsed.offset < 0
            || parsed.offset > 100000
        ) return null;
        return parsed.offset;
    } catch {
        return null;
    }
}

function isFreshByDate(ifModifiedSince, lastModified) {
    if (!ifModifiedSince || !lastModified) return false;
    const requestedTime = Date.parse(String(ifModifiedSince));
    const modifiedTime = new Date(lastModified).getTime();
    if (!Number.isFinite(requestedTime) || !Number.isFinite(modifiedTime)) return false;
    return Math.floor(modifiedTime / 1000) <= Math.floor(requestedTime / 1000);
}

function parseJsonStringArray(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

function parseJsonControls(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed)
            ? parsed.filter(item => item && typeof item.action === 'string' && typeof item.key === 'string')
            : [];
    } catch {
        return [];
    }
}

function catalogRowToItem(row) {
    const capabilities = parseJsonStringArray(row.capabilities);
    const tags = parseJsonStringArray(row.tags);
    const controls = parseJsonControls(row.controls);
    const thumbnailUrl = row.thumbnail && row.runtimeUrl
        ? `${row.runtimeUrl}/${row.thumbnail.split('/').map(segment => encodeURIComponent(segment)).join('/')}`
        : null;
    return {
        gameId: row.gameId,
        versionId: row.versionId,
        name: row.name,
        description: row.description,
        gameVersion: row.gameVersion,
        runtime: row.runtime,
        capabilities,
        thumbnailUrl,
        tags,
        controls,
        streamingEnabled: Boolean(row.streamingManifestPath),
        publishedAt: Number(row.publishedAt || 0),
        developerUid: row.developerUid,
        developer: row.developerName || row.developerEmail || 'Unknown Developer',
        developerAvatarUrl: row.developerAvatarUrl || '',
        rating: Number(row.rating || 0),
        ratingCount: Number(row.ratingCount || 0),
        playCount: Number(row.playCount || 0),
        avgSessionDurationMs: Number(row.avgSessionDurationMs || 0)
    };
}

export function createApp(injectedDb, injectedStorage, jobQueue, options = {}) {
    const db = injectedDb || new LocalSqliteProvider(process.env.TEST_DB_PATH || process.env.PLATFORM_DB_PATH || '.data/platform.db');
    const storage = injectedStorage || new R2StorageProvider();
    const logger = options.logger || createJsonLogger();
    const runtimeConfig = options.runtimeConfig || {};
    const deploymentMode = runtimeConfig.deploymentMode || resolveDeploymentMode(process.env);
    const localAuthService = options.localAuthService || (deploymentMode === DEPLOYMENT_MODES.SINGLE_HOST
        ? new LocalAuthService(db, {
            sessionSecret: options.localAuthOptions?.sessionSecret || process.env.LOCAL_AUTH_SESSION_SECRET,
            sessionTtlSeconds: options.localAuthOptions?.sessionTtlSeconds || runtimeConfig.localAuthSessionTtlSeconds || process.env.LOCAL_AUTH_SESSION_TTL_SECONDS,
            secureCookies: options.localAuthOptions?.secureCookies ?? runtimeConfig.production === true,
            publicOrigin: runtimeConfig.publicBaseUrl || process.env.PLATFORM_PUBLIC_BASE_URL,
            now: options.localAuthOptions?.now,
            randomBytes: options.localAuthOptions?.randomBytes
        })
        : null);
    
    const jobs = jobQueue || new LocalJobQueue(db, {}, { logger });
    
    // Register handlers
    const extractor = new GamePackageExtractor(storage);
    const publishService = new GameVersionPublishService(db, extractor);
    jobs.registerHandler('EXTRACT_GAME_VERSION', publishService.processExtractionJob.bind(publishService));
    
    const cleanupService = new UploadCleanupService(db, storage, jobs);
    jobs.registerHandler('CLEANUP_UPLOAD_SESSION', cleanupService.processCleanupJob.bind(cleanupService));

    const releaseLifecycle = new ReleaseLifecycleService(db, storage);
    jobs.registerHandler('DELETE_GAME_VERSION', releaseLifecycle.processDeleteVersionJob.bind(releaseLifecycle));
    jobs.registerHandler('DELETE_GAME', releaseLifecycle.processDeleteGameJob.bind(releaseLifecycle));

    const app = express();
    const trustProxyHops = Number.isSafeInteger(runtimeConfig.trustProxyHops)
        ? runtimeConfig.trustProxyHops
        : Math.max(0, Math.min(Number(process.env.TRUST_PROXY_HOPS) || 0, 3));
    if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);
    app.locals.database = db;
    app.locals.storage = storage;
    app.locals.jobQueue = jobs;
    app.locals.uploadCleanupService = cleanupService;
    app.locals.releaseLifecycleService = releaseLifecycle;
    app.locals.logger = logger;
    app.locals.deploymentMode = deploymentMode;
    app.locals.localAuthService = localAuthService;
    const googleAuthService = localAuthService ? new GoogleOAuthService(localAuthService, {
        clientId: options.googleAuthOptions?.clientId ?? process.env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: options.googleAuthOptions?.clientSecret ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        publicOrigin: localAuthService.publicOrigin
    }, { client: options.googleAuthOptions?.client, now: options.googleAuthOptions?.now }) : null;
    app.locals.googleAuthService = googleAuthService;
    app.locals.startedAt = Date.now();
    app.disable('x-powered-by');

    app.use((req, res, next) => {
        const suppliedRequestId = req.get('x-request-id');
        req.requestId = suppliedRequestId && /^[a-zA-Z0-9._:-]{1,128}$/.test(suppliedRequestId)
            ? suppliedRequestId
            : crypto.randomUUID();
        res.setHeader('X-Request-Id', req.requestId);
        const decodePathId = value => {
            try { return value ? decodeURIComponent(value) : undefined; } catch { return value || undefined; }
        };
        const gameMatch = req.path.match(/^\/api\/(?:catalog\/|moderation\/)?games\/([^/]+)/)
            || req.path.match(/^\/api\/cdn\/games\/([^/]+)/);
        const versionMatch = req.path.match(/\/versions\/([^/]+)/);
        const uploadMatch = req.path.match(/^\/api\/uploads\/([^/]+)/);
        const reportMatch = req.path.match(/^\/api\/moderation\/reports\/([^/]+)/);
        res.locals.gameId = decodePathId(gameMatch?.[1]);
        res.locals.versionId = decodePathId(versionMatch?.[1]);
        res.locals.uploadSessionId = decodePathId(uploadMatch?.[1]);
        res.locals.reportId = decodePathId(reportMatch?.[1]);
        const startedAt = Date.now();
        res.once('finish', () => {
            logger.info('http_request', {
                requestId: req.requestId,
                userUid: req.auth?.uid || undefined,
                gameId: res.locals.gameId || undefined,
                versionId: res.locals.versionId || undefined,
                jobId: res.locals.jobId || undefined,
                uploadSessionId: res.locals.uploadSessionId || undefined,
                reportId: res.locals.reportId || undefined,
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                durationMs: Date.now() - startedAt
            });
        });
        next();
    });
    app.use('/api/editor-projects', express.json({ limit: '6mb' }));
    app.use(express.json());

    app.use(applySecurityHeaders({
        hstsEnabled: Boolean(runtimeConfig.hstsEnabled),
        development: runtimeConfig.production !== true && process.env.NODE_ENV !== 'production'
    }));

    app.options('/api/cdn/*', (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range, If-None-Match, If-Modified-Since, If-Range');
        res.setHeader('Access-Control-Max-Age', '86400');
        res.sendStatus(204);
    });

    // Public game delivery. Only extracted, published-runtime paths are exposed;
    // uploaded ZIP packages stay private inside the configured StorageProvider.
    app.get('/api/cdn/*', async (req, res) => {
        const objectKey = req.params[0];
        const parts = typeof objectKey === 'string' ? objectKey.split('/') : [];
        const hasUnsafeSegment = parts.some(part => !part || part === '.' || part === '..');
        const isExtractedGameAsset = parts.length >= 6
            && parts[0] === 'games'
            && parts[2] === 'versions'
            && parts[4] === 'extracted';

        if (!isExtractedGameAsset || hasUnsafeSegment || objectKey.includes('\\') || objectKey.includes('\0')) {
            return res.status(400).json({ success: false, error: { code: 'INVALID_ASSET_PATH', message: 'Invalid game asset path.' } });
        }

        try {
            const gameId = parts[1];
            const versionId = parts[3];
            const expectedRuntimeUrl = `/api/cdn/games/${gameId}/versions/${versionId}/extracted`;
            const [game, version] = await Promise.all([
                db.getGame(gameId),
                db.getGameVersion(versionId)
            ]);
            if (
                !game
                || game.moderationState !== 'ACTIVE'
                || !version
                || version.gameId !== gameId
                || version.status !== 'PUBLISHED'
                || version.runtimeUrl !== expectedRuntimeUrl
            ) {
                return res.status(404).json({ success: false, error: { code: 'ASSET_NOT_FOUND', message: 'Game asset not found.' } });
            }

            const metadata = await storage.getObjectMetadata(objectKey);
            const contentLength = Number(metadata.contentLength);
            const lastModified = metadata.lastModified ? new Date(metadata.lastModified) : null;
            let rangeHeader = req.headers.range;
            if (rangeHeader && req.headers['if-range']) {
                const ifRange = String(req.headers['if-range']);
                const ifRangeMatches = metadata.etag
                    ? etagMatches(ifRange, metadata.etag)
                    : isFreshByDate(ifRange, lastModified);
                if (!ifRangeMatches) rangeHeader = null;
            }
            const byteRange = parseByteRange(rangeHeader, contentLength);
            if (byteRange?.invalid) {
                res.setHeader('Content-Range', `bytes */${contentLength}`);
                return res.status(416).end();
            }

            const contentType = mime.lookup(objectKey) || metadata.contentType || 'application/octet-stream';
            res.setHeader('Content-Type', contentType);
            // R2 objects are immutable, but every public request must revalidate
            // through this authorization/moderation gate. Without a CDN purge
            // integration, a year-long fresh cache would outlive quarantine.
            res.setHeader('Cache-Control', 'public, no-cache');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified');
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            res.setHeader('Accept-Ranges', 'bytes');
            if (['text/html', 'application/xhtml+xml', 'image/svg+xml'].includes(String(contentType).split(';')[0])) {
                let capabilities = [];
                try {
                    const parsed = JSON.parse(version.capabilities || '[]');
                    if (Array.isArray(parsed)) capabilities = parsed;
                } catch {
                    // Invalid legacy metadata receives the strictest document sandbox.
                }
                const sandboxTokens = ['allow-scripts'];
                if (capabilities.includes('pointer-lock')) sandboxTokens.push('allow-pointer-lock');
                if (capabilities.includes('downloads')) sandboxTokens.push('allow-downloads');
                res.setHeader('Content-Security-Policy', `sandbox ${sandboxTokens.join(' ')}`);
            }
            if (lastModified) res.setHeader('Last-Modified', lastModified.toUTCString());
            if (metadata.etag) res.setHeader('ETag', metadata.etag);

            if (metadata.etag && etagMatches(req.headers['if-none-match'], metadata.etag) && !byteRange) {
                return res.status(304).end();
            }
            if (!req.headers['if-none-match'] && isFreshByDate(req.headers['if-modified-since'], lastModified) && !byteRange) {
                return res.status(304).end();
            }

            const baseContentType = String(contentType).split(';')[0];
            const mustProxyDocument = ['text/html', 'application/xhtml+xml', 'image/svg+xml'].includes(baseContentType);
            if (
                req.method === 'GET'
                && !mustProxyDocument
                && storage.directDownloadsEnabled
                && typeof storage.createDownloadUrl === 'function'
            ) {
                const directUrl = await storage.createDownloadUrl(objectKey, byteRange || {});
                // Never cache the short-lived signed redirect itself. The R2
                // object response keeps its immutable cache metadata.
                res.setHeader('Cache-Control', 'private, no-store');
                return res.redirect(307, directUrl);
            }

            if (byteRange) {
                res.status(206);
                res.setHeader('Content-Range', `bytes ${byteRange.start}-${byteRange.end}/${contentLength}`);
                res.setHeader('Content-Length', byteRange.end - byteRange.start + 1);
            } else if (Number.isSafeInteger(contentLength) && contentLength >= 0) {
                res.setHeader('Content-Length', contentLength);
            }

            if (req.method === 'HEAD') return res.end();

            const stream = await storage.getDownloadStream(objectKey, byteRange || {});
            stream.on('error', (error) => {
                if (!res.headersSent) res.status(500).end();
                else res.destroy(error);
            });
            stream.pipe(res);
        } catch (error) {
            if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) {
                return res.status(404).json({ success: false, error: { code: 'ASSET_NOT_FOUND', message: 'Game asset not found.' } });
            }
            console.error('Failed to serve game asset:', error);
            return res.status(500).json({ success: false, error: { code: 'ASSET_DELIVERY_FAILED', message: 'Failed to deliver game asset.' } });
        }
    });


    
    const rateLimiter = options.rateLimiter || (
        typeof db.consumeRateLimit === 'function'
            ? new DatabaseRateLimiter(db)
            : new LocalRateLimiter()
    );
    app.locals.rateLimiter = rateLimiter;
    const authIpIdentity = req => `ip:${req.ip}`;
    const authAccountIdentity = req => `username:${normalizeLocalUsername(req.body?.username) || 'invalid'}`;
    const rlAuthRegisterIp = createRateLimitMiddleware(rateLimiter, 'auth_register_ip', { identity: authIpIdentity });
    const rlAuthLoginIp = createRateLimitMiddleware(rateLimiter, 'auth_login_ip', { identity: authIpIdentity });
    const rlAuthLoginAccount = createRateLimitMiddleware(rateLimiter, 'auth_login_account', { identity: authAccountIdentity });
    const rlCreateVersion = createRateLimitMiddleware(rateLimiter, 'create_version');
    const rlCompleteUpload = createRateLimitMiddleware(rateLimiter, 'complete_upload');
    const rlPublishVersion = createRateLimitMiddleware(rateLimiter, 'publish_version');
    const rlReleaseLifecycle = createRateLimitMiddleware(rateLimiter, 'release_lifecycle');
    const rlReportGame = createRateLimitMiddleware(rateLimiter, 'report_game');
    const publicIdentity = req => req.auth?.uid ? `uid:${req.auth.uid}` : `ip:${req.ip}`;
    const rlCreateGame = createRateLimitMiddleware(rateLimiter, 'create_game');
    const rlEditorWrite = createRateLimitMiddleware(rateLimiter, 'editor_write');
    const rlDiscoveryRead = createRateLimitMiddleware(rateLimiter, 'discovery_read', { identity: publicIdentity });
    const rlCatalogRead = createRateLimitMiddleware(rateLimiter, 'catalog_read', { identity: publicIdentity });
    const rlRatingWrite = createRateLimitMiddleware(rateLimiter, 'rating_write');
    const rlFollowWrite = createRateLimitMiddleware(rateLimiter, 'follow_write');
    const rlModerationAction = createRateLimitMiddleware(rateLimiter, 'moderation_action');

    const ensureProfile = async (req, res, next) => {
        try {
            let user = await db.getUser(req.auth.uid);
            if (!user) {
                const email = typeof req.auth.email === 'string' ? req.auth.email : '';
                user = await db.createUser({
                    uid: req.auth.uid,
                    email,
                    displayName: req.auth.claims?.name || (email ? email.split('@')[0] : 'Developer'),
                    avatarUrl: req.auth.claims?.picture || '',
                    role: 'DEVELOPER', // Default role
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                });
            }
            req.userProfile = user;
            next();
        } catch (e) {
            console.error('Error ensuring profile:', e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load user profile' } });
        }
    };

    const requireModerator = (req, res, next) => {
        if (!MODERATOR_ROLES.has(req.userProfile?.role)) {
            return res.status(403).json({ success: false, error: { code: 'MODERATOR_REQUIRED', message: 'Moderator access is required.' } });
        }
        next();
    };


    // Metadata and account APIs are same-origin by default. Explicit origins
    // can be enabled for trusted integrations without exposing authenticated
    // mutation endpoints to every website.
    const configuredCorsOrigins = new Set(String(process.env.CORS_ALLOWED_ORIGINS || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean));
    app.use((req, res, next) => {
        const origin = req.get('Origin');
        if (!origin) return next();
        const localDevelopmentOrigin = process.env.NODE_ENV !== 'production'
            && /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
        if (!configuredCorsOrigins.has(origin) && !localDevelopmentOrigin) {
            if (req.method === 'OPTIONS') {
                return res.status(403).json({ success: false, error: { code: 'CORS_ORIGIN_DENIED', message: 'Origin is not allowed.' } });
            }
            return next();
        }

        res.vary('Origin');
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Dev-Uid');
        res.header('Access-Control-Max-Age', '600');
        if (req.method === 'OPTIONS') {
            return res.sendStatus(204);
        }
        next();
    });

    

    
    if (localAuthService) {
        const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
        const csrfExemptPaths = new Set(['/api/auth/local/register', '/api/auth/local/login', '/api/auth/google/start', storage.uploadRoute]);
        app.use('/api', (req, res, next) => {
            if (safeMethods.has(req.method)) return next();
            if (!localAuthService.verifyRequestOrigin(req)) {
                return res.status(403).json({
                    success: false,
                    error: { code: 'ORIGIN_DENIED', message: 'This request did not originate from this Foundry server.' }
                });
            }
            const requestPath = String(req.originalUrl || '').split('?')[0];
            if (csrfExemptPaths.has(requestPath)) return next();
            const sessionToken = localAuthService.readSessionToken(req);
            if (!sessionToken) return next();
            const tokenHash = localAuthService.sessionTokenHash(sessionToken);
            if (!localAuthService.verifyCsrf(req, tokenHash)) {
                return res.status(403).json({
                    success: false,
                    error: { code: 'CSRF_TOKEN_INVALID', message: 'The request security token is missing or invalid.' }
                });
            }
            next();
        });

        if (storage.kind === 'local-disk' && storage.uploadRoute) {
            app.put(
                storage.uploadRoute,
                express.raw({ type: '*/*', limit: QuotaConfig.PLATFORM_MAX_PACKAGE_SIZE_BYTES }),
                async (req, res) => {
                    const objectKey = typeof req.query.key === 'string' ? req.query.key : '';
                    const contentType = typeof req.query.contentType === 'string' ? req.query.contentType : 'application/zip';
                    const actualContentType = String(req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
                    try {
                        const validSignature = storage.verifyUploadRequest({
                            objectKey,
                            contentType,
                            expires: req.query.expires,
                            signature: req.query.signature
                        });
                        if (!validSignature || actualContentType !== contentType.toLowerCase()) {
                            return res.status(403).json({
                                success: false,
                                error: { code: 'UPLOAD_SIGNATURE_INVALID', message: 'The local upload URL is invalid or expired.' }
                            });
                        }
                        await storage.uploadBuffer(objectKey, req.body, contentType);
                        res.sendStatus(200);
                    } catch (error) {
                        logger.warn('local_object_upload_rejected', {
                            requestId: req.requestId,
                            errorCode: error?.code || 'LOCAL_UPLOAD_FAILED'
                        });
                        res.status(400).json({
                            success: false,
                            error: { code: 'LOCAL_UPLOAD_FAILED', message: 'The package could not be stored.' }
                        });
                    }
                }
            );
        }

        registerGoogleAuthRoutes(app, googleAuthService, {
            startLimit: createRateLimitMiddleware(rateLimiter, 'auth_google_start_ip', { identity: authIpIdentity }),
            callbackLimit: createRateLimitMiddleware(rateLimiter, 'auth_google_callback_ip', { identity: authIpIdentity }),
            logger
        });

        const sendLocalAuthError = (req, res, error, event) => {
            const known = error instanceof LocalAuthError;
            if (!known) logger.error(event, { requestId: req.requestId, error });
            else logger.warn(event, { requestId: req.requestId, errorCode: error.code });
            return res.status(known ? error.status : 500).json({
                success: false,
                error: {
                    code: known ? error.code : 'LOCAL_AUTH_FAILED',
                    message: known ? error.message : 'The local authentication request failed.'
                }
            });
        };

        app.post('/api/auth/local/register', rlAuthRegisterIp, async (req, res) => {
            try {
                const session = await localAuthService.register({
                    username: req.body?.username,
                    password: req.body?.password,
                    displayName: req.body?.displayName
                });
                res.setHeader('Set-Cookie', localAuthService.sessionCookie(session.token));
                res.status(201).json({
                    success: true,
                    data: { user: session.user, csrfToken: session.csrfToken, expiresAt: session.expiresAt }
                });
            } catch (error) {
                sendLocalAuthError(req, res, error, 'local_registration_failed');
            }
        });

        app.post('/api/auth/local/login', rlAuthLoginIp, rlAuthLoginAccount, async (req, res) => {
            try {
                const session = await localAuthService.login({
                    username: req.body?.username,
                    password: req.body?.password
                });
                res.setHeader('Set-Cookie', localAuthService.sessionCookie(session.token));
                res.json({
                    success: true,
                    data: { user: session.user, csrfToken: session.csrfToken, expiresAt: session.expiresAt }
                });
            } catch (error) {
                sendLocalAuthError(req, res, error, 'local_login_failed');
            }
        });

        app.get('/api/auth/local/session', optionalAuth, (req, res, next) => {
            if (!req.auth) {
                return res.json({
                    success: true,
                    data: { user: null, csrfToken: null, expiresAt: null }
                });
            }
            return ensureProfile(req, res, next);
        }, (req, res) => {
            res.json({
                success: true,
                data: {
                    user: { ...req.userProfile, username: req.localAuthSession.user.username },
                    csrfToken: req.localAuthSession.csrfToken,
                    expiresAt: req.localAuthSession.expiresAt
                }
            });
        });

        app.post('/api/auth/local/logout', async (req, res) => {
            await localAuthService.logoutRequest(req);
            res.setHeader('Set-Cookie', localAuthService.clearSessionCookie());
            res.json({ success: true, data: { signedOut: true } });
        });
    }

    app.get('/api/auth/me', requireAuth, ensureProfile, (req, res) => {
        res.json({ success: true, data: req.userProfile });
    });

    const loadOwnedEditorProject = async (req, res) => {
        const project = await db.getEditorProject(req.params.id);
        if (!project || project.ownerUid !== req.auth.uid) {
            res.status(404).json({ success: false, error: { code: 'EDITOR_PROJECT_NOT_FOUND', message: 'Editor project not found.' } });
            return null;
        }
        const validation = validateEditorProjectFiles(project.files);
        if (!validation.valid) {
            res.status(422).json({ success: false, error: { code: 'EDITOR_PROJECT_CORRUPT', message: 'Stored editor project data is malformed.' } });
            return null;
        }
        return { ...project, files: validation.files };
    };

    app.get('/api/editor-projects', requireAuth, ensureProfile, async (req, res) => {
        const projects = await db.listEditorProjects(req.auth.uid);
        const safeProjects = projects.map(project => ({
            id: project.id,
            title: project.title,
            platformGameId: project.platformGameId,
            lastReadyVersionId: project.lastReadyVersionId,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt
        }));
        res.json({ success: true, data: safeProjects });
    });

    app.post('/api/editor-projects', requireAuth, ensureProfile, rlEditorWrite, async (req, res) => {
        const validation = validateEditorProjectFiles(req.body?.files);
        const title = typeof req.body?.title === 'string' ? req.body.title.trim() : 'Untitled Editor Project';
        if (!validation.valid) {
            return res.status(400).json({ success: false, error: { code: 'INVALID_EDITOR_PROJECT', message: validation.message } });
        }
        if (!title || title.length > 120) {
            return res.status(400).json({ success: false, error: { code: 'INVALID_EDITOR_PROJECT_TITLE', message: 'Project title must contain 1 to 120 characters.' } });
        }
        const now = Date.now();
        const project = await db.createEditorProject({
            id: crypto.randomUUID(),
            ownerUid: req.auth.uid,
            title,
            files: validation.files,
            createdAt: now,
            updatedAt: now
        });
        res.status(201).json({ success: true, data: project });
    });

    app.get('/api/editor-projects/:id', requireAuth, ensureProfile, async (req, res) => {
        const project = await loadOwnedEditorProject(req, res);
        if (project) res.json({ success: true, data: project });
    });

    app.put('/api/editor-projects/:id', requireAuth, ensureProfile, rlEditorWrite, async (req, res) => {
        const existing = await loadOwnedEditorProject(req, res);
        if (!existing) return;
        const validation = validateEditorProjectFiles(req.body?.files);
        const title = typeof req.body?.title === 'string' ? req.body.title.trim() : existing.title;
        if (!validation.valid) {
            return res.status(400).json({ success: false, error: { code: 'INVALID_EDITOR_PROJECT', message: validation.message } });
        }
        if (!title || title.length > 120) {
            return res.status(400).json({ success: false, error: { code: 'INVALID_EDITOR_PROJECT_TITLE', message: 'Project title must contain 1 to 120 characters.' } });
        }
        const project = await db.updateEditorProject(existing.id, req.auth.uid, { title, files: validation.files });
        res.json({ success: true, data: project });
    });

    app.put('/api/editor-projects/:id/platform-link', requireAuth, ensureProfile, rlEditorWrite, async (req, res) => {
        const project = await loadOwnedEditorProject(req, res);
        if (!project) return;
        const platformGameId = typeof req.body?.platformGameId === 'string' ? req.body.platformGameId.trim() : '';
        const lastReadyVersionId = typeof req.body?.lastReadyVersionId === 'string' ? req.body.lastReadyVersionId.trim() : null;
        if (!platformGameId) {
            const unlinked = await db.linkEditorProject(project.id, req.auth.uid, null, null);
            return res.json({ success: true, data: unlinked });
        }
        const game = await db.getGame(platformGameId);
        if (!game || game.ownerUid !== req.auth.uid) {
            return res.status(403).json({ success: false, error: { code: 'EDITOR_LINK_FORBIDDEN', message: 'The selected Platform project is not owned by this account.' } });
        }
        if (lastReadyVersionId) {
            const version = await db.getGameVersion(lastReadyVersionId);
            if (!version || version.gameId !== game.id || !['READY', 'PUBLISHING', 'PUBLISHED', 'PUBLISH_FAILED'].includes(version.status)) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_EDITOR_LINK_VERSION', message: 'The linked version is not a usable release candidate for this project.' } });
            }
        }
        const linked = await db.linkEditorProject(project.id, req.auth.uid, game.id, lastReadyVersionId);
        res.json({ success: true, data: linked });
    });
    
    app.get('/api/health', (req, res) => {
        res.json({
            success: true,
            data: {
                status: 'ok',
                deploymentMode,
                authProvider: localAuthService ? 'local' : 'firebase',
                uptimeSeconds: Math.floor((Date.now() - app.locals.startedAt) / 1000),
                storageConfigured: Boolean(storage.isConfigured),
                storageProvider: storage.kind || 'custom',
                r2Configured: storage.kind === 'r2' && Boolean(storage.isConfigured),
                directAssetDelivery: Boolean(storage.directDownloadsEnabled)
            }
        });
    });

    const checkReadiness = async (requestId = null) => {
        const checks = { database: false, storage: false, jobs: false, auth: false };
        let queue = null;
        let queueStopping = false;
        try {
            checks.database = typeof db.ping === 'function' ? await db.ping() : Boolean(db);
            checks.storage = typeof storage.ping === 'function'
                ? await storage.ping()
                : Boolean(storage.isConfigured);
            if (typeof jobs.getStatus === 'function') {
                const status = await jobs.getStatus();
                queueStopping = status.stopping === true;
                queue = {
                    mode: status.mode || 'custom',
                    queued: Number(status.queued || 0),
                    running: Number(status.running || 0),
                    retrying: Number(status.retrying || 0),
                    failed: Number(status.failed || 0)
                };
            } else {
                queue = typeof jobs.enqueue === 'function' ? { mode: 'custom' } : null;
            }
            checks.jobs = Boolean(queue) && !queueStopping;
            checks.auth = localAuthService
                ? await localAuthService.isReady()
                : (process.env.NODE_ENV !== 'production' || isFirebaseAdminConfigured());
        } catch (error) {
            logger.error('readiness_check_failed', { requestId: requestId || undefined, error });
        }
        const ready = Object.values(checks).every(Boolean);
        return { ready, checks, queue };
    };
    app.locals.checkReadiness = checkReadiness;

    app.get('/api/ready', async (req, res) => {
        const { ready, checks, queue } = await checkReadiness(req.requestId);
        res.status(ready ? 200 : 503).json({
            success: ready,
            data: { status: ready ? 'ready' : 'not_ready', checks, queue }
        });
    });

    app.post('/api/games', requireAuth, ensureProfile, rlCreateGame, async (req, res) => {
        try {
            const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
            const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
            if (!title) return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Title is required' } });
            if (title.length > 120) return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Title must be 120 characters or fewer.' } });
            if (description.length > 2000) return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Description must be 2,000 characters or fewer.' } });
            
            const id = crypto.randomUUID();
            const game = await db.createGame({
                id,
                ownerUid: req.auth.uid,
                title,
                description,
                storageMode: 'platform',
                currentState: 'DRAFT',
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
            res.json({ success: true, data: game });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.get('/api/games', requireAuth, ensureProfile, async (req, res) => {
        try {
            const games = await db.listGames(req.auth.uid);
            res.json({ success: true, data: games });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.get('/api/games/:id', requireAuth, ensureProfile, async (req, res) => {
        try {
            const game = await db.getGame(req.params.id);
            if (!game) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found' } });
            if (game.ownerUid !== req.auth.uid) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } });
            res.json({ success: true, data: game });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.patch('/api/games/:id', requireAuth, ensureProfile, async (req, res) => {
        try {
            const game = await db.getGame(req.params.id);
            if (!game) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found' } });
            if (game.ownerUid !== req.auth.uid) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } });

            const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
            const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
            if (!title) return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Title is required' } });
            if (title.length > 120) return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Title must be 120 characters or fewer.' } });
            if (description.length > 2000) return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Description must be 2,000 characters or fewer.' } });

            const updated = await db.updateGameMetadata(game.id, { title, description });
            res.json({ success: true, data: updated });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.post('/api/games/:id/versions', requireAuth, ensureProfile, rlCreateVersion, async (req, res) => {
        try {
            const gameId = req.params.id;
            const game = await db.getGame(gameId);
            if (!game) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found' } });
            if (game.ownerUid !== req.auth.uid) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } });

            const expectedSize = req.body?.expectedSize === undefined ? 0 : Number(req.body.expectedSize);
            if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_UPLOAD_SIZE', message: 'Expected upload size must be a non-negative integer.' } });
            }
            if (expectedSize > QuotaConfig.PLATFORM_MAX_PACKAGE_SIZE_BYTES) {
                return res.status(413).json({ success: false, error: { code: 'PACKAGE_SIZE_EXCEEDED', message: 'Package exceeds the upload size limit.' } });
            }

            // Since we upload directly to R2, this endpoint might just create an upload session.
            const versionId = crypto.randomUUID();
            const sessionId = crypto.randomUUID();
            const objectKey = `games/${gameId}/versions/${versionId}/package.zip`;

            if (!storage.isConfigured) {
                return res.status(501).json({ success: false, error: { code: 'STORAGE_NOT_CONFIGURED', message: 'Platform storage is not configured.' } });
            }

            
            if (game.storageMode === 'platform') {
                const usage = await db.getUserQuotaUsage(req.auth.uid);
                if (usage.activeUploads >= QuotaConfig.PLATFORM_MAX_ACTIVE_UPLOADS_PER_USER) {
                    return res.status(403).json({ success: false, error: { code: 'ACTIVE_UPLOAD_LIMIT_EXCEEDED', message: 'Active upload limit exceeded.' } });
                }
                if (usage.versionCount >= QuotaConfig.PLATFORM_MAX_GAME_VERSIONS_PER_USER) {
                    return res.status(403).json({ success: false, error: { code: 'MAX_VERSIONS_EXCEEDED', message: 'Maximum game versions limit exceeded.' } });
                }
                if (expectedSize > 0 && usage.totalStorageBytes + expectedSize > QuotaConfig.PLATFORM_MAX_STORAGE_BYTES_PER_USER) {
                    return res.status(403).json({ success: false, error: { code: 'STORAGE_QUOTA_EXCEEDED', message: 'This upload would exceed your Platform storage quota.' } });
                }
            }

            const { uploadUrl } = await storage.createUploadSession(objectKey);

            const now = Date.now();
            await db.createUploadSession({
                id: sessionId,
                ownerUid: req.auth.uid,
                gameId: gameId,
                versionId: versionId,
                storageProvider: storage.kind || 'platform',
                objectKey: objectKey,
                expectedSize,
                expectedContentType: 'application/zip',
                status: 'CREATED',
                expiresAt: now + QuotaConfig.UPLOAD_SESSION_EXPIRATION_MS,
                createdAt: now,
                updatedAt: now
            });

            // Pre-create the version record in DRAFT/UPLOADING state
            await db.createGameVersion({
                id: versionId,
                gameId,
                version: '1.0.0', // Should be provided by client ideally or parsed later
                runtime: 'web',
                format: 'web-game',
                entry: 'index.html',
                status: 'UPLOADING',
                createdAt: Date.now()
            });

            res.json({ success: true, data: { uploadUrl, sessionId, versionId, objectKey } });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.get('/api/games/:id/versions', requireAuth, ensureProfile, async (req, res) => {
        try {
            const game = await db.getGame(req.params.id);
            if (!game) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found' } });
            if (game.ownerUid !== req.auth.uid) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } });
            const versions = await db.getGameVersions(req.params.id);
            res.json({ success: true, data: versions });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.get('/api/uploads/recovery', requireAuth, ensureProfile, async (req, res) => {
        try {
            const rows = await db.listUploadRecovery(req.auth.uid);
            const now = Date.now();
            const recovery = rows.map(row => ({
                ...row,
                expired: row.sessionId ? Number(row.expiresAt || 0) <= now : false,
                requiresFileReselection: row.sessionStatus === 'CREATED',
                resumable: row.sessionStatus === 'CREATED' && Number(row.expiresAt || 0) > now
            }));
            res.json({ success: true, data: recovery });
        } catch (error) {
            logger.error('upload_recovery_list_failed', { requestId: req.requestId, error });
            res.status(500).json({ success: false, error: { code: 'UPLOAD_RECOVERY_FAILED', message: 'Could not inspect pending upload work.' } });
        }
    });

    app.post('/api/uploads/:sessionId/resume', requireAuth, ensureProfile, async (req, res) => {
        try {
            const session = await db.getUploadSession(req.params.sessionId);
            if (!session || session.ownerUid !== req.auth.uid) {
                return res.status(404).json({ success: false, error: { code: 'UPLOAD_SESSION_NOT_FOUND', message: 'Upload session not found.' } });
            }
            if (session.status !== 'CREATED') {
                return res.status(409).json({ success: false, error: { code: 'UPLOAD_NOT_RESUMABLE', message: 'This upload session is no longer waiting for a file.' } });
            }
            if (Date.now() >= Number(session.expiresAt || 0)) {
                await db.transaction(async tx => {
                    await tx.updateUploadSessionStatus(session.id, 'EXPIRED');
                    const version = await tx.getGameVersion(session.versionId);
                    if (version?.status === 'UPLOADING') await tx.updateGameVersionStatus(version.id, 'EXPIRED');
                });
                return res.status(410).json({ success: false, error: { code: 'UPLOAD_SESSION_EXPIRED', message: 'This upload session expired. Start a new version upload.' } });
            }
            const { uploadUrl } = await storage.createUploadSession(session.objectKey);
            await db.updateUploadSession(session.id, { updatedAt: Date.now() });
            res.json({
                success: true,
                data: {
                    uploadUrl,
                    sessionId: session.id,
                    versionId: session.versionId,
                    gameId: session.gameId,
                    expectedSize: session.expectedSize,
                    expiresAt: session.expiresAt
                }
            });
        } catch (error) {
            logger.error('upload_resume_failed', { requestId: req.requestId, sessionId: req.params.sessionId, error });
            res.status(500).json({ success: false, error: { code: 'UPLOAD_RESUME_FAILED', message: 'Could not resume this upload session.' } });
        }
    });

    
    app.post('/api/uploads/:sessionId/complete', requireAuth, ensureProfile, rlCompleteUpload, async (req, res) => {
        try {
            const session = await db.getUploadSession(req.params.sessionId);
            if (!session) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
            
            // Basic authorization check
            if (session.ownerUid !== req.auth.uid) {
                return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to complete this session' } });
            }

            if (session.status === 'COMPLETED') {
                const version = await db.getGameVersion(session.versionId);
                const completedStates = new Set(['READY', 'PUBLISHING', 'PUBLISHED', 'PUBLISH_FAILED']);
                if (!version || !completedStates.has(version.status)) {
                    return res.status(409).json({
                        success: false,
                        error: { code: 'UPLOAD_FINALIZATION_INCOMPLETE', message: 'Upload finalization is incomplete. Refresh the project before retrying.' }
                    });
                }
                return res.json({
                    success: true,
                    data: {
                        status: version.status,
                        versionId: session.versionId,
                        resumed: true,
                        streamingManifestPath: version?.streamingManifestPath || null
                    }
                });
            }

            if (session.status !== 'CREATED') {
                return res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: 'Session is not in CREATED state' } });
            }
            if (Date.now() > session.expiresAt) {
                await db.updateUploadSessionStatus(session.id, 'EXPIRED');
                return res.status(400).json({ success: false, error: { code: 'UPLOAD_SESSION_EXPIRED', message: 'Upload session has expired' } });
            }

            // Check package size
            try {
                const metadata = await storage.getObjectMetadata(session.objectKey);
                const contentLength = Number(metadata.contentLength);
                if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
                    return res.status(400).json({ success: false, error: { code: 'INVALID_UPLOAD_METADATA', message: 'Uploaded object size is unavailable.' } });
                }
                if (contentLength > QuotaConfig.PLATFORM_MAX_PACKAGE_SIZE_BYTES) {
                    await db.updateUploadSessionStatus(session.id, 'REJECTED');
                    await db.updateGameVersionStatus(session.versionId, 'REJECTED');
                    return res.status(403).json({ success: false, error: { code: 'PACKAGE_SIZE_EXCEEDED', message: 'Package size exceeded' } });
                }
                if (session.expectedSize > 0 && contentLength !== session.expectedSize) {
                    await db.updateUploadSessionStatus(session.id, 'REJECTED');
                    await db.updateGameVersionStatus(session.versionId, 'REJECTED');
                    return res.status(400).json({ success: false, error: { code: 'UPLOAD_SIZE_MISMATCH', message: 'Uploaded package size does not match the selected file. Please upload again.' } });
                }
                // Store the package size
                await db.updateUploadSession(session.id, { packageSizeBytes: contentLength });
                await db.updateGameVersionMetadata(session.versionId, { packageSizeBytes: contentLength });
            } catch (e) {
                console.error("DEBUG:", e);
                // Object not found, maybe they didn't upload anything
                return res.status(400).json({ success: false, error: { code: 'NOT_FOUND', message: 'Uploaded object not found' } });
            }

            await db.updateUploadSessionStatus(session.id, 'VALIDATING');
            await db.updateGameVersionStatus(session.versionId, 'VALIDATING');

            let validationResult = { valid: false, errors: [{ code: 'UNKNOWN_ERROR', message: 'Validation failed unexpectedly' }] };
            let packageSha256 = null;
            const source = new R2PackageSource(storage, session.objectKey);
            
            try {
                const validator = new GamePackageValidator();
                validationResult = await validator.validate(source);
                if (validationResult.valid) packageSha256 = await source.getPackageSha256();
            } catch (err) {
                validationResult = { valid: false, errors: [{ code: 'VALIDATION_EXCEPTION', message: err.message }] };
            } finally {
                await source.cleanup();
            }

            if (validationResult.valid && validationResult.manifest) {
                await db.transaction(async tx => {
                    await tx.updateGameVersionMetadata(session.versionId, {
                        status: 'READY',
                        version: validationResult.manifest.gameVersion || '1.0.0',
                        runtime: validationResult.manifest.runtime || 'web',
                        format: validationResult.manifest.format || 'web-game',
                        entry: validationResult.manifest.entry || 'index.html',
                        capabilities: JSON.stringify(validationResult.manifest.capabilities || []),
                        thumbnail: validationResult.manifest.thumbnail || null,
                        tags: JSON.stringify(validationResult.manifest.tags || []),
                        controls: JSON.stringify(validationResult.manifest.controls || []),
                        packageSha256,
                        streamingManifestPath: validationResult.streamingManifestPath || null
                    });
                    await tx.updateUploadSession(session.id, { status: 'COMPLETED', completedAt: Date.now() });
                });
                
                res.json({
                    success: true,
                    data: {
                        status: 'READY',
                        manifest: validationResult.manifest,
                        streamingManifestPath: validationResult.streamingManifestPath || null
                    }
                });
            } else {
                await db.updateUploadSessionStatus(session.id, 'REJECTED');
                await db.updateGameVersionStatus(session.versionId, 'REJECTED');
                res.json({ success: false, error: { code: 'VALIDATION_FAILED', message: 'Package validation failed', details: validationResult.errors } });
            }

        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.post('/api/games/:id/versions/:versionId/publish', requireAuth, ensureProfile, rlPublishVersion, async (req, res) => {
        try {
            const game = await db.getGame(req.params.id);
            if (!game) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found' } });
            
            if (game.ownerUid !== req.auth.uid) {
                return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to publish this game' } });
            }
            
            const versions = await db.getGameVersions(game.id);
            const targetVersion = versions.find(v => v.id === req.params.versionId);
            
            if (!targetVersion) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Version not found' } });
            
            if (targetVersion.status !== 'READY' && targetVersion.status !== 'PUBLISH_FAILED') {
                return res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: 'Only READY or PUBLISH_FAILED versions can be published' } });
            }

            if (targetVersion.publishAttempts >= QuotaConfig.MAX_PUBLISH_ATTEMPTS) {
                return res.status(403).json({ success: false, error: { code: 'PUBLISH_RETRY_LIMIT_EXCEEDED', message: 'Maximum publish attempts reached' } });
            }

            // Enqueue extraction job
            const jobId = await jobs.enqueue('EXTRACT_GAME_VERSION', targetVersion.id, {
                gameId: game.id,
                versionId: targetVersion.id,
                ownerUid: req.auth.uid
            });

            const updatedVersion = await db.getGameVersion(targetVersion.id);
            if (updatedVersion?.status === 'PUBLISH_FAILED') {
                const quotaFailure = /storage quota/i.test(updatedVersion.publishError || '');
                return res.status(quotaFailure ? 403 : 500).json({
                    success: false,
                    error: {
                        code: quotaFailure ? 'STORAGE_QUOTA_EXCEEDED' : 'PUBLISH_FAILED',
                        message: updatedVersion.publishError || 'Publishing failed. Review the package and retry this version.'
                    }
                });
            }

            // Inline mode may already be finished. Async queues still report a
            // transient state even before their worker atomically claims the row.
            const responseStatus = updatedVersion?.status === 'PUBLISHED'
                ? 'PUBLISHED'
                : 'PUBLISHING';
            res.json({ success: true, data: { status: responseStatus, jobId } });
        } catch (e) {
            console.error(e);
            if (e?.code === 'STORAGE_QUOTA_EXCEEDED') {
                return res.status(403).json({ success: false, error: { code: e.code, message: e.message } });
            }
            if (e?.code === 'PACKAGE_CHANGED_AFTER_VALIDATION') {
                return res.status(409).json({ success: false, error: { code: e.code, message: e.message } });
            }
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.post('/api/games/:id/versions/:versionId/activate', requireAuth, ensureProfile, rlReleaseLifecycle, async (req, res) => {
        try {
            const game = await db.getGame(req.params.id);
            if (!game) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found' } });
            if (game.ownerUid !== req.auth.uid) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to manage this release' } });

            const versions = await db.getGameVersions(game.id);
            if (versions.some(version => version.status === 'PUBLISHING')) {
                return res.status(409).json({ success: false, error: { code: 'RELEASE_BUSY', message: 'Wait for the current publish operation to finish.' } });
            }
            const target = versions.find(version => version.id === req.params.versionId);
            if (!target) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Version not found' } });
            if (target.status !== 'ARCHIVED') {
                return res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: 'Only an archived release can be restored.' } });
            }
            if (!target.runtimeUrl || !target.entry) {
                return res.status(409).json({ success: false, error: { code: 'RUNTIME_UNAVAILABLE', message: 'This release no longer has a restorable runtime.' } });
            }

            const entryObjectKey = `games/${game.id}/versions/${target.id}/extracted/${target.entry}`;
            try {
                await storage.getObjectMetadata(entryObjectKey);
            } catch (error) {
                if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) {
                    return res.status(409).json({ success: false, error: { code: 'RUNTIME_UNAVAILABLE', message: 'This archived runtime has been removed and cannot be restored.' } });
                }
                throw error;
            }

            const activated = await db.transaction(tx => tx.activateGameVersion(game.id, target.id, Date.now()));
            res.json({ success: true, data: { status: activated.status, versionId: activated.id } });
        } catch (error) {
            logger.error('release_restore_failed', { requestId: req.requestId, gameId: req.params.id, versionId: req.params.versionId, error });
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Could not restore this release.' } });
        }
    });

    app.post('/api/games/:id/unpublish', requireAuth, ensureProfile, rlReleaseLifecycle, async (req, res) => {
        try {
            const game = await db.getGame(req.params.id);
            if (!game) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found' } });
            if (game.ownerUid !== req.auth.uid) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to manage this release' } });
            const versions = await db.getGameVersions(game.id);
            if (versions.some(version => version.status === 'PUBLISHING')) {
                return res.status(409).json({ success: false, error: { code: 'RELEASE_BUSY', message: 'Wait for the current publish operation to finish.' } });
            }
            if (!versions.some(version => version.status === 'PUBLISHED')) {
                return res.json({ success: true, data: { status: 'DRAFT', changed: false } });
            }

            const changed = await db.transaction(tx => tx.unpublishGame(game.id));
            res.json({ success: true, data: { status: 'DRAFT', changed: changed > 0 } });
        } catch (error) {
            logger.error('release_unpublish_failed', { requestId: req.requestId, gameId: req.params.id, error });
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Could not unpublish this game.' } });
        }
    });

    app.delete('/api/games/:id/versions/:versionId', requireAuth, ensureProfile, rlReleaseLifecycle, async (req, res) => {
        let previousStatus = null;
        try {
            const game = await db.getGame(req.params.id);
            if (!game) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found' } });
            if (game.ownerUid !== req.auth.uid) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to delete this version' } });
            const version = await db.getGameVersion(req.params.versionId);
            if (!version || version.gameId !== game.id) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Version not found' } });
            if (['PUBLISHED', 'PUBLISHING', 'VALIDATING', 'UPLOADING'].includes(version.status)) {
                return res.status(409).json({ success: false, error: { code: 'VERSION_BUSY', message: version.status === 'PUBLISHED' ? 'Unpublish or activate another release before deleting this version.' : 'Wait for the version operation to finish.' } });
            }

            previousStatus = version.status;
            if (version.status !== 'DELETING') await db.updateGameVersionStatus(version.id, 'DELETING');
            let jobId;
            try {
                jobId = await jobs.enqueue('DELETE_GAME_VERSION', version.id, { gameId: game.id, versionId: version.id });
            } catch (error) {
                if (previousStatus !== 'DELETING') await db.updateGameVersionStatus(version.id, previousStatus);
                throw error;
            }
            const exists = await db.getGameVersion(version.id);
            res.status(exists ? 202 : 200).json({ success: true, data: { status: exists ? 'DELETING' : 'DELETED', versionId: version.id, jobId } });
        } catch (error) {
            logger.error('version_delete_failed', { requestId: req.requestId, gameId: req.params.id, versionId: req.params.versionId, error });
            res.status(500).json({ success: false, error: { code: 'DELETE_FAILED', message: 'Could not schedule version cleanup.' } });
        }
    });

    app.delete('/api/games/:id', requireAuth, ensureProfile, rlReleaseLifecycle, async (req, res) => {
        let snapshot = null;
        try {
            const game = await db.getGame(req.params.id);
            if (!game) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found' } });
            if (game.ownerUid !== req.auth.uid) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to delete this project' } });
            if (req.body?.confirmTitle !== game.title) {
                return res.status(400).json({ success: false, error: { code: 'CONFIRMATION_REQUIRED', message: 'Project title confirmation does not match.' } });
            }
            const versions = await db.getGameVersions(game.id);
            if (versions.some(version => ['PUBLISHING', 'VALIDATING', 'UPLOADING'].includes(version.status))) {
                return res.status(409).json({ success: false, error: { code: 'PROJECT_BUSY', message: 'Wait for active upload, validation or publishing work to finish.' } });
            }

            snapshot = { gameState: game.currentState, versions: versions.map(version => ({ id: version.id, status: version.status })) };
            if (game.currentState !== 'DELETING') {
                await db.transaction(async tx => {
                    await tx.updateGameState(game.id, 'DELETING');
                    for (const version of versions) await tx.updateGameVersionStatus(version.id, 'DELETING');
                });
            }
            let jobId;
            try {
                jobId = await jobs.enqueue('DELETE_GAME', game.id, { gameId: game.id });
            } catch (error) {
                if (snapshot.gameState !== 'DELETING') {
                    await db.transaction(async tx => {
                        await tx.updateGameState(game.id, snapshot.gameState);
                        for (const version of snapshot.versions) await tx.updateGameVersionStatus(version.id, version.status);
                    });
                }
                throw error;
            }
            const exists = await db.getGame(game.id);
            res.status(exists ? 202 : 200).json({ success: true, data: { status: exists ? 'DELETING' : 'DELETED', gameId: game.id, jobId } });
        } catch (error) {
            logger.error('project_delete_failed', { requestId: req.requestId, gameId: req.params.id, error });
            res.status(500).json({ success: false, error: { code: 'DELETE_FAILED', message: 'Could not schedule project cleanup.' } });
        }
    });

    app.get('/api/games/:id/analytics', requireAuth, ensureProfile, async (req, res) => {
        try {
            const game = await db.getGame(req.params.id);
            if (!game) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found' } });
            if (game.ownerUid !== req.auth.uid) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } });
            const [rating, engagement] = await Promise.all([
                db.getGameRatingSummary(game.id),
                db.getGameDiscoveryStats(game.id)
            ]);
            res.json({
                success: true,
                data: {
                    gameId: game.id,
                    impressions: engagement.impressions,
                    playStarts: engagement.playStarts,
                    successfulStarts: engagement.readyCount,
                    failedStarts: engagement.errorCount,
                    nextGameCount: engagement.nextCount,
                    libraryAdds: engagement.libraryAdds,
                    avgSessionDurationMs: engagement.avgSessionDurationMs,
                    ratingAverage: rating.average,
                    ratingCount: rating.count,
                    playRate: engagement.impressions > 0 ? Number((engagement.playStarts / engagement.impressions).toFixed(3)) : 0,
                    readyRate: engagement.playStarts > 0 ? Number((engagement.readyCount / engagement.playStarts).toFixed(3)) : 0
                }
            });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.post('/api/games/:id/reports', requireAuth, ensureProfile, rlReportGame, async (req, res) => {
        try {
            const category = typeof req.body?.category === 'string' ? req.body.category.trim().toUpperCase() : '';
            const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
            if (!REPORT_CATEGORIES.has(category) || reason.length < 10 || reason.length > 1000) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_REPORT', message: 'Choose a valid category and provide 10 to 1,000 characters of context.' } });
            }
            const game = await db.getGame(req.params.id);
            if (!game || game.moderationState !== 'ACTIVE' || !await db.getPublishedGameVersion(game.id)) {
                return res.status(404).json({ success: false, error: { code: 'GAME_NOT_REPORTABLE', message: 'This game is not publicly available.' } });
            }
            const report = await db.createGameReport({
                id: crypto.randomUUID(),
                gameId: game.id,
                reporterUid: req.auth.uid,
                category,
                reason,
                status: 'OPEN',
                createdAt: Date.now()
            });
            res.status(201).json({ success: true, data: { id: report.id, status: report.status } });
        } catch (error) {
            logger.error('game_report_failed', { requestId: req.requestId, gameId: req.params.id, error });
            res.status(500).json({ success: false, error: { code: 'REPORT_FAILED', message: 'Could not submit this report.' } });
        }
    });

    app.get('/api/moderation/reports', requireAuth, ensureProfile, requireModerator, async (req, res) => {
        try {
            const requestedStatus = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : 'OPEN';
            if (requestedStatus !== 'ALL' && !MODERATION_REPORT_STATUSES.has(requestedStatus)) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_REPORT_STATUS', message: 'Unsupported report status.' } });
            }
            const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 100));
            const [items, pendingCount] = await Promise.all([
                db.listModerationReports(requestedStatus === 'ALL' ? '' : requestedStatus, limit),
                db.countOpenGameReports()
            ]);
            res.json({ success: true, data: { items, pendingCount } });
        } catch (error) {
            logger.error('moderation_report_queue_failed', { requestId: req.requestId, operatorUid: req.auth.uid, error });
            res.status(500).json({ success: false, error: { code: 'MODERATION_QUEUE_FAILED', message: 'Could not load the moderation queue.' } });
        }
    });

    app.get('/api/moderation/games/:id/reports', requireAuth, ensureProfile, requireModerator, async (req, res) => {
        const game = await db.getGame(req.params.id);
        if (!game) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found.' } });
        const requestedStatus = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : '';
        if (requestedStatus && !MODERATION_REPORT_STATUSES.has(requestedStatus)) {
            return res.status(400).json({ success: false, error: { code: 'INVALID_REPORT_STATUS', message: 'Unsupported report status.' } });
        }
        res.json({ success: true, data: await db.listGameReports(game.id, requestedStatus || null) });
    });

    app.get('/api/moderation/games/:id/actions', requireAuth, ensureProfile, requireModerator, async (req, res) => {
        const game = await db.getGame(req.params.id);
        if (!game) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found.' } });
        res.json({ success: true, data: await db.listModerationActions(game.id) });
    });

    app.patch('/api/moderation/games/:id', requireAuth, ensureProfile, requireModerator, rlModerationAction, async (req, res) => {
        try {
            const moderationState = typeof req.body?.moderationState === 'string' ? req.body.moderationState.trim().toUpperCase() : '';
            const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
            if (!MODERATION_STATES.has(moderationState)) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_MODERATION_STATE', message: 'Unsupported moderation state.' } });
            }
            if (reason.length < 10 || reason.length > 1000) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_MODERATION_REASON', message: 'Provide 10 to 1,000 characters explaining this action.' } });
            }
            const existing = await db.getGame(req.params.id);
            if (!existing) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found.' } });
            const action = await db.transaction(async tx => {
                const game = await tx.updateGameModerationState(existing.id, moderationState);
                const audit = await tx.createModerationAction({
                    id: crypto.randomUUID(),
                    gameId: game.id,
                    operatorUid: req.auth.uid,
                    action: 'SET_GAME_STATE',
                    previousState: existing.moderationState || 'ACTIVE',
                    nextState: moderationState,
                    reason,
                    createdAt: Date.now()
                });
                return { game, audit };
            });
            res.locals.gameId = action.game.id;
            logger.info('game_moderation_state_changed', {
                requestId: req.requestId,
                gameId: action.game.id,
                previousState: existing.moderationState || 'ACTIVE',
                moderationState,
                operatorUid: req.auth.uid,
                actionId: action.audit.id
            });
            res.json({ success: true, data: { gameId: action.game.id, moderationState: action.game.moderationState, actionId: action.audit.id } });
        } catch (error) {
            logger.error('game_moderation_state_change_failed', { requestId: req.requestId, gameId: req.params.id, operatorUid: req.auth.uid, error });
            res.status(500).json({ success: false, error: { code: 'MODERATION_ACTION_FAILED', message: 'Could not apply the moderation action.' } });
        }
    });

    app.patch('/api/moderation/reports/:reportId', requireAuth, ensureProfile, requireModerator, rlModerationAction, async (req, res) => {
        try {
            const status = typeof req.body?.status === 'string' ? req.body.status.trim().toUpperCase() : '';
            const resolution = typeof req.body?.resolution === 'string' ? req.body.resolution.trim() : '';
            const requestedState = typeof req.body?.moderationState === 'string' ? req.body.moderationState.trim().toUpperCase() : null;
            if (!new Set(['RESOLVED', 'DISMISSED']).has(status)) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_REPORT_STATUS', message: 'Reports may only be resolved or dismissed.' } });
            }
            if (resolution.length < 10 || resolution.length > 1000) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_MODERATION_REASON', message: 'Provide 10 to 1,000 characters explaining this resolution.' } });
            }
            if (requestedState && !MODERATION_STATES.has(requestedState)) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_MODERATION_STATE', message: 'Unsupported moderation state.' } });
            }
            const existingReport = await db.getGameReport(req.params.reportId);
            if (!existingReport) return res.status(404).json({ success: false, error: { code: 'REPORT_NOT_FOUND', message: 'Report not found.' } });
            if (existingReport.status !== 'OPEN') {
                return res.status(409).json({ success: false, error: { code: 'REPORT_ALREADY_RESOLVED', message: 'This report has already been processed.' } });
            }
            const existingGame = await db.getGame(existingReport.gameId);
            if (!existingGame) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found.' } });
            const resolvedAt = Date.now();
            const result = await db.transaction(async tx => {
                const game = requestedState
                    ? await tx.updateGameModerationState(existingGame.id, requestedState)
                    : existingGame;
                const report = await tx.resolveGameReport(existingReport.id, {
                    status,
                    resolution,
                    resolvedByUid: req.auth.uid,
                    resolvedAt
                });
                if (!report) {
                    const conflict = new Error('Report was processed concurrently.');
                    conflict.code = 'REPORT_ALREADY_RESOLVED';
                    throw conflict;
                }
                const audit = await tx.createModerationAction({
                    id: crypto.randomUUID(),
                    gameId: existingGame.id,
                    reportId: existingReport.id,
                    operatorUid: req.auth.uid,
                    action: status === 'DISMISSED' ? 'DISMISS_REPORT' : 'RESOLVE_REPORT',
                    previousState: existingGame.moderationState || 'ACTIVE',
                    nextState: game.moderationState || 'ACTIVE',
                    reason: resolution,
                    createdAt: resolvedAt
                });
                return { game, report, audit };
            });
            res.locals.gameId = result.game.id;
            logger.info('moderation_report_resolved', {
                requestId: req.requestId,
                gameId: result.game.id,
                reportId: result.report.id,
                operatorUid: req.auth.uid,
                status,
                moderationState: result.game.moderationState,
                actionId: result.audit.id
            });
            res.json({ success: true, data: { report: result.report, game: result.game, actionId: result.audit.id } });
        } catch (error) {
            if (error?.code === 'REPORT_ALREADY_RESOLVED') {
                return res.status(409).json({ success: false, error: { code: error.code, message: error.message } });
            }
            logger.error('moderation_report_resolution_failed', { requestId: req.requestId, reportId: req.params.reportId, operatorUid: req.auth.uid, error });
            res.status(500).json({ success: false, error: { code: 'MODERATION_ACTION_FAILED', message: 'Could not resolve the report.' } });
        }
    });

    // Discovery / retention layer. Platform owns selection, accounts and engagement data;
    // Player remains responsible only for executing the selected game.
    const allowedDiscoveryEvents = new Set([
        'impression', 'play_start', 'game_ready', 'next_game', 'session_end', 'game_error'
    ]);

    const buildCatalogItems = async (games, userUid = null) => {
        const rows = await db.getCatalogRowsByGameIds(games.map(game => game.id), userUid);
        const byId = new Map(rows.map(row => [row.gameId, row]));
        return games.map(game => {
            const row = byId.get(game.id);
            if (!row) return null;
            const item = catalogRowToItem(row);
            if (userUid) {
                item.userState = {
                    inLibrary: Boolean(row.inLibrary),
                    userRating: row.userRating == null ? null : Number(row.userRating),
                    followingDeveloper: Boolean(row.followingDeveloper)
                };
            }
            return item;
        }).filter(Boolean);
    };

    const buildCatalogItem = async (game, userUid = null) => (await buildCatalogItems([game], userUid))[0] || null;

    const rankDiscoveryGames = async (games, userUid = null) => {
        const [recentRows, libraryIds, catalogRows] = await Promise.all([
            userUid ? db.listRecentlyPlayedGameIds(userUid, 50) : [],
            userUid ? db.listLibraryGameIds(userUid) : [],
            db.getCatalogRowsByGameIds(games.map(game => game.id))
        ]);
        const recent = new Set(recentRows.map(row => row.gameId));
        const library = new Set(libraryIds);
        const statsById = new Map(catalogRows.map(row => [row.gameId, row]));
        const now = Date.now();

        const ranked = [];
        for (const game of games) {
            const stats = statsById.get(game.id);
            if (!stats) continue;
            const rating = { average: Number(stats.rating || 0), count: Number(stats.ratingCount || 0) };
            const engagement = {
                playStarts: Number(stats.playCount || 0),
                readyCount: Number(stats.readyCount || 0),
                nextCount: Number(stats.nextCount || 0),
                errorCount: Number(stats.errorCount || 0)
            };
            const publishedAt = Number(game.latestPublishedAt || game.updatedAt || game.createdAt || now);
            const ageDays = Math.max(0, (now - publishedAt) / 86400000);
            const freshness = Math.max(0, 3 - Math.min(ageDays / 14, 3));
            const quality = rating.count > 0 ? rating.average : 2.5;
            const engagementScore = Math.min(Math.log2(engagement.readyCount + 1), 4);
            const readyRate = engagement.playStarts > 0
                ? Math.min(1, engagement.readyCount / engagement.playStarts)
                : 0.5;
            const reliability = readyRate * 2;
            const skipPenalty = Math.min(3, (engagement.nextCount / Math.max(engagement.readyCount, 1)) * 2);
            const failurePenalty = Math.min(3, (engagement.errorCount / Math.max(engagement.playStarts, 1)) * 3);
            const seenPenalty = recent.has(game.id) ? 4 : 0;
            const savedPenalty = library.has(game.id) ? 1.5 : 0;
            ranked.push({
                game,
                score: quality * 2 + engagementScore + freshness + reliability
                    - skipPenalty - failurePenalty - seenPenalty - savedPenalty
            });
        }
        ranked.sort((a, b) => b.score - a.score
            || Number(b.game.latestPublishedAt || b.game.createdAt || 0) - Number(a.game.latestPublishedAt || a.game.createdAt || 0));
        return ranked;
    };

    app.post('/api/discovery/events', optionalAuth, async (req, res) => {
        try {
            const { sessionId, gameId, eventType, durationMs = 0 } = req.body || {};
            const telemetryIdentity = req.auth?.uid || req.ip || String(sessionId || 'anonymous');
            const telemetryLimit = await rateLimiter.consume(telemetryIdentity, 'discovery_event');
            if (!telemetryLimit.allowed) {
                return res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many telemetry events.' } });
            }
            if (!sessionId || !gameId || !allowedDiscoveryEvents.has(eventType)) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_EVENT', message: 'Invalid discovery event.' } });
            }
            const game = await db.getGame(gameId);
            if (!game || game.moderationState !== 'ACTIVE' || !await db.getPublishedGameVersion(gameId)) {
                return res.status(404).json({ success: false, error: { code: 'NOT_PUBLISHED', message: 'Game is not published.' } });
            }
            const event = await db.recordDiscoveryEvent({
                id: crypto.randomUUID(),
                sessionId: String(sessionId).slice(0, 128),
                userUid: req.auth?.uid || null,
                gameId,
                eventType,
                durationMs: Math.max(0, Math.min(Number(durationMs) || 0, 24 * 60 * 60 * 1000)),
                createdAt: Date.now()
            });
            res.json({ success: true, data: { id: event.id } });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.get('/api/discovery/play-now', optionalAuth, rlDiscoveryRead, async (req, res) => {
        try {
            const excludedGameIds = parseDiscoveryExclusions(req.query.exclude);
            const games = (await db.listPublishedGames()).filter(game => !excludedGameIds.has(game.id));
            if (games.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: { code: 'NO_PLAYABLE_GAMES', message: 'No unvisited published games are available in this discovery cycle.' }
                });
            }
            const ranked = await rankDiscoveryGames(games, req.auth?.uid || null);
            const selected = ranked[0]?.game;
            const item = selected ? await buildCatalogItem(selected, req.auth?.uid || null) : null;
            if (!item) {
                return res.status(404).json({ success: false, error: { code: 'NO_PLAYABLE_GAMES', message: 'No published game version is currently playable.' } });
            }
            res.json({ success: true, data: item });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.get('/api/discovery/trending', rlDiscoveryRead, async (req, res) => {
        try {
            const limit = Math.max(1, Math.min(Number(req.query.limit) || 8, 24));
            const rankedRows = await db.listTrendingGameIds(limit);
            const byId = new Map((await db.listPublishedGames()).map(game => [game.id, game]));
            const orderedGames = rankedRows.map(row => byId.get(row.gameId)).filter(Boolean);
            if (orderedGames.length < limit) {
                for (const game of byId.values()) {
                    if (!orderedGames.some(item => item.id === game.id)) orderedGames.push(game);
                    if (orderedGames.length >= limit) break;
                }
            }
            const items = await buildCatalogItems(orderedGames.slice(0, limit));
            res.json({ success: true, data: items });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.get('/api/discovery/recommendations', optionalAuth, rlDiscoveryRead, async (req, res) => {
        try {
            const limit = Math.max(1, Math.min(Number(req.query.limit) || 8, 24));
            const excludeGameId = typeof req.query.exclude === 'string' ? req.query.exclude : null;
            const games = (await db.listPublishedGames()).filter(game => game.id !== excludeGameId);
            const ranked = await rankDiscoveryGames(games, req.auth?.uid || null);
            const items = await buildCatalogItems(ranked.slice(0, limit).map(({ game }) => game), req.auth?.uid || null);
            res.json({ success: true, data: items, meta: { personalized: Boolean(req.auth?.uid) } });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.get('/api/library', requireAuth, ensureProfile, async (req, res) => {
        try {
            const ids = await db.listLibraryGameIds(req.auth.uid);
            const gamesById = new Map((await db.listPublishedGames()).map(game => [game.id, game]));
            const items = await buildCatalogItems(ids.map(id => gamesById.get(id)).filter(Boolean), req.auth.uid);
            res.json({ success: true, data: items });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.put('/api/library/:gameId', requireAuth, ensureProfile, async (req, res) => {
        try {
            const game = await db.getGame(req.params.gameId);
            if (!game || game.moderationState !== 'ACTIVE' || !await db.getPublishedGameVersion(game.id)) {
                return res.status(404).json({ success: false, error: { code: 'NOT_PUBLISHED', message: 'Game is not published.' } });
            }
            const alreadyInLibrary = await db.isInLibrary(req.auth.uid, game.id);
            await db.addToLibrary(req.auth.uid, game.id);
            if (!alreadyInLibrary) {
                await db.recordDiscoveryEvent({ id: crypto.randomUUID(), sessionId: `library:${req.auth.uid}`, userUid: req.auth.uid, gameId: game.id, eventType: 'library_add', durationMs: 0, createdAt: Date.now() });
            }
            res.json({ success: true, data: { gameId: game.id, inLibrary: true } });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.delete('/api/library/:gameId', requireAuth, ensureProfile, async (req, res) => {
        try {
            await db.removeFromLibrary(req.auth.uid, req.params.gameId);
            res.json({ success: true, data: { gameId: req.params.gameId, inLibrary: false } });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.get('/api/continue-playing', requireAuth, ensureProfile, async (req, res) => {
        try {
            const recent = await db.listRecentlyPlayedGameIds(req.auth.uid, 12);
            const gamesById = new Map((await db.listPublishedGames()).map(game => [game.id, game]));
            const lastPlayedById = new Map(recent.map(row => [row.gameId, row.lastPlayedAt]));
            const items = (await buildCatalogItems(recent.map(row => gamesById.get(row.gameId)).filter(Boolean), req.auth.uid))
                .map(item => ({ ...item, lastPlayedAt: lastPlayedById.get(item.gameId) }));
            res.json({ success: true, data: items });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.delete('/api/continue-playing/:gameId', requireAuth, ensureProfile, async (req, res) => {
        try {
            await db.dismissRecentlyPlayedGame(req.auth.uid, req.params.gameId);
            res.json({ success: true, data: { gameId: req.params.gameId, visible: false } });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.get('/api/ratings/:gameId', optionalAuth, async (req, res) => {
        try {
            const summary = await db.getGameRatingSummary(req.params.gameId);
            const userRating = req.auth?.uid ? await db.getUserGameRating(req.auth.uid, req.params.gameId) : null;
            res.json({ success: true, data: { ...summary, userRating } });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.put('/api/ratings/:gameId', requireAuth, ensureProfile, rlRatingWrite, async (req, res) => {
        try {
            const rating = Number(req.body?.rating);
            if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_RATING', message: 'Rating must be an integer from 1 to 5.' } });
            }
            const game = await db.getGame(req.params.gameId);
            if (!game || game.moderationState !== 'ACTIVE' || !await db.getPublishedGameVersion(game.id)) {
                return res.status(404).json({ success: false, error: { code: 'NOT_PUBLISHED', message: 'Game is not published.' } });
            }
            await db.upsertGameRating(req.auth.uid, game.id, rating);
            await db.recordDiscoveryEvent({ id: crypto.randomUUID(), sessionId: `rating:${req.auth.uid}`, userUid: req.auth.uid, gameId: game.id, eventType: 'rating_submit', durationMs: 0, createdAt: Date.now() });
            const summary = await db.getGameRatingSummary(game.id);
            res.json({ success: true, data: { ...summary, userRating: rating } });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.put('/api/developers/:uid/follow', requireAuth, ensureProfile, rlFollowWrite, async (req, res) => {
        try {
            if (req.auth.uid === req.params.uid) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_FOLLOW', message: 'You cannot follow yourself.' } });
            }
            const developer = await db.getUser(req.params.uid);
            if (!developer) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Developer not found.' } });
            await db.followDeveloper(req.auth.uid, req.params.uid);
            res.json({ success: true, data: { developerUid: req.params.uid, following: true } });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.delete('/api/developers/:uid/follow', requireAuth, ensureProfile, rlFollowWrite, async (req, res) => {
        try {
            await db.unfollowDeveloper(req.auth.uid, req.params.uid);
            res.json({ success: true, data: { developerUid: req.params.uid, following: false } });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.get('/api/following', requireAuth, ensureProfile, async (req, res) => {
        try {
            const developers = await db.listFollowedDevelopers(req.auth.uid);
            const games = await db.listPublishedGamesByOwners(developers.map(dev => dev.uid).filter(Boolean));
            const items = await buildCatalogItems(games, req.auth.uid);
            res.json({ success: true, data: { developers, games: items } });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.get('/api/catalog/games', rlCatalogRead, async (req, res) => {
        try {
            const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
            const tag = typeof req.query.tag === 'string' ? req.query.tag.trim() : '';
            const requestedSort = typeof req.query.sort === 'string' ? req.query.sort : 'featured';
            const sort = CATALOG_SORTS.has(requestedSort) ? requestedSort : 'featured';
            const limit = Math.max(1, Math.min(Number(req.query.limit) || 24, 48));
            if (query.length > 120 || tag.length > 50) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_CATALOG_FILTER', message: 'Catalog search or tag filter is too long.' } });
            }
            const cursorFilters = { query: query.toLocaleLowerCase(), tag: tag.toLocaleLowerCase(), sort };
            const offset = decodeCatalogCursor(req.query.cursor, cursorFilters);
            if (offset === null) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_CURSOR', message: 'Catalog cursor is invalid or does not match the current filters.' } });
            }

            const [rows, popularTags] = await Promise.all([
                db.searchPublishedCatalog({ query, tag, sort, limit: limit + 1, offset }),
                db.listPublishedCatalogTags({ query, limit: 10 })
            ]);
            const hasMore = rows.length > limit;
            const catalog = rows.slice(0, limit).map(catalogRowToItem);
            const responseBody = {
                success: true,
                data: catalog,
                meta: {
                    limit,
                    hasMore,
                    nextCursor: hasMore ? encodeCatalogCursor(offset + limit, cursorFilters) : null,
                    popularTags
                }
            };
            const etag = `\"${crypto.createHash('sha256').update(JSON.stringify(responseBody)).digest('base64url')}\"`;
            res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
            res.setHeader('ETag', etag);
            if (etagMatches(req.headers['if-none-match'], etag)) return res.status(304).end();
            res.json(responseBody);
        } catch (e) {
            logger.error('catalog_query_failed', { requestId: req.requestId, error: e });
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.get('/api/catalog/games/:id', optionalAuth, rlCatalogRead, async (req, res) => {
        try {
            const game = await db.getGame(req.params.id);
            if (!game) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found' } });
            if (game.moderationState !== 'ACTIVE') return res.status(404).json({ success: false, error: { code: 'NOT_PUBLISHED', message: 'Game is not published' } });
            const version = await db.getPublishedGameVersion(game.id);
            if (!version) return res.status(404).json({ success: false, error: { code: 'NOT_PUBLISHED', message: 'Game is not published' } });
            if (!version.runtimeUrl) return res.status(503).json({ success: false, error: { code: 'RUNTIME_UNAVAILABLE', message: 'Published game runtime is unavailable.' } });
            const base = await buildCatalogItem(game, req.auth?.uid || null);
            res.json({
                success: true,
                data: {
                    ...base,
                    format: version.format,
                    entry: version.entry,
                    streamingManifestUrl: version.streamingManifestPath
                        ? `${version.runtimeUrl}/${version.streamingManifestPath}`
                        : null,
                    storageRef: { location: version.runtimeUrl }
                }
            });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.use('/api', (req, res) => {
        res.status(404).json({ success: false, error: { code: 'API_ROUTE_NOT_FOUND', message: 'API route not found.' } });
    });

    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        if (error?.type === 'entity.too.large') {
            return res.status(413).json({ success: false, error: { code: 'REQUEST_TOO_LARGE', message: 'Request body is too large.' } });
        }
        if (error instanceof SyntaxError && error?.status === 400 && 'body' in error) {
            return res.status(400).json({ success: false, error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON.' } });
        }
        console.error('Unhandled Platform request error:', error);
        return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } });
    });

    return app;
}
