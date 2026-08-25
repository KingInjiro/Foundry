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
import { LocalSqliteProvider } from '../database/LocalSqliteProvider.js';
import { R2StorageProvider } from '../storage/R2StorageProvider.js';
import { ReleaseLifecycleService } from '../lifecycle/ReleaseLifecycleService.js';
import { createJsonLogger } from '../observability/JsonLogger.js';

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
    
    const jobs = jobQueue || new LocalJobQueue(db);
    
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
    app.locals.database = db;
    app.locals.storage = storage;
    app.locals.jobQueue = jobs;
    app.locals.uploadCleanupService = cleanupService;
    app.locals.releaseLifecycleService = releaseLifecycle;
    app.locals.logger = logger;
    app.locals.startedAt = Date.now();
    app.disable('x-powered-by');

    app.use((req, res, next) => {
        const suppliedRequestId = req.get('x-request-id');
        req.requestId = suppliedRequestId && /^[a-zA-Z0-9._:-]{1,128}$/.test(suppliedRequestId)
            ? suppliedRequestId
            : crypto.randomUUID();
        res.setHeader('X-Request-Id', req.requestId);
        const startedAt = Date.now();
        res.once('finish', () => {
            logger.info('http_request', {
                requestId: req.requestId,
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                durationMs: Date.now() - startedAt
            });
        });
        next();
    });
    app.use(express.json());

    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
        res.setHeader('Origin-Agent-Cluster', '?1');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()');
        next();
    });

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
            const version = await db.getGameVersion(versionId);
            if (
                !version
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
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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
    const rlCreateVersion = createRateLimitMiddleware(rateLimiter, 'create_version');
    const rlCompleteUpload = createRateLimitMiddleware(rateLimiter, 'complete_upload');
    const rlPublishVersion = createRateLimitMiddleware(rateLimiter, 'publish_version');
    const rlReleaseLifecycle = createRateLimitMiddleware(rateLimiter, 'release_lifecycle');

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

    

    
    app.get('/api/auth/me', requireAuth, ensureProfile, (req, res) => {
        res.json({ success: true, data: req.userProfile });
    });
    
    app.get('/api/health', (req, res) => {
        res.json({
            success: true,
            data: {
                status: 'ok',
                uptimeSeconds: Math.floor((Date.now() - app.locals.startedAt) / 1000),
                storageConfigured: Boolean(storage.isConfigured),
                storageProvider: storage.kind || 'custom',
                r2Configured: storage.kind === 'r2' && Boolean(storage.isConfigured),
                directAssetDelivery: Boolean(storage.directDownloadsEnabled)
            }
        });
    });

    app.get('/api/ready', async (req, res) => {
        const checks = { database: false, storage: false, jobs: false };
        let queue = null;
        try {
            checks.database = typeof db.ping === 'function' ? await db.ping() : Boolean(db);
            checks.storage = typeof storage.ping === 'function'
                ? await storage.ping()
                : Boolean(storage.isConfigured);
            if (typeof jobs.getStatus === 'function') {
                const status = await jobs.getStatus();
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
            checks.jobs = Boolean(queue);
        } catch (error) {
            logger.error('readiness_check_failed', { requestId: req.requestId, error });
        }
        const ready = Object.values(checks).every(Boolean);
        res.status(ready ? 200 : 503).json({
            success: ready,
            data: { status: ready ? 'ready' : 'not_ready', checks, queue }
        });
    });

    app.post('/api/games', requireAuth, ensureProfile, async (req, res) => {
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

    // Discovery / retention layer. Platform owns selection, accounts and engagement data;
    // Player remains responsible only for executing the selected game.
    const allowedDiscoveryEvents = new Set([
        'impression', 'play_start', 'game_ready', 'next_game', 'session_end', 'game_error'
    ]);

    const buildCatalogItem = async (game, userUid = null) => {
        const version = await db.getPublishedGameVersion(game.id);
        if (!version) return null;
        const [developer, rating, engagement] = await Promise.all([
            db.getUser(game.ownerUid),
            db.getGameRatingSummary(game.id),
            db.getGameDiscoveryStats(game.id)
        ]);

        const parseStringArray = value => {
            try {
                const parsed = JSON.parse(value || '[]');
                return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
            } catch {
                return [];
            }
        };
        const parseControls = value => {
            try {
                const parsed = JSON.parse(value || '[]');
                return Array.isArray(parsed)
                    ? parsed.filter(item => item && typeof item.action === 'string' && typeof item.key === 'string')
                    : [];
            } catch {
                return [];
            }
        };
        const capabilities = parseStringArray(version.capabilities);
        const tags = parseStringArray(version.tags);
        const controls = parseControls(version.controls);
        const thumbnailUrl = version.thumbnail && version.runtimeUrl
            ? `${version.runtimeUrl}/${version.thumbnail.split('/').map(segment => encodeURIComponent(segment)).join('/')}`
            : null;

        const item = {
            gameId: game.id,
            versionId: version.id,
            name: game.title,
            description: game.description,
            gameVersion: version.version,
            runtime: version.runtime,
            capabilities,
            thumbnailUrl,
            tags,
            controls,
            streamingEnabled: Boolean(version.streamingManifestPath),
            publishedAt: version.publishedAt || version.createdAt,
            developerUid: game.ownerUid,
            developer: developer?.displayName || developer?.email || 'Unknown Developer',
            developerAvatarUrl: developer?.avatarUrl || '',
            rating: rating.average,
            ratingCount: rating.count,
            playCount: engagement.playStarts,
            avgSessionDurationMs: engagement.avgSessionDurationMs
        };

        if (userUid) {
            const [inLibrary, userRating, followingDeveloper] = await Promise.all([
                db.isInLibrary(userUid, game.id),
                db.getUserGameRating(userUid, game.id),
                userUid === game.ownerUid ? false : db.isFollowingDeveloper(userUid, game.ownerUid)
            ]);
            item.userState = { inLibrary, userRating, followingDeveloper };
        }
        return item;
    };

    const rankDiscoveryGames = async (games, userUid = null) => {
        const recentRows = userUid ? await db.listRecentlyPlayedGameIds(userUid, 50) : [];
        const libraryIds = userUid ? await db.listLibraryGameIds(userUid) : [];
        const recent = new Set(recentRows.map(row => row.gameId));
        const library = new Set(libraryIds);
        const now = Date.now();

        const ranked = [];
        for (const game of games) {
            const [rating, engagement] = await Promise.all([
                db.getGameRatingSummary(game.id),
                db.getGameDiscoveryStats(game.id)
            ]);
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
            if (!game || !await db.getPublishedGameVersion(gameId)) {
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

    app.get('/api/discovery/play-now', optionalAuth, async (req, res) => {
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

    app.get('/api/discovery/trending', async (req, res) => {
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
            const items = (await Promise.all(orderedGames.slice(0, limit).map(game => buildCatalogItem(game)))).filter(Boolean);
            res.json({ success: true, data: items });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.get('/api/discovery/recommendations', optionalAuth, async (req, res) => {
        try {
            const limit = Math.max(1, Math.min(Number(req.query.limit) || 8, 24));
            const excludeGameId = typeof req.query.exclude === 'string' ? req.query.exclude : null;
            const games = (await db.listPublishedGames()).filter(game => game.id !== excludeGameId);
            const ranked = await rankDiscoveryGames(games, req.auth?.uid || null);
            const items = (await Promise.all(ranked.slice(0, limit).map(({ game }) => buildCatalogItem(game, req.auth?.uid || null)))).filter(Boolean);
            res.json({ success: true, data: items, meta: { personalized: Boolean(req.auth?.uid) } });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.get('/api/library', requireAuth, ensureProfile, async (req, res) => {
        try {
            const ids = await db.listLibraryGameIds(req.auth.uid);
            const items = [];
            for (const id of ids) {
                const game = await db.getGame(id);
                if (!game) continue;
                const item = await buildCatalogItem(game, req.auth.uid);
                if (item) items.push(item);
            }
            res.json({ success: true, data: items });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.put('/api/library/:gameId', requireAuth, ensureProfile, async (req, res) => {
        try {
            const game = await db.getGame(req.params.gameId);
            if (!game || !await db.getPublishedGameVersion(game.id)) {
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
            const items = [];
            for (const row of recent) {
                const game = await db.getGame(row.gameId);
                if (!game) continue;
                const item = await buildCatalogItem(game, req.auth.uid);
                if (item) items.push({ ...item, lastPlayedAt: row.lastPlayedAt });
            }
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

    app.put('/api/ratings/:gameId', requireAuth, ensureProfile, async (req, res) => {
        try {
            const rating = Number(req.body?.rating);
            if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_RATING', message: 'Rating must be an integer from 1 to 5.' } });
            }
            const game = await db.getGame(req.params.gameId);
            if (!game || !await db.getPublishedGameVersion(game.id)) {
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

    app.put('/api/developers/:uid/follow', requireAuth, ensureProfile, async (req, res) => {
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

    app.delete('/api/developers/:uid/follow', requireAuth, ensureProfile, async (req, res) => {
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
            const items = (await Promise.all(games.map(game => buildCatalogItem(game, req.auth.uid)))).filter(Boolean);
            res.json({ success: true, data: { developers, games: items } });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        }
    });

    app.get('/api/catalog/games', async (req, res) => {
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

    app.get('/api/catalog/games/:id', optionalAuth, async (req, res) => {
        try {
            const game = await db.getGame(req.params.id);
            if (!game) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found' } });
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
