/** @vitest-environment jsdom */
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import JSZip from 'jszip';
import { UploadGameModal } from '../../../src/platform/developer/UploadGameModal.jsx';
import { apiClient } from '../../../src/platform/api/apiClient.js';
import * as validationClient from '../../../src/platform/developer/packageValidationClient.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const runtimeLimits = {
    maxPackageSizeBytes: 2147483648,
    maxFileSizeBytes: 2147483648,
    maxTotalExtractedSizeBytes: 4294967296,
    maxFilesPerPackage: 1000,
    maxExtractedFilesPerPackage: 1000
};

async function makePackage({ includeManifest = true } = {}) {
    const zip = new JSZip();
    if (includeManifest) {
        zip.file('manifest.json', JSON.stringify({
            version: 1,
            format: 'web-game',
            gameId: 'ui-test-game',
            gameVersion: '1.2.3',
            name: 'UI Test Game',
            runtime: 'web',
            entry: 'index.html',
            capabilities: []
        }));
    }
    zip.file('index.html', '<main>ready</main>');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    return new File([bytes], includeManifest ? 'valid-game.zip' : 'missing-manifest.zip', { type: 'application/zip' });
}

async function chooseFile(container, file) {
    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

async function waitForText(container, text) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        if (container.textContent.includes(text)) return;
        await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
    }
    throw new Error(`Timed out waiting for: ${text}`);
}

