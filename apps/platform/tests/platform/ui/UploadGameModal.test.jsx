/** @vitest-environment jsdom */
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import JSZip from 'jszip';
import { UploadGameModal } from '../../../src/platform/developer/UploadGameModal.jsx';
import { apiClient } from '../../../src/platform/api/apiClient.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

    beforeEach(async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => {
            root.render(
                <MemoryRouter>
                    <UploadGameModal isOpen onClose={vi.fn()} />
                </MemoryRouter>
            );
        });
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
        vi.spyOn(apiClient, 'post').mockImplementation(async endpoint => {
            if (endpoint === '/api/games') {
                createProjectCalls += 1;
                return { ok: true, json: async () => ({ success: true, data: { id: 'created-game' } }) };
            }
            if (endpoint === '/api/games/created-game/versions') {
                createVersionCalls += 1;
                return { ok: true, json: async () => ({ success: true, data: { uploadUrl: '/upload', sessionId: 'session-1', versionId: 'version-1' } }) };
            }
            if (endpoint === '/api/uploads/session-1/complete') {
                return { ok: true, json: async () => ({ success: true, data: { status: 'READY' } }) };
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
