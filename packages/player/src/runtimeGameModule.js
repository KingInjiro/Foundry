const NOOP_LIFECYCLE_METHODS = [
    'onInitialize',
    'onFixedUpdate',
    'onUpdate',
    'onRender',
    'onUI'
];

export function createInlineGameModuleSource(code) {
    if (typeof code !== 'string' || code.trim() === '') {
        throw new Error('Inline game code is empty.');
    }

    const exportedCode = code.replace(
        /return\s+([a-zA-Z0-9_]+)\s*;?\s*$/,
        'export default $1;'
    );

    return `
        const _api = self.FoundryAPI;
        Object.keys(_api).forEach(key => { globalThis[key] = _api[key]; });
        const assets = self.assets;
        const Matter = self.Matter;
        const THREE = self.THREE;
        const CANNON = self.CANNON;
        ${exportedCode}
    `;
}

export function createEditorCommandModuleSource(code, { expression = true } = {}) {
    if (typeof code !== 'string' || code.trim() === '' || code.length > 10_000) {
        throw new Error('Editor console command is empty or too large.');
    }
    const body = expression ? `return (${code});` : code;
    return `
        const context = globalThis.__foundryEditorContext;
        if (!context || context.enabled !== true) throw new Error('Editor console commands are disabled.');
        const engine = context.engine;
        const Foundry = context.Foundry;
        const assets = context.assets;
        const result = await (async () => { ${body}\n })();
        context.report(result);
    `;
}

export function getGameConstructor(moduleNamespace) {
    const GameClass = moduleNamespace?.default || moduleNamespace?.CustomGame || moduleNamespace?.Game;
    if (typeof GameClass !== 'function') {
        throw new Error('Game entry must export a game class as default, CustomGame, or Game.');
    }
    return GameClass;
}

export function prepareSimulationLifecycle(simulation) {
    if (!simulation || typeof simulation !== 'object') {
        throw new Error('Game class did not create a simulation object.');
    }

    for (const method of NOOP_LIFECYCLE_METHODS) {
        if (typeof simulation[method] !== 'function') {
            simulation[method] = () => {};
        }
    }

    let startPromise = Promise.resolve();
    const startMethod = typeof simulation.onStart === 'function'
        ? simulation.onStart.bind(simulation)
        : typeof simulation.start === 'function'
            ? simulation.start.bind(simulation)
            : () => {};

    simulation.onStart = (...args) => {
        try {
            const result = startMethod(...args);
            startPromise = Promise.resolve(result);
            return result;
        } catch (error) {
            startPromise = Promise.reject(error);
            startPromise.catch(() => {});
            throw error;
        }
    };

    if (typeof simulation.onStop !== 'function') {
        simulation.onStop = typeof simulation.stop === 'function'
            ? simulation.stop.bind(simulation)
            : () => {};
    }

    if (simulation.clearColor === undefined) simulation.clearColor = '#111111';
    if (simulation.clearAlpha === undefined) simulation.clearAlpha = 1;

    return {
        simulation,
        waitForStart: () => startPromise
    };
}
