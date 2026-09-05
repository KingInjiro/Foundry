import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { R2StorageProvider } from '../../../src/platform/backend/storage/R2StorageProvider.js';

describe('R2StorageProvider', () => {
    it('forwards inclusive byte ranges to object storage', async () => {
        const provider = Object.create(R2StorageProvider.prototype);
        provider.isConfigured = true;
        provider.bucketName = 'games';
        const body = { pipe: vi.fn() };
        provider.client = { send: vi.fn(async () => ({ Body: body })) };

        await expect(provider.getDownloadStream('runtime/data.bin', { start: 10, end: 19 })).resolves.toBe(body);
        const command = provider.client.send.mock.calls[0][0];
        expect(command).toBeInstanceOf(GetObjectCommand);
        expect(command.input).toEqual({
            Bucket: 'games',
            Key: 'runtime/data.bin',
            Range: 'bytes=10-19'
        });
    });

    it('deletes every object under a paginated prefix', async () => {
        const provider = Object.create(R2StorageProvider.prototype);
        provider.isConfigured = true;
        provider.bucketName = 'games';

        let listPage = 0;
        provider.client = {
            send: vi.fn(async command => {
                if (command instanceof ListObjectsV2Command) {
                    listPage += 1;
                    if (listPage === 1) {
                        return {
                            Contents: [{ Key: 'prefix/a.js' }, { Key: 'prefix/b.js' }],
                            IsTruncated: true,
                            NextContinuationToken: 'page-2'
                        };
                    }
                    return {
                        Contents: [{ Key: 'prefix/c.js' }],
                        IsTruncated: false
                    };
                }
                if (command instanceof DeleteObjectsCommand) return {};
                throw new Error('Unexpected command');
            })
        };

        await provider.deletePrefix('prefix/');

        const listCommands = provider.client.send.mock.calls
            .map(([command]) => command)
            .filter(command => command instanceof ListObjectsV2Command);
        const deleteCommands = provider.client.send.mock.calls
            .map(([command]) => command)
            .filter(command => command instanceof DeleteObjectsCommand);

        expect(listCommands).toHaveLength(2);
        expect(listCommands[0].input).toEqual({ Bucket: 'games', Prefix: 'prefix/' });
        expect(listCommands[1].input).toEqual({
            Bucket: 'games',
            Prefix: 'prefix/',
            ContinuationToken: 'page-2'
        });
        expect(deleteCommands).toHaveLength(2);
        expect(deleteCommands[0].input.Delete.Objects).toEqual([{ Key: 'prefix/a.js' }, { Key: 'prefix/b.js' }]);
        expect(deleteCommands[1].input.Delete.Objects).toEqual([{ Key: 'prefix/c.js' }]);
    });

    it('lists a paginated prefix without mutating storage', async () => {
        const provider = Object.create(R2StorageProvider.prototype);
        provider.isConfigured = true;
        provider.bucketName = 'games';
        let page = 0;
        provider.client = { send: vi.fn(async command => {
            expect(command).toBeInstanceOf(ListObjectsV2Command);
            page += 1;
            return page === 1
                ? { Contents: [{ Key: 'games/a', Size: 3, ETag: 'a' }], IsTruncated: true, NextContinuationToken: 'next' }
                : { Contents: [{ Key: 'games/b', Size: 4, ETag: 'b' }], IsTruncated: false };
        }) };

        await expect(provider.listObjects('games/')).resolves.toEqual([
            expect.objectContaining({ key: 'games/a', size: 3, etag: 'a' }),
            expect.objectContaining({ key: 'games/b', size: 4, etag: 'b' })
        ]);
        expect(provider.client.send.mock.calls[1][0].input.ContinuationToken).toBe('next');
    });

    it('refuses prefix deletion when R2 is not configured', async () => {
        const provider = Object.create(R2StorageProvider.prototype);
        provider.isConfigured = false;

        await expect(provider.deletePrefix('prefix/')).rejects.toThrow('R2 is not configured');
    });
});
