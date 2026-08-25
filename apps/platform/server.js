import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApp } from './src/platform/backend/server/app.js';
import { LocalSqliteProvider } from './src/platform/backend/database/LocalSqliteProvider.js';
import { LocalDiskStorageProvider } from './src/platform/backend/storage/LocalDiskStorageProvider.js';
import { QuotaConfig } from './src/platform/backend/config/quotas.js';

function getCleanupIntervalMs() {
    const configured = Number(process.env.UPLOAD_CLEANUP_INTERVAL_MS);
    return Number.isFinite(configured) && configured >= 60_000
        ? configured
        : 15 * 60_000;
}

async function startServer() {
    const app = express();
    const PORT = process.env.PORT || 3000;
    let viteServer = null;

    const e2eMode = process.env.E2E_MODE === 'true';
    const localDevMode = process.env.NODE_ENV !== 'production' && process.env.LOCAL_DEV_MODE === 'true';
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
        app.post('/api/test-db/reset', async (req, res) => {
            if (e2eMode) {
                db.db.exec(`
                    DELETE FROM jobs;
                    DELETE FROM upload_sessions;
                    DELETE FROM game_versions;
                    DELETE FROM games;
                    DELETE FROM users;
                    DELETE FROM user_library;
                    DELETE FROM game_ratings;
                    DELETE FROM developer_follows;
                    DELETE FROM discovery_events;
                    DELETE FROM continue_playing_dismissals;
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

    // API routes FIRST
    const backendApp = createApp(db, storage);
    app.use(backendApp);
    const logger = backendApp.locals.logger;

    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_UNREADY_STARTUP !== 'true') {
        const databaseReady = await backendApp.locals.database.ping();
        const storageReady = typeof backendApp.locals.storage.ping === 'function'
            ? await backendApp.locals.storage.ping()
            : Boolean(backendApp.locals.storage.isConfigured);
        if (!databaseReady || !storageReady) {
            throw new Error('Production dependencies are not ready. Set ALLOW_UNREADY_STARTUP=true only for controlled diagnostics.');
        }
    }

    const runUploadCleanup = () => {
        void backendApp.locals.uploadCleanupService.enqueueCleanupJobs().catch(error => {
            logger.error('upload_cleanup_scheduling_failed', { error });
        });
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
        const distPath = path.join(process.cwd(), 'dist');
        app.use(express.static(distPath));
        app.get('*', (req, res) => {
            res.sendFile(path.join(distPath, 'index.html'));
        });
    }

    const server = app.listen(PORT, HOST, () => {
        const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
        logger.info('server_started', { host: HOST, port: Number(PORT), displayUrl: `http://${displayHost}:${PORT}` });
    });

    let shuttingDown = false;
    const shutdown = signal => {
        if (shuttingDown) return;
        shuttingDown = true;
        clearInterval(cleanupInterval);
        backendApp.locals.jobQueue?.stop?.();
        server.close(async () => {
            await viteServer?.close();
            try {
                backendApp.locals.database?.db?.close?.();
            } catch (error) {
                logger.error('database_shutdown_failed', { error });
            }
            logger.info('server_stopped', { signal });
        });
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
}

startServer().catch(error => {
    console.error('Failed to start Foundry Platform:', error);
    process.exitCode = 1;
});
