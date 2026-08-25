import { QuotaConfig } from '../config/quotas.js';

export class UploadCleanupService {
    constructor(db, storage, jobQueue) {
        this.db = db;
        this.storage = storage;
        this.jobQueue = jobQueue;
    }

    async enqueueCleanupJobs() {
        const now = Date.now();
        const completedBefore = now - QuotaConfig.COMPLETED_UPLOAD_RETENTION_MS;
        const sessions = await this.db.getUploadSessionsForCleanup(now, completedBefore);
        for (const session of sessions) {
            if (this.jobQueue) {
                await this.jobQueue.enqueue('CLEANUP_UPLOAD_SESSION', session.id, { sessionId: session.id });
            }
        }
    }

    async processCleanupJob(payload, job) {
        const { sessionId } = payload;
        const session = await this.db.getUploadSession(sessionId);
        
        if (!session || session.status === 'CLEANED') {
            return; // Already handled
        }

        if (typeof this.storage.deleteObject === 'function') {
            await this.storage.deleteObject(session.objectKey);
        }

        if (session.versionId && typeof this.db.updateGameVersionMetadata === 'function') {
            const version = typeof this.db.getGameVersion === 'function'
                ? await this.db.getGameVersion(session.versionId)
                : null;
            const metadata = { packageSizeBytes: 0 };
            if (version && ['READY', 'PUBLISH_FAILED'].includes(version.status)) {
                metadata.status = 'EXPIRED';
                metadata.publishError = 'The validated source package expired. Upload this build as a new version to publish it.';
            }
            await this.db.updateGameVersionMetadata(session.versionId, metadata);
        }
        await this.db.updateUploadSession(session.id, { status: 'CLEANED' });
    }

    // Legacy method for testing backward compatibility
    async runUploadCleanup() {
        const now = Date.now();
        const completedBefore = now - QuotaConfig.COMPLETED_UPLOAD_RETENTION_MS;
        const sessions = await this.db.getUploadSessionsForCleanup(now, completedBefore);
        for (const session of sessions) {
            try {
                if (typeof this.storage.deleteObject === 'function') {
                    await this.storage.deleteObject(session.objectKey);
                }

                if (session.versionId && typeof this.db.updateGameVersionMetadata === 'function') {
                    const version = typeof this.db.getGameVersion === 'function'
                        ? await this.db.getGameVersion(session.versionId)
                        : null;
                    const metadata = { packageSizeBytes: 0 };
                    if (version && ['READY', 'PUBLISH_FAILED'].includes(version.status)) {
                        metadata.status = 'EXPIRED';
                        metadata.publishError = 'The validated source package expired. Upload this build as a new version to publish it.';
                    }
                    await this.db.updateGameVersionMetadata(session.versionId, metadata);
                }
                await this.db.updateUploadSession(session.id, { status: 'CLEANED' });
            } catch (err) {
                console.error(`Failed to clean up session ${session.id}`, err);
            }
        }
    }
}
