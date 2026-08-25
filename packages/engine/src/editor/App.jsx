import React, { useState, useEffect, useRef } from 'react';
import { db, doc, setDoc, getDoc } from './lib/firebase.js';
import { motion } from 'motion/react';
import { Cloud, CloudDownload, GripHorizontal } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';



import Editor from '@monaco-editor/react';
import { Rocket, Play, Pause, RotateCcw, Download, FolderOpen, Save, Activity, File, Plus, X, FileJson, ChevronDown, Image as ImageIcon, Music, Upload, Wand2, Github, PanelLeft, PanelRight, Code, Settings } from 'lucide-react';





import { EntityInspector } from './components/EntityInspector.jsx';
import { DraggableWindow } from './components/DraggableWindow.jsx';
import { SimulationInspector } from './components/SimulationInspector.jsx';
import { DocsViewer } from './components/DocsViewer.jsx';
import { LogicGraph } from './components/LogicGraph.jsx';
import { ChangelogModal } from './components/ChangelogModal.jsx';









import { Foundry } from '../engine/Foundry.js';
import { EXAMPLES } from './examples.js';
import { ProjectManager } from './components/ProjectManager.jsx';

import { foundryTypes } from './monacoTypes.js';
// Expose core classes so user code can access them
const FoundryAPI = Foundry;

const defaultFiles = EXAMPLES.juicy_shooter.files || EXAMPLES.juicy_shooter;

const getFileType = (filename) => {
    if (!filename) return 'text';
    const ext = filename.split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
    if (['mp3', 'wav', 'ogg'].includes(ext)) return 'audio';
    return 'text';
};

const getMimeType = (filename) => {
    if (!filename) return 'text/plain';
    const ext = filename.split('.').pop().toLowerCase();
    const mimeTypes = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'ogg': 'audio/ogg',
    };
    return mimeTypes[ext] || 'text/plain';
};



const engineModules = import.meta.glob(['../engine/audio/**/*.js', '../engine/camera/**/*.js', '../engine/core/**/*.js', './**/*.js', '../engine/entity/**/*.js', '../engine/graphics/**/*.js', '../engine/input/**/*.js', '../engine/math/**/*.js', '../engine/physics/**/*.js', '../engine/renderer/**/*.js', '../engine/serialization/**/*.js', '../engine/simulation/**/*.js', '../engine/simulations/**/*.js', '../engine/ui/**/*.js', '../engine/world/**/*.js', '../engine/Foundry.js', '../engine/index.js'], { query: '?raw', import: 'default', eager: true });

