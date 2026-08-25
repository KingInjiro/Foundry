import { describe, expect, it, vi } from 'vitest';
import {
    createInlineGameModuleSource,
    getGameConstructor,
    prepareSimulationLifecycle
} from '../src/runtimeGameModule.js';

describe('runtime game module helpers', () => {
    it('converts the editor return convention into a module export', () => {
        const source = createInlineGameModuleSource('class Demo {}\nreturn Demo;');
        expect(source).toContain('export default Demo;');
        expect(source).not.toContain('return Demo;');
    });

    it('rejects empty inline code while published URL launches can skip this helper', () => {
        expect(() => createInlineGameModuleSource()).toThrow('empty');
        expect(() => createInlineGameModuleSource('   ')).toThrow('empty');
    });

    it('finds documented game class exports and rejects missing classes', () => {
        class DefaultGame {}
        class CustomGame {}
        class Game {}

        expect(getGameConstructor({ default: DefaultGame })).toBe(DefaultGame);
        expect(getGameConstructor({ CustomGame })).toBe(CustomGame);
        expect(getGameConstructor({ Game })).toBe(Game);
        expect(() => getGameConstructor({ default: {} })).toThrow('export a game class');
    });

    it('adapts a lightweight start/stop game to the Engine simulation lifecycle', async () => {
        const start = vi.fn(async () => 'started');
        const stop = vi.fn();
        const prepared = prepareSimulationLifecycle({ start, stop });

        expect(prepared.simulation.clearColor).toBe('#111111');
        expect(prepared.simulation.clearAlpha).toBe(1);
        expect(() => prepared.simulation.onInitialize()).not.toThrow();
        expect(() => prepared.simulation.onUpdate(16)).not.toThrow();

        prepared.simulation.onStart();
        await expect(prepared.waitForStart()).resolves.toBe('started');
        prepared.simulation.onStop();

        expect(start).toHaveBeenCalledTimes(1);
        expect(stop).toHaveBeenCalledTimes(1);
    });

    it('preserves and awaits an existing asynchronous onStart lifecycle', async () => {
        const onStart = vi.fn(async () => 'ready');
        const prepared = prepareSimulationLifecycle({ onStart, onStop() {} });

        prepared.simulation.onStart();
        await expect(prepared.waitForStart()).resolves.toBe('ready');
        expect(onStart).toHaveBeenCalledTimes(1);
    });
});
