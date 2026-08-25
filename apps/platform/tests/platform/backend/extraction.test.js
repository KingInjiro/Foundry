import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GamePackageExtractor } from '../../../src/platform/backend/extraction/GamePackageExtractor.js';
import JSZip from 'jszip';

describe('GamePackageExtractor', () => {
    let mockStorage;
    let extractor;

    beforeEach(() => {
        mockStorage = {
            getObjectMetadata: vi.fn().mockResolvedValue({ contentLength: 1024 }),
            getDownloadStream: vi.fn(),
            uploadBuffer: vi.fn().mockResolvedValue(),
            deleteObject: vi.fn().mockResolvedValue()
        };
        extractor = new GamePackageExtractor(mockStorage);
    });

    const createZipBuffer = async (files) => {
        const zip = new JSZip();
        for (const [name, content] of Object.entries(files)) {
            zip.file(name, content);
        }
        return await zip.generateAsync({ type: 'nodebuffer' });
    };

    const setupMockZip = async (files) => {
        const buffer = await createZipBuffer(files);
        const { Readable } = await import('stream');
        mockStorage.getDownloadStream.mockResolvedValue(Readable.from(buffer));
    };

    it('identifies unsafe paths', () => {
        expect(extractor.isUnsafePath('../outside.js')).toBe(true);
        expect(extractor.isUnsafePath('dir/../../outside.js')).toBe(true);
        expect(extractor.isUnsafePath('/etc/passwd')).toBe(true);
        expect(extractor.isUnsafePath('\\windows')).toBe(true);
        expect(extractor.isUnsafePath('C:\\windows')).toBe(true);
        expect(extractor.isUnsafePath('good.js')).toBe(false);
        expect(extractor.isUnsafePath('dir/good.js')).toBe(false);
    });

    it('rejects missing entry point', async () => {
        await setupMockZip({
            'not_index.html': 'hello'
        });
        await expect(extractor.extractPackage('game1', 'v1', 'key1', 'index.html')).rejects.toThrow(/Entry file "index.html" is missing/);
    });

    it('rejects paths that only differ by letter case', async () => {
        await setupMockZip({
            'index.html': 'hello',
            'Assets/hero.png': 'first',
            'assets/HERO.png': 'second'
        });
        await expect(extractor.extractPackage('game1', 'v1', 'key1', 'index.html')).rejects.toThrow(/Duplicate or conflicting path/);
    });

    it('successfully extracts valid package', async () => {
        await setupMockZip({
            'index.html': 'hello',
            'game.js': 'console.log(1)'
        });
        const result = await extractor.extractPackage('game1', 'v1', 'key1', 'index.html');
        expect(result.success).toBe(true);
        expect(mockStorage.uploadBuffer).toHaveBeenCalledTimes(2);
        expect(mockStorage.uploadBuffer).toHaveBeenCalledWith(
            'games/game1/versions/v1/extracted/index.html',
            expect.anything(),
            'text/html',
            { cacheControl: 'public, max-age=31536000, immutable' }
        );
    });

    it('cleans partial extraction when the remaining developer quota is exceeded', async () => {
        await setupMockZip({
            'index.html': 'hello',
            'game.js': 'console.log(1)'
        });

        await expect(extractor.extractPackage(
            'game1',
            'v1',
            'key1',
            'index.html',
            null,
            { maxExtractedSizeBytes: 6 }
        )).rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' });
        expect(mockStorage.uploadBuffer).not.toHaveBeenCalled();
        expect(mockStorage.deleteObject).not.toHaveBeenCalled();
    });
});
