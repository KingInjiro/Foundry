import { Engine } from '../src/engine/core/Engine.js';
import { SwarmSimulation } from '../src/engine/simulations/swarm/SwarmSimulation.js';

console.log('Initializing Foundry Engine in Headless Mode...');

// Create Engine with headless mode flag
const engine = new Engine({
    headless: true,
    width: 1000,
    height: 1000
});

// Register simulation
engine.simulations.register('Swarm', new SwarmSimulation(engine));
engine.simulations.setActive('Swarm');

console.log('Simulation active. Advancing 500 frames as fast as possible...');

const startTime = performance.now();
const dt = 1 / 60;

// Fast-forward simulation
for (let i = 0; i < 500; i++) {
    // Manually step the loop
    engine.loop.step(dt);
}

const endTime = performance.now();
const boidsCount = engine.world.entities.count;

console.log(`\nSimulation complete!`);
console.log(`Boids count: ${boidsCount}`);
console.log(`Frames processed: 500`);
console.log(`Time taken: ${(endTime - startTime).toFixed(2)} ms`);
console.log(`Average frame time: ${((endTime - startTime) / 500).toFixed(2)} ms`);
