import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { validatePackageOffMainThread } from '../../../src/platform/developer/packageValidationClient.js';

const limits = { maxPackageSizeBytes: 2147483648, maxFileSizeBytes: 2147483648,
    maxTotalExtractedSizeBytes: 4294967296, maxFilesPerPackage: 1000, maxExtractedFilesPerPackage: 1000 };

class TestWorker extends EventTarget {
    constructor() { super(); TestWorker.instance = this; }
    terminate = vi.fn();
    postMessage(message) { this.message = message; }
}

afterEach(() => vi.unstubAllGlobals());

describe('package validation runtime configuration', () => {
    it('requires complete numeric runtime limits before creating a worker', async () => {
        const worker = vi.fn();
        vi.stubGlobal('Worker', worker);
        await expect(validatePackageOffMainThread({ size: 100 })).rejects.toThrow('invalid upload limits');
        expect(worker).not.toHaveBeenCalled();
    });

    it('passes the server quotas to the worker and releases it after validation', async () => {
        vi.stubGlobal('Worker', TestWorker);
        const file = { size: 128 * 1024 * 1024 };
        const result = validatePackageOffMainThread(file, { limits });
        const worker = TestWorker.instance;
        expect(worker.message).toMatchObject({ file, limits });
        worker.dispatchEvent(new MessageEvent('message', { data: { requestId: worker.message.requestId, result: { valid: true } } }));
        await expect(result).resolves.toEqual({ valid: true });
        expect(worker.terminate).toHaveBeenCalledOnce();
    });

    it('terminates a cancelled worker so closing the dialog releases its archive memory', async () => {
        vi.stubGlobal('Worker', TestWorker);
        const controller = new AbortController();
        const result = validatePackageOffMainThread({ size: 128 * 1024 * 1024 }, { limits, signal: controller.signal });
        controller.abort();
        await expect(result).rejects.toMatchObject({ name: 'AbortError' });
        expect(TestWorker.instance.terminate).toHaveBeenCalledOnce();
    });

    it.each(['maxFilesPerPackage', 'maxExtractedFilesPerPackage', 'maxFileSizeBytes', 'maxTotalExtractedSizeBytes'])('uses runtime %s in the direct fallback without changing package validation', async field => {
        vi.stubGlobal('Worker', undefined);
        const chunk = 'streamed bytes';
        const zip = new JSZip();
        zip.file('manifest.json', JSON.stringify({ version: 1, format: 'foundry-game', gameId: 'runtime-limits',
            gameVersion: '1.0.0', name: 'Runtime Limits', runtime: 'foundry', engineVersion: '1.0.0', entry: 'game.js' }));
        zip.file('game.js', 'console.log("ready")');
        zip.file('chunk.json', chunk);
        zip.file('streaming-manifest.json', JSON.stringify({ schemaVersion: 1, runtime: { entry: 'game.js' }, chunks: [{
            id: 'boot', url: 'chunk.json', size: Buffer.byteLength(chunk),
            hash: `sha256-${createHash('sha256').update(chunk).digest('hex')}`, dependencies: [], priority: 'critical', preload: true
        }] }));
        const file = await zip.generateAsync({ type: 'nodebuffer' });
        const rejected = await validatePackageOffMainThread(file, { limits: { ...limits, [field]: 0 } });
        expect(rejected.valid).toBe(false);
        expect(rejected.errors.some(error => ['TOO_MANY_FILES', 'STREAMING_MANIFEST_LIMIT_EXCEEDED'].includes(error.code))).toBe(true);
        const accepted = await validatePackageOffMainThread(file, { limits });
        expect(accepted.valid).toBe(true);
        expect(accepted.streamingManifestPath).toBe('streaming-manifest.json');
    });
});
