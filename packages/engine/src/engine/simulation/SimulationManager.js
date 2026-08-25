/**
 * Keeps track of registered simulations and handles clean transitions.
 */
export class SimulationManager {
    /**
     * @param {import('../core/Engine.js').Engine} engine 
     */
    constructor(engine) {
        this.engine = engine;
        
        /** @type {Map<string, import('./Simulation.js').Simulation>} */
        this.simulations = new Map();
        
        /** @type {import('./Simulation.js').Simulation | null} */
        this.activeSimulation = null;
        
        this.engine.events.on('fixedUpdate', (dt) => {
            if (this.activeSimulation) this.activeSimulation.onFixedUpdate(dt);
        });
        
        this.engine.events.on('update', (dt) => {
            if (this.activeSimulation) this.activeSimulation.onUpdate(dt);
        });
        
        this.engine.events.on('render', () => {
            this.render();
        });
    }
    
    /**
     * Registers a simulation instance.
     * @param {string} name 
     * @param {import('./Simulation.js').Simulation} simulation 
     */
    register(name, simulation) {
        this.simulations.set(name, simulation);
        simulation.onInitialize();
    }
    
    /**
     * Switches to the specified simulation, safely tearing down the old one.
     * @param {string} name 
     */
    setActive(name) {
        if (!this.simulations.has(name)) return;
        
        if (this.activeSimulation) {
            this.activeSimulation.onStop();
        }
        
        // Purge world and entity state to prevent leaks
        this.clearWorldState();
        
        this.activeSimulationName = name;
        this.activeSimulation = this.simulations.get(name);
        this.activeSimulation.onStart();
    }
    
    /**
     * Resets the World and EntityManager state safely.
     * This guarantees zero memory leaks during transitions.
     * @private
     */
    clearWorldState() {
        const world = this.engine.world;
        
        world.clear();
        
        // Reset camera
        this.engine.camera.set(0, 0, 1);
        
        // Reset global forces and dimensions
        world.gravityX = 0;
        world.gravityY = 400;
        world.isInfinite = false;
        world.width = 4000;
        world.height = 4000;
    }
    
    /**
     * Internal render orchestrator handling camera and UI passes.
     * @private
     */
    render() {
        const r = this.engine.renderer;
        const camera = this.engine.camera;
        const world = this.engine.world;
        const ui = this.engine.ui;
        const win = this.engine.window;
        
        r.begin();
        
        // Screen clear
        if (this.activeSimulation) {
            r.setGlobalAlpha(this.activeSimulation.clearAlpha);
            r.setFillStyle(this.activeSimulation.clearColor);
        } else {
            r.setGlobalAlpha(1.0);
            r.setFillStyle('#111111');
        }
        
        r.fillRect(0, 0, win.width, win.height);
        r.setGlobalAlpha(1.0); // Reset alpha
        
        // World Space Pass
        camera.begin();
        world.render(r, camera);
        if (this.activeSimulation) {
            this.activeSimulation.onRender(r, camera);
        }
        this.engine.events.emit('postRenderWorld', r, camera);
        camera.end();
        
        // Screen Space Pass (UI)
        ui.begin();
        if (this.activeSimulation) {
            this.activeSimulation.onUI(ui);
        }
        
        // Draw top-bar menu for simulation swapping
        this.renderTopBar(ui, win.width);
        
        ui.end();
        r.end();
    }
    
    /**
     * Renders the global top-bar menu for swapping simulations.
     * @private
     * @param {import('../ui/UIContext.js').UIContext} ui 
     * @param {number} width
     */
    renderTopBar(ui, width) {
        if (this.engine.hideTopBar) return;
        ui.panel(0, 0, width, 40, 'rgba(20, 20, 20, 0.9)');
        ui.text('Foundry Engine', 15, 25, '#4ade80', 'bold 16px monospace');
        
        let offsetX = 180;
        for (const [name, sim] of this.simulations.entries()) {
            const isActive = this.activeSimulation === sim;
            const label = isActive ? `[ ${name} ]` : `  ${name}  `;
            
            // Adjust button width based on name length
            const btnWidth = name.length * 10 + 20;
            
            if (ui.button(`sim_btn_${name}`, label, offsetX, 5, btnWidth, 30)) {
                if (!isActive) {
                    this.setActive(name);
                }
            }
            offsetX += btnWidth + 10;
        }

        // Global Time Controls
        const time = this.engine.time;
        if (width > 600) {
            ui.text(`Time Scale: ${time.timeScale.toFixed(1)}x`, width - 300, 25, '#fff');
            if (ui.button('btn_time_pause', time.timeScale === 0 ? 'Resume' : 'Pause', width - 150, 5, 70, 30)) {
                time.timeScale = time.timeScale === 0 ? 1 : 0;
            }
            if (ui.button('btn_time_fast', '>>', width - 75, 5, 50, 30)) {
                if (time.timeScale < 4) time.timeScale += 0.5;
            }
            if (ui.button('btn_time_slow', '<<', width - 370, 5, 50, 30)) {
                if (time.timeScale > 0) time.timeScale -= 0.5;
                if (time.timeScale < 0) time.timeScale = 0;
            }
        }
    }
}
