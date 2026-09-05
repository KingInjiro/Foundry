import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workerPath = fileURLToPath(new URL('../src/worker.js', import.meta.url));
const sandboxPath = fileURLToPath(new URL('../src/sandbox.jsx', import.meta.url));

describe('Player editor-command security boundary', () => {
    it('contains no direct eval execution in the production Worker', async () => {
        const source = await readFile(workerPath, 'utf8');
        expect(source).not.toMatch(/\beval\s*\(/);
        expect(source).toContain('editorCommandsAllowed');
        expect(source).toContain('disabled for published games');
    });

    it('forwards editor commands only for the legacy reusable-editor protocol', async () => {
        const source = await readFile(sandboxPath, 'utf8');
        expect(source).toMatch(/data\.type === 'eval'[\s\S]*parentProtocol === 'legacy'/);
    });
});
