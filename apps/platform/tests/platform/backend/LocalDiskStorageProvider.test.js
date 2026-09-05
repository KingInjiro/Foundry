import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalDiskStorageProvider } from '../../../src/platform/backend/storage/LocalDiskStorageProvider.js';

const temporaryDirectories = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function createProvider() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-local-storage-'));
    temporaryDirectories.push(directory);
    return { directory, provider: new LocalDiskStorageProvider(directory) };
}

async function readStream(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

describe('LocalDiskStorageProvider', () => {
    it('stores and removes objects only inside its configured root', async () => {
        const { directory, provider } = createProvider();

        await provider.uploadBuffer('games/game-1/index.html', Buffer.from('ready'));
        expect(fs.readFileSync(path.join(directory, 'games/game-1/index.html'), 'utf8')).toBe('ready');

        await provider.deletePrefix('games/game-1');
        expect(fs.existsSync(path.join(directory, 'games/game-1'))).toBe(false);
    });

    it('streams an inclusive byte range for runtime asset delivery', async () => {
        const { provider } = createProvider();
        await provider.uploadBuffer('games/game-1/data.bin', Buffer.from('0123456789'));

        const stream = await provider.getDownloadStream('games/game-1/data.bin', { start: 2, end: 5 });
        expect((await readStream(stream)).toString()).toBe('2345');
    });

    it('lists objects recursively beneath a safe prefix', async () => {
        const { provider } = createProvider();
        await provider.uploadBuffer('games/game-1/index.html', Buffer.from('ready'));
        await provider.uploadBuffer('games/game-1/assets/data.bin', Buffer.from('data'));

        await expect(provider.listObjects('games/')).resolves.toEqual([
            expect.objectContaining({ key: 'games/game-1/assets/data.bin', size: 4 }),
            expect.objectContaining({ key: 'games/game-1/index.html', size: 5 })
        ]);
    });

    it('issues bounded same-origin signed upload URLs in production mode', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-local-storage-'));
        temporaryDirectories.push(directory);
        const now = 1_800_000_000_000;
        const provider = new LocalDiskStorageProvider(directory, '/api/storage/upload', {
            uploadSigningSecret: 'storage-signing-secret-with-more-than-32-bytes',
            uploadUrlTtlSeconds: 600,
            now: () => now
        });

        const { uploadUrl } = await provider.createUploadSession('games/game-1/package.zip');
        expect(uploadUrl.startsWith('/api/storage/upload?')).toBe(true);
        const parsed = new URL(uploadUrl, 'https://foundry.example.test');
        const request = {
            objectKey: parsed.searchParams.get('key'),
            contentType: parsed.searchParams.get('contentType'),
            expires: parsed.searchParams.get('expires'),
            signature: parsed.searchParams.get('signature')
        };
        expect(provider.verifyUploadRequest(request)).toBe(true);
        expect(provider.verifyUploadRequest({ ...request, objectKey: 'games/other/package.zip' })).toBe(false);
        provider.now = () => now + 601_000;
        expect(provider.verifyUploadRequest(request)).toBe(false);
    });

    it('publishes writes by atomic rename and leaves no partial upload file', async () => {
        const { directory, provider } = createProvider();
        fs.rmSync(path.join(directory, '.tmp'), { recursive: true, force: true });
        await provider.uploadBuffer('games/game-1/package.zip', Buffer.from('first'));
        await provider.uploadBuffer('games/game-1/package.zip', Buffer.from('second'));

        expect(fs.readFileSync(path.join(directory, 'games/game-1/package.zip'), 'utf8')).toBe('second');
        expect(fs.readdirSync(path.join(directory, '.tmp'))).toEqual([]);
    });

    it('does not follow symbolic links while listing the object tree', async () => {
        const { directory, provider } = createProvider();
        const outside = path.join(directory, '..', `foundry-outside-${Date.now()}.txt`);
        fs.writeFileSync(outside, 'outside');
        try {
            fs.mkdirSync(path.join(directory, 'games'), { recursive: true });
            fs.symlinkSync(outside, path.join(directory, 'games', 'escape'));
            await expect(provider.listObjects('games/')).rejects.toThrow('symbolic link');
        } finally {
            fs.rmSync(outside, { force: true });
        }
    });

    it.each([
        '../outside.txt',
        'games/../../outside.txt',
        '/absolute.txt',
        'C:\\absolute.txt',
        'games\\..\\outside.txt',
        'games//empty.txt'
    ])('rejects unsafe object key %s', async objectKey => {
        const { provider } = createProvider();

        await expect(provider.uploadBuffer(objectKey, Buffer.from('blocked')))
            .rejects.toThrow('Invalid local storage object key');
    });
});
