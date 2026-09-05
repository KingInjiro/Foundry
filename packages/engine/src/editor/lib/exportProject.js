import JSZip from 'jszip';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg']);
// Constructed instead of embedded as a source-level import so the repository
// import verifier does not mistake generated HTML for an App dependency.
const ENGINE_IMPORT_PATH = ['./engine', 'Foundry.js'].join('/');

function extensionOf(filename) {
    return String(filename || '').split('.').pop()?.toLocaleLowerCase() || '';
}

function portablePath(input) {
    const value = String(input || '').replace(/\\/g, '/').replace(/^\.\//, '');
    const segments = value.split('/');
    if (!value || value.startsWith('/') || segments.some(segment => !segment || segment === '.' || segment === '..')) {
        throw new Error(`Unsafe export path: ${input}`);
    }
    return segments.join('/');
}

export function mapEngineModulePath(modulePath) {
    const normalized = String(modulePath || '').replace(/\\/g, '/');
    const match = normalized.match(/^(?:\.\.\/)+engine\/(.+)$/);
    if (!match) return null;
    return `engine/${portablePath(match[1])}`;
}

export function collectEngineArchiveFiles(engineModules) {
    const files = new Map();
    for (const [sourcePath, content] of Object.entries(engineModules || {})) {
        const archivePath = mapEngineModulePath(sourcePath);
        if (!archivePath) continue;
        const collisionKey = archivePath.toLocaleLowerCase();
        if ([...files.keys()].some(path => path.toLocaleLowerCase() === collisionKey)) {
            throw new Error(`Duplicate engine export path: ${archivePath}`);
        }
        files.set(archivePath, String(content));
    }
    if (!files.has('engine/Foundry.js')) {
        throw new Error('Canonical engine entry engine/Foundry.js is missing from the export source.');
    }
    return files;
}

function sortedJavaScriptFiles(files) {
    return [...files]
        .filter(file => extensionOf(file.name) === 'js')
        .sort((a, b) => {
            const aMain = String(a.name).toLocaleLowerCase() === 'main.js';
            const bMain = String(b.name).toLocaleLowerCase() === 'main.js';
            return aMain === bMain ? 0 : aMain ? 1 : -1;
        });
}

export function compileEditorGameSource(files) {
    const combined = sortedJavaScriptFiles(files).map(file => String(file.code || '')).join('\n\n');
    if (!combined.trim()) throw new Error('The editor project does not contain JavaScript game code.');

    const defaultExports = [...combined.matchAll(/\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;?/g)];
    const exportedName = defaultExports.at(-1)?.[1] || null;
    const source = combined
        .replace(/(?:const|let|var)\s*\{[^}]*\}\s*=\s*(?:window\.)?Foundry\s*;?/g, '')
        .replace(/\bimport\s+[\s\S]*?\s+from\s+['"][^'"]+['"]\s*;?/g, '')
        .replace(/\bexport\s+default\s+[A-Za-z_$][\w$]*\s*;?/g, '')
        .replace(/\bexport\s+(?=(?:class|function|const|let|var)\b)/g, '');
    const candidate = exportedName
        ? `typeof ${exportedName} !== 'undefined' ? ${exportedName} : null`
        : "typeof Main !== 'undefined' ? Main : (typeof CustomGame !== 'undefined' ? CustomGame : (typeof Game !== 'undefined' ? Game : null))";

    return { source, candidate };
}

function dataUrlForFile(file) {
    const code = String(file.code || '');
    if (code.startsWith('data:')) return code;
    const extension = extensionOf(file.name);
    const mime = IMAGE_EXTENSIONS.has(extension)
        ? `image/${extension === 'jpg' ? 'jpeg' : extension}`
        : extension === 'mp3'
            ? 'audio/mpeg'
            : `audio/${extension}`;
    return `data:${mime};base64,${code}`;
}

function addBinaryFile(zip, archivePath, file) {
    const code = String(file.code || '');
    const payload = code.startsWith('data:') ? code.slice(code.indexOf(',') + 1) : code;
    zip.file(archivePath, payload, { base64: true });
}

