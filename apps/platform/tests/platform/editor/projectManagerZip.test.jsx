/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { ProjectManager } from '../../../../../packages/engine/src/editor/components/ProjectManager.jsx';

vi.mock('file-saver', () => ({ saveAs: vi.fn() }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function waitFor(assertion) {
    let lastError;
    for (let attempt = 0; attempt < 80; attempt += 1) {
        try {
            assertion();
            return;
        } catch (error) {
            lastError = error;
            await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
        }
    }
    throw lastError;
}

async function chooseFile(container, file) {
    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await Promise.resolve();
    });
}

function button(container, label) {
    return [...container.querySelectorAll('button')].find(node => node.textContent.includes(label));
}

describe('Editor Project Manager ZIP feedback', () => {
    let container;
    let root;
    let onClose;
    let onProjectLoaded;

    beforeEach(async () => {
        vi.clearAllMocks();
        onClose = vi.fn();
        onProjectLoaded = vi.fn();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => {
            root.render(
                <ProjectManager
                    isOpen
                    onClose={onClose}
                    onProjectLoaded={onProjectLoaded}
                    currentFiles={[{ id: 'f1', name: 'main.js', code: 'return class Main {};' }]}
                />
            );
        });
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.restoreAllMocks();
    });

    it('shows import pending state and applies a valid project once', async () => {
        const pending = deferred();
        const contents = new JSZip();
        contents.file('src/main.js', 'return class ImportedMain {};');
        vi.spyOn(JSZip.prototype, 'loadAsync').mockReturnValue(pending.promise);

        await chooseFile(container, new File(['zip'], 'project.zip', { type: 'application/zip' }));
        expect(button(container, 'Importing…')).toBeTruthy();
        expect(button(container, 'Export Project').disabled).toBe(true);

        pending.resolve(contents);
        await waitFor(() => expect(onProjectLoaded).toHaveBeenCalledTimes(1));
        expect(onProjectLoaded.mock.calls[0][0]).toEqual([
            expect.objectContaining({ name: 'main.js', code: 'return class ImportedMain {};' })
        ]);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('shows an actionable error for an invalid ZIP and permits retry', async () => {
        vi.spyOn(JSZip.prototype, 'loadAsync').mockRejectedValue(new Error('Synthetic invalid ZIP parser detail'));

        await chooseFile(container, new File(['not a zip'], 'broken.zip', { type: 'application/zip' }));

        await waitFor(() => expect(container.textContent).toContain('This ZIP could not be read as a Foundry project.'));
        expect(container.textContent).not.toContain('Synthetic invalid ZIP parser detail');
        expect(button(container, 'Import Project').disabled).toBe(false);
    });

    it('shows an actionable error when an archive entry cannot be parsed', async () => {
        vi.spyOn(JSZip.prototype, 'loadAsync').mockResolvedValue({
            files: {
                'src/main.js': {
                    dir: false,
                    async: vi.fn().mockRejectedValue(new Error('Synthetic entry decoder detail'))
                }
            }
        });

        await chooseFile(container, new File(['zip'], 'project.zip', { type: 'application/zip' }));

        await waitFor(() => expect(container.textContent).toContain('A file inside this ZIP could not be imported.'));
        expect(container.textContent).not.toContain('Synthetic entry decoder detail');
        expect(onProjectLoaded).not.toHaveBeenCalled();
    });

    it('shows export pending and success feedback while preventing double submit', async () => {
        const pending = deferred();
        vi.spyOn(JSZip.prototype, 'generateAsync').mockReturnValue(pending.promise);

        await act(async () => button(container, 'Export Project').click());
        expect(button(container, 'Exporting…')).toBeTruthy();
        expect(button(container, 'Exporting…').disabled).toBe(true);
        expect(button(container, 'Import Project').disabled).toBe(true);

        pending.resolve(new Blob(['archive'], { type: 'application/zip' }));
        await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
        expect(saveAs).toHaveBeenCalledWith(expect.any(Blob), 'foundry-project.zip');
        expect(container.textContent).toContain('Project ZIP downloaded.');
        expect(button(container, 'Export Project').disabled).toBe(false);
    });

    it('shows an actionable export error and permits retry', async () => {
        vi.spyOn(JSZip.prototype, 'generateAsync').mockRejectedValue(new Error('Synthetic ZIP generator detail'));

        await act(async () => button(container, 'Export Project').click());

        await waitFor(() => expect(container.textContent).toContain('Project export failed. Try again.'));
        expect(container.textContent).not.toContain('Synthetic ZIP generator detail');
        expect(button(container, 'Export Project').disabled).toBe(false);
        expect(saveAs).not.toHaveBeenCalled();
    });
});
