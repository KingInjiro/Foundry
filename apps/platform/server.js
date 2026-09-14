import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApp } from './src/platform/backend/server/app.js';
import { LocalSqliteProvider } from './src/platform/backend/database/LocalSqliteProvider.js';
import { LocalDiskStorageProvider } from './src/platform/backend/storage/LocalDiskStorageProvider.js';
import { QuotaConfig } from './src/platform/backend/config/quotas.js';
import { assertSafeRuntimeMode } from './src/platform/backend/config/runtimeMode.js';
import { validateProductionConfiguration } from './src/platform/backend/config/productionConfig.js';
import { createProductionProviders } from './src/platform/backend/config/productionProviders.js';
import { checkStorageIntegrity } from './src/platform/backend/storage/StorageIntegrityChecker.js';

function getCleanupIntervalMs() {
    const configured = Number(process.env.UPLOAD_CLEANUP_INTERVAL_MS);
    return Number.isFinite(configured) && configured >= 60_000
        ? configured
        : 15 * 60_000;
}

async function startServer() {
    const runtimeMode = assertSafeRuntimeMode();
    const productionConfig = validateProductionConfiguration();
    const app = express();
    const PORT = productionConfig.production ? productionConfig.port : (process.env.PORT || 3000);
    let viteServer = null;

    const { e2eMode, localDevMode, singleHostTestMode } = runtimeMode;
    const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');

    // Explicit non-production storage/auth modes.
    let db, storage;
    if (e2eMode) {
        process.env.AUTH_DEV_BYPASS = 'true';
        process.env.JOB_MODE = 'inline'; // synchronous jobs
        db = new LocalSqliteProvider('.e2e/platform-e2e.db');
        storage = new LocalDiskStorageProvider('.e2e/storage', '/api/test-storage/upload');
    } else if (localDevMode) {
        process.env.AUTH_DEV_BYPASS = 'true';
        process.env.JOB_MODE = 'inline';
        db = new LocalSqliteProvider('.local/platform.db');
        storage = new LocalDiskStorageProvider('.local/storage', '/api/local-storage/upload');
    } else if (singleHostTestMode) {
        const dataDirectory = path.resolve(process.env.SINGLE_HOST_TEST_DATA_DIR || '.single-host-e2e');
        const objectDirectory = path.join(dataDirectory, 'objects');
        const fs = await import('node:fs');
        fs.mkdirSync(objectDirectory, { recursive: true });
        fs.mkdirSync(path.join(dataDirectory, 'backups'), { recursive: true });
        db = new LocalSqliteProvider(path.join(dataDirectory, 'platform.db'));
        storage = new LocalDiskStorageProvider(objectDirectory, '/api/storage/upload', {
            uploadSigningSecret: process.env.LOCAL_STORAGE_SIGNING_SECRET,
            uploadUrlTtlSeconds: process.env.LOCAL_STORAGE_UPLOAD_URL_TTL_SECONDS,
            publicOrigin: process.env.PLATFORM_PUBLIC_BASE_URL
        });
    } else {
        const providers = createProductionProviders(productionConfig);
        db = providers.database;
        storage = providers.storage;
    }

    if (e2eMode || localDevMode) {
        app.put(storage.uploadRoute, express.raw({ type: '*/*', limit: QuotaConfig.PLATFORM_MAX_PACKAGE_SIZE_BYTES }), async (req, res) => {
            const key = req.query.key;
            if (!key) return res.status(400).send('Missing key');
            await storage.uploadBuffer(key, req.body, req.headers['content-type']);
            res.sendStatus(200);
        });
    }

    // Destructive reset remains test-only and is never exposed by local development mode.
    if (e2eMode) {
        app.get('/api/test-delay', async (req, res) => {
            const delayMs = Math.max(0, Math.min(Number(req.query.ms) || 0, 30_000));
            await new Promise(resolve => setTimeout(resolve, delayMs));
            if (!res.destroyed) res.json({ success: true, data: [] });
        });

        app.post('/api/test-users/:uid/role', async (req, res) => {
            const role = typeof req.query.role === 'string' ? req.query.role.trim().toUpperCase() : '';
            if (!['ADMIN', 'MODERATOR', 'DEVELOPER'].includes(role)) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_TEST_ROLE', message: 'Unsupported test role.' } });
            }
            const result = await db.provisionUserRole({
                uid: req.params.uid,
                role,
                email: `${req.params.uid}@foundry.test`,
                displayName: `${role} QA`
            });
            res.json({ success: true, data: result.user });
        });

        app.post('/api/test-db/reset', async (req, res) => {
            if (e2eMode) {
                db.db.exec(`
                    DELETE FROM jobs;
                    DELETE FROM rate_limit_buckets;
                    DELETE FROM upload_sessions;
                    DELETE FROM moderation_actions;
                    DELETE FROM game_reports;
                    DELETE FROM editor_projects;
                    DELETE FROM user_library;
                    DELETE FROM game_ratings;
                    DELETE FROM developer_follows;
                    DELETE FROM discovery_events;
                    DELETE FROM continue_playing_dismissals;
                    DELETE FROM game_versions;
                    DELETE FROM games;
                    DELETE FROM users;
                `);
                // Also clean storage directory
                const fs = await import('fs');
                const path = await import('path');
                const rimraf = (dir_path) => {
                    if (fs.existsSync(dir_path)) {
                        fs.readdirSync(dir_path).forEach(function(entry) {
                            var entry_path = path.join(dir_path, entry);
                            if (fs.lstatSync(entry_path).isDirectory()) {
                                rimraf(entry_path);
                            } else {
                                fs.unlinkSync(entry_path);
                            }
                        });
                        fs.rmdirSync(dir_path);
                    }
                };
                rimraf('.e2e/storage');
                fs.mkdirSync('.e2e/storage', { recursive: true });
                res.sendStatus(200);
            } else {
                res.sendStatus(403);
            }
        });
    }

    if (productionConfig.production && productionConfig.deploymentMode === 'single-host') {
        const integrity = await checkStorageIntegrity(db, storage);
        if (integrity.status !== 'PASS') throw new Error(`Production storage integrity failed (${integrity.counts.missingOrInvalid} issue(s)); changing storage does not migrate objects.`);
    }

    // API routes FIRST
    const backendApp = createApp(db, storage, undefined, { runtimeConfig: productionConfig });
    app.use(backendApp);
    const logger = backendApp.locals.logger;

    if (process.env.NODE_ENV === 'production') {
        const readiness = await backendApp.locals.checkReadiness();
        if (!readiness.ready) {
            throw new Error(`Production dependencies are not ready: ${JSON.stringify(readiness.checks)}`);
        }
    }

    let cleanupSchedulingStopped = false;
    let activeCleanupScheduling = Promise.resolve();
    const runUploadCleanup = () => {
        if (cleanupSchedulingStopped) return activeCleanupScheduling;
        activeCleanupScheduling = activeCleanupScheduling
            .then(() => backendApp.locals.uploadCleanupService.enqueueCleanupJobs())
            .catch(error => logger.error('upload_cleanup_scheduling_failed', { error }));
        return activeCleanupScheduling;
    };
    runUploadCleanup();
    const cleanupInterval = setInterval(runUploadCleanup, getCleanupIntervalMs());
    cleanupInterval.unref?.();

    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
        viteServer = await createViteServer({
            server: { middlewareMode: true },
            appType: "spa",
        });
        app.use(viteServer.middlewares);
    } else {
        const distPath = path.join(process.cwd(), 'dist', 'client');
        // Prebuilt ZIPs normalize mtimes. Equal-length HTML from different
        // releases then has the same stat-based ETag/Last-Modified, causing a
        // false 304 and references to removed bundles. Always send current HTML,
        // including when a browser supplies validators cached before this fix.
        const serveHtml = filename => (req, res) => res.sendFile(path.join(distPath, filename), {
            etag: false,
            lastModified: false,
            cacheControl: false,
            headers: { 'Cache-Control': 'no-store' }
        });
        app.get(['/', '/index.html'], serveHtml('index.html'));
        app.get('/sandbox.html', serveHtml('sandbox.html'));
        app.get('/generic-sandbox.html', serveHtml('generic-sandbox.html'));
        app.use(express.static(distPath, { index: false }));
        app.get('*', serveHtml('index.html'));
    }

    const server = app.listen(PORT, HOST, () => {
        const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
        logger.info('server_started', { host: HOST, port: Number(PORT), displayUrl: `http://${displayHost}:${PORT}` });
    });

    let shuttingDown = false;
    const shutdown = async signal => {
        if (shuttingDown) return;
        shuttingDown = true;
        cleanupSchedulingStopped = true;
        clearInterval(cleanupInterval);
        logger.info('server_stopping', { signal });

        // server.close() immediately stops accepting new connections. The job
        // queue is then put into drain mode before the database is closed.
        const httpClosed = new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
            server.closeIdleConnections?.();
        });
        const graceMs = productionConfig.shutdownGraceMs || 30_000;
        const graceTimer = setTimeout(() => {
            logger.error('shutdown_grace_exceeded', { signal, graceMs, recovery: 'Active jobs remain durable and are reclaimable after their lease expires.' });
            server.closeAllConnections?.();
            process.exitCode = 1;
            setTimeout(() => process.exit(1), 250);
        }, graceMs);
        graceTimer.unref?.();

        try {
            await activeCleanupScheduling;
            await Promise.all([httpClosed, Promise.resolve(backendApp.locals.jobQueue?.stop?.())]);
            await viteServer?.close();
            if (typeof backendApp.locals.database?.close === 'function') {
                await backendApp.locals.database.close();
            } else {
                backendApp.locals.database?.db?.close?.();
            }
            logger.info('server_stopped', { signal });
        } catch (error) {
            logger.error('graceful_shutdown_failed', { signal, error });
            process.exitCode = 1;
        } finally {
            clearTimeout(graceTimer);
        }
    };
    process.once('SIGINT', () => { void shutdown('SIGINT'); });
    process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
}

startServer().catch(error => {
    console.error('Failed to start Foundry Platform:', error);
    process.exitCode = 1;
});
