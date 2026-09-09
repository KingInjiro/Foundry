import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { FileBackedZip } from '../../../src/platform/backend/validation/FileBackedZip.js';
import { R2PackageSource } from '../../../src/platform/backend/validation/R2PackageSource.js';
import { GamePackageValidator, MAX_MANIFEST_BYTES } from '../../../src/platform/backend/validation/GamePackageValidator.js';
import { GamePackageExtractor } from '../../../src/platform/backend/extraction/GamePackageExtractor.js';
import { QuotaConfig } from '../../../src/platform/backend/config/quotas.js';

const manifest = {
    version: 1, format: 'web-game', gameId: 'bounded', gameVersion: '1.0.0',
    name: 'Bounded ZIP', runtime: 'web', entry: 'index.html'
};
const sha256 = bytes => `sha256-${crypto.createHash('sha256').update(bytes).digest('hex')}`;

async function zipBytes(files) {
    const zip = new JSZip();
    for (const [name, contents] of Object.entries(files)) zip.file(name, contents, { createFolders: false });
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Alter real central-directory bytes, not a mocked parser or private JSZip object.
function alterDirectory(buffer, edit) {
    const eocd = buffer.length - 22;
    let cursor = buffer.readUInt32LE(eocd + 16);
    const count = buffer.readUInt16LE(eocd + 10);
    for (let i = 0; i < count; i++) {
        expect(buffer.readUInt32LE(cursor)).toBe(0x02014b50);
        const length = buffer.readUInt16LE(cursor + 28);
        const filename = buffer.toString('utf8', cursor + 46, cursor + 46 + length);
        edit(buffer, cursor, filename);
        cursor += 46 + length + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
    }
    return buffer;
}

function storageFor(buffer, advertisedBytes = buffer.length) {
    const objects = new Map();
    return {
        objects,
        getObjectMetadata: vi.fn(async () => ({ contentLength: advertisedBytes })),
        getDownloadStream: vi.fn(async () => Readable.from((function* () {
            for (let offset = 0; offset < buffer.length; offset += 97) yield buffer.subarray(offset, offset + 97);
        })())),
        uploadBuffer: vi.fn(async (key, data) => { objects.set(key, Buffer.from(data)); }),
        deleteObject: vi.fn(async key => { objects.delete(key); }),
        deletePrefix: vi.fn(async prefix => {
            for (const key of objects.keys()) if (key.startsWith(prefix)) objects.delete(key);
        })
    };
}

describe('Bounded server ZIP processing', () => {
    let tempRoot;
    let originalQuotas;
    const openSources = [];

    beforeEach(async () => {
        originalQuotas = { ...QuotaConfig };
        tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'foundry-bounded-zip-test-'));
        vi.spyOn(os, 'tmpdir').mockReturnValue(tempRoot);
    });

    afterEach(async () => {
        for (const source of openSources.splice(0)) await source.cleanup();
        // Every success/error path must close its archive and remove its temporary ZIP.
        expect(await fs.promises.readdir(tempRoot)).toEqual([]);
        vi.restoreAllMocks();
        Object.assign(QuotaConfig, originalQuotas);
        await fs.promises.rm(tempRoot, { recursive: true, force: true });
    });

    const sourceFor = storage => {
        const source = new R2PackageSource(storage, 'package.zip');
        openSources.push(source);
        return source;
    };

    it('validates and extracts a normal ZIP without fs.readFile or JSZip.loadAsync', async () => {
        const buffer = await zipBytes({ 'manifest.json': JSON.stringify(manifest), 'index.html': '<main>Ready</main>' });
        const storage = storageFor(buffer);
        vi.spyOn(fs.promises, 'readFile').mockImplementation(() => { throw new Error('Whole-file allocation forbidden'); });
        vi.spyOn(JSZip, 'loadAsync').mockImplementation(() => { throw new Error('In-memory ZIP parser forbidden'); });
        const source = sourceFor(storage);
        expect(await new GamePackageValidator().validate(source)).toMatchObject({ valid: true, errors: [] });
        expect(await source.getPackageSha256()).toBe(sha256(buffer));
        await source.cleanup();
        const result = await new GamePackageExtractor(storage).extractPackage('g', 'v', 'package.zip', 'index.html');
        expect(result).toMatchObject({ success: true, extractedCount: 2, packageSizeBytes: buffer.length });
        expect(storage.objects.get('games/g/versions/v/extracted/index.html').toString()).toBe('<main>Ready</main>');
    });

    it('rejects an advertised ZIP over the package limit before starting a download', async () => {
        const storage = storageFor(Buffer.alloc(0), QuotaConfig.PLATFORM_MAX_PACKAGE_SIZE_BYTES + 1);
        await expect(sourceFor(storage).init()).rejects.toMatchObject({ code: 'PACKAGE_SIZE_EXCEEDED' });
        expect(storage.getDownloadStream).not.toHaveBeenCalled();
    });

    it.each([false, true])('bounds actual download bytes when metadata lies (expected size: %s)', async expected => {
        const buffer = await zipBytes({ 'index.html': 'hello' });
        const storage = storageFor(buffer, buffer.length - 1);
        const stream = await storage.getDownloadStream();
        storage.getDownloadStream.mockResolvedValue(stream);
        await expect(FileBackedZip.download(storage, 'package.zip', expected ? { expectedPackageSizeBytes: buffer.length - 1 } : {}))
            .rejects.toMatchObject({ code: expected ? 'PACKAGE_CHANGED_AFTER_VALIDATION' : 'UPLOAD_SIZE_MISMATCH' });
        expect(stream.destroyed).toBe(true);
    });

    it('enforces the hard package limit in the stream even when metadata advertises the maximum', async () => {
        QuotaConfig.PLATFORM_MAX_PACKAGE_SIZE_BYTES = 100;
        const storage = storageFor(Buffer.alloc(1000), 100);
        await expect(sourceFor(storage).init()).rejects.toMatchObject({ code: 'PACKAGE_SIZE_EXCEEDED' });
    });

    it('rejects truncated downloads before ZIP parsing', async () => {
        const storage = storageFor(Buffer.alloc(20), 100);
        await expect(sourceFor(storage).init()).rejects.toMatchObject({ code: 'UPLOAD_SIZE_MISMATCH' });
    });

    it.each(['PLATFORM_MAX_FILES_PER_PACKAGE', 'PLATFORM_MAX_EXTRACTED_FILES_PER_PACKAGE'])('enforces %s', async quota => {
        QuotaConfig[quota] = 2;
        const storage = storageFor(await zipBytes({ a: '1', b: '2', c: '3' }));
        const operation = quota === 'PLATFORM_MAX_FILES_PER_PACKAGE'
            ? sourceFor(storage).init()
            : new GamePackageExtractor(storage).extractPackage('g', 'v', 'package.zip');
        await expect(operation).rejects.toMatchObject({ code: 'TOO_MANY_FILES' });
        expect(storage.uploadBuffer).not.toHaveBeenCalled();
    });

    it('rejects an oversized compressed file before decompression', async () => {
        QuotaConfig.PLATFORM_MAX_FILE_SIZE_BYTES = 1024;
        const storage = storageFor(await zipBytes({ 'large.bin': Buffer.alloc(1025) }));
        await expect(sourceFor(storage).init()).rejects.toMatchObject({ code: 'FILE_SIZE_EXCEEDED' });
    });

    it('rejects total extracted size overflow with individually valid files', async () => {
        QuotaConfig.PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES = 1024;
        const storage = storageFor(await zipBytes({ a: Buffer.alloc(600), b: Buffer.alloc(600) }));
        await expect(new GamePackageExtractor(storage).extractPackage('g', 'v', 'package.zip'))
            .rejects.toMatchObject({ code: 'EXTRACTED_SIZE_EXCEEDED' });
        expect(storage.uploadBuffer).not.toHaveBeenCalled();
    });

    it('enforces the actual file byte limit during inflation even when its declared size is small', async () => {
        QuotaConfig.PLATFORM_MAX_FILE_SIZE_BYTES = 1024;
        const buffer = alterDirectory(await zipBytes({ 'bomb.bin': Buffer.alloc(4096) }), (data, cursor) => {
            data.writeUInt32LE(8, cursor + 24);
        });
        await expect(sourceFor(storageFor(buffer)).readFile('bomb.bin')).rejects.toMatchObject({ code: 'FILE_SIZE_EXCEEDED' });
    });

    it.each(['manifest.json', 'streaming-manifest.json', 'foundry-streaming.json'])('bounds highly compressed %s before string decoding', async filename => {
        const limit = filename === 'manifest.json' ? MAX_MANIFEST_BYTES : QuotaConfig.PLATFORM_MAX_FILE_SIZE_BYTES;
        const buffer = await zipBytes({ [filename]: ' '.repeat(limit + 1) });
        expect(buffer.length).toBeLessThan(limit / 10);
        const source = sourceFor(storageFor(buffer));
        const result = await new GamePackageValidator().validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors[0].code).toBe(filename === 'manifest.json' ? 'MANIFEST_TOO_LARGE' : 'STREAMING_MANIFEST_LIMIT_EXCEEDED');
    });

    it.each(['manifest.json', 'streaming-manifest.json'])('stops decompression of %s with a forged small declared size', async filename => {
        const buffer = alterDirectory(await zipBytes({ [filename]: ' '.repeat(MAX_MANIFEST_BYTES * 4) }), (data, cursor) => {
            data.writeUInt32LE(8, cursor + 24);
        });
        const source = sourceFor(storageFor(buffer));
        await expect(filename === 'manifest.json' ? source.readManifest() : source.readStreamingManifest(filename))
            .rejects.toThrow(/too many bytes|size/i);
        // read errors clean themselves up, without relying on the caller's finally.
        expect(await fs.promises.readdir(tempRoot)).toEqual([]);
    });

    it('rejects actual decompressed bytes exceeding declared total and removes earlier extracted objects', async () => {
        QuotaConfig.PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES = 1024;
        const buffer = alterDirectory(await zipBytes({ 'index.html': 'hello', 'bomb.bin': Buffer.alloc(4096) }), (data, cursor, name) => {
            if (name === 'bomb.bin') data.writeUInt32LE(8, cursor + 24);
        });
        const storage = storageFor(buffer);
        await expect(new GamePackageExtractor(storage).extractPackage('g', 'v', 'package.zip', 'index.html'))
            .rejects.toMatchObject({ code: 'EXTRACTED_SIZE_EXCEEDED' });
        expect(storage.uploadBuffer).toHaveBeenCalledTimes(1);
        expect(storage.deleteObject).toHaveBeenCalledWith('games/g/versions/v/extracted/index.html');
        expect(storage.objects.size).toBe(0);
    });

    it.each(['../escape', '/etc/passwd', 'dir\\file', 'dir/%2e%2e/file', 'dir/CON.txt', 'dir//file'])('rejects unsafe ZIP path %s without normalization', async filename => {
        const source = sourceFor(storageFor(await zipBytes({ [filename]: 'unsafe' })));
        const result = await new GamePackageValidator().validate(source);
        expect(result.errors[0].code).toBe('UNSAFE_FILE_PATH');
    });

    it.each([
        ['File.txt', 'file.txt'], ['folder', 'folder/child'], ['caf\u00e9.txt', 'cafe\u0301.txt']
    ])('rejects conflicting archive paths %s / %s', async (first, second) => {
        const storage = storageFor(await zipBytes({ [first]: 'first', [second]: 'second' }));
        await expect(sourceFor(storage).init()).rejects.toMatchObject({ code: 'CASE_COLLIDING_PATH' });
    });

    it('rejects identical duplicate names that an object-map ZIP parser would overwrite', async () => {
        const buffer = alterDirectory(await zipBytes({ 'same.txt': 'first', 'next.txt': 'second' }), (data, cursor, name) => {
            if (name === 'next.txt') data.write('same.txt', cursor + 46, 'utf8');
        });
        await expect(sourceFor(storageFor(buffer)).init()).rejects.toMatchObject({ code: 'CASE_COLLIDING_PATH' });
    });

    it('rechecks the streaming package SHA before extraction after a same-size replacement', async () => {
        const original = await zipBytes({ 'manifest.json': JSON.stringify(manifest), 'index.html': 'AAAA' });
        const replacement = await zipBytes({ 'manifest.json': JSON.stringify(manifest), 'index.html': 'BBBB' });
        expect(replacement.length).toBe(original.length);
        const source = sourceFor(storageFor(original));
        expect((await new GamePackageValidator().validate(source)).valid).toBe(true);
        const expectedPackageSha256 = await source.getPackageSha256();
        await source.cleanup();
        const storage = storageFor(replacement);
        await expect(new GamePackageExtractor(storage).extractPackage('g', 'v', 'package.zip', 'index.html', null, {
            expectedPackageSha256, expectedPackageSizeBytes: original.length
        })).rejects.toMatchObject({ code: 'PACKAGE_CHANGED_AFTER_VALIDATION' });
        expect(storage.uploadBuffer).not.toHaveBeenCalled();
    });

    it('removes the current attempted write too when storage persists an object and then rejects', async () => {
        const storage = storageFor(await zipBytes({ 'index.html': 'ok', 'second.bin': 'fail' }));
        storage.uploadBuffer.mockImplementation(async (key, data) => {
            storage.objects.set(key, data);
            if (key.endsWith('second.bin')) throw new Error('Storage acknowledgement failed');
        });
        await expect(new GamePackageExtractor(storage).extractPackage('g', 'v', 'package.zip', 'index.html'))
            .rejects.toThrow('Storage acknowledgement failed');
        expect(storage.deleteObject).toHaveBeenCalledTimes(2);
        expect(storage.objects.size).toBe(0);
    });

    it('cleans up a malformed archive', async () => {
        await expect(sourceFor(storageFor(Buffer.from('not a zip'))).init()).rejects.toThrow();
    });

    it('cleans up an interrupted download and destroys its input stream', async () => {
        const storage = storageFor(Buffer.alloc(100));
        const controller = new AbortController();
        const stream = Readable.from((async function* () {
            yield Buffer.alloc(10);
            controller.abort();
            yield Buffer.alloc(10);
        })());
        storage.getDownloadStream.mockResolvedValue(stream);
        await expect(FileBackedZip.download(storage, 'package.zip', { signal: controller.signal }))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(stream.destroyed).toBe(true);
    });

    it('cleans up an aborted extraction and its already uploaded objects', async () => {
        const storage = storageFor(await zipBytes({ 'index.html': 'hello', 'second.bin': 'next' }));
        const controller = new AbortController();
        storage.uploadBuffer.mockImplementation(async (key, data) => {
            storage.objects.set(key, data);
            controller.abort();
        });
        await expect(new GamePackageExtractor(storage).extractPackage('g', 'v', 'package.zip', 'index.html', null, {
            signal: controller.signal
        })).rejects.toMatchObject({ name: 'AbortError' });
        expect(storage.objects.size).toBe(0);
    });

    it('destroys the active ZIP entry stream on abort during decompression', async () => {
        const controller = new AbortController();
        const archive = await FileBackedZip.download(storageFor(await zipBytes({ 'asset.bin': Buffer.alloc(1024 * 1024) })),
            'package.zip', { signal: controller.signal });
        openSources.push(archive);
        const open = archive.zip.openReadStreamPromise.bind(archive.zip);
        let entryStream;
        vi.spyOn(archive.zip, 'openReadStreamPromise').mockImplementation(async (...args) => {
            entryStream = await open(...args);
            entryStream.once('data', () => controller.abort());
            return entryStream;
        });
        await expect(archive.readFile('asset.bin')).rejects.toMatchObject({ name: 'AbortError' });
        expect(entryStream.destroyed).toBe(true);
        await archive.cleanup();
        expect(await fs.promises.readdir(tempRoot)).toEqual([]);
    });
});
