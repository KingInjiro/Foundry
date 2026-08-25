import { describe, expect, it, vi } from 'vitest';
import { UploadCancelledError, uploadFileWithProgress } from '../../../src/platform/developer/uploadFileWithProgress.js';

class TestRequest {
    constructor() {
        this.listeners = new Map();
        this.upload = {
            addEventListener: (type, listener) => this.uploadListener = { type, listener }
        };
        TestRequest.instance = this;
    }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.header = [name, value]; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    send(file) { this.file = file; }
    abort() { this.listeners.get('abort')?.(); }
    emit(type) { this.listeners.get(type)?.(); }
}

describe('uploadFileWithProgress', () => {
    it('reports progress and resolves only after a successful PUT response', async () => {
        const onProgress = vi.fn();
        const promise = uploadFileWithProgress({
            url: 'https://upload.test/signed',
            file: { size: 200 },
            onProgress,
            XMLHttpRequestImpl: TestRequest
        });
        TestRequest.instance.uploadListener.listener({ lengthComputable: true, loaded: 50, total: 200 });
        TestRequest.instance.status = 200;
        TestRequest.instance.emit('load');

        await expect(promise).resolves.toEqual({ status: 200 });
        expect(onProgress).toHaveBeenCalledWith({ loaded: 50, total: 200, percentage: 25 });
        expect(TestRequest.instance.method).toBe('PUT');
    });

    it('aborts the request through AbortSignal and keeps cancellation distinguishable', async () => {
        const controller = new AbortController();
        const promise = uploadFileWithProgress({
            url: 'https://upload.test/signed',
            file: { size: 10 },
            signal: controller.signal,
            XMLHttpRequestImpl: TestRequest
        });
        controller.abort();
        await expect(promise).rejects.toBeInstanceOf(UploadCancelledError);
    });
});
