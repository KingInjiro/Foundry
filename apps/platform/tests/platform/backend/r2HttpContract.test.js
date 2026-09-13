import { describe, expect, it } from 'vitest';
import { controlledR2 } from '../../helpers/controlledR2.mjs';

describe('R2 signed upload HTTP contract', () => {
    it('uploads non-empty bytes without signing a fictitious empty-body checksum and rejects changed content type/signature', async () => {
        const f = await controlledR2();
        try {
            const body = Buffer.from('non-empty package bytes');
            const { uploadUrl } = await f.storage.createUploadSession('games/one/package.zip');
            expect((await f.putSigned(uploadUrl, body)).status).toBe(200);
            const url = new URL(uploadUrl);
            expect(url.searchParams.has('x-amz-checksum-crc32')).toBe(false);
            expect((await f.putSigned(uploadUrl, body, 'text/plain')).status).toBe(403);
            url.searchParams.set('X-Amz-Signature', '0'.repeat(64));
            expect((await f.putSigned(url.href, body)).status).toBe(403);
            expect((await f.storage.getObjectMetadata('games/one/package.zip')).contentLength).toBe(body.length);
            const chunks = [];
            for await (const chunk of await f.storage.getDownloadStream('games/one/package.zip', { start: 0, end: 8 })) chunks.push(chunk);
            expect(Buffer.concat(chunks)).toEqual(body.subarray(0, 9));
            await f.storage.uploadBuffer('games/one/extracted/data', body, 'text/plain');
            await f.storage.deletePrefix('games/one');
            expect(f.objects.size).toBe(0);
        } finally { await f.close(); }
    });
});
