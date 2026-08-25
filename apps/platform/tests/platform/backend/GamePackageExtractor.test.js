import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GamePackageExtractor } from '../../../src/platform/backend/extraction/GamePackageExtractor.js';
import JSZip from 'jszip';
import { Readable } from 'stream';
import { QuotaConfig } from '../../../src/platform/backend/config/quotas.js';

describe('GamePackageExtractor', () => {
    let extractor;
    let mockStorage;

    beforeEach(() => {
        mockStorage = {
            getObjectMetadata: vi.fn(),
            getDownloadStream: vi.fn(),
            uploadBuffer: vi.fn()
        };
        extractor = new GamePackageExtractor(mockStorage);
    });

    it('rejects path traversal attacks', async () => {
        const zip = new JSZip();
        zip.file("../secret.txt", "hacked");
        const zipBuffer = Buffer.from('mock');

        mockStorage.getObjectMetadata.mockResolvedValue({ contentLength: zipBuffer.length });
        
        mockStorage.getDownloadStream.mockResolvedValue(Readable.from(zipBuffer));
        vi.spyOn(JSZip, 'loadAsync').mockResolvedValue(zip);


        await expect(extractor.extractPackage('game1', 'ver1', 'objkey')).rejects.toThrow(/Unsafe path/);
    });

    it('rejects absolute paths', async () => {
        const zip = new JSZip();
        zip.file("/etc/passwd", "hacked");
        const zipBuffer = Buffer.from('mock');

        mockStorage.getObjectMetadata.mockResolvedValue({ contentLength: zipBuffer.length });
        
        mockStorage.getDownloadStream.mockResolvedValue(Readable.from(zipBuffer));
        vi.spyOn(JSZip, 'loadAsync').mockResolvedValue(zip);


        await expect(extractor.extractPackage('game1', 'ver1', 'objkey')).rejects.toThrow(/Unsafe path/);
    });

    it('rejects a declared ZIP bomb size before decompressing the entry', async () => {
        const zip = new JSZip();
        zip.file('index.html', '<h1>Safe entry</h1>');
        zip.file('bomb.bin', 'compressed');
        zip.files['bomb.bin']._data = {
            uncompressedSize: QuotaConfig.PLATFORM_MAX_FILE_SIZE_BYTES + 1
        };
        const zipBuffer = Buffer.from('mock');

        mockStorage.getObjectMetadata.mockResolvedValue({ contentLength: zipBuffer.length });
        mockStorage.getDownloadStream.mockResolvedValue(Readable.from(zipBuffer));
        vi.spyOn(JSZip, 'loadAsync').mockResolvedValue(zip);

        await expect(extractor.extractPackage('game1', 'ver1', 'objkey', 'index.html'))
            .rejects.toMatchObject({ code: 'FILE_SIZE_EXCEEDED' });
        expect(mockStorage.uploadBuffer).not.toHaveBeenCalled();
    });

    it('successfully extracts a safe package', async () => {
        const zip = new JSZip();
        zip.file("index.html", "<h1>Hello</h1>");
        zip.file("assets/img.png", "fakeimage");
        const zipBuffer = Buffer.from('mock');

        mockStorage.getObjectMetadata.mockResolvedValue({ contentLength: zipBuffer.length });
        
        mockStorage.getDownloadStream.mockResolvedValue(Readable.from(zipBuffer));
        vi.spyOn(JSZip, 'loadAsync').mockResolvedValue(zip);


        const result = await extractor.extractPackage('game1', 'ver1', 'objkey');
        expect(result.success).toBe(true);
        expect(result.extractedCount).toBe(2);
        
        expect(mockStorage.uploadBuffer).toHaveBeenCalledTimes(2);
    });
});
