import React, { useState, useRef } from 'react';
import { FolderOpen, Download, Upload, Plus, FileCode, X, Play, Folder, Save, Trash } from 'lucide-react';
import { EXAMPLES } from '../examples.js';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export function ProjectManager({ isOpen, onClose, onProjectLoaded, currentFiles }) {
    const fileInputRef = useRef(null);

    const exportProject = () => {
        const zip = new JSZip();
        
        // game.json wrapper
        const gameJson = {
            name: "Foundry Project",
            version: "1.0.0",
            engineVersion: "0.1.0",
            main: "main.js"
        };
        
        zip.file("game.json", JSON.stringify(gameJson, null, 4));
        
        const srcFolder = zip.folder("src");
        const assetsFolder = zip.folder("assets");
        
        currentFiles.forEach(file => {
            if (file.name.endsWith('.png') || file.name.endsWith('.jpg') || file.name.endsWith('.mp3')) {
                // If it's a base64 string, we need to extract the data part
                if (file.code && file.code.startsWith('data:')) {
                    const base64Data = file.code.split(',')[1];
                    assetsFolder.file(file.name, base64Data, {base64: true});
                } else {
                    assetsFolder.file(file.name, file.code);
                }
            } else {
                srcFolder.file(file.name, file.code);
            }
        });
        
        zip.generateAsync({type:"blob"}).then(function(content) {
            saveAs(content, "foundry-project.zip");
        });
    };

    const importProject = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const zip = new JSZip();
        zip.loadAsync(file).then(async (contents) => {
            const files = [];
            let idCounter = 1;
            
            for (const filename of Object.keys(contents.files)) {
                const zipObj = contents.files[filename];
                if (zipObj.dir) continue;
                
                const parts = filename.split('/');
                const shortName = parts[parts.length - 1];
                
                // Skip hidden files
                if (shortName.startsWith('.')) continue;
                if (shortName === 'game.json') continue; // We'll parse this separately later if needed
                
                const isAsset = shortName.endsWith('.png') || shortName.endsWith('.jpg') || shortName.endsWith('.mp3');
                
                if (isAsset) {
                    const ext = shortName.split('.').pop().toLowerCase();
                    const mime = ext === 'mp3' ? 'audio/mpeg' : `image/${ext}`;
                    const base64 = await zipObj.async("base64");
                    files.push({
                        id: `f${idCounter++}`,
                        name: shortName,
                        code: `data:${mime};base64,${base64}`
                    });
                } else {
                    const text = await zipObj.async("text");
                    files.push({
                        id: `f${idCounter++}`,
                        name: shortName,
                        code: text
                    });
                }
            }
            
            if (files.length > 0) {
                onProjectLoaded(files);
                onClose();
            }
        });
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-950">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <FolderOpen className="text-green-500" />
                        Project Manager
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>
                
                <div className="flex flex-1 overflow-hidden">
                    <div className="w-1/3 bg-neutral-950 p-4 border-r border-neutral-800 flex flex-col gap-4">
                        <div className="text-sm font-bold text-neutral-500 uppercase tracking-wider mb-2">Actions</div>
                        <button 
                            onClick={() => {
                                onProjectLoaded([{
                                    id: 'f1',
                                    name: 'main.js',
                                    code: `class MyGame extends Simulation {\n    constructor(engine) {\n        super(engine);\n        this.clearColor = '#111';\n    }\n    onStart() {\n        this.engine.world.gravityY = 0;\n    }\n}\nreturn MyGame;`
                                }]);
                                onClose();
                            }}
                            className="flex items-center gap-3 p-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg transition-colors text-left"
                        >
                            <div className="p-2 bg-green-500/20 text-green-400 rounded"><Plus size={18} /></div>
                            <div>
                                <div className="font-bold">New Blank Project</div>
                                <div className="text-xs text-neutral-400">Start from scratch</div>
                            </div>
                        </button>

                        
                        <button 
                            onClick={exportProject}
                            className="flex items-center gap-3 p-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg transition-colors text-left"
                        >
                            <div className="p-2 bg-blue-500/20 text-blue-400 rounded"><Download size={18} /></div>
                            <div>
                                <div className="font-bold">Export Project</div>
                                <div className="text-xs text-neutral-400">Download as ZIP (game.json structure)</div>
                            </div>
                        </button>
                        
                        <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-3 p-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg transition-colors text-left"
                        >
                            <div className="p-2 bg-purple-500/20 text-purple-400 rounded"><Upload size={18} /></div>
                            <div>
                                <div className="font-bold">Import Project</div>
                                <div className="text-xs text-neutral-400">Load from ZIP</div>
                            </div>
                        </button>
                        <input 
                            type="file" 
                            accept=".zip" 
                            ref={fileInputRef} 
                            style={{ display: 'none' }} 
                            onChange={importProject} 
                        />
                    </div>
                    
                    <div className="w-2/3 p-6 overflow-y-auto bg-neutral-900">
                        <h3 className="text-lg font-bold text-white mb-4">Templates</h3>
                        <div className="grid grid-cols-2 gap-4">
                            {Object.entries(EXAMPLES).map(([key, example]) => (
                                <button 
                                    key={key}
                                    onClick={() => {
                                        onProjectLoaded(example.files || example);
                                        onClose();
                                    }}
                                    className="p-4 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 hover:border-green-500/50 rounded-xl text-left transition-all group flex flex-col gap-2"
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
