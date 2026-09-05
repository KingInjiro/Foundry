import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileCode, FolderOpen, LoaderCircle, Plus, Upload, X } from 'lucide-react';
import { EXAMPLES } from '../examples.js';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export function ProjectManager({ isOpen, onClose, onProjectLoaded, currentFiles }) {
    const fileInputRef = useRef(null);
    const [operation, setOperation] = useState('idle');
    const [feedback, setFeedback] = useState(null);
    const busy = operation !== 'idle';

    useEffect(() => {
        if (!isOpen) return;
        setOperation('idle');
        setFeedback(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const onKeyDown = event => {
            if (event.key === 'Escape' && !busy) onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [busy, isOpen, onClose]);

    const exportProject = async () => {
        if (busy) return;
        setOperation('exporting');
        setFeedback(null);
        try {
            const zip = new JSZip();
            const gameJson = {
                name: 'Foundry Project',
                version: '1.0.0',
                engineVersion: '0.1.0',
                main: 'main.js'
            };

            zip.file('game.json', JSON.stringify(gameJson, null, 4));

            const srcFolder = zip.folder('src');
            const assetsFolder = zip.folder('assets');

            currentFiles.forEach(file => {
                if (file.name.endsWith('.png') || file.name.endsWith('.jpg') || file.name.endsWith('.mp3')) {
                    if (file.code && file.code.startsWith('data:')) {
                        const base64Data = file.code.split(',')[1];
                        assetsFolder.file(file.name, base64Data, { base64: true });
                    } else {
                        assetsFolder.file(file.name, file.code);
                    }
                } else {
                    srcFolder.file(file.name, file.code);
                }
            });

            const content = await zip.generateAsync({ type: 'blob' });
            saveAs(content, 'foundry-project.zip');
            setFeedback({ type: 'success', message: 'Project ZIP downloaded.' });
        } catch {
            setFeedback({ type: 'error', message: 'Project export failed. Try again.' });
        } finally {
            setOperation('idle');
        }
    };

    const importProject = async event => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        if (busy) return;

        setOperation('importing');
        setFeedback(null);
        let phase = 'opening';
        try {
            const zip = new JSZip();
            const contents = await zip.loadAsync(file);
            phase = 'parsing';
            const files = [];
            let idCounter = 1;

            for (const filename of Object.keys(contents.files)) {
                const zipObj = contents.files[filename];
                if (zipObj.dir) continue;

                const parts = filename.split('/');
                const shortName = parts[parts.length - 1];

                if (shortName.startsWith('.')) continue;
                if (shortName === 'game.json') continue;

                const isAsset = shortName.endsWith('.png') || shortName.endsWith('.jpg') || shortName.endsWith('.mp3');

                if (isAsset) {
                    const ext = shortName.split('.').pop().toLowerCase();
                    const mime = ext === 'mp3' ? 'audio/mpeg' : `image/${ext}`;
                    const base64 = await zipObj.async('base64');
                    files.push({
                        id: `f${idCounter++}`,
                        name: shortName,
                        code: `data:${mime};base64,${base64}`
                    });
                } else {
                    const text = await zipObj.async('text');
                    files.push({
                        id: `f${idCounter++}`,
                        name: shortName,
                        code: text
                    });
                }
            }

            if (files.length === 0) {
                setFeedback({ type: 'error', message: 'No importable project files were found in this ZIP.' });
                return;
            }

            phase = 'applying';
            onProjectLoaded(files);
            onClose();
        } catch {
            const message = phase === 'opening'
                ? 'This ZIP could not be read as a Foundry project.'
                : phase === 'parsing'
                    ? 'A file inside this ZIP could not be imported.'
                    : 'The imported project could not be applied.';
            setFeedback({ type: 'error', message });
        } finally {
            setOperation('idle');
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="editor-project-manager-title"
            onMouseDown={event => {
                if (event.target === event.currentTarget && !busy) onClose();
            }}
        >
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-950">
                    <h2 id="editor-project-manager-title" className="text-xl font-bold text-white flex items-center gap-2">
                        <FolderOpen className="text-green-500" />
                        Project Manager
                    </h2>
                    <button type="button" onClick={onClose} disabled={busy} aria-label="Close project manager dialog" className="p-2 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white disabled:opacity-40 transition-colors">
                        <X size={20} />
                    </button>
                </div>
                
                <div className="flex flex-1 min-h-0 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
                    <div className="w-full shrink-0 bg-neutral-950 p-4 border-b border-neutral-800 flex flex-col gap-4 md:w-1/3 md:border-b-0 md:border-r md:overflow-y-auto">
                        <div className="text-sm font-bold text-neutral-500 uppercase tracking-wider mb-2">Actions</div>
                        <button 
                            type="button"
                            disabled={busy}
                            onClick={() => {
                                onProjectLoaded([{
                                    id: 'f1',
                                    name: 'main.js',
                                    code: `class MyGame extends Simulation {\n    constructor(engine) {\n        super(engine);\n        this.clearColor = '#111';\n    }\n    onStart() {\n        this.engine.world.gravityY = 0;\n    }\n}\nreturn MyGame;`
                                }]);
                                onClose();
                            }}
                            className="flex items-center gap-3 p-3 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white rounded-lg transition-colors text-left"
                        >
                            <div className="p-2 bg-green-500/20 text-green-400 rounded"><Plus size={18} /></div>
                            <div>
                                <div className="font-bold">New Blank Project</div>
                                <div className="text-xs text-neutral-400">Start from scratch</div>
                            </div>
                        </button>

                        
                        <button 
                            type="button"
                            onClick={() => void exportProject()}
                            disabled={busy}
                            className="flex items-center gap-3 p-3 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white rounded-lg transition-colors text-left"
                        >
                            <div className="p-2 bg-blue-500/20 text-blue-400 rounded">{operation === 'exporting' ? <LoaderCircle className="animate-spin" size={18} /> : <Download size={18} />}</div>
                            <div>
                                <div className="font-bold">{operation === 'exporting' ? 'Exporting…' : 'Export Project'}</div>
                                <div className="text-xs text-neutral-400">Download as ZIP (game.json structure)</div>
                            </div>
                        </button>
                        
                        <button 
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={busy}
                            className="flex items-center gap-3 p-3 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white rounded-lg transition-colors text-left"
                        >
                            <div className="p-2 bg-purple-500/20 text-purple-400 rounded">{operation === 'importing' ? <LoaderCircle className="animate-spin" size={18} /> : <Upload size={18} />}</div>
                            <div>
                                <div className="font-bold">{operation === 'importing' ? 'Importing…' : 'Import Project'}</div>
                                <div className="text-xs text-neutral-400">Load from ZIP</div>
                            </div>
                        </button>
                        <input 
                            type="file" 
                            accept=".zip" 
                            ref={fileInputRef} 
                            style={{ display: 'none' }} 
                            onChange={importProject} 
                            disabled={busy}
                        />
                        {feedback && (
                            <div
                                className={`rounded-lg border p-3 text-sm ${feedback.type === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-green-500/30 bg-green-500/10 text-green-200'}`}
                                role={feedback.type === 'error' ? 'alert' : 'status'}
                                aria-live="polite"
                            >
                                <div className="flex items-start gap-2">
                                    {feedback.type === 'error' ? <AlertCircle className="mt-0.5 shrink-0" size={16} /> : <CheckCircle2 className="mt-0.5 shrink-0" size={16} />}
                                    <span>{feedback.message}</span>
                                </div>
                            </div>
                        )}
                    </div>
                    
                    <div className="w-full shrink-0 p-6 overflow-y-auto bg-neutral-900 md:w-2/3">
                        <h3 className="text-lg font-bold text-white mb-4">Templates</h3>
                        <div className="grid grid-cols-2 gap-4">
                            {Object.entries(EXAMPLES).map(([key, example]) => (
                                <button 
                                    key={key}
                                    type="button"
                                    disabled={busy}
                                    onClick={() => {
                                        onProjectLoaded(example.files || example);
                                        onClose();
                                    }}
                                    className="p-4 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 border border-neutral-700 hover:border-green-500/50 rounded-xl text-left transition-all group flex flex-col gap-2"
                                >
                                    <div className="font-bold text-white group-hover:text-green-400 transition-colors capitalize">{example.name || key}</div>
                                    <div className="text-sm text-neutral-400 line-clamp-2">{example.description || 'Load this template'}</div>
                                    <div className="text-xs text-neutral-500 mt-auto pt-2 flex items-center gap-1">
                                        <FileCode size={12} /> {(example.files || example).length} files
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
