import React, { useState, useEffect } from 'react';
import { Settings2 } from 'lucide-react';

export function SimulationInspector({ engineRef }) {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setTick(t => t + 1);
        }, 100);
        return () => clearInterval(interval);
    }, []);

    const engine = engineRef.current;
    if (!engine) return null;

    const time = engine.time;
    const world = engine.world;
    const camera = engine.camera;

    return (
        <div className="flex flex-col h-full bg-neutral-950">
            <div className="flex items-center justify-between p-2 border-b border-neutral-800 shrink-0">
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-1">
                    <Settings2 size={12} /> Simulation
                </span>
                <span className="text-[10px] text-green-400 font-mono">{time?.fps || 0} FPS</span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-4">
                
                <div className="space-y-2">
                    <div className="text-[10px] font-bold text-neutral-600 uppercase">Engine</div>
                    <InspectorRow 
                        label="Time Scale" 
                        value={time?.timeScale ?? 1} 
                        onChange={(v) => { if(time) time.timeScale = v; }} 
                        step={0.1} 
                    />
                </div>

                <div className="space-y-2">
                    <div className="text-[10px] font-bold text-neutral-600 uppercase">Entities</div>
                    <InspectorRow label="Total Active" value={world?.entities?.entities?.length ?? 0} />
                    <InspectorRow label="Physics Bodies" value={world?.entities?.entities?.filter(e => e.components.some(c => c.constructor.name === 'PhysicsBody'))?.length ?? 0} />
                </div>
                <div className="space-y-2">
                    <div className="text-[10px] font-bold text-neutral-600 uppercase">World</div>
                    <InspectorRow 
                        label="Gravity X" 
                        value={world?.gravityX ?? 0} 
                        onChange={(v) => { if(world) world.gravityX = v; }} 
                        step={10} 
                    />
                    <InspectorRow 
                        label="Gravity Y" 
                        value={world?.gravityY ?? 400} 
                        onChange={(v) => { if(world) world.gravityY = v; }} 
                        step={10} 
                    />
                    <div className="flex justify-between items-center text-xs">
                        <span className="text-neutral-500">Infinite</span>
                        <input 
                            type="checkbox" 
                            checked={world?.isInfinite || false}
                            onChange={(e) => { if(world) world.isInfinite = e.target.checked; }}
                            className="accent-green-500"
                        />
                    </div>
                    {!world?.isInfinite && (
                        <>
                            <InspectorRow 
                                label="Width" 
                                value={world?.width ?? 4000} 
                                onChange={(v) => { if(world) world.width = v; }} 
                                step={100} 
                                min={100}
                            />
                            <InspectorRow 
                                label="Height" 
                                value={world?.height ?? 4000} 
                                onChange={(v) => { if(world) world.height = v; }} 
                                step={100} 
                                min={100}
                            />
                        </>
                    )}
                </div>

                <div className="space-y-2">
                    <div className="text-[10px] font-bold text-neutral-600 uppercase">Debug</div>
                    <div className="flex justify-between items-center text-xs">
                        <span className="text-neutral-500">Physics Debug Draw</span>
                        <input 
                            type="checkbox" 
                            checked={engine?.debugRenderer?.enabled || false}
                            onChange={(e) => { if(engine?.debugRenderer) engine.debugRenderer.enabled = e.target.checked; }}
                            className="accent-green-500"
                        />
                    </div>
                </div>
                <div className="space-y-2">
                    <div className="text-[10px] font-bold text-neutral-600 uppercase">Camera</div>
                    <InspectorRow 
                        label="Target X" 
                        value={camera?.targetX ?? 0} 
                        onChange={(v) => { if(camera) camera.targetX = v; }} 
                        step={10} 
                    />
                    <InspectorRow 
                        label="Target Y" 
                        value={camera?.targetY ?? 0} 
                        onChange={(v) => { if(camera) camera.targetY = v; }} 
                        step={10} 
                    />
                    <InspectorRow 
                        label="Zoom" 
                        value={camera?.targetZoom ?? 1} 
                        onChange={(v) => { if(camera) camera.targetZoom = v; }} 
                        step={0.1} 
                        min={0.1}
                    />
                </div>
            </div>
        </div>
    );
}

function InspectorRow({ label, value, onChange, step = 1, min = -Infinity, max = Infinity }) {
    const isEditable = onChange !== undefined;

    return (
        <div className="flex justify-between items-center text-xs">
            <span className="text-neutral-500">{label}</span>
            {isEditable ? (
                <input 
                    type="number" 
                    value={Number(value).toFixed(step < 1 ? 2 : 0)}
                    onChange={(e) => {
                        let val = parseFloat(e.target.value);
                        if (!isNaN(val)) {
                            if (val < min) val = min;
                            if (val > max) val = max;
                            onChange(val);
                        }
                    }}
                    step={step}
                    className="w-16 bg-neutral-900 text-neutral-300 font-mono text-right px-1 py-0.5 rounded border border-neutral-800 outline-none focus:border-green-500"
                />
            ) : (
                <span className="text-neutral-300 font-mono">{typeof value === 'number' ? value.toFixed(2) : value}</span>
            )}
        </div>
    );
}
