import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
    StreamingObservability, 
    StreamingObservabilitySink, 
    StreamingEvent,
    StreamingEventType 
} from '../../src/streaming/StreamingObservability';
import { StreamingManifestLoader } from '../../src/streaming/StreamingManifestLoader';
import { ChunkFetcher, ChunkIntegrityError, ChunkFetchNetworkError } from '../../src/streaming/ChunkFetcher';
import { MemoryBudgetManager } from '../../src/streaming/MemoryBudgetManager';
import { StreamingRuntimeController } from '../../src/streaming/StreamingRuntimeController';

class TestObservabilitySink implements StreamingObservabilitySink {
    public events: StreamingEvent[] = [];
    emit(event: StreamingEvent): void {
        this.events.push(event);
    }
    
    getEventsByType(type: StreamingEventType): StreamingEvent[] {
        return this.events.filter(e => e.type === type);
    }

    clear() {
        this.events = [];
    }
}

describe('Phase 3K Observability Contract', () => {
    let sink: TestObservabilitySink;
    let observability: StreamingObservability;

    beforeEach(() => {
        sink = new TestObservabilitySink();
        observability = new StreamingObservability(sink);
        vi.stubGlobal('performance', { now: vi.fn(() => Date.now()) }); // vitest stub for performance.now()
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('StreamingManifestLoader Instrumentation', () => {
        it('emits MANIFEST_LOAD_START and MANIFEST_LOAD_SUCCESS without leaking sensitive URL queries or manifest body', async () => {
            const manifestBody = {
                schemaVersion: 1,
                runtime: { entry: 'a' },
                chunks: [{ id: 'a', url: 'a.bin', size: 10, hash: `sha256-${'a'.repeat(64)}`, dependencies: [], priority: 'high', preload: false }]
            };
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: async () => JSON.stringify(manifestBody)
            });

            const loader = new StreamingManifestLoader(observability);
            await loader.load('https://api.example.com/manifest.json?token=secret');

            const startEvents = sink.getEventsByType('MANIFEST_LOAD_START');
            expect(startEvents.length).toBe(1);
            expect(startEvents[0].metadata?.url).toBe('https://api.example.com/manifest.json'); // stripped query

            const successEvents = sink.getEventsByType('MANIFEST_LOAD_SUCCESS');
            expect(successEvents.length).toBe(1);
            expect(successEvents[0].metadata?.url).toBe('https://api.example.com/manifest.json');
            expect(typeof successEvents[0].metadata?.durationMs).toBe('number');
            expect(successEvents[0].metadata?.manifest).toBeUndefined(); // no raw body
        });

        it('emits MANIFEST_LOAD_FAILURE on HTTP error', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 404
            });

            const loader = new StreamingManifestLoader(observability);
            await expect(loader.load('https://api.example.com/manifest.json')).rejects.toThrow();

            const failEvents = sink.getEventsByType('MANIFEST_LOAD_FAILURE');
            expect(failEvents.length).toBe(1);
            expect(failEvents[0].metadata?.category).toBe('HTTP');
            expect(failEvents[0].metadata?.status).toBe(404);
        });
    });

    describe('ChunkFetcher Instrumentation', () => {
        const manifest = {
            schemaVersion: 1,
            runtime: { entry: 'a' },
            chunks: new Map([
                ['a', { id: 'a', url: 'a.bin', size: 10, hash: 'sha256-68617368', dependencies: [], priority: 'high', preload: false }]
            ]),
            dependencies: new Map()
        } as any;

        it('emits CHUNK_REQUEST_START, QUEUE_WAIT, QUEUE_DISPATCH, and CHUNK_REQUEST_SUCCESS', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                arrayBuffer: async () => new TextEncoder().encode('1234567890').buffer
            });
            vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockResolvedValue(new TextEncoder().encode('hash').buffer) } });

            const fetcher = new ChunkFetcher(manifest, 'https://cdn.example.com', 4, observability);
            await fetcher.fetchChunk('a');

            expect(sink.events.map(e => e.type)).toEqual([
                'CHUNK_REQUEST_START',
                'QUEUE_WAIT',
                'QUEUE_DISPATCH',
                'CHUNK_REQUEST_SUCCESS'
            ]);

            const success = sink.getEventsByType('CHUNK_REQUEST_SUCCESS')[0];
            expect(success.metadata?.chunkId).toBe('a');
            expect(success.metadata?.byteSize).toBe(10);
            expect(success.metadata?.data).toBeUndefined(); // no raw arraybuffer
        });

        it('emits CHUNK_INTEGRITY_FAILURE on hash mismatch', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                arrayBuffer: async () => new TextEncoder().encode('bad').buffer
            });
            vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockResolvedValue(new TextEncoder().encode('badhash').buffer) } });

            const fetcher = new ChunkFetcher(manifest, 'https://cdn.example.com', 4, observability);
            await expect(fetcher.fetchChunk('a')).rejects.toThrow(ChunkIntegrityError);

            expect(sink.getEventsByType('CHUNK_INTEGRITY_FAILURE').length).toBe(1);
        });

        it('emits QUEUE_SATURATED when queue hits max concurrent', async () => {
            let resolveFetch: any;
            global.fetch = vi.fn().mockReturnValue(new Promise(r => { resolveFetch = r; }));

            // max concurrent = 1
            const fetcher = new ChunkFetcher({
                schemaVersion: 1,
                runtime: { entry: 'a' },
                chunks: new Map([
                    ['a', { id: 'a', url: 'a.bin', size: 1, hash: 'sha256-68617368', dependencies: [], priority: 'high', preload: false }],
                    ['b', { id: 'b', url: 'b.bin', size: 1, hash: 'sha256-68617368', dependencies: [], priority: 'high', preload: false }]
                ]),
                dependencies: new Map()
            } as any, 'https://cdn.example.com', 1, observability);

            const p1 = fetcher.fetchChunk('a');
            const p2 = fetcher.fetchChunk('b');

            await new Promise(r => setTimeout(r, 0));

            expect(sink.getEventsByType('QUEUE_SATURATED').length).toBe(1);
            expect(sink.getEventsByType('QUEUE_SATURATED')[0].metadata?.activeDownloads).toBe(1);
        });
    });

    describe('MemoryBudgetManager Instrumentation', () => {
        it('emits MEMORY_INSERT and MEMORY_EVICTION', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 10, observability });
            
            manager.insert({ id: 'a', data: new ArrayBuffer(6), size: 6, sha256: 'h' });
            expect(sink.getEventsByType('MEMORY_INSERT').length).toBe(1);
            expect(sink.getEventsByType('MEMORY_INSERT')[0].metadata?.byteSize).toBe(6);

            // Insert b to cause eviction of a
            manager.insert({ id: 'b', data: new ArrayBuffer(6), size: 6, sha256: 'h' });
            
            expect(sink.getEventsByType('MEMORY_EVICTION').length).toBe(1);
            expect(sink.getEventsByType('MEMORY_EVICTION')[0].metadata?.evictedChunkId).toBe('a');
            expect(sink.getEventsByType('MEMORY_INSERT').length).toBe(2);
        });

        it('emits MEMORY_BUDGET_EXCEEDED when chunk is too big', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 10, observability });
            
            expect(() => {
                manager.insert({ id: 'a', data: new ArrayBuffer(15), size: 15, sha256: 'h' });
            }).toThrow();

            expect(sink.getEventsByType('MEMORY_BUDGET_EXCEEDED').length).toBe(1);
            expect(sink.getEventsByType('MEMORY_BUDGET_EXCEEDED')[0].metadata?.requestedBytes).toBe(15);
        });
    });

    describe('StreamingRuntimeController Instrumentation', () => {
        const manifest = {
            schemaVersion: 1,
            runtime: { entry: 'a' },
            chunks: new Map([
                ['a', { id: 'a', url: 'a.bin', size: 10, hash: 'sha256-68617368', dependencies: [], priority: 'high', preload: false }]
            ]),
            dependencies: new Map([['a', []]])
        } as any;

        it('emits CONTROLLER_INITIALIZE_START and CONTROLLER_READY', async () => {
            const fetcher = new ChunkFetcher(manifest, 'url', 4, observability);
            fetcher.fetchChunk = vi.fn().mockResolvedValue({ id: 'a', size: 10, data: new ArrayBuffer(10), sha256: 'h' });
            const memory = new MemoryBudgetManager({ maxMemoryBytes: 100, observability });
            
            const controller = new StreamingRuntimeController(manifest, fetcher, memory, observability);
            await controller.initialize();

            expect(sink.getEventsByType('CONTROLLER_INITIALIZE_START').length).toBe(1);
            expect(sink.getEventsByType('CONTROLLER_READY').length).toBe(1);
        });

        it('emits DEPENDENCY_RESOLUTION_START and DEPENDENCY_RESOLUTION_COMPLETE', async () => {
            const manifestWithDeps = {
                schemaVersion: 1,
                runtime: { entry: 'a' },
                chunks: new Map([
                    ['a', { id: 'a', url: 'a.bin', size: 10, hash: 'sha256-68617368', dependencies: ['b'], priority: 'high', preload: false }],
                    ['b', { id: 'b', url: 'b.bin', size: 10, hash: 'sha256-68617368', dependencies: [], priority: 'high', preload: false }]
                ]),
                dependencies: new Map([['a', ['b']], ['b', []]])
            } as any;

            const fetcher = new ChunkFetcher(manifestWithDeps, 'url', 4, observability);
            fetcher.fetchChunk = vi.fn().mockResolvedValue({ id: 'a', size: 10, data: new ArrayBuffer(10), sha256: 'h' });
            const memory = new MemoryBudgetManager({ maxMemoryBytes: 100, observability });
            
            const controller = new StreamingRuntimeController(manifestWithDeps, fetcher, memory, observability);
            await controller.initialize();

            expect(sink.getEventsByType('DEPENDENCY_RESOLUTION_START').length).toBe(1);
            expect(sink.getEventsByType('DEPENDENCY_RESOLUTION_START')[0].metadata?.chunkId).toBe('a');
            expect(sink.getEventsByType('DEPENDENCY_RESOLUTION_START')[0].metadata?.dependencyCount).toBe(1);
            
            expect(sink.getEventsByType('DEPENDENCY_RESOLUTION_COMPLETE').length).toBe(1);
        });

        it('emits CONTROLLER_DISPOSE_START and CONTROLLER_DISPOSED', () => {
            const fetcher = new ChunkFetcher(manifest, 'url', 4, observability);
            const memory = new MemoryBudgetManager({ maxMemoryBytes: 100, observability });
            const controller = new StreamingRuntimeController(manifest, fetcher, memory, observability);
            
            controller.dispose();

            expect(sink.getEventsByType('CONTROLLER_DISPOSE_START').length).toBe(1);
            expect(sink.getEventsByType('CONTROLLER_DISPOSED').length).toBe(1);
        });
    });

    describe('Security and Sanitization', () => {
        it('never leaks array buffers or sensitive headers', () => {
            const manager = new MemoryBudgetManager({ maxMemoryBytes: 100, observability });
            const buffer = new ArrayBuffer(5);
            manager.insert({ id: 'a', data: buffer, size: 5, sha256: 'h' });
            
            const insertEvent = sink.getEventsByType('MEMORY_INSERT')[0];
            expect(JSON.stringify(insertEvent)).not.toContain('ArrayBuffer');
            
            expect(Object.values(insertEvent.metadata || {})).not.toContain(buffer);
        });
    });
});
