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
