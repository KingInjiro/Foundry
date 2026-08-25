import { Simulation } from '../../simulation/Simulation.js';
import GolWorker from './gol.worker.js?worker';

/**
 * Conway's Game of Life Cellular Automata.
 * Demonstrates how the Foundry Engine can be used for grid-based, non-entity simulations.
 * Uses typed arrays for zero-allocation performance.
 */
export class GameOfLifeSimulation extends Simulation {
    /**
     * @param {import('../../core/Engine.js').Engine} engine 
     */
    constructor(engine) {
        super(engine);
        this.cellSize = 10;
        this.cols = 0;
        this.rows = 0;
        
        /** @type {Uint8Array} */
        this.grid = null;
        /** @type {Uint8Array} */
        this.nextGrid = null;
        
        this.updateInterval = 0.05; // Seconds between updates
        this.timer = 0;
        this.isRunning = true;
        this.worker = null;
        this.isWorkerBusy = false;
    }

    onInitialize() {
        // Initialization can happen here, but we'll set up grid in onStart 
        // to adapt to current window size.
    }

    onStart() {
        const w = this.engine.window.width;
        const h = this.engine.window.height;
        
        this.cols = Math.floor(w / this.cellSize);
        this.rows = Math.floor(h / this.cellSize);
        
        const size = this.cols * this.rows;
        this.grid = new Uint8Array(size);
        this.nextGrid = new Uint8Array(size);
        
        // Random seed
        this.randomize();
        
        // Center camera (0,0 is center of screen by default in Camera2D)
        this.engine.camera.set(w / 2, h / 2, 1);
        
        if (!this.worker) {
            this.worker = new GolWorker();
            this.worker.onmessage = (e) => {
                this.grid = e.data.grid;
                this.nextGrid = e.data.nextGrid;
                this.isWorkerBusy = false;
            };
        }
    }
    
    randomize() {
        for (let i = 0; i < this.grid.length; i++) {
            this.grid[i] = Math.random() > 0.85 ? 1 : 0;
        }
    }

    onUpdate(dt) {
        if (!this.isRunning) return;
        
        this.timer += dt;
        if (this.timer >= this.updateInterval) {
            this.timer = 0;
            this.stepSimulation();
        }
    }

    stepSimulation() {
        if (this.isWorkerBusy || !this.grid || !this.nextGrid) return;
        this.isWorkerBusy = true;
        
        // Send ArrayBuffers to worker.
        // We transfer ownership of the buffers to the worker to avoid cloning (0 copy overhead).
        // While the worker computes, this.grid and this.nextGrid will be inaccessible.
        // We handle this in onRender by just skipping render if grid is null/0 length.
        this.worker.postMessage({
            grid: this.grid,
            nextGrid: this.nextGrid,
            cols: this.cols,
            rows: this.rows
        }, [this.grid.buffer, this.nextGrid.buffer]);
        
        // The worker will return them via onmessage.
    }

    onRender(r, camera) {
        const { cols, rows, grid, cellSize } = this;
        
        r.setFillStyle('#4ade80');
        
        // Draw all alive cells
        // Using optimized batched rects if renderer supports it, else single rects
        if (!grid || grid.length === 0) return; // Buffers currently owned by worker

        r.ctx.beginPath();
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (grid[x + y * cols] === 1) {
                    r.ctx.rect(x * cellSize, y * cellSize, cellSize - 1, cellSize - 1);
                }
            }
        }
        r.ctx.fill();
    }

    onUI(ui) {
        ui.panel(10, 50, 250, 200, 'rgba(30, 30, 30, 0.8)');
        ui.text('Game of Life (CA)', 20, 70, '#4ade80', 'bold 16px monospace');
        
        ui.text(`FPS: ${this.engine.time.fps}`, 20, 95);
        
        const pUpdate = this.engine.profiler.get('update').toFixed(2);
        const pRender = this.engine.profiler.get('render').toFixed(2);
        ui.text(`CPU Logic : ${pUpdate}ms`, 20, 115, '#fca5a5');
        ui.text(`CPU Render: ${pRender}ms`, 20, 130, '#93c5fd');
        
        ui.text(`Cells: ${this.cols * this.rows}`, 20, 155);
        
        if (ui.button('btn_pause', this.isRunning ? 'Pause' : 'Resume', 20, 175, 100, 30)) {
            this.isRunning = !this.isRunning;
        }
        
        if (ui.button('btn_random', 'Randomize', 130, 175, 100, 30)) {
            this.randomize();
        }
        
        this.updateInterval = ui.slider('sl_speed', 'Speed (s)', 20, 220, 210, 20, 0.01, 0.5, this.updateInterval);
    }
}
