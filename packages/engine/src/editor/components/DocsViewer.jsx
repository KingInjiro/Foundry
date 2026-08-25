import React, { useRef, useState, useEffect } from 'react';
import { Book, Code, Box, Crosshair, Image as ImageIcon, Music, Cpu, Zap, Layers, PlayCircle, Settings, Camera, Keyboard, Activity, Workflow, Globe, Monitor, ShieldCheck, Map, Bug, Rocket, CheckCircle2, XCircle, Terminal } from 'lucide-react';

const CodeBlock = ({ code, title, runnable, onRunExample }) => (
    <div className="bg-neutral-950 rounded-lg border border-neutral-800 overflow-hidden font-mono text-sm mt-4">
        <div className="flex items-center justify-between px-4 py-2 bg-neutral-900 border-b border-neutral-800">
            <span className="text-neutral-400">{title || 'Code'}</span>
            {runnable && (
                <button onClick={() => onRunExample?.(code, title)} className="flex items-center gap-1.5 px-3 py-1 bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded transition-colors text-xs font-bold border border-green-500/20 shadow-sm">
                    <PlayCircle size={14} /> Run Example
                </button>
            )}
        </div>
        <div className="p-4 overflow-x-auto text-green-300">
            <pre><code>{code}</code></pre>
        </div>
    </div>
);

