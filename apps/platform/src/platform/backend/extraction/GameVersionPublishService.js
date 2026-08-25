import { QuotaConfig } from '../config/quotas.js';

export class GameVersionPublishService {
    constructor(dbProvider, extractor) {
        this.db = dbProvider;
        this.extractor = extractor;
    }

    async processExtractionJob(payload, job) {
        const { gameId, versionId, ownerUid } = payload;
        
        // Use atomic claim to transition state
        const claimed = await this.db.claimVersionForPublishing(versionId, ownerUid);
        if (!claimed) {
            // Already processing or not in valid state
            const version = await this.db.getGameVersion(versionId);
            if (version && version.status === 'PUBLISHED') {
                return; // Already completed successfully
            }
            throw Object.assign(new Error('Failed to claim version for publishing'), { isPermanent: true });
        }

        await this.db.recordPublishAttempt(versionId);

        let extractedResult = null;
        try {
            const [version, session] = await Promise.all([
                this.db.getGameVersion(versionId),
                this.db.getUploadSessionByVersionId(versionId)
            ]);
            if (!version || !session || session.gameId !== gameId || session.ownerUid !== ownerUid) {
                throw Object.assign(new Error('Publish source package was not found'), { isPermanent: true });
            }

            const usage = await this.db.getUserQuotaUsage(ownerUid);
            const remainingStorageBytes = QuotaConfig.PLATFORM_MAX_STORAGE_BYTES_PER_USER - usage.totalStorageBytes;
            if (remainingStorageBytes <= 0) {
                throw Object.assign(new Error('Publishing this version would exceed the developer storage quota.'), {
                    code: 'STORAGE_QUOTA_EXCEEDED',
                    isPermanent: true
                });
            }

            // Extract the validated package idempotently and expose only its extracted files.
            const result = await this.extractor.extractPackage(
                gameId,
                versionId,
                session.objectKey,
                version.entry,
                version.streamingManifestPath,
                {
                    maxExtractedSizeBytes: remainingStorageBytes,
                    expectedPackageSha256: version.packageSha256 || null,
                    expectedPackageSizeBytes: version.packageSha256 && Number(version.packageSizeBytes) > 0
                        ? Number(version.packageSizeBytes)
                        : null
                }
            );
            extractedResult = result;

            // Transaction boundary for quota and state updates
            await this.db.transaction(async (tx) => {
                const currentUsage = await tx.getUserQuotaUsage(ownerUid);
                if (currentUsage.totalStorageBytes + result.extractedSizeBytes > QuotaConfig.PLATFORM_MAX_STORAGE_BYTES_PER_USER) {
                    throw Object.assign(new Error('Publishing this version would exceed the developer storage quota.'), {
                        code: 'STORAGE_QUOTA_EXCEEDED',
                        isPermanent: true
                    });
                }
                await tx.updateGameVersionMetadata(versionId, {
                    extractedSizeBytes: result.extractedSizeBytes,
                    packageSizeBytes: result.packageSizeBytes,
                    publishError: null,
                    runtimeUrl: result.runtimeUrl
                });
                await tx.activateGameVersion(gameId, versionId, Date.now());
                // Find upload session and mark as ready to be cleaned up
                const session = await tx.getUploadSessionByVersionId(versionId);
                if (session) {
                    await tx.updateUploadSessionStatus(session.id, 'COMPLETED');
                }
            });
        } catch (error) {
            if (extractedResult && typeof this.extractor.cleanupExtractedRuntime === 'function') {
                try {
                    await this.extractor.cleanupExtractedRuntime(gameId, versionId);
                } catch (cleanupError) {
                    console.error('Failed to cleanup extracted runtime after publish failure', cleanupError);
                }
            }
            await this.db.markVersionPublishFailed(versionId, error instanceof Error ? error.message : String(error));
            
            // Re-throw so job runner sees the failure
            // If error is related to validation/safety, it's permanent
            if (error.code === 'UNSAFE_FILE_PATH' || 
                error.code === 'TOO_MANY_FILES' || 
                error.code === 'FILE_SIZE_EXCEEDED' ||
                error.code === 'EXTRACTED_SIZE_EXCEEDED' || 
                error.code === 'INVALID_MANIFEST' ||
                error.code === 'PACKAGE_CHANGED_AFTER_VALIDATION' ||
                error.code === 'STORAGE_QUOTA_EXCEEDED') {
                error.isPermanent = true;
            }
            throw error;
        }
    }
}
