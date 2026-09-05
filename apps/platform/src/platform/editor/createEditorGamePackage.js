import JSZip from 'jszip';
import { compileEditorGameSource } from '@foundry/engine/editor/lib/exportProject.js';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg']);

function safePackagePath(value) {
    const path = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (!path || path.startsWith('/') || path.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
        throw new Error(`Editor file has an unsafe package path: ${value}`);
    }
    return path;
}

function packageGameId(editorProjectId) {
    const normalized = String(editorProjectId || 'editor-draft')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^[^A-Za-z0-9]+/, '')
        .slice(0, 100);
    return normalized || 'editor-draft';
}

function sourceAssetValue(file) {
    const code = String(file.code || '');
    return code.startsWith('data:') ? code.slice(code.indexOf(',') + 1) : code;
}

export async function createEditorGamePackage({
    editorProjectId,
    files,
    name = 'Foundry Editor Game',
    description = '',
    gameVersion = '1.0.0'
}) {
    const title = String(name || '').trim();
    if (!title || title.length > 120) throw new Error('Game name must contain 1 to 120 characters.');
    const normalizedDescription = String(description || '').trim();
    if (normalizedDescription.length > 2000) throw new Error('Game description must be 2,000 characters or fewer.');

    const zip = new JSZip();
    const { source, candidate } = compileEditorGameSource(files);
    const assetExpressions = [];

    for (const file of files) {
        const safeName = safePackagePath(file.name);
        const extension = safeName.split('.').pop()?.toLocaleLowerCase() || '';
        if (IMAGE_EXTENSIONS.has(extension) || AUDIO_EXTENSIONS.has(extension)) {
            const archivePath = `assets/${safeName}`;
            zip.file(archivePath, sourceAssetValue(file), { base64: true });
            assetExpressions.push(`${JSON.stringify(safeName)}: new URL(${JSON.stringify(`./${archivePath}`)}, import.meta.url).href`);
        }
        if (extension === 'js') zip.file(`editor-source/${safeName}`, String(file.code || ''));
    }

    const entrySource = `const __editorAssets = { ${assetExpressions.join(', ')} };
Object.assign(globalThis.assets || (globalThis.assets = {}), __editorAssets);
const assets = globalThis.assets;
${source}
const __FoundryEditorGame = ${candidate};
if (typeof __FoundryEditorGame !== 'function') throw new Error('Editor project must expose a default game class, Main, CustomGame, or Game.');
export default __FoundryEditorGame;
`;
    zip.file('main.js', entrySource);

    const manifest = {
        version: 1,
        format: 'foundry-game',
        gameId: packageGameId(editorProjectId),
        gameVersion: String(gameVersion || '1.0.0').slice(0, 64),
        name: title,
        description: normalizedDescription,
        runtime: 'foundry',
        engineVersion: '0.1.0',
        entry: 'main.js',
        capabilities: ['audio', 'storage', 'fullscreen'],
        tags: ['Editor']
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
    const fileName = `${packageGameId(editorProjectId)}.zip`;
    const file = typeof File === 'function'
        ? new File([blob], fileName, { type: 'application/zip', lastModified: Date.now() })
        : Object.assign(blob, { name: fileName, lastModified: Date.now() });
    return { file, manifest, entrySource };
}
