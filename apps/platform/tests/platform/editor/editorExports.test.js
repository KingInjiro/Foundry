import { afterEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
    archiveToGitHubFiles,
    buildEditorExportArchive,
    mapEngineModulePath
} from '@foundry/engine/editor/lib/exportProject.js';
import { pushFilesToGitHub } from '@foundry/engine/editor/lib/githubExport.js';
import { createEditorGamePackage } from '../../../src/platform/editor/createEditorGamePackage.js';
import { GamePackageValidator } from '../../../src/platform/backend/validation/GamePackageValidator.js';
import { LocalZipPackageSource } from '../../../src/platform/backend/validation/LocalZipPackageSource.js';

const engineModules = {
    '../engine/Foundry.js': 'export const Foundry = { Engine: class {} };',
    '../engine/core/Clock.js': 'export class Clock {}',
    './components/EditorOnly.js': 'throw new Error("must not ship")'
};
const editorFiles = [
    { id: 'helper', name: 'nested/helper.js', code: 'class Helper {}' },
    { id: 'main', name: 'main.js', code: 'class Main extends Simulation {}\nexport default Main;' }
];

afterEach(() => {
    delete globalThis.Simulation;
    delete globalThis.assets;
});

describe('canonical editor exports', () => {
    it('maps only engine source paths into a case-stable engine directory', () => {
        expect(mapEngineModulePath('../engine/Foundry.js')).toBe('engine/Foundry.js');
        expect(mapEngineModulePath('../engine/audio/Mixer.js')).toBe('engine/audio/Mixer.js');
        expect(mapEngineModulePath('./components/EditorOnly.js')).toBeNull();
    });

    it.each(['standalone', 'html', 'project', 'tauri'])('generates a %s archive with resolvable canonical imports', async mode => {
        const archive = await buildEditorExportArchive({ mode, files: editorFiles, engineModules });
        const buffer = await archive.generateAsync({ type: 'nodebuffer' });
        const zip = await JSZip.loadAsync(buffer);
        const paths = Object.keys(zip.files);
        const html = await zip.file('index.html').async('string');

        expect(paths).toContain('engine/Foundry.js');
        expect(paths).toContain('engine/core/Clock.js');
        expect(paths.some(path => path.includes('EditorOnly') || path.startsWith('.engine'))).toBe(false);
        expect(html).toContain("from './engine/Foundry.js'");
        expect(html).not.toContain("from '../engine/Foundry.js'");
        if (mode === 'html') expect(paths).toContain('game.js');
        if (mode === 'project' || mode === 'tauri') expect(paths).toContain('src/nested/helper.js');
        if (mode === 'tauri') expect(paths).toEqual(expect.arrayContaining(['src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/src/main.rs', '.github/workflows/build.yml']));

        const githubFiles = await archiveToGitHubFiles(zip);
        expect(githubFiles.map(file => file.path)).toContain('engine/Foundry.js');
    });

    it('builds a validator-compatible Platform package whose generated entry imports as a module', async () => {
        const result = await createEditorGamePackage({
            editorProjectId: 'editor-project-123',
            files: editorFiles,
            name: 'Editor Handoff'
        });
        const bytes = await result.file.arrayBuffer();
        const validation = await new GamePackageValidator().validate(new LocalZipPackageSource(bytes));
        expect(validation.valid).toBe(true);
        expect(validation.manifest).toMatchObject({ runtime: 'foundry', format: 'foundry-game', entry: 'main.js', gameId: 'editor-project-123' });

        globalThis.Simulation = class Simulation {};
        const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.entrySource).toString('base64')}#${Date.now()}`;
        const imported = await import(moduleUrl);
        expect(typeof imported.default).toBe('function');
        expect(imported.default.name).toBe('Main');
    });
});

describe('GitHub export failure handling', () => {
    it('fails the whole export when any file upload fails', async () => {
        const responses = [
            new Response(JSON.stringify({ owner: { login: 'owner' } }), { status: 201, headers: { 'content-type': 'application/json' } }),
            new Response('', { status: 404 }),
            new Response(JSON.stringify({ message: 'permission denied' }), { status: 403, headers: { 'content-type': 'application/json' } })
        ];
        const fetchImpl = async () => responses.shift();

        await expect(pushFilesToGitHub({
            token: 'session-secret',
            repository: 'private-export',
            files: [{ path: 'index.html', content: '<html></html>', encoding: 'utf-8' }],
            fetchImpl
        })).rejects.toMatchObject({ code: 'GITHUB_EXPORT_FAILED', status: 403 });
    });

    it('checks every operation and reports success only after all files are accepted', async () => {
        const calls = [];
        const responses = [
            new Response(JSON.stringify({ owner: { login: 'owner' } }), { status: 201 }),
            new Response('', { status: 404 }),
            new Response('{}', { status: 201 }),
            new Response('', { status: 404 }),
            new Response('{}', { status: 201 })
        ];
        const fetchImpl = async (url, options = {}) => {
            calls.push({ url, options });
            return responses.shift();
        };
        const result = await pushFilesToGitHub({
            token: 'session-secret',
            repository: 'private-export',
            files: [
                { path: 'index.html', content: '<html></html>', encoding: 'utf-8' },
                { path: 'engine/Foundry.js', content: 'export {};', encoding: 'utf-8' }
            ],
            fetchImpl
        });

        expect(result.url).toBe('https://github.com/owner/private-export');
        expect(calls.filter(call => call.options.method === 'PUT')).toHaveLength(2);
        expect(calls.some(call => String(call.options.body || '').includes('session-secret'))).toBe(false);
    });

    it('does not hide a failed existing-file lookup', async () => {
        const responses = [
            new Response(JSON.stringify({ owner: { login: 'owner' } }), { status: 201 }),
            new Response(JSON.stringify({ message: 'upstream unavailable' }), { status: 503 })
        ];
        await expect(pushFilesToGitHub({
            token: 'session-secret',
            repository: 'private-export',
            files: [{ path: 'index.html', content: '<html></html>', encoding: 'utf-8' }],
            fetchImpl: async () => responses.shift()
        })).rejects.toMatchObject({ code: 'GITHUB_EXPORT_FAILED', status: 503 });
    });
});