describe('UploadGameModal', () => {
    let container;
    let root;

    async function renderModal(isOpen = true) {
        await act(async () => root.render(<MemoryRouter><UploadGameModal isOpen={isOpen} onClose={vi.fn()} /></MemoryRouter>));
    }

    beforeEach(async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        vi.spyOn(apiClient.json, 'get').mockResolvedValue(runtimeLimits);
        await renderModal();
    });

    it('shows the server-provided maximum, fetched same-origin without cached build quotas', () => {
        expect(container.textContent).toContain('Maximum 2.0 GB');
        expect(apiClient.json.get).toHaveBeenCalledWith('/api/config/upload-limits', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
        expect(container.querySelector('input[type="file"]').disabled).toBe(false);
    });

    it.each([128 * 1024 * 1024, runtimeLimits.maxPackageSizeBytes])('allows a valid ZIP with modeled size %i through real local validation', async size => {
        const file = await makePackage();
        // Model the size boundary without allocating hundreds of MiB in unit tests.
        Object.defineProperty(file, 'size', { value: size });
        await chooseFile(container, file);
        await waitForText(container, 'Package is ready');
        expect(container.textContent).not.toContain('the limit is');
        expect(container.textContent).toContain('Maximum 2.0 GB');
    });

    it('rejects a file above the runtime maximum before reading or uploading it', async () => {
        const validate = vi.spyOn(validationClient, 'validatePackageOffMainThread');
        const upload = vi.spyOn(apiClient.json, 'post');
        const file = await makePackage();
        Object.defineProperty(file, 'size', { value: runtimeLimits.maxPackageSizeBytes + 1 });
        await chooseFile(container, file);
        expect(container.textContent).toContain('the limit is 2.0 GB');
        expect(validate).not.toHaveBeenCalled();
        expect(upload).not.toHaveBeenCalled();
        expect([...container.querySelectorAll('button')].some(button => button.textContent.includes('Upload Version'))).toBe(false);
    });

    it('blocks selection and drop while the limit is unknown, then uses the resolved limit', async () => {
        await renderModal(false);
        let resolveLimits;
        apiClient.json.get.mockImplementation(() => new Promise(resolve => { resolveLimits = resolve; }));
        await renderModal();
        const validate = vi.spyOn(validationClient, 'validatePackageOffMainThread');
        const input = container.querySelector('input[type="file"]');
        expect(input.disabled).toBe(true);
        expect(container.textContent).toContain('Loading upload limits');
        const file = await makePackage();
        await chooseFile(container, file);
        const drop = new Event('drop', { bubbles: true });
        Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
        await act(async () => input.parentElement.dispatchEvent(drop));
        expect(validate).not.toHaveBeenCalled();
        await act(async () => resolveLimits({ ...runtimeLimits, maxPackageSizeBytes: 256 * 1024 * 1024 }));
        expect(input.disabled).toBe(false);
        expect(container.textContent).toContain('Maximum 256 MB');
    });

    it('shows a safe retriable configuration error without a numeric fallback', async () => {
        await renderModal(false);
        apiClient.json.get.mockRejectedValueOnce(new Error('Network offline'));
        await renderModal();
        expect(container.textContent).toContain("Could not load the server's upload limits");
        expect(container.querySelector('input[type="file"]').disabled).toBe(true);
        expect(container.textContent).not.toContain('Maximum');
        await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Retry Upload Limits').click());
        expect(container.textContent).toContain('Maximum 2.0 GB');
        expect(container.querySelector('input[type="file"]').disabled).toBe(false);
    });

    it.each([null, {}, { ...runtimeLimits, maxPackageSizeBytes: '2147483648' }, { ...runtimeLimits, maxPackageSizeBytes: Infinity }])('fails closed for invalid runtime config %j', async response => {
        await renderModal(false);
        apiClient.json.get.mockResolvedValueOnce(response);
        await renderModal();
        expect(container.textContent).toContain("Could not load the server's upload limits");
        expect(container.querySelector('input[type="file"]').disabled).toBe(true);
    });

    it('ignores a stale response from a closed dialog and refreshes limits on reopen', async () => {
        await renderModal(false);
        let resolveOld;
        apiClient.json.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
        await renderModal();
        const oldSignal = apiClient.json.get.mock.calls.at(-1)[1].signal;
        await renderModal(false);
        expect(oldSignal.aborted).toBe(true);
        apiClient.json.get.mockResolvedValueOnce({ ...runtimeLimits, maxPackageSizeBytes: 1024 * 1024 });
        await renderModal();
        await act(async () => resolveOld(runtimeLimits));
        expect(container.textContent).toContain('Maximum 1.0 MB');
        expect(container.textContent).not.toContain('Maximum 2.0 GB');
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('shows actionable manifest details after local validation', async () => {
        await chooseFile(container, await makePackage());
        await waitForText(container, 'Package is ready');

        expect(container.textContent).toContain('UI Test Game');
        expect(container.textContent).toContain('1.2.3');
        expect(container.textContent).toContain('index.html');
        expect([...container.querySelectorAll('button')].some(button => button.textContent.includes('Upload Version'))).toBe(true);
    });

    it('shows the concrete validation reason for an invalid package', async () => {
        await chooseFile(container, await makePackage({ includeManifest: false }));
        await waitForText(container, 'Package needs attention');

        expect(container.textContent).toContain('manifest.json does not exist in the root of the package.');
    });

    it('retries a failed transfer without creating another project or upload session', async () => {
        let createProjectCalls = 0;
        let createVersionCalls = 0;
        vi.spyOn(apiClient.json, 'post').mockImplementation(async endpoint => {
            if (endpoint === '/api/games') {
                createProjectCalls += 1;
                return { id: 'created-game' };
            }
            if (endpoint === '/api/games/created-game/versions') {
                createVersionCalls += 1;
                return { uploadUrl: '/upload', sessionId: 'session-1', versionId: 'version-1' };
            }
            if (endpoint === '/api/uploads/session-1/complete') {
                return { status: 'READY' };
            }
            throw new Error(`Unexpected endpoint: ${endpoint}`);
        });
        const transferStatuses = [500, 200];
        let transferCount = 0;
        class MockXMLHttpRequest extends EventTarget {
            constructor() {
                super();
                this.upload = new EventTarget();
                this.status = 0;
            }
            open() {}
            setRequestHeader() {}
            send(file) {
                transferCount += 1;
                queueMicrotask(() => {
                    this.upload.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded: file.size, total: file.size }));
                    this.status = transferStatuses.shift();
                    this.dispatchEvent(new Event('load'));
                });
            }
            abort() { this.dispatchEvent(new Event('abort')); }
        }
        vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);

        await chooseFile(container, await makePackage());
        await waitForText(container, 'Package is ready');
        await act(async () => {
            [...container.querySelectorAll('button')].find(button => button.textContent.includes('Upload Version')).click();
        });
        await waitForText(container, 'Retry Upload');
        await act(async () => {
            [...container.querySelectorAll('button')].find(button => button.textContent.includes('Retry Upload')).click();
        });
        await waitForText(container, 'Version uploaded');

        expect(createProjectCalls).toBe(1);
        expect(createVersionCalls).toBe(1);
        expect(transferCount).toBe(2);
    });
});