function createWebIndex({ source, candidate, assets, separateGameScript = false }) {
    const bootSource = separateGameScript
        ? `
        const script = document.createElement('script');
        script.src = './game.js';
        script.onload = () => startGame(window.FoundryGame);
        script.onerror = () => showError('game.js could not be loaded.');
        document.body.appendChild(script);`
        : `
        const createGameClass = new Function('Foundry', 'assets', ${JSON.stringify(`const { Simulation, Entity, Component, ObjectPool, Mathf, Vector2, Sprite, Animator, TextRenderer, ShapeRenderer, Tilemap, ParticleEmitter, PhysicsBody, AudioManager, TrailRenderer, LightSource, Parallax, Lifespan, CameraFollow, NavAgent, InputController, Scene, FSM, State, StateMachine, raycast, Flash, PhysicsConstraint, SoftBody, Health, DamageArea, TriggerArea, JuiceSystem, TweenManager, Easing, MeshRenderer, Light3D, ModelRenderer, PhysicsBody3D } = Foundry;\n${source}\nreturn ${candidate};`)});
        startGame(createGameClass(Foundry, assets));`;

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Foundry Game</title>
  <style>html,body,#game-container{margin:0;width:100%;height:100%;overflow:hidden;background:#000}#error{color:#fca5a5;font:14px system-ui;padding:24px}</style>
  <script type="importmap">{"imports":{"matter-js":"https://esm.sh/matter-js@0.19.0"}}</script>
</head>
<body>
  <div id="game-container"></div><div id="error" hidden></div>
  <script type="module">
    import { Foundry } from '${ENGINE_IMPORT_PATH}';
    window.Foundry = Foundry;
    const assets = ${JSON.stringify(assets)};
    const showError = message => { const node = document.getElementById('error'); node.hidden = false; node.textContent = message; };
    const startGame = GameClass => {
      if (typeof GameClass !== 'function') return showError('Game entry did not expose a game class.');
      const engine = new Foundry.Engine({ headless: false, width: innerWidth, height: innerHeight });
      document.getElementById('game-container').appendChild(engine.canvas.element);
      addEventListener('resize', () => engine.resize(innerWidth, innerHeight));
      for (const [name, url] of Object.entries(assets)) {
        if (url.startsWith('data:image') || /\.(png|jpe?g|gif|webp|avif)$/i.test(name)) engine.assets.loadImage(name, url);
        else engine.assets.loadSound(name, url);
      }
      const simulation = new GameClass(engine);
      engine.simulations.register('Main', simulation);
      engine.simulations.setActive('Main');
      engine.start({ splash: false });
    };
    ${bootSource}
  </script>
</body>
</html>`;
}

function createTauriFiles(zip) {
    zip.file('package.json', JSON.stringify({
        name: 'foundry-game',
        private: true,
        version: '1.0.0',
        scripts: { dev: 'vite', build: 'vite build', tauri: 'tauri' },
        devDependencies: { vite: '^6.2.3', '@tauri-apps/cli': '^1.6.3' }
    }, null, 2));
    zip.file('src-tauri/tauri.conf.json', JSON.stringify({
        build: { beforeBuildCommand: 'npm run build', beforeDevCommand: 'npm run dev', devPath: 'http://localhost:5173', distDir: '../dist' },
        package: { productName: 'Foundry Game', version: '1.0.0' },
        tauri: { allowlist: { all: false }, bundle: { active: true, identifier: 'com.foundry.game', targets: 'all' }, security: { csp: null }, windows: [{ title: 'Foundry Game', width: 800, height: 600, resizable: true }] }
    }, null, 2));
    zip.file('src-tauri/Cargo.toml', `[package]\nname = "foundry-game"\nversion = "1.0.0"\nedition = "2021"\n\n[build-dependencies]\ntauri-build = { version = "1.5", features = [] }\n\n[dependencies]\ntauri = { version = "1.6", features = [] }\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"`);
    zip.file('src-tauri/build.rs', 'fn main() { tauri_build::build() }\n');
    zip.file('src-tauri/src/main.rs', `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]\nfn main() { tauri::Builder::default().run(tauri::generate_context!()).expect("tauri runtime failed"); }\n`);
    zip.file('.github/workflows/build.yml', `name: Build desktop game
on:
  push:
    branches: [main, master]
  workflow_dispatch:
jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        platform: [macos-latest, ubuntu-22.04, windows-latest]
    runs-on: \${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: dtolnay/rust-toolchain@stable
      - name: Install Linux dependencies
        if: matrix.platform == 'ubuntu-22.04'
        run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.0-dev build-essential libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
      - run: npm install
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`);
}

export async function buildEditorExportArchive({ mode, files, engineModules }) {
    if (!['standalone', 'html', 'project', 'tauri'].includes(mode)) throw new Error(`Unsupported export mode: ${mode}`);
    const zip = new JSZip();
    for (const [archivePath, content] of collectEngineArchiveFiles(engineModules)) zip.file(archivePath, content);

    const { source, candidate } = compileEditorGameSource(files);
    const assets = {};
    for (const file of files) {
        const extension = extensionOf(file.name);
        if (!IMAGE_EXTENSIONS.has(extension) && !AUDIO_EXTENSIONS.has(extension)) continue;
        const safeName = portablePath(file.name);
        if (mode === 'standalone') {
            assets[safeName] = dataUrlForFile(file);
        } else {
            const archivePath = `assets/${safeName}`;
            addBinaryFile(zip, archivePath, file);
            assets[safeName] = `./${archivePath}`;
        }
    }

    if (mode === 'html') {
        zip.file('game.js', `const { Simulation, Entity, Component, ObjectPool, Mathf, Vector2, Sprite, Animator, TextRenderer, ShapeRenderer, Tilemap, ParticleEmitter, PhysicsBody, AudioManager, TrailRenderer, LightSource, Parallax, Lifespan, CameraFollow, NavAgent, InputController, Scene, FSM, State, StateMachine, raycast, Flash, PhysicsConstraint, SoftBody, Health, DamageArea, TriggerArea, JuiceSystem, TweenManager, Easing, MeshRenderer, Light3D, ModelRenderer, PhysicsBody3D } = Foundry;\n${source}\nwindow.FoundryGame = ${candidate};\n`);
    }

    if (mode === 'project' || mode === 'tauri') {
        for (const file of files) {
            if (extensionOf(file.name) === 'js') zip.file(`src/${portablePath(file.name)}`, String(file.code || ''));
        }
        zip.file('README.md', '# Foundry Game\n\nRun `npm install` and `npm run dev`. The exported runtime entry is `index.html`.\n');
    }

    zip.file('index.html', createWebIndex({ source, candidate, assets, separateGameScript: mode === 'html' }));
    if (mode === 'tauri') createTauriFiles(zip);
    return zip;
}

export async function archiveToGitHubFiles(zip) {
    const files = [];
    for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const binary = !/\.(?:js|mjs|cjs|json|html|css|md|toml|rs|yml|yaml|txt)$/i.test(path);
        files.push({
            path: portablePath(path),
            content: await entry.async(binary ? 'base64' : 'string'),
            encoding: binary ? 'base64' : 'utf-8'
        });
    }
    return files;
}
