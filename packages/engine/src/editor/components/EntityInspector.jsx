import React, { useState, useEffect } from 'react';
import { Box, Settings2, Edit2, Play, Activity, ChevronRight, ChevronDown } from 'lucide-react';

export function EntityInspector({ engineRef }) {
    const [tick, setTick] = useState(0);
    const [selectedEntityId, setSelectedEntityId] = useState(null);
    const [expandedNodes, setExpandedNodes] = useState(new Set());

    useEffect(() => {
        const interval = setInterval(() => {
            setTick(t => t + 1);
            
            // Sync selection from editor gizmo
            if (engineRef.current?.editor) {
                const editorSelected = engineRef.current.editor.selectedEntity;
                if (editorSelected && editorSelected.id !== selectedEntityId) {
                    setSelectedEntityId(editorSelected.id);
                    // Ensure parents are expanded
                    let parent = editorSelected.parent;
                    if (parent) {
                        setExpandedNodes(prev => {
                            const next = new Set(prev);
                            let curr = parent;
                            while (curr) {
                                next.add(curr.id);
                                curr = curr.parent;
                            }
                            return next;
                        });
                    }
                } else if (!editorSelected && selectedEntityId) {
                    setSelectedEntityId(null);
                }
            }
        }, 100);
        return () => clearInterval(interval);
    }, [selectedEntityId, engineRef]);
    
    // Custom selection setter to sync back to engine
    const handleSelectEntity = (id) => {
        setSelectedEntityId(id);
        if (engineRef.current?.editor) {
            const entities = engineRef.current.world.entities.entities;
            const ent = entities.find(e => e.id === id);
            engineRef.current.editor.selectedEntity = ent || null;
        }
    };

    const toggleNode = (id, e) => {
        e.stopPropagation();
        setExpandedNodes(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleDrop = (draggedId, targetId) => {
        if (draggedId === targetId) return;
        if (!engineRef.current?.world) return;
        
        const entities = engineRef.current.world.entities.entities;
        const dragged = entities.find(e => e.id === draggedId);
        const target = targetId === 'root' ? null : entities.find(e => e.id === targetId);
        
        if (!dragged) return;

        // Prevent cyclic parenting (target cannot be dragged or a descendant of dragged)
        let curr = target;
        while (curr) {
            if (curr.id === draggedId) return; // cyclic
            curr = curr.parent;
        }

        // Set parent
        if (target) {
            target.addChild(dragged);
            setExpandedNodes(prev => new Set(prev).add(target.id));
        } else {
            if (dragged.parent) {
                dragged.parent.removeChild(dragged);
            }
        }
    };

    const entities = engineRef.current?.world?.entities?.entities || [];
    const selectedEntity = entities.find(e => e.id === selectedEntityId);
    
    const rootEntities = entities.filter(e => !e.parent);

    return (
        <div className="flex flex-col h-full bg-neutral-950">
            <div className="flex items-center justify-between p-2 border-b border-neutral-800 shrink-0">
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-1">
                    <Box size={12} /> Scene Graph
                </span>
                <span className="text-[10px] text-neutral-500">{entities.length}</span>
            </div>
            
            {/* Tree View (Top Half) */}
            <div 
                className={`flex-1 overflow-y-auto p-2 border-b border-neutral-800 ${selectedEntity ? 'max-h-[50%]' : ''}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                    const id = parseInt(e.dataTransfer.getData('text/plain'));
                    if (!isNaN(id)) handleDrop(id, 'root');
                }}
            >
                <div className="space-y-[2px]">
                    {rootEntities.length === 0 ? (
                        <div className="text-xs text-neutral-600 italic px-2 py-4 text-center">No active entities</div>
                    ) : (
                        rootEntities.map(e => (
                            <EntityTreeItem 
                                key={e.id}
                                entity={e}
                                depth={0}
                                selectedId={selectedEntityId}
                                onSelect={handleSelectEntity}
                                expandedNodes={expandedNodes}
                                toggleNode={toggleNode}
                                onDropNode={handleDrop}
                            />
                        ))
                    )}
                </div>
            </div>

            {/* Details View (Bottom Half) */}
            {selectedEntity && (
                <div className="flex-1 overflow-y-auto p-2 bg-neutral-900/50">
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-green-400">#{selectedEntity.id} {selectedEntity.tag}</span>
                            <button 
                                onClick={() => handleSelectEntity(null)}
                                className="text-[10px] bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-2 py-1 rounded transition-colors"
                            >
                                Clear
                            </button>
                        </div>
                        
                        <div className="space-y-4">
                            <Section title="Transform">
                                <InspectorNumberRow entity={selectedEntity} field="x" label="Local X" />
                                <InspectorNumberRow entity={selectedEntity} field="y" label="Local Y" />
                                <InspectorNumberRow entity={selectedEntity} field="z" label="Local Z" />
                                <InspectorNumberRow entity={selectedEntity} field="rotationX" label="Rot X" step={0.1} />
                                <InspectorNumberRow entity={selectedEntity} field="rotationY" label="Rot Y" step={0.1} />
                                <InspectorNumberRow entity={selectedEntity} field="rotationZ" label="Rot Z" step={0.1} />
                                <InspectorNumberRow entity={selectedEntity} field="scaleX" label="Scale X" step={0.1} />
                                <InspectorNumberRow entity={selectedEntity} field="scaleY" label="Scale Y" step={0.1} />
                                <InspectorNumberRow entity={selectedEntity} field="scaleZ" label="Scale Z" step={0.1} />
                                <InspectorNumberRow entity={selectedEntity} field="layer" label="Layer" step={1} />
                            </Section>
                            <Section title="State">
                                <InspectorBoolRow entity={selectedEntity} field="active" label="Active" />
                                <InspectorBoolRow entity={selectedEntity} field="visible" label="Visible" />
                            </Section>
                            <Section title="Physics">
                                <InspectorBoolRow entity={selectedEntity} field="hasCollision" label="Collisions" />
                                <InspectorBoolRow entity={selectedEntity} field="isStatic" label="Is Static" />
                                <InspectorBoolRow entity={selectedEntity} field="isKinematic" label="Is Kinematic" />
                                <InspectorNumberRow entity={selectedEntity} field="mass" label="Mass" step={0.1} />
                                <InspectorNumberRow entity={selectedEntity} field="restitution" label="Restitution" step={0.1} />
                            </Section>
                            
                            <Section title="Add Component">
                                <select 
                                    className="w-full bg-neutral-900 border border-neutral-700 text-neutral-300 text-xs p-1 rounded"
                                    onChange={(e) => {
                                        if (e.target.value && window.addComponentToEntity) {
                                            window.addComponentToEntity(selectedEntity.id, e.target.value);
                                        }
                                        e.target.value = "";
                                    }}
                                >
                                    <option value="">-- Add Component --</option>
                                    <option value="Sprite">Sprite</option>
                                    <option value="MeshRenderer">MeshRenderer (3D)</option>
                                    <option value="ModelRenderer">ModelRenderer (3D)</option>
                                    <option value="Light3D">Light3D (3D)</option>
                                    <option value="LightSource">LightSource (2D)</option>
                                    <option value="ParticleEmitter">ParticleEmitter</option>
                                    <option value="PhysicsBody">PhysicsBody</option>
                                    <option value="SoftBody">SoftBody</option>
                                    <option value="PhysicsBody3D">PhysicsBody3D</option>
                                    <option value="Tilemap">Tilemap</option>
                                </select>
                            </Section>
                            
                            {selectedEntity.components && selectedEntity.components.length > 0 && (
                                <Section title="Components">
                                    <div className="space-y-2">
                                        {selectedEntity.components.map((c, i) => (
                                            <div key={i} className="bg-neutral-950 border border-neutral-800 rounded overflow-hidden">
                                                <div className="flex justify-between items-center bg-neutral-900 px-2 py-1.5 border-b border-neutral-800">
                                                    <span className="text-xs font-bold text-neutral-300">{c.constructor.name}</span>
                                                    <span className="text-[10px] text-neutral-600">{c.enabled ? 'On' : 'Off'}</span>
                                                </div>
                                                {c.data && Object.keys(c.data).length > 0 && (
                                                    <div className="p-2 space-y-1">
                                                        {Object.entries(c.data).map(([key, val]) => {
                                                            if (typeof val === 'number') {
                                                                return (
                                                                    <ComponentNumberRow key={key} entityId={selectedEntity.id} compName={c.constructor.name} field={key} value={val} />
                                                                );
                                                            } else if (typeof val === 'boolean') {
                                                                return (
                                                                    <ComponentBoolRow key={key} entityId={selectedEntity.id} compName={c.constructor.name} field={key} value={val} />
                                                                );
                                                            } else if (typeof val === 'string') {
                                                                if (val.startsWith('#') || val.startsWith('rgb')) {
                                                                    return <ComponentColorRow key={key} entityId={selectedEntity.id} compName={c.constructor.name} field={key} value={val} />;
                                                                }
                                                                return (
                                                                    <ComponentStringRow key={key} entityId={selectedEntity.id} compName={c.constructor.name} field={key} value={val} />
                                                                );

                                                            } else if (Array.isArray(val)) {
                                                                return (
                                                                    <div key={key} className="flex justify-between items-center text-xs py-1">
                                                                        <span className="text-neutral-500 w-1/3 truncate">{key}</span>
                                                                        <span className="text-neutral-300 w-2/3 text-right truncate">[{val.join(', ')}]</span>
                                                                    </div>
                                                                );
                                                            }
                                                            return null;
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </Section>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function EntityTreeItem({ entity, depth, selectedId, onSelect, expandedNodes, toggleNode, onDropNode }) {
    const hasChildren = entity.children && entity.children.length > 0;
    const isExpanded = expandedNodes.has(entity.id);
    const isSelected = selectedId === entity.id;

    return (
        <div>
            <div 
                draggable
                onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', entity.id);
                    e.stopPropagation();
                }}
                onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = parseInt(e.dataTransfer.getData('text/plain'));
                    if (!isNaN(id)) onDropNode(id, entity.id);
                }}
                onClick={() => onSelect(entity.id)}
                className={`flex items-center py-1 px-1 rounded cursor-pointer select-none group transition-colors ${
                    isSelected ? 'bg-green-500/20 text-green-400' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                }`}
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
            >
                <div 
                    className="w-4 h-4 flex items-center justify-center shrink-0 mr-1"
                    onClick={(e) => hasChildren && toggleNode(entity.id, e)}
                >
                    {hasChildren ? (
                        isExpanded ? <ChevronDown size={14} className="opacity-70" /> : <ChevronRight size={14} className="opacity-70" />
                    ) : (
                        <div className="w-1 h-1 rounded-full bg-neutral-700"></div>
                    )}
                </div>
                <Box size={12} className="mr-1.5 opacity-50 shrink-0" />
                <span className="text-xs truncate flex-1">{entity.tag || 'Entity'}</span>
                <span className={`text-[10px] ml-2 ${isSelected ? 'text-green-500/50' : 'text-neutral-600 group-hover:text-neutral-500'}`}>#{entity.id}</span>
            </div>
            
            {hasChildren && isExpanded && (
                <div className="flex flex-col">
                    {entity.children.map(child => (
                        <EntityTreeItem 
                            key={child.id}
                            entity={child}
                            depth={depth + 1}
                            selectedId={selectedId}
                            onSelect={onSelect}
                            expandedNodes={expandedNodes}
                            toggleNode={toggleNode}
                            onDropNode={onDropNode}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function Section({ title, children }) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest border-b border-neutral-800 pb-1 mb-1">
                {title}
            </div>
            {children}
        </div>
    );
}

function InspectorNumberRow({ entity, field, label, step = 1 }) {
    const [editing, setEditing] = useState(false);
    const [tempVal, setTempVal] = useState("");

    const handleEdit = () => {
        setTempVal(entity[field]);
        setEditing(true);
    };

    const handleSave = () => {
        const parsed = parseFloat(tempVal);
        if (!isNaN(parsed)) {
            entity[field] = parsed;
        }
        setEditing(false);
    };

    return (
        <div className="flex justify-between items-center text-xs group">
            <span className="text-neutral-500">{label}</span>
            {editing ? (
                <input 
                    type="number"
                    step={step}
                    autoFocus
                    value={tempVal}
                    onChange={e => setTempVal(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={e => e.key === 'Enter' && handleSave()}
                    className="w-16 bg-neutral-800 text-green-400 font-mono text-right outline-none rounded px-1 border border-green-500/30"
                />
            ) : (
                <span 
                    onClick={handleEdit}
                    className="text-neutral-300 font-mono cursor-pointer hover:text-green-400 border-b border-transparent hover:border-green-500/50 transition-colors"
                >
                    {typeof entity[field] === 'number' ? entity[field].toFixed(2) : entity[field]}
                </span>
            )}
        </div>
    );
}

function InspectorBoolRow({ entity, field, label }) {
    const toggle = () => {
        entity[field] = !entity[field];
    };

    return (
        <div className="flex justify-between items-center text-xs group cursor-pointer" onClick={toggle}>
            <span className="text-neutral-500">{label}</span>
            <span className={"font-mono " + (entity[field] ? "text-green-400" : "text-neutral-600")}>
                {entity[field] ? 'True' : 'False'}
            </span>
        </div>
    );
}


function ComponentNumberRow({ entityId, compName, field, value }) {
    const [editing, setEditing] = useState(false);
    const [tempVal, setTempVal] = useState("");

    const handleEdit = () => {
        setTempVal(value);
        setEditing(true);
    };

    const handleSave = () => {
        const parsed = parseFloat(tempVal);
        if (!isNaN(parsed)) {
            if (window.updateComponentProperty) window.updateComponentProperty(entityId, compName, field, parsed);
        }
        setEditing(false);
    };

    return (
        <div className="flex justify-between items-center text-[10px] group">
            <span className="text-neutral-500">{field}</span>
            {editing ? (
                <input 
                    type="number"
                    autoFocus
                    value={tempVal}
                    onChange={e => setTempVal(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={e => e.key === 'Enter' && handleSave()}
                    className="w-16 bg-neutral-800 text-green-400 font-mono text-right outline-none rounded px-1 border border-green-500/30"
                />
            ) : (
                <span 
                    onClick={handleEdit}
                    className="text-neutral-300 font-mono cursor-pointer hover:text-green-400 border-b border-transparent hover:border-green-500/50 transition-colors"
                >
                    {typeof value === 'number' ? value.toFixed(2) : value}
                </span>
            )}
        </div>
    );
}

function ComponentBoolRow({ entityId, compName, field, value }) {
    const toggle = () => {
        if (window.updateComponentProperty) window.updateComponentProperty(entityId, compName, field, !value);
    };

    return (
        <div className="flex justify-between items-center text-[10px] group cursor-pointer" onClick={toggle}>
            <span className="text-neutral-500">{field}</span>
            <span className={"font-mono " + (value ? "text-green-400" : "text-neutral-600")}>
                {value ? 'True' : 'False'}
            </span>
        </div>
    );
}

function ComponentStringRow({ entityId, compName, field, value }) {
    const [editing, setEditing] = useState(false);
    const [tempVal, setTempVal] = useState("");

    const handleEdit = () => {
        setTempVal(value);
        setEditing(true);
    };

    const handleSave = () => {
        if (window.updateComponentProperty) window.updateComponentProperty(entityId, compName, field, tempVal);
        setEditing(false);
    };

    return (
        <div className="flex justify-between items-center text-[10px] group">
            <span className="text-neutral-500">{field}</span>
            {editing ? (
                <input 
                    type="text"
                    autoFocus
                    value={tempVal}
                    onChange={e => setTempVal(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={e => e.key === 'Enter' && handleSave()}
                    className="w-20 bg-neutral-800 text-green-400 font-mono text-right outline-none rounded px-1 border border-green-500/30"
                />
            ) : (
                <span 
                    onClick={handleEdit}
                    className="text-neutral-300 font-mono truncate max-w-[80px] cursor-pointer hover:text-green-400 border-b border-transparent hover:border-green-500/50 transition-colors"
                >
                    "{value}"
                </span>
            )}
        </div>
    );
}

function ComponentColorRow({ entityId, compName, field, value }) {
    return (
        <div className="flex justify-between items-center text-[10px] group">
            <span className="text-neutral-500">{field}</span>
            <div className="flex items-center gap-1">
                <input 
                    type="color"
                    value={value}
                    onChange={(e) => {
                        if (window.updateComponentProperty) window.updateComponentProperty(entityId, compName, field, e.target.value);
                    }}
                    className="w-4 h-4 rounded cursor-pointer border-0 p-0 bg-transparent"
                />
                <span className="text-neutral-400 font-mono uppercase">{value}</span>
            </div>
        </div>
    );
}
