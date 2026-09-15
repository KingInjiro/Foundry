/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../../src/platform/api/apiClient.js';
import { uploadPackageToPlatform } from '../../../src/platform/developer/platformUploadService.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('unchanged upload transports', () => {
    it.each(['/api/local-storage/upload/session?signature=local', 'https://bucket.account.r2.cloudflarestorage.com/game.zip?X-Amz-Signature=controlled'])('sends the original File by ZIP PUT to %s and completes the same session', async uploadUrl => {
        const requests = [];
        class TestRequest extends EventTarget {
            constructor() { super(); this.upload = new EventTarget(); this.headers = {}; requests.push(this); }
            open(method, url) { this.method = method; this.url = url; }
            setRequestHeader(name, value) { this.headers[name] = value; }
            send(file) { this.body = file; this.status = 200; queueMicrotask(() => this.dispatchEvent(new Event('load'))); }
        }
        vi.stubGlobal('XMLHttpRequest', TestRequest);
        const file = new File(['small fixture'], 'game.zip', { type: 'application/zip' });
        Object.defineProperty(file, 'size', { value: 128 * 1024 * 1024 });
        const post = vi.spyOn(apiClient.json, 'post').mockImplementation(async endpoint => {
            if (endpoint === '/api/games/project/versions') return { sessionId: 'session', versionId: 'version', uploadUrl };
            if (endpoint === '/api/uploads/session/complete') return { status: 'READY' };
            throw new Error(`Unexpected request: ${endpoint}`);
        });
        const result = await uploadPackageToPlatform({ file, gameId: 'project', manifest: { name: 'Test' } });
        expect(post).toHaveBeenCalledTimes(2);
        expect(post).toHaveBeenCalledWith('/api/games/project/versions', { expectedSize: file.size }, { signal: undefined });
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('PUT');
        expect(requests[0].url).toBe(uploadUrl);
        expect(requests[0].body).toBe(file);
        expect(requests[0].headers).toEqual({ 'Content-Type': 'application/zip' });
        expect(requests[0].withCredentials).toBeUndefined();
        expect(result).toMatchObject({ gameId: 'project', sessionId: 'session', versionId: 'version', status: 'READY' });
    });
});