export default function App() {
    useEffect(() => {
        if (!localStorage.getItem('v154_force_clear_cuberunner')) {
            localStorage.removeItem('foundry_files');
            localStorage.setItem('v154_force_clear_cuberunner', 'true');
            window.location.reload();
        }
    }, []);
    const [files, setFiles] = useState(() => {
        try {
            
        if (!localStorage.getItem('v153_cuberunner_fix')) {
            localStorage.removeItem('foundry_files');
            localStorage.setItem('v153_cuberunner_fix', 'true');
        }
        const saved = localStorage.getItem('foundry_files');

            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) return parsed;
                if (parsed && parsed.files) return parsed.files;
            }
        } catch(e) {}
        return defaultFiles;
    });
    const [activeFileId, setActiveFileId] = useState(files[0]?.id || 'f1');
    const [showChangelog, setShowChangelog] = useState(false);
    const [sceneTab, setSceneTab] = useState('game');
    const [ideMode, setIdeMode] = useState('code');
    const [errorMsg, setErrorMsg] = useState(null);
    const [engineStats, setEngineStats] = useState(null);
    const [crashData, setCrashData] = useState(null);
    const [showResourceMonitor, setShowResourceMonitor] = useState(true);
    const [syncId, setSyncId] = useState('');
    const [isSyncing, setIsSyncing] = useState(false);
    const engineRef = useRef(null);
    const editorRef = useRef(null);
    const [logs, setLogs] = useState([]);
    const logsEndRef = useRef(null);
    const [consoleInput, setConsoleInput] = useState('');
    const [inspectorTab, setInspectorTab] = useState('entities');
    const [showExamples, setShowExamples] = useState(false);
    const [showProjectManager, setShowProjectManager] = useState(false);
    const [showWelcome, setShowWelcome] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [showInspector, setShowInspector] = useState(false);
    const [leftPanelOpen, setLeftPanelOpen] = useState(window.innerWidth > 768);
    const [mobileTab, setMobileTab] = useState("editor");
    const [rightPanelOpen, setRightPanelOpen] = useState(window.innerWidth > 1024);
    const [showGithubModal, setShowGithubModal] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const [githubToken, setGithubToken] = useState(localStorage.getItem('foundry_gh_token') || '');
    const [githubRepo, setGithubRepo] = useState('foundry-game');
    const [githubStatus, setGithubStatus] = useState('');
    
    const [isPaused, setIsPaused] = useState(false);
    const [hasAutosave, setHasAutosave] = useState(() => !!localStorage.getItem('foundry_autosaved_scene'));



    


    const handleEditorDidMount = (editor, monaco) => {
        editorRef.current = editor;
        
        // Add format command (Ctrl+Alt+F or standard Shift+Alt+F is already there, but let's add a clear action)
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            editor.getAction('editor.action.formatDocument').run();
            // Could also trigger a run here if wanted, but format is nice
            
            // Highlight effect for the button
            const btn = document.getElementById('run-code-btn');
            if (btn) {
                btn.classList.add('scale-95', 'bg-green-600');
                setTimeout(() => btn.classList.remove('scale-95', 'bg-green-600'), 150);
                btn.click(); // Trigger run
            }
        });
    };

    const handleEditorWillMount = (monaco) => {
        monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: true,
            noSyntaxValidation: false
        });
        monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
            target: monaco.languages.typescript.ScriptTarget.ES2020,
            allowNonTsExtensions: true
        });
        monaco.languages.typescript.javascriptDefaults.addExtraLib(foundryTypes, 'ts:filename/foundry.d.ts');

        monaco.languages.registerCompletionItemProvider('javascript', {
            provideCompletionItems: (model, position) => {
                const suggestions = [
                    {
                        label: 'class Entity',
                        kind: monaco.languages.CompletionItemKind.Snippet,
                        insertText: [
                            'class ${1:MyEntity} extends Entity {',
                            '    constructor() {',
                            '        super();',
                            '        this.tag = \'${2:my_entity}\';',
                            '        $0',
                            '    }',
                            '',
                            '    onUpdate(dt) {',
                            '        ',
                            '    }',
                            '',
                            '    onRender(r) {',
                            '        ',
                            '    }',
                            '}'
                        ].join('\n'),
                        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        documentation: 'Create a new Entity class'
                    },
                    {
                        label: 'class Simulation',
                        kind: monaco.languages.CompletionItemKind.Snippet,
                        insertText: [
                            'class ${1:MySim} extends Simulation {',
                            '    constructor(engine) {',
                            '        super(engine);',
                            '        this.clearColor = \'#111\';',
                            '    }',
                            '',
                            '    onStart() {',
                            '        $0',
                            '    }',
                            '',
                            '    onUpdate(dt) {',
                            '        ',
                            '    }',
                            '',
                            '    onUI(ui) {',
                            '        ',
                            '    }',
                            '}',
                            'return ${1:MySim};'
                        ].join('\n'),
                        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        documentation: 'Create a new Simulation class'
                    },
                    {
                        label: 'onRender',
                        kind: monaco.languages.CompletionItemKind.Snippet,
                        insertText: [
                            'onRender(r) {',
                            '    $0',
                            '}'
                        ].join('\n'),
                        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        documentation: 'Add onRender method'
                    },
                    {
                        label: 'onUpdate',
                        kind: monaco.languages.CompletionItemKind.Snippet,
                        insertText: [
                            'onUpdate(dt) {',
                            '    $0',
                            '}'
                        ].join('\n'),
                        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        documentation: 'Add onUpdate method'
                    }
                ];
                return { suggestions };
            }
        });

        
        monaco.editor.defineTheme('foundry-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [
                { background: '0a0a0a' },
                { token: 'comment', foreground: '5c6370', fontStyle: 'italic' }
            ],
            colors: {
                'editor.background': '#0a0a0a',
                'editor.lineHighlightBackground': '#171717',
                'editorLineNumber.foreground': '#525252',
                'editorLineNumber.activeForeground': '#a3a3a3',
                'editorIndentGuide.background': '#262626',
                'editorIndentGuide.activeBackground': '#404040',
                'editor.selectionBackground': '#264f78',
                'scrollbarSlider.background': '#262626',
                'scrollbarSlider.hoverBackground': '#404040',
                'scrollbarSlider.activeBackground': '#525252',
            }
        });
    };

    const loadExample = (key) => {
        setFiles(EXAMPLES[key].files || EXAMPLES[key]);
        setActiveFileId((EXAMPLES[key].files || EXAMPLES[key])[0].id);
        localStorage.setItem('foundry_files', JSON.stringify(EXAMPLES[key].files || EXAMPLES[key]));
        setShowExamples(false);
        // Add a small delay to let state update, then run the code automatically
        setTimeout(() => {
            const runBtn = document.getElementById('run-code-btn');
            if (runBtn) runBtn.click();
        }, 100);
    };

    
    const saveToCloud = async () => {
        setIsSyncing(true);
        try {
            const id = syncId || Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
            await setDoc(doc(db, 'projects', id), { files });
            setSyncId(id);
            window.history.replaceState({}, '', '?id=' + id);
            alert('Project saved! Share this URL to load the project:\n' + window.location.href);
        } catch (e) {
            console.error('Save failed', e);
            alert('Failed to save to cloud.');
        }
        setIsSyncing(false);
    };

    const loadFromCloud = async (id) => {
        setIsSyncing(true);
        try {
            const snap = await getDoc(doc(db, 'projects', id));
            if (snap.exists()) {
                const data = snap.data();
                setFiles(data.files);
                setActiveFileId(data.files[0].id);
                setSyncId(id);
            } else {
                alert('Project not found in cloud.');
            }
        } catch (e) {
            console.error('Load failed', e);
            alert('Failed to load from cloud.');
        }
        setIsSyncing(false);
    };

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const id = urlParams.get('id');
        if (id) {
            loadFromCloud(id);
        }
    }, []);

        const handleExport = async (mode) => {
        try {
            const zip = new JSZip();
            
            // 1. Engine files (for all modes)
            for (const [path, content] of Object.entries(engineModules)) {
                const cleanPath = path.replace('./', 'engine/');
                zip.file(cleanPath, content);
            }
            
            let indexHtml = "";
            
            if (mode === 'standalone' || mode === 'html') {
                let combinedCode = "";
                const sortedFiles = [...files].sort((a, b) => {
                    if (a.name.toLowerCase() === 'main.js') return 1;
                    if (b.name.toLowerCase() === 'main.js') return -1;
                    return 0;
                });
                combinedCode = sortedFiles.filter(f => f.name.endsWith('.js')).map(f => f.code).join('\n\n');
                const cleanedCode = combinedCode.replace(/(?:const|let|var)\s*\{[^}]*\}\s*=\s*(?:window\.)?Foundry\s*;/g, '').replace(/import\s+[\s\S]*?\s+from\s+['"].*?['"];?/g, '');
                
                const assets = {};
                if (mode === 'standalone') {
                    files.forEach(f => {
                        const type = getFileType(f.name);
                        if (type === 'image' || type === 'audio') {
                            assets[f.name] = `data:${getMimeType(f.name)};base64,${f.code}`;
                        } else if (type !== 'text' && !f.name.endsWith('.js')) {
                            assets[f.name] = f.code;
                        }
                    });
                } else {
                    const assetsFolder = zip.folder("assets");
                    files.forEach(f => {
                        const type = getFileType(f.name);
                        if (type === 'image' || type === 'audio') {
                            if (f.code && f.code.startsWith('data:')) {
                                assetsFolder.file(f.name, f.code.split(',')[1], {base64: true});
                            } else {
                                assetsFolder.file(f.name, f.code, {base64: true});
                            }
                            assets[f.name] = 'assets/' + f.name;
                        }
                    });
                    
                    zip.file('game.js', "const { Simulation, Entity, Component, ObjectPool, Mathf, Vector2, Sprite, Animator, TextRenderer, ShapeRenderer, Tilemap, ParticleEmitter, PhysicsBody, AudioManager, TrailRenderer, LightSource, Parallax, Lifespan, CameraFollow, NavAgent, InputController, Scene, FSM, State, StateMachine, raycast, Flash, PhysicsConstraint, SoftBody, Health, DamageArea, TriggerArea, JuiceSystem, TweenManager, Easing, MeshRenderer, Light3D, ModelRenderer, PhysicsBody3D } = Foundry;\n" + cleanedCode + "\n\nwindow.FoundryGame = typeof Main !== 'undefined' ? Main : (typeof CustomGame !== 'undefined' ? CustomGame : null);");
                }
                
                indexHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Foundry Game</title>
    <style>
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
        #game-container { width: 100%; height: 100%; }
    </style>
    <script type="importmap">
        { "imports": { "matter-js": "https://esm.sh/matter-js@0.19.0" } }
    </script>
</head>
<body>
    <div id="game-container"></div>
    <script type="module">
        import { Foundry } from '../engine/Foundry.js';
        window.Foundry = Foundry;
        const assets = ${JSON.stringify(assets)};
        const engine = new Foundry.Engine({ headless: false, width: window.innerWidth, height: window.innerHeight });
        document.getElementById('game-container').appendChild(engine.canvas.element);
        window.addEventListener('resize', () => { engine.resize(window.innerWidth, window.innerHeight); });
        
        for (const [name, url] of Object.entries(assets)) {
            if (url.startsWith('data:image') || name.endsWith('.png') || name.endsWith('.jpg')) { engine.assets.loadImage(name, url); }
            else { engine.assets.loadSound(name, url); }
        }
        
        ${mode === 'standalone' ? `
        const createSimClass = new Function('Foundry', 'assets', "const { Simulation, Entity, Component, ObjectPool, Mathf, Vector2, Sprite, Animator, TextRenderer, ShapeRenderer, Tilemap, ParticleEmitter, PhysicsBody, AudioManager, TrailRenderer, LightSource, Parallax, Lifespan, CameraFollow, NavAgent, InputController, Scene, FSM, State, StateMachine, raycast, Flash, PhysicsConstraint, SoftBody, Health, DamageArea, TriggerArea, JuiceSystem, TweenManager, Easing, MeshRenderer, Light3D, ModelRenderer, PhysicsBody3D } = Foundry;\\n" + \`${cleanedCode}\` + "\\nreturn typeof Main !== 'undefined' ? Main : (typeof CustomGame !== 'undefined' ? CustomGame : null);");
        const SimClass = createSimClass(Foundry, assets);
        if (SimClass) {
            const simInstance = new SimClass(engine);
            engine.simulations.register('Main', simInstance);
            engine.simulations.setActive('Main');
            engine.start({ splash: false });
        }` : `
        const script = document.createElement('script');
        script.src = 'game.js';
        script.onload = () => {
            const SimClass = window.FoundryGame;
            if (SimClass) {
                const simInstance = new SimClass(engine);
                engine.simulations.register('Main', simInstance);
                engine.simulations.setActive('Main');
                engine.start({ splash: false });
            }
        };
        document.body.appendChild(script);
        `}
    </script>
</body>
</html>`;} else {
                // PROJECT / TAURI MODE: raw source files
                const srcFolder = zip.folder("src");
                const sortedFiles = [...files].sort((a, b) => {
                    if (a.name.toLowerCase() === 'main.js') return 1;
                    if (b.name.toLowerCase() === 'main.js') return -1;
                    return 0;
                });
                
                const fileNames = [];
                sortedFiles.forEach(f => {
                    if (f.name.endsWith('.js')) {
                        srcFolder.file(f.name, f.code);
                        fileNames.push('/src/' + f.name);
                    }
                });
                
                // Assets in public/assets
                const assetsFolder = zip.folder("public").folder("assets");
                const assetsManifest = {};
                files.forEach(f => {
                    const type = getFileType(f.name);
                    if (type === 'image' || type === 'audio') {
                        if (f.code && f.code.startsWith('data:')) {
                            assetsFolder.file(f.name, f.code.split(',')[1], {base64: true});
                        } else {
                            assetsFolder.file(f.name, f.code, {base64: true});
                        }
                        assetsManifest[f.name] = '/assets/' + f.name;
                    }
                });
                
                indexHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Foundry Game</title>
    <style>
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
        #game-container { width: 100%; height: 100%; }
    </style>
    <script type="importmap">
        { "imports": { "matter-js": "https://esm.sh/matter-js@0.19.0" } }
    </script>
</head>
<body>
    <div id="game-container"></div>
    <script type="module">
        import { Foundry } from '../engine/Foundry.js';
        
        async function boot() {
            const assetsManifest = ${JSON.stringify(assetsManifest)};
            const scriptFiles = ${JSON.stringify(fileNames)};
            
            const engine = new Foundry.Engine({ headless: false, width: window.innerWidth, height: window.innerHeight });
            document.getElementById('game-container').appendChild(engine.canvas.element);
            window.addEventListener('resize', () => { engine.resize(window.innerWidth, window.innerHeight); });
            
            let combinedCode = "";
            for (const file of scriptFiles) {
                const res = await fetch(file);
                const text = await res.text();
                combinedCode += text + "\n\n";
            }
            const cleanedCode = combinedCode.replace(/(?:const|let|var)\s*\{[^}]*\}\s*=\s*(?:window\.)?Foundry\s*;/g, '').replace(/import\s+[\s\S]*?\s+from\s+['"].*?['"];?/g, '');
            
            for (const [name, url] of Object.entries(assetsManifest)) {
                if (name.endsWith('.png') || name.endsWith('.jpg')) { engine.assets.loadImage(name, url); }
                else { engine.assets.loadSound(name, url); }
            }
            
            const createSimClass = new Function('Foundry', 'assets', "const { Simulation, Entity, Component, ObjectPool, Mathf, Vector2, Sprite, Animator, TextRenderer, ShapeRenderer, Tilemap, ParticleEmitter, PhysicsBody, AudioManager, TrailRenderer, LightSource, Parallax, Lifespan, CameraFollow, NavAgent, InputController, Scene, FSM, State, StateMachine, raycast, Flash, PhysicsConstraint, SoftBody, Health, DamageArea, TriggerArea, JuiceSystem, TweenManager, Easing, MeshRenderer, Light3D, ModelRenderer, PhysicsBody3D } = Foundry;\\n" + cleanedCode + "\\nreturn typeof Main !== 'undefined' ? Main : (typeof CustomGame !== 'undefined' ? CustomGame : null);");
            const SimClass = createSimClass(Foundry, assetsManifest);
            
            if (SimClass) {
                const simInstance = new SimClass(engine);
                engine.simulations.register('Main', simInstance);
                engine.simulations.setActive('Main');
                engine.start({ splash: false });
            }
        }
        boot();
    </script>
</body>
</html>`;

                zip.file('package.json', JSON.stringify({
                    name: "foundry-game",
                    version: "1.0.0",
                    scripts: { 
                        "dev": "vite", 
                        "build": "vite build",
                        "tauri": "tauri"
                    },
                    devDependencies: { 
                        "vite": "^5.0.0",
                        "@tauri-apps/cli": "^1.5.0"
                    }
                }, null, 2));
                
                zip.file('README.md', `# Foundry Game\n\nTo run this game locally:\n\n1. Install Node.js.\n2. Run \`npm install\`\n3. Run \`npm run dev\` to start a local development server.\n\nTo build a native executable (Tauri):\n1. Install Rust and native build tools.\n2. Run \`npm run tauri build\`\n`);
            }
            
            zip.file('index.html', indexHtml);
            
            if (mode === 'tauri') {
                const srcTauri = zip.folder('src-tauri');
                srcTauri.file('tauri.conf.json', JSON.stringify({
                  build: { beforeBuildCommand: "npm run build", beforeDevCommand: "npm run dev", devPath: "http://localhost:5173", distDir: "../dist" },
                  package: { productName: "Foundry Game", version: "1.0.0" },
                  tauri: {
                    allowlist: { all: false },
                    bundle: {
                      active: true, category: "Game", copyright: "",
                      deb: { depends: [] }, externalBin: [],
                      icon: [],
                      identifier: "com.foundry.game", longDescription: "",
                      macOS: { entitlements: null, exceptionDomain: "", frameworks: [], providerShortName: null, signingIdentity: null },
                      resources: [], shortDescription: "", targets: "all",
                      windows: { certificateThumbprint: null, digestAlgorithm: "sha256", timestampUrl: "" }
                    },
                    security: { csp: null },
                    windows: [ { fullscreen: false, height: 600, resizable: true, title: "Foundry Game", width: 800 } ]
                  }
                }, null, 2));
                
                srcTauri.file('Cargo.toml', `[package]\nname = "foundry-game"\nversion = "1.0.0"\ndescription = "A Foundry Engine Game"\nauthors = ["you"]\nedition = "2021"\n\n[build-dependencies]\ntauri-build = { version = "1.5.0", features = [] }\n\n[dependencies]\ntauri = { version = "1.5.0", features = [] }\nserde = { version = "1.0", features = ["derive"] }\nserde_json = "1.0"`);
                srcTauri.file('build.rs', `fn main() {\n  tauri_build::build()\n}`);
                
                const srcTauriSrc = srcTauri.folder('src');
                srcTauriSrc.file('main.rs', `#![cfg_attr(\n  all(not(debug_assertions), target_os = "windows"),\n  windows_subsystem = "windows"\n)]\n\nfn main() {\n  tauri::Builder::default()\n    .run(tauri::generate_context!())\n    .expect("error while running tauri application");\n}`);
                
                const ghAction = `name: Build Tauri App\non:\n  push:\n    branches: [ main, master ]\n  workflow_dispatch:\njobs:\n  build:\n    strategy:\n      fail-fast: false\n      matrix:\n        platform: [macos-latest, ubuntu-22.04, windows-latest]\n    runs-on: \$\{{ matrix.platform }}\n    steps:\n      - uses: actions/checkout@v4\n      - name: setup node\n        uses: actions/setup-node@v4\n        with:\n          node-version: 20\n      - name: install Rust stable\n        uses: dtolnay/rust-toolchain@stable\n      - name: install dependencies (ubuntu only)\n        if: matrix.platform == 'ubuntu-22.04'\n        run: |\n          sudo apt-get update\n          sudo apt-get install -y libwebkit2gtk-4.0-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev\n      - name: install frontend dependencies\n        run: npm install\n      - uses: tauri-apps/tauri-action@v0\n        env:\n          GITHUB_TOKEN: \$\{{ secrets.GITHUB_TOKEN }}\n        with:\n          tagName: v\$\{{ github.run_number }}\n          releaseName: 'Foundry Game Release v\$\{{ github.run_number }}'\n          releaseBody: 'Automated release built with Tauri Action.'\n          releaseDraft: false\n          prerelease: false`;
                zip.file('.github/workflows/build.yml', ghAction);
            }
            
            const blob = await zip.generateAsync({ type: 'blob' });
            saveAs(blob, mode === 'tauri' ? 'foundry-tauri.zip' : (mode === 'project' ? 'foundry-project.zip' : 'foundry-html.zip'));
            setShowExportModal(false);
            
        } catch (e) {
            console.error("Export failed", e);
            setErrorMsg("Export failed: " + e.message);
        }
    };

    const handleGithubExport = async () => {
        if (!githubToken || !githubRepo) return;
        localStorage.setItem('foundry_gh_token', githubToken);
        setGithubStatus('Creating repository...');
        try {
            // Create repo
            const repoRes = await fetch('https://api.github.com/user/repos', {
                method: 'POST',
                headers: { 'Authorization': `token ${githubToken}`, 'Accept': 'application/vnd.github.v3+json' },
                body: JSON.stringify({ name: githubRepo, private: false, auto_init: true })
            });
            let owner;
            if (repoRes.ok) {
                const repoData = await repoRes.json();
                owner = repoData.owner.login;
            } else if (repoRes.status === 422) {
                // Repo might already exist, try to get user info to proceed
                const userRes = await fetch('https://api.github.com/user', {
                    headers: { 'Authorization': `token ${githubToken}`, 'Accept': 'application/vnd.github.v3+json' }
                });
                const userData = await userRes.json();
                owner = userData.login;
                setGithubStatus('Using existing repository...');
            } else {
                throw new Error("Failed to create repo: " + repoRes.statusText);
            }
            
            setGithubStatus('Uploading files...');
            
            // Gather files
            const ghFiles = [];
            
            // Add engine files
            for (const [path, fContent] of Object.entries(engineModules)) {
                const cleanPath = path.replace('./', 'engine/');
                ghFiles.push({ path: cleanPath, content: fContent, encoding: 'utf-8' });
            }
            
            // Add source files
            files.forEach(f => {
                const type = getFileType(f.name);
                if (type === 'image' || type === 'audio') {
                    if (f.code && f.code.startsWith('data:')) {
                        ghFiles.push({ path: 'src/' + f.name, content: f.code.split(',')[1], encoding: 'base64' });
                    }
                } else {
                    ghFiles.push({ path: 'src/' + f.name, content: f.code, encoding: 'utf-8' });
                }
            });
            
            // Add game.json
            const gameJson = { name: "Foundry Project", version: "1.0.0", engineVersion: "0.1.0", main: "main.js" };
            ghFiles.push({ path: 'game.json', content: JSON.stringify(gameJson, null, 4), encoding: 'utf-8' });
            
            // Tauri setup for GitHub Actions
            const combinedCode = files.filter(f => f.name.endsWith('.js')).map(f => f.code).join('\n\n');
            const cleanedCode = combinedCode.replace(/(?:const|let|var)\s*\{[^}]*\}\s*=\s*(?:window\.)?Foundry\s*;/g, '').replace(/import\s+[\s\S]*?\s+from\s+['"].*?['"];?/g, '');
            
            const assets = {};
            files.forEach(f => {
                const type = getFileType(f.name);
                if (type === 'image' || type === 'audio') {
                    assets[f.name] = `data:${getMimeType(f.name)};base64,${f.code}`;
                } else if (type !== 'text' && !f.name.endsWith('.js')) {
                    assets[f.name] = f.code;
                }
            });
            
            const indexHtml = "<!DOCTYPE html>\n" +
"<html><head>\n" +
"    <meta charset=\"utf-8\">\n" +
"    <title>Foundry Game</title>\n" +
"    <style>\n" +
"        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }\n" +
"        #game-container { width: 100%; height: 100%; }\n" +
"    </style>\n" +
"    <script type=\"importmap\">\n" +
"        {\n" +
"            \"imports\": {\n" +
"                \"matter-js\": \"https://esm.sh/matter-js@0.19.0\"\n" +
"            }\n" +
"        }\n" +
"    </script>\n" +
"</head><body>\n" +
"    <div id=\"game-container\"></div>\n" +
"    <script type=\"module\">\n" +
"        import { Foundry } from '../engine/Foundry.js';\n" +
"        const FoundryAPI = Foundry;\n" +
"        const assets = " + JSON.stringify(assets) + ";\n" +
"        const engine = new Foundry.Engine(document.getElementById('game-container'));\n" +
"        \n" +
"        // Preload assets\n" +
"        for (const [name, url] of Object.entries(assets)) {\n" +
"            if (url.startsWith('data:image')) {\n" +
"                engine.assets.loadImage(name, url);\n" +
"            } else if (url.startsWith('data:audio')) {\n" +
"                engine.assets.loadSound(name, url);\n" +
"            }\n" +
"        }\n\n" +
"        const createSimClass = new Function('Foundry', 'assets', \"const { Simulation, Entity, Component, ObjectPool, Mathf, Vector2, Sprite, Animator, TextRenderer, ShapeRenderer, Tilemap, ParticleEmitter, PhysicsBody, AudioManager, TrailRenderer, LightSource, Parallax, Lifespan, CameraFollow, NavAgent, InputController, Scene, FSM, State, StateMachine, raycast, Flash, PhysicsConstraint, SoftBody, Health, DamageArea, TriggerArea, JuiceSystem, TweenManager, Easing, MeshRenderer, Light3D, ModelRenderer, PhysicsBody3D } = Foundry;\\n\" + cleanedCode + \"\\n\");\n" +
"        \n" +
"        const SimClass = createSimClass(FoundryAPI, assets);\n" +
"        if (SimClass) {\n" +
"            const simInstance = new SimClass(engine);\n" +
"            engine.setSimulation(simInstance);\n" +
"            engine.start({ splash: false });\n" +
"        }\n" +
"    </script>\n" +
"</body></html>";
            ghFiles.push({ path: 'index.html', content: indexHtml, encoding: 'utf-8' });
            ghFiles.push({ path: 'package.json', content: JSON.stringify({ name: "foundry-game", version: "1.0.0", scripts: { "tauri": "tauri" }, devDependencies: { "@tauri-apps/cli": "^1.5.0" } }, null, 2), encoding: 'utf-8' });
            ghFiles.push({ path: 'src-tauri/tauri.conf.json', content: JSON.stringify({
              build: { beforeBuildCommand: "", beforeDevCommand: "", devPath: "../", distDir: "../" }, package: { productName: "Foundry Game", version: "1.0.0" },
              tauri: { allowlist: { all: false }, bundle: { active: true, category: "Game", copyright: "", deb: { depends: [] }, externalBin: [], icon: [], identifier: "com.foundry.game", longDescription: "", macOS: { entitlements: null, exceptionDomain: "", frameworks: [], providerShortName: null, signingIdentity: null }, resources: [], shortDescription: "", targets: "all", windows: { certificateThumbprint: null, digestAlgorithm: "sha256", timestampUrl: "" } }, security: { csp: null }, windows: [ { fullscreen: false, height: 600, resizable: true, title: "Foundry Game", width: 800 } ] }
            }, null, 2), encoding: 'utf-8' });
            ghFiles.push({ path: 'src-tauri/Cargo.toml', content: `[package]\nname = "foundry-game"\nversion = "1.0.0"\ndescription = "A Foundry Engine Game"\nauthors = ["you"]\nedition = "2021"\n\n[build-dependencies]\ntauri-build = { version = "1.5.0", features = [] }\n\n[dependencies]\ntauri = { version = "1.5.0", features = [] }\nserde = { version = "1.0", features = ["derive"] }\nserde_json = "1.0"`, encoding: 'utf-8' });
            ghFiles.push({ path: 'src-tauri/build.rs', content: `fn main() {\n  tauri_build::build()\n}`, encoding: 'utf-8' });
            ghFiles.push({ path: 'src-tauri/src/main.rs', content: `#![cfg_attr(\n  all(not(debug_assertions), target_os = "windows"),\n  windows_subsystem = "windows"\n)]\n\nfn main() {\n  tauri::Builder::default()\n    .run(tauri::generate_context!())\n    .expect("error while running tauri application");\n}`, encoding: 'utf-8' });
            
            // GitHub Action for Tauri
            const ghAction = `name: Build Tauri App

on:
  push:
    branches: [ main, master ]
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
      - name: setup node
        uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: install Rust stable
        uses: dtolnay/rust-toolchain@stable
      - name: install dependencies (ubuntu only)
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.0-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
      - name: install frontend dependencies
        run: npm install
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: v\${{ github.run_number }}
          releaseName: 'Foundry Game Release v\${{ github.run_number }}'
          releaseBody: 'Automated release built with Tauri Action.'
          releaseDraft: false
          prerelease: false
`;
            ghFiles.push({ path: '.github/workflows/build.yml', content: ghAction, encoding: 'utf-8' });
            
            // Wait to make sure repo is initialized
            await new Promise(r => setTimeout(r, 2000));
            
            // In GitHub API, to upload files, we can just PUT to /contents/ path.
            // For many files, it's slow, but it's simple and works. 
            // We should check if the file exists first to get the sha, but since we just created it or it's a new export,
            // we'll try PUT directly. If it fails with 422 (sha needed), we fetch the sha and retry.
            for (const file of ghFiles) {
                setGithubStatus(`Uploading ${file.path}...`);
                let url = `https://api.github.com/repos/${owner}/${githubRepo}/contents/${file.path}`;
                
                let fileSha = null;
                // Get SHA if exists
                try {
                    const checkRes = await fetch(url, { headers: { 'Authorization': `token ${githubToken}`, 'Accept': 'application/vnd.github.v3+json' } });
                    if (checkRes.ok) {
                        const checkData = await checkRes.json();
                        fileSha = checkData.sha;
                    }
                } catch(e) {}
                
                const body = {
                    message: `Add ${file.path}`,
                    content: file.encoding === 'base64' ? file.content : btoa(unescape(encodeURIComponent(file.content)))
                };
                if (fileSha) body.sha = fileSha;
                
                await fetch(url, {
                    method: 'PUT',
                    headers: { 'Authorization': `token ${githubToken}`, 'Accept': 'application/vnd.github.v3+json' },
                    body: JSON.stringify(body)
                });
            }
            
            setGithubStatus(`Success! View at github.com/${owner}/${githubRepo} (Check Actions tab to see it build the .exe)`);
            setTimeout(() => { setShowGithubModal(false); setGithubStatus(''); }, 5000);
        } catch (e) {
            console.error(e);
            setGithubStatus('Error: ' + e.message);
        }
    };

    const importProject = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const zip = new JSZip();
            const contents = await zip.loadAsync(file);
            const newFiles = [];
            
            for (const [filename, zipEntry] of Object.entries(contents.files)) {
                if (!zipEntry.dir) {
                    const fileType = getFileType(filename);
                    const isBinary = fileType !== 'text';
                    const content = isBinary ? await zipEntry.async('base64') : await zipEntry.async('text');
                    newFiles.push({
                        id: filename.replace(/[^a-zA-Z0-9]/g, '_') + '_' + Date.now() + Math.random().toString(36).substring(7),
                        name: filename.split('/').pop(),
                        code: content
                    });
                }
            }
            
            if (newFiles.length > 0) {
                // Try to put main.js first if it exists
                const sortedFiles = newFiles.sort((a, b) => {
                    if (a.name === 'main.js') return -1;
                    if (b.name === 'main.js') return 1;
                    return 0;
                });
                setFiles(sortedFiles);
                setActiveFileId(sortedFiles[0].id);
                localStorage.setItem('foundry_files', JSON.stringify(sortedFiles));
            } else {
                console.error('No files found in the archive');
            }
        } catch(err) {
            console.error('Invalid zip file');
        }
        
        e.target.value = '';
    };

    const uploadAssets = async (e) => {
        const uploadedFiles = Array.from(e.target.files);
        if (!uploadedFiles.length) return;

        const newFiles = [...files];
        for (const file of uploadedFiles) {
            const type = getFileType(file.name);
            const content = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    if (type === 'text') {
                        resolve(e.target.result);
                    } else {
                        // Extract base64 part
                        const result = e.target.result;
                        const base64 = result.includes(',') ? result.split(',')[1] : result;
                        resolve(base64);
                    }
                };
                if (type === 'text') {
                    reader.readAsText(file);
                } else {
                    reader.readAsDataURL(file);
                }
            });

            newFiles.push({
                id: file.name.replace(/[^a-zA-Z0-9]/g, '_') + '_' + Date.now() + Math.random().toString(36).substring(7),
                name: file.name,
                code: content
            });
        }
        
        setFiles(newFiles);
        localStorage.setItem('foundry_files', JSON.stringify(newFiles));
        e.target.value = '';
    };


    useEffect(() => {
        const handleMessage = (event) => {
            if (event.data && event.data.type) {
                if (event.data.type === 'log') {
                    if (typeof event.data.msg === 'string' && event.data.msg.includes('ResizeObserver')) return;
                    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    setLogs(prev => [...prev, { id: Date.now() + Math.random(), type: event.data.level, msg: event.data.msg, time }]);
                } else if (event.data.type === 'error') {
                    // Do nothing for 'error' unless it's a crash. Worker errors might just be logs.
                } else if (event.data.type === 'crashed') {
                    if (typeof event.data.msg === 'string' && event.data.msg.includes('ResizeObserver')) return;
                    setCrashData({ msg: event.data.msg, stack: event.data.stack });
                                } else if (event.data.type === 'autosave') {
                    localStorage.setItem('foundry_autosaved_scene', event.data.state);
                    setHasAutosave(true);
                } else if (event.data.type === 'stats') {
                    const mem = window.performance && window.performance.memory ? window.performance.memory.usedJSHeapSize / 1048576 : 0;
                    setEngineStats({ 
                        stats: { ...event.data.stats, memory: mem || event.data.stats.memory }, 
                        time: event.data.time 
                    });
                }
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Setup iframe ref
    const iframeRef = useRef(null);

    useEffect(() => {
        const handleInteraction = () => {
            if (iframeRef.current && iframeRef.current.contentWindow) {
                iframeRef.current.contentWindow.postMessage({ type: 'audio_command', cmd: 'resume' }, '*');
            }
        };
        window.addEventListener('click', handleInteraction, { passive: true });
        window.addEventListener('keydown', handleInteraction, { passive: true });
        
        const handleKeyDown = (e) => {
            if (e.code === 'F3') {
                e.preventDefault();
                // If we are in play mode, also forward the toggle if we want, but iframe should handle its own focus.
                // Mostly just preventing the default browser find action when focus is in the editor.
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('click', handleInteraction);
            window.removeEventListener('keydown', handleInteraction);
        };
    }, []);

    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView();
        }
    }, [logs]);



    const runCode = (recover = false) => {
        setShowPreview(true);
        setErrorMsg(null);
        setCrashData(null);
        setEngineStats(null);
        setLogs([]);
        console.log("Starting compilation in sandbox...");
        
        try {
            // Combine all JS files, ensuring the one that returns the simulation is at the bottom
            const jsFiles = files.filter(f => f.name.endsWith('.js') || !f.name.includes('.'));
            const sortedFiles = [...jsFiles].sort((a, b) => {
                const isMainA = a.name === 'main.js' || /extends\s+Simulation/.test(a.code) || /return\s+[a-zA-Z0-9_]+\s*;?\s*$/.test(a.code);
                const isMainB = b.name === 'main.js' || /extends\s+Simulation/.test(b.code) || /return\s+[a-zA-Z0-9_]+\s*;?\s*$/.test(b.code);
                if (isMainA && !isMainB) return 1;
                if (!isMainA && isMainB) return -1;
                return 0;
            });
            const combinedCode = sortedFiles.map(f => f.code).join('\n\n');
            
            // Clean up any old manual imports from user code to avoid redeclaration errors
            const cleanedCode = combinedCode.replace(/(?:const|let|var)\s*\{[^}]*\}\s*=\s*(?:window\.)?Foundry\s*;/g, '').replace(/import\s+[\s\S]*?\s+from\s+['"].*?['"];?/g, '');
            
            // Expose non-JS assets to the simulation context
            const assets = {};
            files.forEach(f => {
                const type = getFileType(f.name);
                if (type === 'image' || type === 'audio') {
                    assets[f.name] = `data:${getMimeType(f.name)};base64,${f.code}`;
                } else {
                    assets[f.name] = f.code;
                }
            });
            
            if (iframeRef.current && iframeRef.current.contentWindow) {
                iframeRef.current.contentWindow.postMessage({
                    type: 'run',
                    code: cleanedCode,
                    assets,
                    recoverState: recover ? localStorage.getItem('foundry_autosaved_scene') : null
                }, '*');
                
                // Keep engineRef in sync for inspectors
                setTimeout(() => {
                    if (iframeRef.current && iframeRef.current.contentWindow.engine) {
                        engineRef.current = iframeRef.current.contentWindow.engine;
                    }
                }, 500);
            }
        } catch (e) {
            console.error(e);
            setErrorMsg(e.toString());
        }
    };



 // rebind if files change? no, runCode uses latest files from closure anyway. Actually, just let the iframe trigger it via onLoad.

    const getLanguage = (filename) => {

        if (!filename) return 'plaintext';
        if (filename.endsWith('.js')) return 'javascript';
        if (filename.endsWith('.json')) return 'json';
        if (filename.endsWith('.css')) return 'css';
        if (filename.endsWith('.html')) return 'html';
        if (filename.endsWith('.md')) return 'markdown';
        return 'plaintext';
    };

    const activeFile = files.find(f => f.id === activeFileId);

    const handleConsoleCommand = (e) => {
        if (e.key === 'Enter') {
            if (!consoleInput.trim()) return;
            const cmd = consoleInput;
            setConsoleInput('');
            console.log('> ' + cmd);
            try {
                
if (iframeRef.current && iframeRef.current.contentWindow) {
    iframeRef.current.contentWindow.postMessage({ type: 'eval', code: cmd }, '*');
}

            } catch (err) {
                console.error(err);
            }
        }
    };

    return (
        <div className="flex flex-col w-screen h-screen bg-neutral-950 text-white overflow-hidden font-sans">
            
            {/* Changelog Modal */}
            {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}
            
            {/* Top IDE Header */}

            <div className={`flex items-center justify-between px-2 md:px-4 lg:px-6 xl:px-8 py-2 xl:py-3 bg-[#0d0d0d] border-b border-[#222] shadow-[0_4px_20px_rgba(0,0,0,0.5)] shrink-0 w-full z-40 shadow-md ${ideMode === 'play' ? 'hidden md:flex' : ''}`}>
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        
                        <div className="bg-green-500/20 p-1.5 rounded-lg border border-green-500/30"><FolderOpen size={18} className="text-green-400" /></div>
                        <h1 className="hidden sm:block text-lg font-black tracking-widest text-green-400" style={{ textShadow: "0 0 10px rgba(74, 222, 128, 0.4)" }}>FOUNDRY</h1>
                        <button 
                            onClick={() => setShowChangelog(true)}
                            className="ml-2 px-2 py-0.5 bg-neutral-800 border border-neutral-700 hover:border-green-500/50 hover:bg-neutral-700 transition-colors rounded text-[10px] font-bold text-neutral-400 hover:text-green-400 flex items-center gap-1 uppercase tracking-wider"
                        >
                            <Rocket size={12} />
                            v0.1.2
                        </button>

                    </div>
                    <div className="h-5 w-px bg-neutral-700" />
                    
                    <div className="hidden md:flex items-center gap-1 mr-4">
                        <button onClick={() => setLeftPanelOpen(!leftPanelOpen)} className={`p-1.5 rounded transition-colors ${leftPanelOpen ? 'bg-neutral-800 text-green-400' : 'text-neutral-500 hover:text-neutral-300'}`} title="Toggle File Explorer">
                            <PanelLeft size={16} />
                        </button>
                    </div>
                    <div className="flex bg-black/50 rounded-lg p-1 shadow-inner border border-white/5 backdrop-blur-md">
                        <button 
                            onClick={() => setIdeMode('code')} 
                            className={`px-2 md:px-6 lg:px-8 xl:px-10 py-1.5 xl:py-2 text-[10px] md:text-xs font-bold uppercase tracking-widest rounded transition-all ${ideMode === 'code' ? 'bg-[#222] text-green-400 shadow-sm border border-white/5' : 'text-neutral-500 hover:text-neutral-300 hover:bg-white/5'}`}
                        >
                            Code
                        </button>
                        <button 
                            onClick={() => setIdeMode('scene')} 
                            className={`px-2 md:px-6 lg:px-8 xl:px-10 py-1.5 xl:py-2 text-[10px] md:text-xs font-bold uppercase tracking-widest rounded transition-all ${ideMode === 'scene' ? 'bg-[#222] text-green-400 shadow-sm border border-white/5' : 'text-neutral-500 hover:text-neutral-300 hover:bg-white/5'}`}
                        >
                            Scene
                        </button>
                        <button 
                            onClick={() => setIdeMode('logic')} 
                            className={`px-2 md:px-6 lg:px-8 xl:px-10 py-1.5 xl:py-2 text-[10px] md:text-xs font-bold uppercase tracking-widest rounded transition-all ${ideMode === 'logic' ? 'bg-[#222] text-green-400 shadow-sm border border-white/5' : 'text-neutral-500 hover:text-neutral-300 hover:bg-white/5'}`}
                        >
                            Logic
                        </button>
                        <button 
                            onClick={() => setIdeMode('docs')} 
                            className={`px-2 md:px-6 lg:px-8 xl:px-10 py-1.5 xl:py-2 text-[10px] md:text-xs font-bold uppercase tracking-widest rounded transition-all ${ideMode === 'docs' ? 'bg-[#222] text-green-400 shadow-sm border border-white/5' : 'text-neutral-500 hover:text-neutral-300 hover:bg-white/5'}`}
                        >
                            Docs
                        </button>
                    </div>
                </div>
                
                <div className="flex items-center gap-3">
                    <button onClick={() => setRightPanelOpen(!rightPanelOpen)} className={`hidden md:flex p-1.5 rounded transition-colors mr-2 ${rightPanelOpen ? 'bg-neutral-800 text-green-400' : 'text-neutral-500 hover:text-neutral-300'}`} title="Toggle Inspector">
                        <PanelRight size={16} />
                    </button>
                    {ideMode === 'play' && (
                        <>
                            <button 
                                onClick={() => {
                                    if (iframeRef.current && iframeRef.current.contentWindow) {
                                        iframeRef.current.contentWindow.postMessage({ type: 'pause' }, '*');
                                        setIsPaused(!isPaused);
                                    }
                                }}
                                className={`px-4 xl:px-6 py-1.5 xl:py-2 text-sm font-bold tracking-wide rounded flex items-center gap-2 transition-all ${isPaused ? 'bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'}`}
                            >
                                {isPaused ? <Play size={16} /> : <Pause size={16} />}
                                {isPaused ? 'RESUME' : 'PAUSE'}
                            </button>
                            <button 
                                onClick={() => {
                                    runCode();
                                    setIsPaused(false);
                                }}
                                className="px-4 xl:px-6 py-1.5 xl:py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm font-bold tracking-wide rounded flex items-center gap-2 transition-all"
                            >
                                <RotateCcw size={16} />
                                RESTART
                            </button>
                        </>
                    )}
                    {ideMode === 'play' ? (
                        <button 
                            id="stop-code-btn"
                            onClick={() => {
                                setIdeMode('code');
                                setIsPaused(false);
                            }}
                            className="px-3 md:px-6 py-1.5 bg-red-500 hover:bg-red-400 text-white text-sm font-bold tracking-wide rounded flex items-center gap-2 shadow-lg shadow-red-900/20 transition-all active:scale-95"
                        >
                            <X size={16} />
                            STOP
                        </button>
                    ) : (
                        <button 
                            id="run-code-btn"
                            onClick={() => {
                                setIdeMode('play');
                                runCode();
                            }}
                            className="px-3 md:px-8 lg:px-10 xl:px-12 py-1.5 xl:py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold tracking-widest rounded-lg flex items-center gap-2 shadow-[0_0_15px_rgba(34,197,94,0.3)] transition-all active:scale-95"
                        >
                            <Play size={16} className="fill-black" />
                            RUN
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden relative">
                
                {/* ========================================= */}
                {/* CODE MODE                                 */}
                {/* ========================================= */}
                <div className={`flex-1 flex overflow-hidden ${ideMode !== 'code' ? 'hidden' : ''} ${mobileTab === "editor" ? "flex" : "hidden md:flex"}`}>
                    {/* Left Sidebar (Explorer) */}
                    <div className={`${leftPanelOpen ? "md:w-64 lg:w-72 xl:w-80 md:border-r" : "md:w-0 md:overflow-hidden"} ${mobileTab === "files" ? "w-full flex-1 border-none flex" : "w-0 overflow-hidden hidden md:flex"} bg-[#0a0a0a] border-[#222] flex-col z-30 shrink-0 transition-all duration-300 ease-in-out`}>
                        <div className="p-3 border-b border-neutral-800 flex flex-col gap-2 relative bg-neutral-900/30">
                            <button 
                                onClick={() => setShowProjectManager(true)}
                                className="w-full px-3 py-1.5 bg-green-900/40 border border-green-800 hover:bg-green-800 text-green-400 hover:text-white text-xs font-bold rounded flex items-center justify-between transition-colors uppercase tracking-wider"
                            >
                                <span>Projects</span>
                                <FolderOpen size={14} />
                            </button>
                            
                            <div className="flex gap-2 mt-2">
                                <button onClick={saveToCloud} disabled={isSyncing} className="flex-1 px-2 py-1.5 bg-blue-900/40 hover:bg-blue-800 text-blue-200 text-xs font-bold rounded flex items-center justify-center gap-1 transition-colors">
                                    <Cloud size={14} /> Save
                                </button>
                                <button onClick={() => { const id = prompt('Enter Project ID to load:'); if(id) loadFromCloud(id); }} disabled={isSyncing} className="flex-1 px-2 py-1.5 bg-blue-900/40 hover:bg-blue-800 text-blue-200 text-xs font-bold rounded flex items-center justify-center gap-1 transition-colors">
                                    <CloudDownload size={14} /> Load
                                </button>
                            </div>
                            <div className="flex gap-2">
                                <label className="flex-1 px-2 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[10px] font-bold rounded flex items-center justify-center gap-1 transition-colors cursor-pointer uppercase">
                                    <Upload size={12} /> Import
                                    <input type="file" accept=".zip" className="hidden" onChange={importProject} />
                                </label>
                                <button onClick={() => setShowExportModal(true)} className="flex-1 px-2 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[10px] font-bold rounded flex items-center justify-center gap-1 transition-colors uppercase" title="Export Project">
                                    <Download size={12} /> Export
                                </button>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => setShowGithubModal(true)} className="flex-1 px-2 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[10px] font-bold rounded flex items-center justify-center gap-1 transition-colors uppercase">
                                    <Github size={12} /> Export to GitHub
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 flex flex-col min-h-0 bg-neutral-950">
                            <div className="flex items-center justify-between p-2 border-b border-neutral-800 bg-neutral-900">
                                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Files & Assets</span>
                                <div className="flex gap-2">
                                    <label className="text-neutral-400 hover:text-green-400 transition-colors cursor-pointer" title="Upload Asset">
                                        <Upload size={14} />
                                        <input type="file" className="hidden" multiple accept="image/*,audio/*" onChange={uploadAssets} />
                                    </label>
                                    <button 
                                        onClick={() => {
                                            const newId = 'f' + Date.now();
                                            const newFiles = [...files, { id: newId, name: `File${files.length + 1}.js`, code: '' }];
                                            setFiles(newFiles);
                                            setActiveFileId(newId);
                                            localStorage.setItem('foundry_files', JSON.stringify(newFiles));
                                        }}
                                        className="text-neutral-400 hover:text-green-400 transition-colors"
                                        title="New File"
                                    >
                                        <Plus size={14} />
                                    </button>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                                {files.map(file => {
                                    const fType = getFileType(file.name);
                                    return (
                                    <div 
                                        key={file.id} 
                                        onClick={() => setActiveFileId(file.id)}
                                        className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors text-sm ${activeFileId === file.id ? 'bg-green-500/10 text-green-400' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}`}
                                    >
                                        {fType === 'image' ? (
                                            <ImageIcon size={14} className={activeFileId === file.id ? "text-green-500" : "text-neutral-500"} />
                                        ) : fType === 'audio' ? (
                                            <Music size={14} className={activeFileId === file.id ? "text-green-500" : "text-neutral-500"} />
                                        ) : (
                                            <File size={14} className={activeFileId === file.id ? "text-green-500" : "text-neutral-500"} />
                                        )}
                                        <input 
                                            value={file.name}
                                            onChange={(e) => {
                                                const newFiles = files.map(f => f.id === file.id ? { ...f, name: e.target.value } : f);
                                                setFiles(newFiles);
                                                localStorage.setItem('foundry_files', JSON.stringify(newFiles));
                                            }}
                                            className="bg-transparent outline-none flex-1 w-full text-inherit cursor-pointer"
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                        {files.length > 1 && (
                                            <button 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const newFiles = files.filter(f => f.id !== file.id);
                                                    setFiles(newFiles);
                                                    localStorage.setItem('foundry_files', JSON.stringify(newFiles));
                                                    if (activeFileId === file.id) setActiveFileId(newFiles[0].id);
                                                }}
                                                className="text-neutral-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <X size={14} />
                                            </button>
                                        )}
                                    </div>
                                )})}
                            </div>
                        </div>
                    </div>
                    
                    {/* Center Editor */}
                    <div className="flex-1 flex flex-col min-w-0">
                        {/* Editor Tabs */}
                        <div className="flex items-center justify-between bg-neutral-900 border-b border-neutral-800 shrink-0">
                            <div className="flex-1 flex overflow-x-auto no-scrollbar">
                                {files.map(file => {
                                    const fType = getFileType(file.name);
                                    return (
                                    <button
                                        key={file.id}
                                        onClick={() => setActiveFileId(file.id)}
                                        className={`flex items-center gap-2 px-4 py-2.5 text-sm border-r border-neutral-800 transition-colors min-w-[120px] max-w-[200px] ${
                                            activeFileId === file.id 
                                                ? 'bg-neutral-950 text-green-400 border-t-2 border-t-green-500' 
                                                : 'text-neutral-500 hover:bg-neutral-900/80 hover:text-neutral-300 border-t-2 border-t-transparent'
                                        }`}
                                    >
                                        {fType === 'image' ? (
                                            <ImageIcon size={14} className={activeFileId === file.id ? "text-green-500" : "text-neutral-600"} />
                                        ) : fType === 'audio' ? (
                                            <Music size={14} className={activeFileId === file.id ? "text-green-500" : "text-neutral-600"} />
                                        ) : (
                                            <File size={14} className={activeFileId === file.id ? "text-green-500" : "text-neutral-600"} />
                                        )}
                                        <span className="truncate flex-1 text-left font-medium">{file.name}</span>
                                        {files.length > 1 && (
                                            <X 
                                                size={14} 
                                                className={`opacity-0 hover:text-red-400 transition-opacity ${activeFileId === file.id ? 'opacity-100 text-neutral-400' : 'group-hover:opacity-100'}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const newFiles = files.filter(f => f.id !== file.id);
                                                    setFiles(newFiles);
                                                    localStorage.setItem('foundry_files', JSON.stringify(newFiles));
                                                    if (activeFileId === file.id) setActiveFileId(newFiles[0].id);
                                                }}
                                            />
                                        )}
                                    </button>
                                )})}
                            </div>
                            <div className="px-3 flex items-center shrink-0 border-l border-neutral-800">
                                <button
                                    onClick={() => {
                                        if (editorRef.current) {
                                            editorRef.current.getAction('editor.action.formatDocument').run();
                                        }
                                    }}
                                    className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors"
                                    title="Format Code (Shift+Alt+F)"
                                >
                                    <Wand2 size={16} />
                                </button>
                            </div>
                        </div>

                        {/* Monaco */}
                        <div className="flex-1 relative bg-neutral-950">
                            {(!activeFile || getFileType(activeFile?.name) === 'text') ? (
                                <Editor
                                    height="100%"
                                    language={getLanguage(activeFile?.name)}
                                    theme="foundry-dark"
                                    beforeMount={handleEditorWillMount}
                                    onMount={handleEditorDidMount}
                                    value={activeFile?.code || ''}
                                    onChange={(value) => {
                                        const val = value || '';
                                        const newFiles = files.map(f => f.id === activeFileId ? { ...f, code: val } : f);
                                        setFiles(newFiles);
                                        localStorage.setItem('foundry_files', JSON.stringify(newFiles));
                                    }}
                                    options={{
                                        minimap: { enabled: false },
                                        fontSize: 14,
                                        padding: { top: 16 },
                                        fontFamily: "'Fira Code', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
                                        fontLigatures: true,
                                        wordWrap: 'on',
                                        smoothScrolling: true,
                                        cursorBlinking: 'smooth',
                                        cursorSmoothCaretAnimation: 'on',
                                        formatOnPaste: true,
                                    }}
                                />
                            ) : (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950 p-8">
                                    {getFileType(activeFile.name) === 'image' ? (
                                        <div className="p-4 bg-neutral-900 rounded-xl border border-neutral-800 shadow-2xl">
                                            <img src={activeFile.code} alt={activeFile.name} className="max-w-full max-h-[60vh] object-contain rounded" />
                                        </div>
                                    ) : (
                                        <div className="p-8 bg-neutral-900 rounded-xl border border-neutral-800 shadow-2xl flex flex-col items-center gap-4">
                                            <Music size={48} className="text-neutral-600" />
                                            <audio controls src={activeFile.code} className="mt-4" />
                                        </div>
                                    )}
                                    <h3 className="mt-6 text-xl font-bold text-neutral-300">{activeFile.name}</h3>
                                    <p className="text-neutral-500 mt-2">Asset File</p>
                                </div>
                            )}
                        </div>
                        
                        {/* Console (only in code mode) */}
                        <div className="h-48 bg-neutral-950 border-t border-neutral-800 flex flex-col shrink-0">
                            <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-900 bg-neutral-900">
                                <span className="text-xs font-bold text-neutral-400 tracking-widest">CONSOLE</span>
                                <button onClick={() => setLogs([])} className="text-xs text-neutral-500 hover:text-white transition-colors">Clear</button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 font-mono text-xs space-y-1 bg-black">
                                {logs.length === 0 && <div className="text-neutral-600 italic px-2">No logs yet...</div>}
                                {logs.map(log => (
                                    <div key={log.id} className={`${log.type === 'error' ? 'text-red-400' : log.type === 'warn' ? 'text-yellow-400' : 'text-neutral-300'} break-words border-b border-neutral-900/50 pb-1 px-2`}>
                                        <span className="text-neutral-600 mr-2">[{log.time}]</span>
                                        {log.msg}
                                    </div>
                                ))}
                                <div ref={logsEndRef} />
                            </div>
                            <div className="border-t border-neutral-900 bg-neutral-900/50 p-2 flex items-center gap-2">
                                <span className="text-green-500 font-mono text-xs font-bold">{'>'}</span>
                                <input 
                                    type="text" 
                                    value={consoleInput}
                                    onChange={(e) => setConsoleInput(e.target.value)}
                                    onKeyDown={handleConsoleCommand}
                                    className="bg-transparent text-neutral-300 font-mono text-xs outline-none flex-1"
                                    placeholder="Type JS command... (e.g. engine.stop())"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* ========================================= */}
                {/* LOGIC MODE                                */}
                {/* ========================================= */}
                <div className={`flex-1 flex overflow-hidden ${ideMode !== 'logic' ? 'hidden' : ''} ${mobileTab === "editor" ? "flex" : "hidden md:flex"}`}>
                    <LogicGraph />
                </div>

                {/* ========================================= */}
                {/* DOCS MODE                                 */}
                {/* ========================================= */}
                <div className={`flex-1 flex overflow-hidden ${ideMode !== 'docs' ? 'hidden' : ''} ${mobileTab === "editor" ? "flex" : "hidden md:flex"}`}>
                    <DocsViewer onRunExample={(code, title = "Example.js") => {
                        const id = Date.now().toString();
                        let newTitle = title;
                        // Check if file already exists with same name, if so, append (Fork)
                        let counter = 1;
                        while(files.some(f => f.name === newTitle)) {
                            const nameWithoutExt = title.replace(/.js$/, '');
                            newTitle = `${nameWithoutExt} (Fork ${counter}).js`;
                            counter++;
                        }
                        
                        const newFiles = [...files, { id, name: newTitle, code }];
                        setFiles(newFiles);
                        setActiveFileId(id);
                        localStorage.setItem('foundry_files', JSON.stringify(newFiles));
                        setIdeMode('code');
                    }} />
                </div>
                
                {/* ========================================= */}
                {/* SCENE MODE                                */}
                {/* ========================================= */}
                <div className={`flex-1 flex overflow-hidden ${ideMode !== 'scene' ? 'hidden' : ''} ${mobileTab === "editor" ? "flex" : "hidden md:flex"}`}>
                    {/* Left Hierarchy (Temporarily disabled to combine with Scene view) */}
                    
                    {/* Center Scene View */}
                    <div className="flex-1 bg-black relative flex items-center justify-center border-r border-neutral-800">
                        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #333 1px, transparent 1px)', backgroundSize: '40px 40px', opacity: 0.2 }} />
                        <span className="text-neutral-700 font-black text-2xl uppercase tracking-widest opacity-30">Scene Editor coming soon...</span>
                    </div>

                    {/* Right Inspector */}
                    <div className={`${rightPanelOpen ? "md:w-80 lg:w-96 xl:w-[400px] md:border-l" : "md:w-0 md:overflow-hidden"} ${mobileTab === "inspector" ? "w-full flex-1 border-none flex" : "w-0 overflow-hidden hidden md:flex"} bg-neutral-950 border-neutral-800 flex-col z-30 shrink-0 transition-all duration-300 ease-in-out`}>
                        <div className="flex bg-neutral-900 border-b border-neutral-800 shrink-0 p-1 gap-1">
                            <button 
                                onClick={() => setInspectorTab('entities')} 
                                className={`flex-1 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-colors ${inspectorTab === 'entities' ? 'bg-neutral-800 text-green-400' : 'text-neutral-500 hover:text-neutral-300'}`}
                            >
                                Entities
                            </button>
                            <button 
                                onClick={() => setInspectorTab('simulation')} 
                                className={`flex-1 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-colors ${inspectorTab === 'simulation' ? 'bg-neutral-800 text-green-400' : 'text-neutral-500 hover:text-neutral-300'}`}
                            >
                                World
                            </button>
                        </div>
                        <div className="flex-1 overflow-hidden">
                            {inspectorTab === 'entities' ? (
                                <EntityInspector engineRef={engineRef} />
                            ) : (
                                <SimulationInspector engineRef={engineRef} />
                            )}
                        </div>
                    </div>
                </div>

                {/* ========================================= */}
                {/* PLAY MODE (IFRAME CONTAINER)              */}
                {/* ========================================= */}
                {ideMode === 'play' && (
                    <div className="absolute inset-0 z-20 mt-0 md:mt-[3.25rem] bg-black">
                        <iframe ref={iframeRef} src="/sandbox.html" className="w-full h-full border-none bg-black" sandbox="allow-scripts allow-same-origin" onLoad={() => setTimeout(() => runCode(), 100)} />
                        {/* Mobile Stop FAB */}
                        <button 
                            onClick={() => {
                                setIdeMode('code');
                                setIsPaused(false);
                            }}
                            className="md:hidden absolute top-4 right-4 z-[60] w-12 h-12 bg-red-500 rounded-full flex items-center justify-center shadow-lg shadow-red-900/50 text-white active:scale-95"
                        >
                            <X size={24} />
                        </button>

                        
                        {/* Resource Monitor Toggle & Panel */}
                        {engineStats && !crashData && (
                            <motion.div 
                                drag 
                                dragMomentum={false}
                                className="absolute top-4 left-4 z-30 flex flex-col items-start gap-2"
                                style={{ pointerEvents: 'auto' }}
                            >
                                <div className="flex items-center gap-2">
                                    <div className="cursor-move p-2 bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-700/50 backdrop-blur rounded-lg shadow-lg text-neutral-500 hover:text-white transition-colors" title="Drag to move">
                                        <GripHorizontal size={14} />
                                    </div>
                                    <button 
                                        onClick={() => setShowResourceMonitor(!showResourceMonitor)}
                                        className="bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-700/50 backdrop-blur text-neutral-400 hover:text-green-400 p-2 rounded-lg shadow-lg transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-wider cursor-pointer"
                                        onPointerDownCapture={e => e.stopPropagation()}
                                    >
                                        <Activity size={14} /> {showResourceMonitor ? 'Hide Stats' : 'Show Stats'}
                                    </button>
                                </div>
                                
                                {showResourceMonitor && (
                                    <div className="bg-neutral-900/80 border border-neutral-700/50 backdrop-blur text-xs font-mono p-3 rounded-lg pointer-events-none select-none shadow-xl flex flex-col gap-1.5 min-w-[160px]">
                                        <div className="text-neutral-400 font-bold mb-1 uppercase tracking-wider text-[10px]">Resource Monitor</div>
                                        <div className="flex justify-between"><span className="text-neutral-500">FPS</span><span className={engineStats.time.fps < 30 ? "text-red-400" : "text-green-400"}>{Math.round(engineStats.time.fps)}</span></div>
                                        <div className="flex justify-between"><span className="text-neutral-500">Frame</span><span className="text-neutral-300">{(engineStats.time.deltaTime * 1000).toFixed(1)} ms</span></div>
                                        <div className="flex justify-between"><span className="text-neutral-500">Entities</span><span className="text-neutral-300">{engineStats.stats.entities}</span></div>
                                        <div className="flex justify-between"><span className="text-neutral-500">Draws</span><span className="text-neutral-300">{engineStats.stats.drawCalls}</span></div>
                                        <div className="flex justify-between"><span className="text-neutral-500">Memory</span><span className="text-neutral-300">{engineStats.stats.memory > 0 ? `${engineStats.stats.memory.toFixed(1)} MB` : "N/A"}</span></div>
                                        <div className="flex justify-between"><span className="text-neutral-500">Worker</span><span className="text-green-400">Running</span></div>
                                    </div>
                                )}
                            </motion.div>
                        )}
                        
                        {/* Exception Boundary / Crash Overlay */}
                        {crashData && (
                            <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm p-8">
                                <div className="bg-neutral-900 border border-red-900/50 rounded-xl shadow-2xl max-w-3xl w-full flex flex-col overflow-hidden">
                                    <div className="bg-red-950/30 border-b border-red-900/50 p-4 flex items-center gap-3">
                                        <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></div>
                                        <h2 className="text-red-400 font-bold text-lg">Simulation crashed</h2>
                                    </div>
                                    <div className="p-6 flex flex-col gap-4">
                                        <div>
                                            <div className="text-neutral-500 text-xs font-bold uppercase tracking-wider mb-2">Reason</div>
                                            <div className="font-mono text-red-300 bg-red-950/20 p-3 rounded border border-red-900/30 text-sm whitespace-pre-wrap">{crashData.msg}</div>
                                        </div>
                                        {crashData.stack && (
                                            <div>
                                                <div className="text-neutral-500 text-xs font-bold uppercase tracking-wider mb-2">Stack Trace</div>
                                                <div className="font-mono text-neutral-400 bg-neutral-950 p-3 rounded border border-neutral-800 text-xs whitespace-pre-wrap overflow-x-auto max-h-64">{crashData.stack}</div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="p-4 bg-neutral-950 border-t border-neutral-800 flex justify-end">
                                        <button onClick={() => runCode()} className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded font-bold text-sm transition-colors">Restart Simulation</button>
                                        {hasAutosave && <button onClick={() => runCode(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold text-sm transition-colors">Recover State</button>}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
            
            
            {showExportModal && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl max-w-sm w-full p-6 flex flex-col gap-4">
                        <div className="flex justify-between items-center">
                            <h2 className="text-white font-bold">Export Game</h2>
                            <button onClick={() => setShowExportModal(false)} className="text-neutral-500 hover:text-white"><X size={18} /></button>
                        </div>
                        <p className="text-sm text-neutral-400">Choose how you want to export your project.</p>
                        <div className="flex flex-col gap-3 mt-2">
                            
                            <button onClick={() => handleExport('standalone')} className="w-full bg-neutral-800 hover:bg-neutral-700 text-white font-bold py-3 px-4 rounded text-left flex flex-col transition-colors border border-neutral-700 hover:border-neutral-500">
                                <span className="text-sm">Standalone (Single File)</span>
                                <span className="text-xs text-neutral-400 font-normal mt-1">Single index.html file with all scripts and assets embedded.</span>
                            </button>
                            <button onClick={() => handleExport('html')} className="w-full bg-neutral-800 hover:bg-neutral-700 text-white font-bold py-3 px-4 rounded text-left flex flex-col transition-colors border border-neutral-700 hover:border-neutral-500">
                                <span className="text-sm">Web (HTML5)</span>
                                <span className="text-xs text-neutral-400 font-normal mt-1">index.html with separate game.js and assets folder.</span>
                            </button>
                            <button onClick={() => handleExport('project')} className="w-full bg-neutral-800 hover:bg-neutral-700 text-white font-bold py-3 px-4 rounded text-left flex flex-col transition-colors border border-neutral-700 hover:border-neutral-500">
                                <span className="text-sm">Source Project</span>
                                <span className="text-xs text-neutral-400 font-normal mt-1">Raw source files (src/ and assets/). Best for importing back later.</span>
                            </button>
                            <button onClick={() => handleExport('tauri')} className="w-full bg-blue-900/40 hover:bg-blue-800 text-blue-100 font-bold py-3 px-4 rounded text-left flex flex-col transition-colors border border-blue-800 hover:border-blue-500">
                                <span className="text-sm">Desktop App (Tauri / EXE)</span>
                                <span className="text-xs text-blue-300 font-normal mt-1">Includes Rust setup to build a native executable (Windows, macOS, Linux).</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
{showGithubModal && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl max-w-sm w-full p-6 flex flex-col gap-4">
                        <div className="flex justify-between items-center">
                            <h2 className="text-white font-bold">Export to GitHub</h2>
                            <button onClick={() => setShowGithubModal(false)} className="text-neutral-500 hover:text-white"><X size={18} /></button>
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-xs text-neutral-400 font-bold uppercase">Personal Access Token (repo scope)</label>
                            <input type="password" value={githubToken} onChange={e => setGithubToken(e.target.value)} className="w-full bg-neutral-950 border border-neutral-800 text-white px-3 py-2 rounded text-sm outline-none focus:border-blue-500" />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-xs text-neutral-400 font-bold uppercase">Repository Name</label>
                            <input type="text" value={githubRepo} onChange={e => setGithubRepo(e.target.value)} className="w-full bg-neutral-950 border border-neutral-800 text-white px-3 py-2 rounded text-sm outline-none focus:border-blue-500" />
                        </div>
                        <button onClick={handleGithubExport} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded transition-colors mt-2">Create & Push</button>
                        {githubStatus && <div className="text-xs text-center text-blue-400 font-mono mt-2">{githubStatus}</div>}
                    </div>
                </div>
            )}

            <ProjectManager 
                isOpen={showProjectManager} 
                onClose={() => setShowProjectManager(false)} 
                currentFiles={files}
                onProjectLoaded={(newFiles) => {
                    setFiles(newFiles);
                    setActiveFileId(newFiles[0]?.id);
                    localStorage.setItem('foundry_files', JSON.stringify(newFiles));
                    window.location.reload();
                }}
            />

                        {showWelcome && (
                <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-neutral-900 border border-green-500/30 rounded-xl w-full max-w-md flex flex-col shadow-2xl overflow-hidden relative">
                        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-green-400 via-blue-500 to-purple-500"></div>
                        <div className="p-8 pb-6 flex flex-col">
                            <h2 className="text-3xl font-bold text-white mb-2">Foundry Engine <span className="text-green-400">Alpha</span></h2>
                            <p className="text-neutral-400 text-sm mb-6">Welcome to the first preview of the Foundry Web Engine platform.</p>
                            
                            <div className="space-y-4 mb-8">
                                <div className="flex items-start gap-3">
                                    <div className="w-8 h-8 rounded bg-neutral-800 flex items-center justify-center text-green-400 shrink-0">🚀</div>
                                    <div>
                                        <div className="font-bold text-neutral-200">2D ECS Framework</div>
                                        <div className="text-xs text-neutral-500">Robust Entity-Component-System with pooling.</div>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3">
                                    <div className="w-8 h-8 rounded bg-neutral-800 flex items-center justify-center text-blue-400 shrink-0">⚛️</div>
                                    <div>
                                        <div className="font-bold text-neutral-200">RigidBody Physics</div>
                                        <div className="text-xs text-neutral-500">Integrated Matter.js with raycast, Flash, PhysicsConstraint, SoftBodying & collision layers.</div>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3">
                                    <div className="w-8 h-8 rounded bg-neutral-800 flex items-center justify-center text-purple-400 shrink-0">🎹</div>
                                    <div>
                                        <div className="font-bold text-neutral-200">Audio Synthesis</div>
                                        <div className="text-xs text-neutral-500">Real-time procedural audio generation & playback.</div>
                                    </div>
                                </div>
                            </div>
                            
                            <button
                                onClick={() => {
                                    localStorage.setItem('foundry_welcome_seen', 'true');
                                    setShowWelcome(false);
                                }}
                                className="w-full py-3 bg-green-500 hover:bg-green-400 text-black font-bold rounded-lg shadow-lg shadow-green-900/20 transition-all active:scale-95"
                            >
                                Start Building
                            </button>
                        </div>
                    </div>
                </div>
            )}
        
            {/* Bottom Mobile Navigation */}
            {ideMode !== 'play' && <div className="md:hidden flex items-center justify-around bg-[#0d0d0d] border-t border-[#222] p-1 z-50 shrink-0">
                <button onClick={() => setMobileTab('files')} className={`flex flex-col items-center gap-1 p-2 rounded flex-1 ${mobileTab === 'files' ? 'text-green-400 bg-neutral-800' : 'text-neutral-500'}`}>
                    <FolderOpen size={20} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Files</span>
                </button>
                <button onClick={() => setMobileTab('editor')} className={`flex flex-col items-center gap-1 p-2 rounded flex-1 ${mobileTab === 'editor' ? 'text-green-400 bg-neutral-800' : 'text-neutral-500'}`}>
                    <Code size={20} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Code/Scene</span>
                </button>
                <button onClick={() => setMobileTab('inspector')} className={`flex flex-col items-center gap-1 p-2 rounded flex-1 ${mobileTab === 'inspector' ? 'text-green-400 bg-neutral-800' : 'text-neutral-500'}`}>
                    <Settings size={20} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Inspector</span>
                </button>
            </div>}

        </div>    );
}
