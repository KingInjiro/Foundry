import React, { useEffect } from 'react';
import { X, Rocket, Cpu, Globe, Boxes, Zap } from 'lucide-react';

export function ChangelogModal({ onClose }) {
    useEffect(() => {
        const onKeyDown = event => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="editor-changelog-title"
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className="bg-[#111] border border-neutral-800 rounded-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
                <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-[#161616]">
                    <div className="flex items-center gap-3">
                        <div className="bg-green-500/20 p-2 rounded-lg text-green-400">
                            <Rocket size={20} />
                        </div>
                        <h2 id="editor-changelog-title" className="text-xl font-bold text-white tracking-widest">CHANGELOG</h2>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close changelog dialog" className="text-neutral-500 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>
                
                <div className="p-6 overflow-y-auto space-y-8 flex-1">
                                        {/* v0.1.2 */}
                    <div className="relative pl-6 border-l-2 border-green-500/30 pb-4">
                        <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-green-500 shadow-[0_0_10px_rgba(74,222,128,0.5)] border-4 border-[#111]"></div>
                        <div className="flex items-end gap-3 mb-4">
                            <h3 className="text-2xl font-bold text-green-400">v0.1.2</h3>
                            <span className="text-neutral-400 font-medium mb-1 tracking-wide">3D Expansion & Animation</span>
                        </div>
                        
                        <div className="space-y-4 text-neutral-300">
                            <p className="text-sm">Huge additions to the 3D ecosystem, introducing skeletal animation, vehicle physics, advanced constraints, and environments.</p>
                            
                            <ul className="space-y-2 text-sm mt-4">
                                <li className="flex gap-3"><Cpu className="text-blue-400 shrink-0" size={18}/> <span>Added <b>Vehicle3D</b> for raycast vehicle controller driving simulations.</span></li>
                                <li className="flex gap-3"><Boxes className="text-purple-400 shrink-0" size={18}/> <span>Upgraded <b>ModelRenderer</b> to support Skeletal Animations, Blending, and IK (Inverse Kinematics).</span></li>
                                <li className="flex gap-3"><Globe className="text-emerald-400 shrink-0" size={18}/> <span>Added <b>Terrain3D</b> for heightmap-based procedural terrain and physics.</span></li>
                                <li className="flex gap-3"><Zap className="text-yellow-400 shrink-0" size={18}/> <span>Added <b>SoftBody3D</b> and <b>PhysicsConstraint3D</b> for advanced physics interactions.</span></li>
                                <li className="flex gap-3"><span className="text-green-400 font-bold shrink-0">✓</span> <span>Added <b>InstancedMesh3D</b> for high-performance foliage/instancing.</span></li>
                                <li className="flex gap-3"><span className="text-green-400 font-bold shrink-0">✓</span> <span>Added <b>Sky3D</b> for procedural day/night cycle and skybox environments.</span></li>
                                <li className="flex gap-3"><span className="text-green-400 font-bold shrink-0">✓</span> <span>Integrated visual logic (React Flow) as a future foundation for visual scripting.</span></li>
                            </ul>
                        </div>
                    </div>

                    {/* v0.1.1 */}
                    <div className="relative pl-6 border-l-2 border-neutral-800 pb-4">
                        <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-green-500 border-4 border-[#111]"></div>
                        <div className="flex items-end gap-3 mb-4">
                            <h3 className="text-lg font-bold text-neutral-400">v0.1.1</h3>
                            <span className="text-neutral-500 font-medium mb-0.5 tracking-wide">3D Fundamentals</span>
                        </div>
                        
                        <div className="space-y-4 text-neutral-300">
                            <p className="text-sm">Added initial capabilities for mixing 3D elements inside the 2D canvas architecture, utilizing Three.js and CANNON-es.</p>
                            
                            <ul className="space-y-2 text-sm mt-4">
                                <li className="flex gap-3"><Cpu className="text-blue-400 shrink-0" size={18}/> <span>Added <b>CANNON.js</b> integration for 3D physics with <code>PhysicsBody3D</code>.</span></li>
                                <li className="flex gap-3"><Boxes className="text-purple-400 shrink-0" size={18}/> <span>Added <b>ModelRenderer</b> component to load and render GLTF/GLB models.</span></li>
                                <li className="flex gap-3"><Globe className="text-emerald-400 shrink-0" size={18}/> <span>Upgraded <b>AssetManager</b> to load <code>.gltf</code>, <code>.glb</code> models and textures.</span></li>
                                <li className="flex gap-3"><Zap className="text-yellow-400 shrink-0" size={18}/> <span>Added 3D <b>Raycasting</b> support for mouse interaction with 3D objects.</span></li>
                                <li className="flex gap-3"><span className="text-green-400 font-bold shrink-0">✓</span> <span>Updated IDE Inspector to support 3D properties (Rotation XYZ, Scale XYZ) and components.</span></li>
                                <li className="flex gap-3"><span className="text-green-400 font-bold shrink-0">✓</span> <span>Implemented Orbit/Fly controls for 3D Camera in the Editor (Right-click + WASD).</span></li>
                                <li className="flex gap-3"><span className="text-green-400 font-bold shrink-0">✓</span> <span>Added basic screen-space depth projection mapping for 2D over 3D (TextRenderer, Particles).</span></li>
                            </ul>
                        </div>
                    </div>

                    {/* v0.1.0 */}
                    <div className="relative pl-6 border-l-2 border-neutral-800 pb-2">
                        <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-neutral-700 border-4 border-[#111]"></div>
                        <div className="flex items-end gap-3 mb-4">
                            <h3 className="text-lg font-bold text-neutral-400">v0.1.0</h3>
                            <span className="text-neutral-500 font-medium mb-0.5 tracking-wide">Initial Alpha</span>
                        </div>
                        
                        <div className="space-y-2 text-sm text-neutral-500">
                            <p>Core foundation of Foundry Engine.</p>
                            <ul className="list-disc list-inside space-y-1 ml-1 opacity-80">
                                <li>Core 2D ECS architecture.</li>
                                <li>Matter.js 2D Physics integration.</li>
                                <li>IDE with scene graph and inspector.</li>
                                <li>Basic WebGL/Three.js setup.</li>
                                <li>2D Canvas rendering system.</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
