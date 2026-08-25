import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UploadCleanupService } from '../../../src/platform/backend/storage/UploadCleanupService.js';

describe('UploadCleanupService', () => {
    let cleanupService;
    let mockDb;
    let mockStorage;

    beforeEach(() => {
        mockDb = {
            getUploadSessionsForCleanup: vi.fn(),
            updateUploadSession: vi.fn(),
            updateGameVersionMetadata: vi.fn()
        };
        mockStorage = {
            deleteObject: vi.fn()
        };
        cleanupService = new UploadCleanupService(mockDb, mockStorage);
    });

    it('cleans up expired sessions', async () => {
        const sessions = [
            { id: 'sess1', versionId: 'v1', objectKey: 'uploads/file1.zip' },
            { id: 'sess2', versionId: 'v2', objectKey: 'uploads/file2.zip' }
        ];
        
        mockDb.getUploadSessionsForCleanup.mockResolvedValue(sessions);

        await cleanupService.runUploadCleanup();

        expect(mockDb.getUploadSessionsForCleanup).toHaveBeenCalled();
        expect(mockStorage.deleteObject).toHaveBeenCalledWith('uploads/file1.zip');
        expect(mockStorage.deleteObject).toHaveBeenCalledWith('uploads/file2.zip');
        expect(mockDb.updateGameVersionMetadata).toHaveBeenCalledWith('v1', { packageSizeBytes: 0 });
        expect(mockDb.updateGameVersionMetadata).toHaveBeenCalledWith('v2', { packageSizeBytes: 0 });
        expect(mockDb.updateUploadSession).toHaveBeenCalledWith('sess1', { status: 'CLEANED' });
        expect(mockDb.updateUploadSession).toHaveBeenCalledWith('sess2', { status: 'CLEANED' });
    });

    it('handles storage errors without crashing', async () => {
        const sessions = [
            { id: 'sess1', objectKey: 'uploads/file1.zip' },
            { id: 'sess2', objectKey: 'uploads/file2.zip' }
        ];
        
        mockDb.getUploadSessionsForCleanup.mockResolvedValue(sessions);
        mockStorage.deleteObject.mockRejectedValueOnce(new Error('Storage failure'));

        await cleanupService.runUploadCleanup();

        expect(mockDb.updateUploadSession).toHaveBeenCalledWith('sess2', { status: 'CLEANED' });
        expect(mockDb.updateUploadSession).not.toHaveBeenCalledWith('sess1', { status: 'CLEANED' });
    });
});