export function DocsViewer({ onRunExample }) {
    const [activeSection, setActiveSection] = useState('intro');
    const contentRef = useRef(null);
    const isScrollingRef = useRef(false);

    const sections = [
        { id: 'intro', icon: <Book size={16} />, title: 'Introduction' },
        { id: 'getting-started', icon: <Terminal size={16} />, title: 'Getting Started' },
        { id: 'tutorials', icon: <Map size={16} />, title: 'Tutorials & Guides' },
        { id: 'recipes', icon: <Workflow size={16} />, title: 'Recipes & Systems' },
        { id: 'api-reference', icon: <Code size={16} />, title: 'API Reference' },
        { id: 'architecture', icon: <Layers size={16} />, title: 'Architecture' },
        { id: 'editor', icon: <Monitor size={16} />, title: 'Editor & IDE' },
        { id: 'lifecycle', icon: <Activity size={16} />, title: 'Entity Lifecycle' },
        { id: 'components', icon: <Cpu size={16} />, title: 'Component System' },
        { id: 'world', icon: <Globe size={16} />, title: 'World System' },
        { id: 'physics', icon: <Zap size={16} />, title: 'Physics Engine' },
        { id: '3d-integration', icon: <Box size={16} />, title: '3D & Depth' },
        { id: 'visual-logic', icon: <Workflow size={16} />, title: 'Visual Logic (New)' },
        { id: 'best-practices', icon: <ShieldCheck size={16} />, title: 'Best Practices' },
        { id: 'troubleshooting', icon: <Bug size={16} />, title: 'Troubleshooting' },
        { id: 'capabilities', icon: <Settings size={16} />, title: 'Design Targets' },
        { id: 'export', icon: <Rocket size={16} />, title: 'Export Pipeline' },
        { id: 'roadmap', icon: <Crosshair size={16} />, title: 'Roadmap' },
    ];

    const scrollToSection = (id) => {
        setActiveSection(id);
        isScrollingRef.current = true;
        const element = document.getElementById(`doc-section-${id}`);
        if (element && contentRef.current) {
            contentRef.current.scrollTo({
                top: element.offsetTop - 40,
                behavior: 'smooth'
            });
            setTimeout(() => {
                isScrollingRef.current = false;
            }, 800);
        }
    };

    useEffect(() => {
        const handleScroll = () => {
            if (!contentRef.current || isScrollingRef.current) return;
            
            const scrollPos = contentRef.current.scrollTop;
            
            for (let i = sections.length - 1; i >= 0; i--) {
                const section = sections[i];
                const element = document.getElementById(`doc-section-${section.id}`);
                if (element && scrollPos >= element.offsetTop - 150) {
                    if (activeSection !== section.id) {
                        setActiveSection(section.id);
                    }
                    break;
                }
            }
        };

        const currentRef = contentRef.current;
        if (currentRef) {
            currentRef.addEventListener('scroll', handleScroll, { passive: true });
        }

        return () => {
            if (currentRef) {
                currentRef.removeEventListener('scroll', handleScroll);
            }
        };
    }, [activeSection, sections]);

    return (
        <div className="flex-1 flex overflow-hidden bg-neutral-950 text-neutral-300 font-sans">
            
            {/* Sidebar Navigation */}
            <div className="w-72 bg-neutral-900/40 border-r border-neutral-800 flex flex-col shrink-0 overflow-y-auto">
                <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
                    <h2 className="text-sm font-bold text-neutral-400 uppercase tracking-widest">Platform Docs</h2>
                    <select className="bg-neutral-950 border border-neutral-700 text-neutral-300 text-xs rounded px-2 py-1 outline-none cursor-pointer">
                        <option value="v0.1.2">v0.1.2</option>
                        <option value="beta" disabled>Beta (Soon)</option>
                        <option value="1.0" disabled>1.0 (Planned)</option>
                    </select>
                </div>
                <div className="flex-1 p-2 space-y-1">
                    {sections.map(section => (
                        <button
                            key={section.id}
                            onClick={() => scrollToSection(section.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors text-left ${
                                activeSection === section.id 
                                    ? 'bg-green-500/10 text-green-400 font-bold' 
                                    : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                            }`}
                        >
                            <span className={activeSection === section.id ? 'text-green-500' : 'text-neutral-500'}>
                                {section.icon}
                            </span>
                            {section.title}
                        </button>
                    ))}
                </div>
                <div className="p-4 border-t border-neutral-800 text-xs text-neutral-500 text-center font-mono">
                    Foundry Engine <span className="text-purple-400 font-bold ml-1">API Preview</span>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-8 lg:p-12 scroll-smooth relative" ref={contentRef}>
                <div className="max-w-4xl mx-auto space-y-24 pb-32">
                    
                    {/* Intro */}
                    <div id="doc-section-intro" className="space-y-6 pt-4">
                        <div className="border-b border-neutral-800 pb-8">
                            <div className="flex items-center gap-4 mb-4">
                                <h1 className="text-4xl font-black text-green-400 tracking-tight">Foundry Engine</h1>
                                <span className="bg-purple-500/10 text-purple-400 border border-purple-500/20 px-3 py-1 rounded-full text-xs font-bold tracking-widest uppercase">v0.1.2 (3D Preview)</span>
                            </div>
                            <p className="text-neutral-300 text-2xl font-bold mb-4">
                                Make Games, Not Engines.
                            </p>
                            <p className="text-neutral-400 text-lg leading-relaxed">
                                A lightweight, high-performance 2D entity-component platform built for the web.
                                We handle the physics, batching, and threading so you can focus on making your game fun.
                            </p>
                            <p className="text-neutral-500 italic mt-4 text-sm">
                                Note: The API is stabilizing. Minor changes may occur before Beta.
                            </p>
                        </div>
                    </div>

                    {/* Getting Started */}
                    <div id="doc-section-getting-started" className="space-y-6">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">Getting Started</h2>
                        <p className="text-neutral-300">5 Minutes to Hello World.</p>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                            <div className="bg-neutral-900 p-4 rounded-lg border border-neutral-800 text-center">
                                <div className="text-green-400 font-bold mb-1">1. Create</div>
                                <div className="text-xs text-neutral-500">New Project</div>
                            </div>
                            <div className="bg-neutral-900 p-4 rounded-lg border border-neutral-800 text-center">
                                <div className="text-blue-400 font-bold mb-1">2. Class</div>
                                <div className="text-xs text-neutral-500">Extend Simulation</div>
                            </div>
                            <div className="bg-neutral-900 p-4 rounded-lg border border-neutral-800 text-center">
                                <div className="text-purple-400 font-bold mb-1">3. Entity</div>
                                <div className="text-xs text-neutral-500">Add Sprite</div>
                            </div>
                            <div className="bg-neutral-900 p-4 rounded-lg border border-neutral-800 text-center">
                                <div className="text-yellow-400 font-bold mb-1">4. Run</div>
                                <div className="text-xs text-neutral-500">Play in Browser</div>
                            </div>
                        </div>

                        <CodeBlock 
                            title="HelloWorld.js" onRunExample={onRunExample} 
                            runnable={true}
                            code={`import { Simulation, Entity, Sprite } from 'foundry';

export default class HelloWorld extends Simulation {
    onStart() {
        // Create an entity
        const player = new Entity();
        
        // Add a visual component
        player.addComponent(new Sprite({ image: 'hero.png' }));
        
        // Add to the world
        this.world.add(player);
    }
}`} 
                        />
                        <p className="text-neutral-400 text-sm mt-4">Congratulations! You just spawned your first entity. Ready for more?</p>
                    </div>

                    {/* Tutorials & Guides */}
                    <div id="doc-section-tutorials" className="space-y-6">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">Tutorials & Guides</h2>
                        <p className="text-neutral-300">Don't start with APIs. Start by making games. Click "Run Example" to try the code immediately in the editor.</p>
                        
                        <div className="space-y-12 mt-8">
                            <div>
                                <h3 className="text-2xl font-bold text-green-400 mb-2">1. Your First Game: Avoid the Cubes</h3>
                                <p className="text-neutral-400 mb-4">A complete mini-game in 40 lines of code. Use Arrow Keys to move. Avoid the falling red boxes.</p>
                                <CodeBlock 
                                    title="DodgeGame.js" 
                                    runnable={true}
                                    onRunExample={onRunExample}
                                    code={`import { Simulation, Entity, Sprite, PhysicsBody } from 'foundry';

export default class DodgeGame extends Simulation {
    onStart() {
        // Create player
        this.player = new Entity();
        this.player.transform.setPosition(0, 200);
        this.player.addComponent(new Sprite({ image: 'hero.png', color: '#00ff00' }));
        this.player.addComponent(new PhysicsBody({ type: 'dynamic', mass: 1 }));
        this.world.add(this.player);

        // Ground
        const ground = new Entity();
        ground.transform.setPosition(0, 300);
        ground.addComponent(new Sprite({ width: 800, height: 50, color: '#333' }));
        ground.addComponent(new PhysicsBody({ type: 'static' }));
        this.world.add(ground);
        
        this.timer = 0;
    }

    onUpdate(dt) {
        // Player Input
        const speed = 300;
        let vx = 0;
        if (this.input.isKeyDown('ArrowLeft')) vx = -speed;
        if (this.input.isKeyDown('ArrowRight')) vx = speed;
        
        const currentVel = this.player.getComponent(PhysicsBody).getVelocity();
        this.player.getComponent(PhysicsBody).setVelocity(vx, currentVel.y);
        
        // Jumping
        if (this.input.isKeyDown('ArrowUp') && currentVel.y === 0) {
            this.player.getComponent(PhysicsBody).applyForce(0, -0.05);
        }

        // Spawn falling cubes
        this.timer += dt;
        if (this.timer > 1.0) {
            this.timer = 0;
            const enemy = new Entity();
            enemy.transform.setPosition(Math.random() * 600 - 300, -300);
            enemy.addComponent(new Sprite({ width: 30, height: 30, color: '#ff0000' }));
            enemy.addComponent(new PhysicsBody({ type: 'dynamic' }));
            this.world.add(enemy);
        }
    }
}`} />
                            </div>

                            <div>
                                <h3 className="text-2xl font-bold text-green-400 mb-2">2. Building a Top-Down RPG Camera</h3>
                                <p className="text-neutral-400 mb-4">Learn how to make the camera follow the player, setting boundaries, and handling 8-way movement without gravity.</p>
                                <CodeBlock 
                                    title="RPGBasics.js" 
                                    runnable={true}
                                    onRunExample={onRunExample}
                                    code={`import { Simulation, Entity, Sprite } from 'foundry';

export default class RPGBasics extends Simulation {
    onStart() {
        this.player = new Entity();
        this.player.addComponent(new Sprite({ image: 'hero.png', color: '#4488ff' }));
        this.world.add(this.player);

        // Add some background objects so we can see the camera move
        for(let i=0; i<20; i++) {
            const tree = new Entity();
            tree.transform.setPosition(Math.random() * 1000 - 500, Math.random() * 1000 - 500);
            tree.addComponent(new Sprite({ width: 40, height: 60, color: '#228822' }));
            this.world.add(tree);
        }
    }

    onUpdate(dt) {
        // 8-way movement
        const speed = 200;
        let dx = 0; let dy = 0;
        
        if (this.input.isKeyDown('w')) dy -= 1;
        if (this.input.isKeyDown('s')) dy += 1;
        if (this.input.isKeyDown('a')) dx -= 1;
        if (this.input.isKeyDown('d')) dx += 1;

        // Normalize diagonal speed
        if (dx !== 0 && dy !== 0) {
            const len = Math.sqrt(dx*dx + dy*dy);
            dx /= len; dy /= len;
        }

        this.player.transform.x += dx * speed * dt;
        this.player.transform.y += dy * speed * dt;

        // Camera follow
        this.camera.follow(this.player);
    }
}`} />
                            
<div>
                                <h3 className="text-2xl font-bold text-green-400 mb-2">3. Audio Synthesis </h3>
                                <p className="text-neutral-400 mb-4">Dynamically generate sounds without needing external assets. Great for procedural generation.</p>
                                <CodeBlock 
                                    title="SynthDemo.js" 
                                    runnable={true}
                                    onRunExample={onRunExample}
                                    code={`import { Simulation, Entity, Sprite, Text } from 'foundry';

export default class SynthDemo extends Simulation {
    onStart() {
        // UI Text
        this.info = new Entity();
        this.info.transform.setPosition(0, -100);
        this.info.addComponent(new Text({ text: 'Click anywhere to play a synth note!', color: 'white' }));
        this.world.add(this.info);

        // Visual feedback
        this.visual = new Entity();
        this.visual.addComponent(new Sprite({ width: 50, height: 50, color: '#ff00ff' }));
        this.world.add(this.visual);
    }

    onUpdate(dt) {
        if (this.input.isMouseButtonPressed(0)) {
            // Generate a random frequency between 200 and 800 Hz
            const freq = 200 + Math.random() * 600;
            
            // Play a square wave synth sound
            this.audio.playTone(freq, 'square', 0.4, 0.2);
            
            // Visual pop
            const s = this.visual.getComponent(Sprite);
            s.width = 100;
            s.height = 100;
            
            // Move to mouse
            const mx = this.input.mousePosition.x - this.engine.window.width / 2;
            const my = this.input.mousePosition.y - this.engine.window.height / 2;
            this.visual.transform.setPosition(mx, my);
        }
        
        // Shrink visual
        const s = this.visual.getComponent(Sprite);
        if (s.width > 50) {
            s.width -= 300 * dt;
            s.height -= 300 * dt;
        }
    }
}`} />
                            </div>
                        </div>
                        </div>
                    </div>

                    <div id="doc-section-recipes" className="space-y-6">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">Recipes & Systems</h2>
                        <p className="text-neutral-300">Copy-paste ready architectures for common game systems.</p>
                        
                        <div className="space-y-12 mt-8">
                            <div>
                                <h3 className="text-xl font-bold text-green-400 mb-2">Recipe: Health & Damage System</h3>
                                <p className="text-neutral-400 mb-4">Using custom components to create a reusable health system.</p>
                                <CodeBlock 
                                    title="HealthSystem.js" 
                                    runnable={true}
                                    onRunExample={onRunExample}
                                    code={`import { Simulation, Entity, Component, Sprite, Text } from 'foundry';

// 1. Define custom component
class Health extends Component {
    constructor(max = 100) {
        super();
        this.max = max;
        this.current = max;
    }
    damage(amount) {
        this.current -= amount;
        if (this.current <= 0) this.entity.destroy();
    }
}

export default class BattleGame extends Simulation {
    onStart() {
        this.enemy = new Entity();
        this.enemy.addComponent(new Sprite({ width: 50, height: 50, color: '#ff3333' }));
        this.enemy.addComponent(new Health(50));
        
        // Add a floating text for health
        this.hpText = new Entity();
        this.hpText.addComponent(new Text({ text: 'HP: 50', color: 'white' }));
        this.hpText.transform.setPosition(0, -40);
        this.enemy.addChild(this.hpText);
        
        this.world.add(this.enemy);
    }

    onUpdate() {
        if (!this.enemy.isDestroyed) {
            const hp = this.enemy.getComponent(Health);
            // Click to deal damage
            if (this.input.isMouseButtonPressed(0)) {
                hp.damage(10);
                this.hpText.getComponent(Text).text = 'HP: ' + hp.current;
                
                // Visual flash
                this.enemy.getComponent(Sprite).color = '#ffffff';
                setTimeout(() => {
                    if (!this.enemy.isDestroyed) this.enemy.getComponent(Sprite).color = '#ff3333';
                }, 100);
            }
        }
    }
}`} />
                            </div>
                        </div>
                    </div>

                    <div id="doc-section-api-reference" className="space-y-6">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">API Reference</h2>
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded p-4 text-blue-400 text-sm flex items-start gap-3">
                            <span className="text-xl">ℹ️</span>
                            <div>
                                <strong>Architectural Note:</strong> Currently written manually for the v0.1.2 preview. 
                                In Beta, this reference will be generated automatically from JSDoc comments via our documentation pipeline to ensure it stays perfectly in sync with the codebase.
                            </div>
                        </div>
                        <p className="text-neutral-300 mt-4">The core classes and methods available in the Foundry Engine.</p>

                        <div className="space-y-8">
                            <div className="bg-neutral-900 rounded-lg p-6 border border-neutral-800">
                                <h3 className="text-xl font-bold text-blue-400 font-mono mb-4">class Simulation</h3>
                                <p className="text-neutral-400 mb-4 text-sm">The root entry point of your game.</p>
                                <ul className="space-y-6 font-mono text-sm">
                                    <li className="border-b border-neutral-800 pb-6">
                                        <div className="flex gap-4 mb-3">
                                            <span className="text-green-400 shrink-0">this.camera.follow(entity)</span>
                                            <span className="text-neutral-400">Makes the viewport track an entity.</span>
                                        </div>
                                        <CodeBlock 
                                            title="CameraFollow.js"
                                            runnable={true}
                                            onRunExample={onRunExample}
                                            code={`import { Simulation, Entity, Sprite } from 'foundry';

export default class CameraDemo extends Simulation {
    onStart() {
        this.player = new Entity();
        this.player.addComponent(new Sprite({ image: 'hero.png', color: '#ffcc00' }));
        this.world.add(this.player);

        // Reference objects
        for(let i=0; i<10; i++) {
            const block = new Entity();
            block.transform.setPosition(i * 100, 0);
            block.addComponent(new Sprite({ width: 20, height: 20, color: '#444' }));
            this.world.add(block);
        }
    }

    onUpdate(dt) {
        this.player.transform.x += 150 * dt;
        this.camera.follow(this.player);
    }
}`} />
                                    </li>
                                </ul>
                            </div>

                            <div className="bg-neutral-900 rounded-lg p-6 border border-neutral-800">
                                <h3 className="text-xl font-bold text-blue-400 font-mono mb-4">Core Components</h3>
                                <div className="space-y-8 font-mono text-sm">
                                    <div className="border border-neutral-700 p-4 rounded">
                                        <div className="text-purple-400 font-bold mb-2">Sprite</div>
                                        <div className="text-neutral-400 text-xs mb-4">new Sprite({'{'} image, color, width, height {'}'})</div>
                                        <CodeBlock 
                                            title="SpriteExample.js"
                                            runnable={true}
                                            onRunExample={onRunExample}
                                            code={`import { Simulation, Entity, Sprite } from 'foundry';

export default class SpriteDemo extends Simulation {
    onStart() {
        const e = new Entity();
        e.addComponent(new Sprite({ width: 100, height: 100, color: '#ff00ff' }));
        this.world.add(e);
    }
}`} />
                                    </div>

                                    <div className="border border-neutral-700 p-4 rounded">
                                        <div className="text-purple-400 font-bold mb-2">Animator</div>
                                        <div className="text-neutral-400 text-xs mb-4">new Animator(animations) & play(animName)</div>
                                        <CodeBlock 
                                            title="AnimatorExample.js"
                                            runnable={true}
                                            onRunExample={onRunExample}
                                            code={`import { Simulation, Entity, Sprite, Animator } from 'foundry';

export default class AnimDemo extends Simulation {
    onStart() {
        this.player = new Entity();
        // Base sprite acts as the frame
        this.player.addComponent(new Sprite({ width: 64, height: 64, color: '#ffcc00' }));
        
        // Setup animator
        this.player.addComponent(new Animator({
            idle: { frames: [0, 1], speed: 2 },
            run: { frames: [2, 3, 4], speed: 10 }
        }));
        
        this.world.add(this.player);
    }

    onUpdate(dt) {
        const anim = this.player.getComponent(Animator);
        if (this.input.isKeyDown('ArrowRight')) {
            anim.play('run');
            this.player.transform.x += 100 * dt;
        } else {
            anim.play('idle');
        }
    }
}`} />
                                    </div>
                                    <div className="border border-neutral-700 p-4 rounded">
                                        <div className="text-purple-400 font-bold mb-2">PhysicsBody</div>
                                        <div className="text-neutral-400 text-xs mb-4">new PhysicsBody({'{'} type, mass {'}'}) & applyForce(x, y)</div>
                                        <CodeBlock 
                                            title="PhysicsExample.js"
                                            runnable={true}
                                            onRunExample={onRunExample}
                                            code={`import { Simulation, Entity, Sprite, PhysicsBody } from 'foundry';

export default class PhysicsDemo extends Simulation {
    onStart() {
        this.ball = new Entity();
        this.ball.addComponent(new Sprite({ width: 30, height: 30, color: '#00ffff' }));
        this.ball.addComponent(new PhysicsBody({ type: 'dynamic', mass: 1 }));
        this.world.add(this.ball);

        const ground = new Entity();
        ground.transform.setPosition(0, 200);
        ground.addComponent(new Sprite({ width: 400, height: 20, color: '#333' }));
        ground.addComponent(new PhysicsBody({ type: 'static' }));
        this.world.add(ground);
    }

    onUpdate() {
        if (this.input.isMouseButtonDown(0)) {
            this.ball.getComponent(PhysicsBody).applyImpulse(0, -600);
        }
    }
}`} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div id="doc-section-architecture" className="space-y-6">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">Architecture</h2>
                        
                        <h3 className="text-xl font-bold text-white mt-8 mb-4">Why This Engine?</h3>
                        <div className="grid md:grid-cols-2 gap-4">
                            <div className="bg-neutral-900 p-5 rounded-lg border border-neutral-800">
                                <h4 className="text-lg font-bold text-green-400 mb-2">1. Simplicity</h4>
                                <p className="text-sm text-neutral-400 leading-relaxed">Everything should require as little boilerplate as possible. Less setup, more game logic.</p>
                            </div>
                            <div className="bg-neutral-900 p-5 rounded-lg border border-neutral-800">
                                <h4 className="text-lg font-bold text-green-400 mb-2">2. Performance</h4>
                                <p className="text-sm text-neutral-400 leading-relaxed">Object pooling, batching, spatial partitioning, and Web Worker execution are built-in.</p>
                            </div>
                            <div className="bg-neutral-900 p-5 rounded-lg border border-neutral-800">
                                <h4 className="text-lg font-bold text-green-400 mb-2">3. Familiarity</h4>
                                <p className="text-sm text-neutral-400 leading-relaxed">Developers coming from Unity or Godot should feel instantly at home with the Component system.</p>
                            </div>
                            <div className="bg-neutral-900 p-5 rounded-lg border border-neutral-800">
                                <h4 className="text-lg font-bold text-green-400 mb-2">4. Web First</h4>
                                <p className="text-sm text-neutral-400 leading-relaxed">The browser is the primary platform, not a compromised export target. We embrace web standards.</p>
                            </div>
                        </div>

                        <h3 className="text-xl font-bold text-white mt-12 mb-4">The Constitution (Engine Principles)</h3>
                        <ul className="space-y-4 text-neutral-300 bg-neutral-900/50 p-6 rounded-lg border border-neutral-800">
                            <li className="flex gap-4"><ShieldCheck className="text-green-500 shrink-0 mt-0.5" size={20}/> <span><strong>Encapsulation:</strong> User code must never know about the internal physics or renderer implementations.</span></li>
                            <li className="flex gap-4"><ShieldCheck className="text-green-500 shrink-0 mt-0.5" size={20}/> <span><strong>Decoupling:</strong> Components must never depend directly on each other to function. Use events.</span></li>
                            <li className="flex gap-4"><ShieldCheck className="text-green-500 shrink-0 mt-0.5" size={20}/> <span><strong>Parallel by Design:</strong> Core systems must be schedulable independently. Engine subsystems should communicate through data and events rather than direct execution, enabling future multithreaded execution without breaking the public API.</span></li>
                            <li className="flex gap-4"><ShieldCheck className="text-green-500 shrink-0 mt-0.5" size={20}/> <span><strong>Single Source of Truth:</strong> The engine must have a single source of truth for all transformations (<code className="text-purple-400 px-1 bg-neutral-950 rounded">Transform</code>).</span></li>
                            <li className="flex gap-4"><ShieldCheck className="text-green-500 shrink-0 mt-0.5" size={20}/> <span><strong>Stability:</strong> The public API must be stable and must not break without absolute necessity.</span></li>
                            <li className="flex gap-4"><ShieldCheck className="text-green-500 shrink-0 mt-0.5" size={20}/> <span><strong>Modularity:</strong> Any core system must be replaceable without forcing developers to rewrite their game logic.</span></li>
                        </ul>

                        <h3 className="text-xl font-bold text-white mt-12 mb-4">Strict Frame Execution Order</h3>
                        <p className="text-neutral-400 mb-4">This order is a core contract of the engine and must not be violated. Any changes to this flow are breaking changes.</p>
                        <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-800 overflow-x-auto font-mono text-sm leading-loose text-neutral-300">
                            <div className="text-neutral-500">// Early Frame Phase</div>
                            <div className="text-white">Input Update</div>
                            <div className="text-neutral-500 text-xs">↓</div>
                            <div className="text-white">Fixed Update (Physics)</div>
                            <div className="text-neutral-500 text-xs">↓</div>
                            <div className="text-white">Update Events</div>
                            <div className="text-neutral-500 text-xs">↓</div>
                            <div className="text-neutral-500 mt-4">// Task Phase</div>
                            <div className="text-green-400 font-bold">TaskScheduler.begin()</div>
                            <div className="pl-4">
                                <div className="text-orange-400">dispatch( AI )</div>
                                <div className="text-orange-400">dispatch( Navigation )</div>
                                <div className="text-orange-400">dispatch( Animation )</div>
                            </div>
                            <div className="text-green-400 font-bold">TaskScheduler.end()</div>
                            <div className="text-neutral-500 text-xs">↓</div>
                            <div className="text-white">Apply Task Events / State Changes</div>
                            <div className="text-neutral-500 text-xs">↓</div>
                            <div className="text-neutral-500 mt-4">// Late Frame Phase</div>
                            <div className="text-white">Late Update</div>
                            <div className="text-neutral-500 text-xs">↓</div>
                            <div className="text-white">Renderer</div>
                            <div className="text-neutral-500 text-xs">↓</div>
                            <div className="text-white">UI</div>
                            <div className="text-neutral-500 text-xs">↓</div>
                            <div className="text-white">Audio</div>
                        </div>

                        <h3 className="text-xl font-bold text-white mt-12 mb-4">Engine Layers</h3>
                        <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-800 overflow-x-auto font-mono text-sm leading-loose">
                            <div className="text-green-400 font-bold text-lg mb-2">Engine</div>
                            <div className="pl-4 border-l-2 border-neutral-700 ml-2 space-y-1 py-2 text-neutral-300">
                                <div>├── Loop</div>
                                <div>├── Renderer</div>
                                <div>├── Physics</div>
                                <div>├── Input</div>
                                <div>├── Audio</div>
                                <div>├── Assets</div>
                                <div>└── SimulationManager</div>
                            </div>
                            <div className="pl-8 text-neutral-500 my-3 text-xs uppercase tracking-widest">↓ manages ↓</div>
                            <div className="pl-8 text-blue-400 font-bold text-lg mb-2">Simulation</div>
                            <div className="pl-12 border-l-2 border-neutral-700 ml-10 space-y-1 py-2 text-neutral-300">
                                <div>└── <span className="text-yellow-400 font-bold">World</span></div>
                                <div className="pl-8 border-l-2 border-neutral-700 ml-2 py-2">
                                    <div>├── EntityManager</div>
                                    <div>├── SpatialGrid</div>
                                    <div>└── <span className="text-purple-400 font-bold">Entities</span></div>
                                    <div className="pl-8 border-l-2 border-neutral-700 ml-2 py-2">
                                        <div>├── Transform</div>
                                        <div>└── <span className="text-orange-400 font-bold">Components</span></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Editor */}
                    <div id="doc-section-editor" className="space-y-6">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">Editor & IDE</h2>
                        <p className="text-neutral-300">The engine provides a fully integrated platform. The IDE runs natively in the browser, providing a seamless workflow from code, visual scripting (Visual Logic Graph), to execution.</p>
                        
                        <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-800 overflow-x-auto">
                            <div className="flex flex-col items-center space-y-6 font-mono text-sm min-w-[700px]">
                                <div className="grid grid-cols-3 gap-6 w-full max-w-4xl">
                                    <div className="bg-neutral-950 p-5 border border-neutral-700 rounded-lg text-center shadow-lg">
                                        <span className="text-blue-400 block mb-4 font-bold text-base uppercase tracking-wider">Editor UI</span>
                                        <div className="space-y-3 text-neutral-400 text-xs">
                                            <div className="bg-neutral-900 p-2.5 rounded border border-neutral-800">Monaco Editor</div>
                                            <div className="bg-neutral-900 p-2.5 rounded border border-neutral-800">React Inspector</div>
                                            <div className="bg-neutral-900 p-2.5 rounded border border-neutral-800">Visual Logic Graph</div>
                                            <div className="bg-neutral-900 p-2.5 rounded border border-neutral-800">Asset Browser & Console</div>
                                        </div>
                                    </div>
                                    <div className="bg-neutral-950 p-5 border border-neutral-700 rounded-lg text-center shadow-lg flex flex-col justify-center relative overflow-hidden">
                                        <span className="text-purple-400 block mb-4 font-bold text-base uppercase tracking-wider">Bridge</span>
                                        <div className="space-y-3 text-neutral-400 text-xs relative z-10">
                                            <div className="bg-neutral-900 p-2.5 rounded border border-neutral-800 font-bold border-purple-500/30">SharedArrayBuffer</div>
                                            <div className="bg-neutral-900 p-2.5 rounded border border-neutral-800 font-bold border-purple-500/30">PostMessage</div>
                                        </div>
                                    </div>
                                    <div className="bg-neutral-950 p-5 border border-neutral-700 rounded-lg text-center shadow-lg">
                                        <span className="text-green-400 block mb-4 font-bold text-base uppercase tracking-wider">Engine Worker</span>
                                        <div className="space-y-3 text-neutral-400 text-xs">
                                            <div className="bg-neutral-900 p-2.5 rounded border border-neutral-800">Simulation Loop</div>
                                            <div className="bg-neutral-900 p-2.5 rounded border border-neutral-800">Physics & Logic</div>
                                            <div className="bg-neutral-900 p-2.5 rounded border border-neutral-800">OffscreenCanvas</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    {/* Lifecycle */}
                    <div id="doc-section-lifecycle" className="space-y-6">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">Entity Lifecycle</h2>
                        <p className="text-neutral-300">Understanding the execution order is critical. Entities go through a strict lifecycle managed by the World.</p>
                        
                        <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-800 overflow-x-auto">
                            <div className="space-y-4 font-mono text-sm min-w-max">
                                <div className="flex items-center gap-4">
                                    <span className="text-purple-400 w-32 shrink-0 font-bold">constructor()</span>
                                    <span className="text-neutral-400">Initialize properties, add components. Not yet in world.</span>
                                </div>
                                <div className="text-neutral-600 pl-4">↓</div>
                                <div className="flex items-center gap-4">
                                    <span className="text-green-400 w-32 shrink-0 font-bold">onSpawn(world)</span>
                                    <span className="text-neutral-400">Entity is added to the World. Safe to query other entities.</span>
                                </div>
                                <div className="text-neutral-600 pl-4">↓</div>
                                <div className="flex items-center gap-4">
                                    <span className="text-blue-400 w-32 shrink-0 font-bold">onUpdate(dt)</span>
                                    <span className="text-neutral-400">Called every frame. Handle input, movement, game logic.</span>
                                </div>
                                <div className="text-neutral-600 pl-4">↓</div>
                                <div className="flex items-center gap-4">
                                    <span className="text-yellow-400 w-32 shrink-0 font-bold">onRender(ctx)</span>
                                    <span className="text-neutral-400">Called during render phase. For custom drawing.</span>
                                </div>
                                <div className="text-neutral-600 pl-4">↓</div>
                                <div className="flex items-center gap-4">
                                    <span className="text-red-400 w-32 shrink-0 font-bold">onDestroy()</span>
                                    <span className="text-neutral-400">Entity is removed. Cleanup resources.</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Transform */}
                    <div id="doc-section-transform" className="space-y-6">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">Transform & Hierarchy</h2>
                        <p className="text-neutral-300">Every Entity inherits from a Transform class, providing a robust scene graph.</p>
                        
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="bg-neutral-900/50 p-6 rounded-lg border border-neutral-800">
                                <h3 className="text-xl font-bold text-white mb-3">Local Properties</h3>
                                <ul className="text-sm text-neutral-400 space-y-2 font-mono">
                                    <li><span className="text-green-300">x, y</span> - Local position</li>
                                    <li><span className="text-green-300">rotation</span> - Local rotation (radians)</li>
                                    <li><span className="text-green-300">scaleX, scaleY</span> - Local scale</li>
                                    <li><span className="text-green-300">width, height</span> - Size bounds</li>
                                    <li><span className="text-green-300">zIndex</span> - Render order</li>
                                </ul>
                            </div>
                            
                            <div className="bg-neutral-900/50 p-6 rounded-lg border border-neutral-800">
                                <h3 className="text-xl font-bold text-white mb-3">Hierarchy & Matrices</h3>
                                <ul className="text-sm text-neutral-400 space-y-2 font-mono">
                                    <li><span className="text-green-300">parent</span> - Parent entity reference</li>
                                    <li><span className="text-green-300">children</span> - Array of child entities</li>
                                    <li><span className="text-green-300">localMatrix</span> - Matrix3 local transform</li>
                                    <li><span className="text-green-300">globalMatrix</span> - Matrix3 world transform</li>
                                    <li><span className="text-green-300">dirty</span> - Needs recalculation flag</li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    {/* Components */}
                    <div id="doc-section-components" className="space-y-6">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">Component System</h2>
                        <p className="text-neutral-300">Behaviors and data are attached to Entities via Components. Components have their own lifecycle and update loop.</p>
                        
                        <CodeBlock 
                            title="ComponentAPI.js"
                            runnable={false}
                            code={`// Add a component
this.sprite = this.addComponent(new Sprite({ image: 'player.png' }));

// Retrieve a component
const phys = this.getComponent(PhysicsBody);

// Check if exists
if (this.hasComponent(Animator)) { ... }

// Remove a component
this.removeComponent(Sprite);`} 
                        />
                    </div>

                    {/* World */}
                    <div id="doc-section-world" className="space-y-6">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">World System</h2>
                        <p className="text-neutral-300">The World acts as the conductor, orchestrating all underlying systems automatically. It routes entities to appropriate managers.</p>
                        
                        <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-800 overflow-x-auto">
                            <div className="flex flex-col items-center space-y-4 font-mono text-sm min-w-[600px]">
                                <div className="bg-neutral-950 px-6 py-3 border border-neutral-700 rounded-lg text-white font-bold w-full text-center">World</div>
                                <div className="text-neutral-600">↓ distributes to ↓</div>
                                <div className="grid grid-cols-4 gap-4 w-full">
                                    <div className="bg-neutral-950 p-4 border border-neutral-800 rounded-lg text-center shadow-md">
                                        <span className="text-blue-400 block mb-1 font-bold">EntityManager</span>
                                        <span className="text-xs text-neutral-500">Lifecycle & Hierarchy</span>
                                    </div>
                                    <div className="bg-neutral-950 p-4 border border-neutral-800 rounded-lg text-center shadow-md">
                                        <span className="text-green-400 block mb-1 font-bold">Spatial Grid</span>
                                        <span className="text-xs text-neutral-500">Fast Culling & Queries</span>
                                    </div>
                                    <div className="bg-neutral-950 p-4 border border-neutral-800 rounded-lg text-center shadow-md">
                                        <span className="text-yellow-400 block mb-1 font-bold">Physics Engine</span>
                                        <span className="text-xs text-neutral-500">Collision & Movement</span>
                                    </div>
                                    <div className="bg-neutral-950 p-4 border border-neutral-800 rounded-lg text-center shadow-md">
                                        <span className="text-purple-400 block mb-1 font-bold">Renderer Pipeline</span>
                                        <span className="text-xs text-neutral-500">Batching & Drawing</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Physics */}
                    <div id="doc-section-physics" className="space-y-6">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">Physics Engine</h2>
                        <p className="text-neutral-300">Add a <code className="text-purple-400">PhysicsBody</code> component to an entity to enable rigorous collision and movement within the internal 2D physics backend.</p>
                        
                        <CodeBlock 
                            title="PhysicsSetup.js"
                            runnable={true}
                            code={`this.body = this.addComponent(new PhysicsBody({
    shape: 'rectangle',    // 'rectangle', 'circle', 'polygon'
    width: 32, height: 32, // Used for rectangle
    isStatic: false,       // True for unmovable walls
    isSensor: false,       // True for triggers (no physical response)
    friction: 0.1,
    restitution: 0.2,      // Bounciness (0-1)
}));

// Apply velocity directly (e.g. for walking)
this.body.setVelocity(200, this.body.velocity.y);

// Apply a force (e.g. for a thruster)
this.body.applyForce({ x: 0, y: -0.05 });`} 
                        />
                    </div>

                    {/* 3D Integration */}
                    <div id="doc-section-3d-integration" className="space-y-6">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">3D & Depth (v0.1.2)</h2>
                        <p className="text-neutral-300">Foundry Engine allows mixing 3D models and 3D physics natively within its architecture via Three.js and Cannon-ES. 2D Elements like particles and text automatically depth-project over 3D scenes.</p>
                        
                        <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-800 overflow-x-auto text-sm">
                            <ul className="space-y-3 text-neutral-300">
                                <li><strong>ModelRenderer:</strong> Renders GLTF/GLB models. Supports Skeletal Animations, Blending, and Inverse Kinematics (IK) via <code>CCDIKSolver</code>.</li>
                                <li><strong>PhysicsBody3D:</strong> Cannon-ES 3D Rigidbody (Box, Sphere, Plane, Cylinder, Convex).</li>
                                <li><strong>PhysicsConstraint3D:</strong> Hinge, PointToPoint, Distance, ConeTwist, and Lock constraints.</li>
                                <li><strong>Vehicle3D:</strong> Raycast vehicle controller with suspension and wheel friction.</li>
                                <li><strong>SoftBody3D:</strong> Volume and cloth soft-body physics based on Cannon-ES particle grids.</li>
                                <li><strong>Terrain3D:</strong> Heightmap-based terrain with LODs and auto-generated physics trimesh.</li>
                                <li><strong>InstancedMesh3D:</strong> High-performance instanced rendering for foliage and repetitive objects.</li>
                                <li><strong>Sky3D:</strong> Procedural day/night cycle, sun movement, and ambient light adjustments.</li>
                                <li><strong>Light3D:</strong> Ambient, Directional (with shadows), or Point lights.</li>
                            </ul>
                        </div>

                        <CodeBlock 
                            title="Advanced3DSetup.js"
                            runnable={false}
                            code={`// 1. Procedural Sky & Sun
this.sky = this.addComponent(Sky3D, { sunPosition: [50, 10, 50], intensity: 1.2 });

// 2. Load & Render a GLTF Model with Animation
this.model = this.addComponent(ModelRenderer, {
    modelName: 'character.glb',
    castShadow: true
});
this.model.playAnimation('Run');
this.model.blendAnimations('Run', 'Jump', 0.5); // Crossfade

// 3. Add Advanced Physics (Vehicle)
this.vehicle = this.addComponent(Vehicle3D, {
    chassisMass: 1500,
    chassisSize: [2, 1, 4]
});
this.vehicle.addWheel({ position: [-1, -0.5, 2], isFront: true });
// Apply engine force in update loop...
`} 
                        />
                    </div>

                                        {/* Visual Logic */}
                    <div id="doc-section-visual-logic" className="space-y-6">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">Visual Logic Graph (v0.1.2)</h2>
                        <p className="text-neutral-300">Foundry Engine now includes a Visual Logic Graph built on React Flow. It allows non-programmers or technical artists to build game behaviors using a node-based interface.</p>
                        
                        <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-800 overflow-x-auto text-sm">
                            <ul className="space-y-3 text-neutral-300">
                                <li><strong>Event Nodes:</strong> Trigger logic based on events like <code>On Start</code>, <code>On Update</code>, or <code>On Collision</code>.</li>
                                <li><strong>Action Nodes:</strong> Perform tasks like moving entities, playing animations, or spawning particles.</li>
                                <li><strong>Flow Nodes:</strong> Branching and loops (If/Else, Sequences).</li>
                                <li><strong>Code Generation:</strong> The visual graph compiles down into high-performance JavaScript state machines that run natively in the engine worker.</li>
                            </ul>
                        </div>
                    </div>

                    {/* Best Practices */}
                    <div id="doc-section-best-practices" className="space-y-6">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">Best Practices</h2>
                        <p className="text-neutral-300">Follow these guidelines to keep your project scalable and performant.</p>
                        
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="bg-green-950/20 p-6 rounded-lg border border-green-900/50">
                                <h3 className="text-lg font-bold text-green-400 mb-4 flex items-center gap-2"><CheckCircle2 size={20}/> Good</h3>
                                <ul className="space-y-4 text-sm text-neutral-300">
                                    <li><strong>Favor Composition:</strong> Use Components (e.g., <code className="text-purple-400">HealthComponent</code>, <code className="text-purple-400">AttackComponent</code>) instead of deeply inheriting <code className="text-purple-400">class Enemy extends Character</code>.</li>
                                    <li><strong>Object Pooling:</strong> For bullets or particles, pre-allocate them in an array and reset their state instead of calling <code className="text-purple-400">new Entity()</code> every frame.</li>
                                    <li><strong>Event-Driven Data:</strong> Send events to the UI thread (<code className="text-purple-400">world.emit('score', 10)</code>) rather than polling game state inside React components.</li>
                                </ul>
                            </div>
                            
                            <div className="bg-red-950/20 p-6 rounded-lg border border-red-900/50">
                                <h3 className="text-lg font-bold text-red-400 mb-4 flex items-center gap-2"><XCircle size={20}/> Bad</h3>
                                <ul className="space-y-4 text-sm text-neutral-300">
                                    <li><strong>The "God Class":</strong> Creating a 5000-line <code className="text-purple-400">GameManager.js</code> that knows about every player, enemy, and bullet.</li>
                                    <li><strong>Querying every frame:</strong> Running <code className="text-purple-400">world.getEntitiesByTag('enemy')</code> inside <code className="text-purple-400">onUpdate</code>. Cache the references instead.</li>
                                    <li><strong>Direct DOM manipulation:</strong> Trying to use <code className="text-purple-400">document.getElementById</code> from inside a Component (Game logic runs in a Web Worker and has no DOM access!).</li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    {/* Troubleshooting */}
                    <div id="doc-section-troubleshooting" className="space-y-6">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">Troubleshooting</h2>
                        <p className="text-neutral-300">Common pitfalls and how to quickly resolve them.</p>
                        
                        <div className="space-y-4">
                            <div className="bg-neutral-900 p-5 rounded-lg border border-neutral-800 flex items-start gap-4">
                                <Bug className="text-red-400 shrink-0 mt-1" size={20} />
                                <div>
                                    <h4 className="text-white font-bold mb-2">Issue: Player falls straight through the floor</h4>
                                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-neutral-300">
                                        <div className="bg-neutral-950 px-2 py-1 rounded border border-neutral-700">PhysicsBody missing?</div>
                                        <span className="text-neutral-600">→</span>
                                        <div className="bg-neutral-950 px-2 py-1 rounded border border-neutral-700">isStatic: false on floor?</div>
                                        <span className="text-neutral-600">→</span>
                                        <div className="bg-neutral-950 px-2 py-1 rounded border border-neutral-700">isSensor: true?</div>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="bg-neutral-900 p-5 rounded-lg border border-neutral-800 flex items-start gap-4">
                                <Bug className="text-red-400 shrink-0 mt-1" size={20} />
                                <div>
                                    <h4 className="text-white font-bold mb-2">Issue: Screen is completely black / Nothing renders</h4>
                                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-neutral-300">
                                        <div className="bg-neutral-950 px-2 py-1 rounded border border-neutral-700">Camera position off-screen?</div>
                                        <span className="text-neutral-600">→</span>
                                        <div className="bg-neutral-950 px-2 py-1 rounded border border-neutral-700">Sprite texture loaded?</div>
                                        <span className="text-neutral-600">→</span>
                                        <div className="bg-neutral-950 px-2 py-1 rounded border border-neutral-700">Entity added to World?</div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-neutral-900 p-5 rounded-lg border border-neutral-800 flex items-start gap-4">
                                <Bug className="text-red-400 shrink-0 mt-1" size={20} />
                                <div>
                                    <h4 className="text-white font-bold mb-2">Issue: Movement feels stuttery or jittery</h4>
                                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-neutral-300">
                                        <div className="bg-neutral-950 px-2 py-1 rounded border border-neutral-700 text-yellow-300">Are you multiplying velocity by dt?</div>
                                        <span className="text-neutral-500">(Physics engine applies dt internally. Only multiply by dt for manual position updates)</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Capabilities */}
                    <div id="doc-section-capabilities" className="space-y-6">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">Design Targets & Limits</h2>
                        <p className="text-neutral-300">The engine is built to push the browser to its limits, offering native-like performance for 2D games.</p>
                        
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-800">
                                <h3 className="text-xl font-bold text-green-400 mb-4">Target Performance (60 FPS)</h3>
                                <ul className="space-y-3 font-mono text-sm">
                                    <li className="flex justify-between border-b border-neutral-800 pb-2">
                                        <span className="text-neutral-400">Active Entities</span>
                                        <span className="text-white font-bold">10,000+</span>
                                    </li>
                                    <li className="flex justify-between border-b border-neutral-800 pb-2">
                                        <span className="text-neutral-400">Active Particles</span>
                                        <span className="text-white font-bold">5,000+</span>
                                    </li>
                                    <li className="flex justify-between border-b border-neutral-800 pb-2">
                                        <span className="text-neutral-400">Rigid Bodies</span>
                                        <span className="text-white font-bold">2,000+</span>
                                    </li>
                                    <li className="flex justify-between border-b border-neutral-800 pb-2">
                                        <span className="text-neutral-400">Draw Calls</span>
                                        <span className="text-white font-bold">Auto-Batched</span>
                                    </li>
                                </ul>
                            </div>
                            
                            <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-800">
                                <h3 className="text-xl font-bold text-green-400 mb-4">Core Tech Stack</h3>
                                <ul className="space-y-3 font-mono text-sm">
                                    <li className="flex justify-between border-b border-neutral-800 pb-2">
                                        <span className="text-neutral-400">Execution</span>
                                        <span className="text-white">Web Worker Isolated</span>
                                    </li>
                                    <li className="flex justify-between border-b border-neutral-800 pb-2">
                                        <span className="text-neutral-400">Rendering</span>
                                        <span className="text-white">OffscreenCanvas</span>
                                    </li>
                                    <li className="flex justify-between border-b border-neutral-800 pb-2">
                                        <span className="text-neutral-400">Memory</span>
                                        <span className="text-white">Object Pooling</span>
                                    </li>
                                    <li className="flex justify-between border-b border-neutral-800 pb-2">
                                        <span className="text-neutral-400">Sync</span>
                                        <span className="text-white">SharedArrayBuffer</span>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    {/* Export Pipeline */}
                    <div id="doc-section-export" className="space-y-6">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">Export Pipeline</h2>
                        <p className="text-neutral-300">How to get your game out of the Editor and into players' hands.</p>
                        
                        <div className="bg-neutral-900/50 p-6 rounded-lg border border-neutral-800 overflow-x-auto">
                            <div className="flex items-center gap-4 text-sm font-mono pb-2 min-w-[700px]">
                                <div className="bg-neutral-950 p-4 rounded border border-neutral-700 text-green-400 shrink-0 shadow-md">
                                    <div className="font-bold mb-1">1. Develop</div>
                                    <div className="text-xs text-neutral-500">Browser IDE</div>
                                </div>
                                <div className="text-neutral-600 shrink-0">→</div>
                                <div className="bg-neutral-950 p-4 rounded border border-neutral-700 text-blue-400 shrink-0 shadow-md">
                                    <div className="font-bold mb-1">2. Build</div>
                                    <div className="text-xs text-neutral-500">Bundle JS/Assets</div>
                                </div>
                                <div className="text-neutral-600 shrink-0">→</div>
                                <div className="flex flex-col gap-2 shrink-0 w-48">
                                    <div className="bg-neutral-950 px-4 py-2 rounded border border-neutral-700 text-white font-bold text-center shadow-sm">Web App</div>
                                    <div className="bg-neutral-950 px-4 py-2 rounded border border-neutral-700 text-orange-400 font-bold text-center shadow-sm">Desktop App</div>
                                    <div className="bg-neutral-950 px-4 py-2 rounded border border-neutral-700 text-yellow-400 font-bold text-center shadow-sm">Mobile App</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Roadmap */}
                    <div id="doc-section-roadmap" className="space-y-6 pb-20">
                        <h2 className="text-3xl font-bold text-white border-b border-neutral-800 pb-4">Roadmap</h2>
                        <p className="text-neutral-300">Where the platform is headed.</p>
                        
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-800">
                                <h3 className="text-xl font-bold text-green-400 mb-4">Current (v0.1.2)</h3>
                                <ul className="space-y-2 text-sm text-neutral-300 font-mono">
                                    <li className="flex gap-2"><span className="text-green-500">✓</span> 2D Engine Core</li>
                                    <li className="flex gap-2"><span className="text-green-500">✓</span> RigidBody Physics</li>
                                    <li className="flex gap-2"><span className="text-green-500">✓</span> Tilemaps & Sprites</li>
                                    <li className="flex gap-2"><span className="text-green-500">✓</span> WebGL Renderer</li>
                                    <li className="flex gap-2"><span className="text-green-500">✓</span> Worker Isolation</li>
                                    <li className="flex gap-2"><span className="text-green-500">✓</span> Audio Synthesis Backend</li>
                                    <li className="flex gap-2"><span className="text-green-500">✓</span> Physics Debug Drawer</li>
                                    <li className="flex gap-2"><span className="text-green-500">✓</span> 3D Physics (CANNON-es)</li>
                                    <li className="flex gap-2"><span className="text-green-500">✓</span> ModelRenderer (GLTF/GLB)</li>
                                    <li className="flex gap-2"><span className="text-green-500">✓</span> 3D Raycasting & Depth</li>
                                    <li className="flex gap-2"><span className="text-green-500">✓</span> Audio Spatialization (3D Sound) via PannerNode</li>
                                    <li className="flex gap-2"><span className="text-green-500">✓</span> PBR Materials (Metallic, Roughness, Emissive)</li>
                                    <li className="flex gap-2"><span className="text-green-500">✓</span> Post-Processing Pipeline (Bloom, DoF, Color Correction)</li>
                                </ul>
                            </div>
                            
                            <div className="bg-neutral-900 p-6 rounded-lg border border-neutral-800">
                                <h3 className="text-xl font-bold text-blue-400 mb-4">Next (Beta)</h3>
                                <ul className="space-y-2 text-sm text-neutral-400 font-mono">
                                    <li className="flex gap-2"><span className="text-neutral-600">□</span> Scene Editor Visual UI</li>
                                    
                                    <li className="flex gap-2"><span className="text-neutral-600">□</span> Particle System Editor</li>
                                    <li className="flex gap-2"><span className="text-neutral-600">□</span> Seamless Export UI</li>
                                    
                                </ul>
                            </div>
                        </div>
                    </div>

                </div>
            </div>

        </div>
    );
}
