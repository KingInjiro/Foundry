import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { R2StorageProvider } from '../../../src/platform/backend/storage/R2StorageProvider.js';

describe('R2StorageProvider', () => {
    it.each(['', '/', '////', '.', '..', '/games/', 'games/../', 'games//', 'games\\bad', 'games/\u0000'])('refuses unsafe list/delete prefix %j before S3 calls', async prefix => {
        const provider = Object.create(R2StorageProvider.prototype);
        provider.isConfigured = true;
        provider.client = { send: vi.fn() };
        await expect(provider.listObjects(prefix)).rejects.toThrow('unsafe R2 prefix');
        await expect(provider.deletePrefix(prefix)).rejects.toThrow('unsafe R2 prefix');
        expect(provider.client.send).not.toHaveBeenCalled();
    });

    it('fails closed on incomplete pagination and does not delete out-of-prefix keys', async () => {
        const provider = Object.create(R2StorageProvider.prototype);
        provider.isConfigured = true;
        provider.client = { send: vi.fn(async () => ({ IsTruncated: true, Contents: [] })) };
        await expect(provider.listObjects('games/')).rejects.toThrow('pagination');
        provider.client.send.mockResolvedValue({ Contents: [{ Key: 'other-tenant/object' }], IsTruncated: false });
        await expect(provider.deletePrefix('games/one')).rejects.toThrow('escaped');
        expect(provider.client.send.mock.calls.every(([command]) => command instanceof ListObjectsV2Command)).toBe(true);
        provider.client.send.mockResolvedValue({ IsTruncated: true, NextContinuationToken: 'same', Contents: [] });
        await expect(provider.listObjects('games/')).rejects.toThrow('repeated');
    });

    it('preserves operational failures and not-found semantics without exposing SDK request credentials', async () => {
        const provider = Object.create(R2StorageProvider.prototype);
        provider.isConfigured = true;
        const secret = 'test-only-sensitive-request-detail';
        provider.client = { send: vi.fn(async () => { throw Object.assign(new Error(secret), { $metadata: { httpStatusCode: 403 } }); }) };
        await expect(provider.ping()).rejects.toMatchObject({ code: 'R2_STORAGE_FAILED', message: 'R2 storage operation failed (HTTP 403).' });
        provider.client.send.mockRejectedValue(Object.assign(new Error(secret), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }));
        await expect(provider.getObjectMetadata('games/a')).rejects.toMatchObject({ name: 'NotFound', $metadata: { httpStatusCode: 404 } });
    });

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
