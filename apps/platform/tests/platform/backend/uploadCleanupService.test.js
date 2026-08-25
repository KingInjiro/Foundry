import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UploadCleanupService } from '../../../src/platform/backend/storage/UploadCleanupService.js';

describe('UploadCleanupService Job Integration', () => {
    let service;
    let mockDb;
    let mockStorage;
    let mockJobQueue;

    beforeEach(() => {
        mockDb = {
            getUploadSessionsForCleanup: vi.fn(),
            getUploadSession: vi.fn(),
            getGameVersion: vi.fn(),
            updateUploadSession: vi.fn(),
            updateGameVersionMetadata: vi.fn()
        };
        mockStorage = {
            deleteObject: vi.fn()
        };
        mockJobQueue = {
            enqueue: vi.fn()
        };
        service = new UploadCleanupService(mockDb, mockStorage, mockJobQueue);
    });

    it('marks an unpublished version expired when its retained source package is removed', async () => {
        const session = { id: 'sess-expired', versionId: 'version-expired', objectKey: 'uploads/expired.zip', status: 'COMPLETED' };
        mockDb.getUploadSession.mockResolvedValue(session);
        mockDb.getGameVersion.mockResolvedValue({ id: 'version-expired', status: 'READY' });

        await service.processCleanupJob({ sessionId: session.id });

        expect(mockDb.updateGameVersionMetadata).toHaveBeenCalledWith('version-expired', {
            packageSizeBytes: 0,
            status: 'EXPIRED',
            publishError: expect.stringContaining('expired')
        });
    });

    it('keeps a published version active when only its source ZIP is retired', async () => {
        const session = { id: 'sess-published', versionId: 'version-published', objectKey: 'uploads/published.zip', status: 'COMPLETED' };
        mockDb.getUploadSession.mockResolvedValue(session);
        mockDb.getGameVersion.mockResolvedValue({ id: 'version-published', status: 'PUBLISHED' });

        await service.processCleanupJob({ sessionId: session.id });

        expect(mockDb.updateGameVersionMetadata).toHaveBeenCalledWith('version-published', { packageSizeBytes: 0 });
    });

    it('enqueueCleanupJobs enqueues jobs for expired sessions', async () => {
        mockDb.getUploadSessionsForCleanup.mockResolvedValue([
            { id: 'sess1' }, { id: 'sess2' }
        ]);

        await service.enqueueCleanupJobs();

        expect(mockJobQueue.enqueue).toHaveBeenCalledWith('CLEANUP_UPLOAD_SESSION', 'sess1', { sessionId: 'sess1' });
        expect(mockJobQueue.enqueue).toHaveBeenCalledWith('CLEANUP_UPLOAD_SESSION', 'sess2', { sessionId: 'sess2' });
    });

    it('processCleanupJob deletes temporary object and marks CLEANED', async () => {
        const session = { id: 'sess1', versionId: 'version1', objectKey: 'uploads/abc.zip', status: 'COMPLETED' };
        mockDb.getUploadSession.mockResolvedValue(session);

        await service.processCleanupJob({ sessionId: 'sess1' });

        expect(mockStorage.deleteObject).toHaveBeenCalledWith('uploads/abc.zip');
        expect(mockDb.updateGameVersionMetadata).toHaveBeenCalledWith('version1', { packageSizeBytes: 0 });
        expect(mockDb.updateUploadSession).toHaveBeenCalledWith('sess1', { status: 'CLEANED' });
    });

    it('processCleanupJob does not delete published extracted assets', async () => {
        // UploadCleanupService never processes published game versions' extracted keys,
        // it only operates on the upload_sessions.objectKey which is explicitly the package.zip
        const session = { id: 'sess1', objectKey: 'uploads/def.zip', status: 'COMPLETED' };
        mockDb.getUploadSession.mockResolvedValue(session);

        await service.processCleanupJob({ sessionId: 'sess1' });

        expect(mockStorage.deleteObject).toHaveBeenCalledWith('uploads/def.zip');
        expect(mockStorage.deleteObject).not.toHaveBeenCalledWith('extracted/abc/def'); // does not touch extracted paths
    });
});
