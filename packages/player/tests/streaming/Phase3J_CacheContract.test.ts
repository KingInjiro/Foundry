import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChunkFetcher, ChunkIntegrityError } from '../../src/streaming/ChunkFetcher';
import { StreamingManifestLoader } from '../../src/streaming/StreamingManifestLoader';
import { StreamingRuntimeController } from '../../src/streaming/StreamingRuntimeController';
import { MemoryBudgetManager } from '../../src/streaming/MemoryBudgetManager';

describe('Phase 3J Cache Contract Hardening', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('ChunkFetcher Cache Semantics', () => {
        it('uses force-cache and omit credentials for chunks', async () => {
            const manifest = {
                schemaVersion: 1,
                runtime: { entry: 'a' },
                chunks: new Map([
                    ['a', { id: 'a', url: 'a.bin', size: 10, hash: 'sha256-01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b', dependencies: [], priority: 'high', preload: false }]
                ]),
                dependencies: new Map()
            } as any;

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                arrayBuffer: async () => new TextEncoder().encode('mock data').buffer
            });

            const fetcher = new ChunkFetcher(manifest, 'https://cdn.example.com/v1');
            await fetcher.fetchChunk('a').catch(() => {}); // Will fail integrity since hash is random, but we only care about fetch call

            expect(global.fetch).toHaveBeenCalledWith('https://cdn.example.com/v1/a.bin', expect.objectContaining({
                cache: 'force-cache',
                credentials: 'omit'
            }));
        });

        it('fails if cached content is corrupted (SHA-256 final barrier)', async () => {
            const manifest = {
                schemaVersion: 1,
                runtime: { entry: 'a' },
                chunks: new Map([
                    ['a', { id: 'a', url: 'a.bin', size: 4, hash: 'sha256-expectedhash', dependencies: [], priority: 'high', preload: false }]
                ]),
                dependencies: new Map()
            } as any;

            // Simulating a cache hit where the browser returns the cached response, but it was corrupted
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                arrayBuffer: async () => new TextEncoder().encode('bad').buffer
            });

            const fetcher = new ChunkFetcher(manifest, 'https://cdn.example.com/v1');
            
            await expect(fetcher.fetchChunk('a')).rejects.toThrow(ChunkIntegrityError);
        });

        it('cross-version isolation: different CDN base URLs produce different fetch URLs preventing browser cache collisions', async () => {
            const manifestA = {
                schemaVersion: 1,
                runtime: { entry: 'shared' },
                chunks: new Map([
                    ['shared', { id: 'shared', url: 'shared.bin', size: 4, hash: 'sha256-hashA', dependencies: [], priority: 'high', preload: false }]
                ]),
                dependencies: new Map()
            } as any;

            const manifestB = {
                schemaVersion: 1,
                runtime: { entry: 'shared' },
                chunks: new Map([
                    ['shared', { id: 'shared', url: 'shared.bin', size: 4, hash: 'sha256-hashB', dependencies: [], priority: 'high', preload: false }]
                ]),
                dependencies: new Map()
            } as any;

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                arrayBuffer: async () => new TextEncoder().encode('data').buffer
            });

            const fetcherA = new ChunkFetcher(manifestA, 'https://cdn.example.com/versions/A/extracted');
            const fetcherB = new ChunkFetcher(manifestB, 'https://cdn.example.com/versions/B/extracted');

            await fetcherA.fetchChunk('shared').catch(() => {});
            await fetcherB.fetchChunk('shared').catch(() => {});

            expect(global.fetch).toHaveBeenCalledWith('https://cdn.example.com/versions/A/extracted/shared.bin', expect.anything());
            expect(global.fetch).toHaveBeenCalledWith('https://cdn.example.com/versions/B/extracted/shared.bin', expect.anything());
        });
    });

    describe('ManifestLoader Cache Semantics', () => {
        it('uses no-cache and omit credentials to ensure revalidation', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    schemaVersion: 1,
                    runtime: { entry: 'a' },
                    chunks: [{ id: 'a', url: 'a.bin', size: 10, hash: `sha256-${'a'.repeat(64)}`, dependencies: [], priority: 'high', preload: false }]
                })
            });

            const loader = new StreamingManifestLoader();
            await loader.load('https://api.example.com/games/1/latest.json');

            expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/games/1/latest.json', expect.objectContaining({
                cache: 'no-cache',
                credentials: 'omit'
            }));
        });
    });

    describe('Controller Lifecycle & HTTP Cache', () => {
        it('aborts in-flight chunk requests when disposed, and browser cache remains untouched by controller', async () => {
            const manifest = {
                schemaVersion: 1,
                runtime: { entry: 'a' },
                chunks: new Map([
                    ['a', { id: 'a', url: 'a.bin', size: 10, hash: 'sha256-hash', dependencies: [], priority: 'high', preload: false }]
                ]),
                dependencies: new Map()
            } as any;

            let fetchSignal: AbortSignal | undefined;
            global.fetch = vi.fn().mockImplementation((url, opts) => {
                fetchSignal = opts.signal;
                return new Promise((resolve, reject) => {
                    if (opts.signal) {
                        opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
                    }
                });
            });

            const fetcher = new ChunkFetcher(manifest, 'https://cdn.example.com/v1');
            const memory = new MemoryBudgetManager({ maxMemoryBytes: 1000 });
            const controller = new StreamingRuntimeController(manifest, fetcher, memory);
            
            // start initialization
            const p = controller.initialize();
            
            // wait a tick for fetch to be called
            await new Promise(r => setTimeout(r, 0));
            
            expect(fetchSignal).toBeDefined();
            expect(fetchSignal!.aborted).toBe(false);

            // dispose controller
            controller.dispose();

            // verify fetch was aborted
            expect(fetchSignal!.aborted).toBe(true);

            await expect(p).rejects.toThrow();
        });
    });
});

    describe('Manifest Loader & Controller Race Conditions', () => {
        it('prevents a stale manifest response from being inserted into a disposed controller', async () => {
            const manifest = {
                schemaVersion: 1,
                runtime: { entry: 'a' },
                chunks: new Map([
                    ['a', { id: 'a', url: 'a.bin', size: 10, hash: 'sha256-hash', dependencies: [], priority: 'high', preload: false }]
                ]),
                dependencies: new Map()
            } as any;

            let resolveFetch: any;
            global.fetch = vi.fn().mockImplementation(() => {
                return new Promise(resolve => {
                    resolveFetch = resolve;
                });
            });

            const fetcher = new ChunkFetcher(manifest, 'https://cdn.example.com/v1');
            const memory = new MemoryBudgetManager({ maxMemoryBytes: 1000 });
            const controller = new StreamingRuntimeController(manifest, fetcher, memory);
            
            // start initialization
            const p = controller.initialize();
            
            // wait a tick for fetch to be called
            await new Promise(r => setTimeout(r, 0));
            
            // dispose controller BEFORE fetch completes
            controller.dispose();

            // complete the fetch
            resolveFetch({
                ok: true,
                status: 200,
                arrayBuffer: async () => new TextEncoder().encode('data').buffer
            });

            // wait for the rejection
            await expect(p).rejects.toThrow();

            // verify memory was not populated because controller was disposed
            expect(memory.getSnapshot().currentMemoryBytes).toBe(0);
        });
    });
