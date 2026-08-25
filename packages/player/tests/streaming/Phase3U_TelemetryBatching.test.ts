import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingTelemetrySink, BrowserStreamingTelemetryTransport, StreamingTelemetryEvent, StreamingTelemetryPayload } from '../../src/streaming/StreamingTelemetrySink';
import { StreamingEvent } from '../../src/streaming/StreamingObservability';

describe('Phase 3U - StreamingTelemetrySink', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('disabled sink performs zero work', () => {
        const sink = new StreamingTelemetrySink({ enabled: false });
        sink.emit({ type: 'CHUNK_REQUEST_START', timestamp: 100 });
        expect(sink.getSnapshot().bufferedEvents).toBe(0);
    });

    it('event buffering', () => {
        const sink = new StreamingTelemetrySink({ enabled: true, maxBatchSize: 10 });
        sink.emit({ type: 'CHUNK_REQUEST_START', timestamp: 100 });
        expect(sink.getSnapshot().bufferedEvents).toBe(1);
    });

    it('maxBatchSize triggers asynchronous flush', async () => {
        const mockSend = vi.fn().mockResolvedValue(undefined);
        const sink = new StreamingTelemetrySink({ 
            enabled: true, 
            maxBatchSize: 2,
            transport: { send: mockSend }
        });
        
        sink.emit({ type: 'CHUNK_REQUEST_START', timestamp: 100 });
        expect(mockSend).not.toHaveBeenCalled();
        
        sink.emit({ type: 'CHUNK_REQUEST_SUCCESS', timestamp: 101 });
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(sink.getSnapshot().activeFlush).toBe(true);

        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        
        expect(sink.getSnapshot().sentBatches).toBe(1);
        expect(sink.getSnapshot().sentEvents).toBe(2);
        expect(sink.getSnapshot().activeFlush).toBe(false);
    });

    it('flushIntervalMs triggers flush', async () => {
        const mockSend = vi.fn().mockResolvedValue(undefined);
        const sink = new StreamingTelemetrySink({ 
            enabled: true, 
            maxBatchSize: 10,
            flushIntervalMs: 5000,
            transport: { send: mockSend }
        });
        
        sink.emit({ type: 'CHUNK_REQUEST_START', timestamp: 100 });
        expect(mockSend).not.toHaveBeenCalled();
        
        vi.advanceTimersByTime(5000);
        
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('maxBufferedEvents prevents unlimited growth', () => {
        const sink = new StreamingTelemetrySink({ enabled: true, maxBufferedEvents: 2, maxBatchSize: 10 });
        
        sink.emit({ type: 'CHUNK_REQUEST_START', timestamp: 100 });
        sink.emit({ type: 'CHUNK_REQUEST_SUCCESS', timestamp: 101 });
        sink.emit({ type: 'MANIFEST_LOAD_START', timestamp: 102 });
        
        const snapshot = sink.getSnapshot();
        expect(snapshot.bufferedEvents).toBe(2);
        expect(snapshot.droppedEvents).toBe(1);
    });

    it('critical failure event retention', () => {
        const sink = new StreamingTelemetrySink({ enabled: true, maxBufferedEvents: 2, maxBatchSize: 10 });
        
        sink.emit({ type: 'ASSET_DECODE_FAILURE', timestamp: 100 });
        sink.emit({ type: 'CHUNK_REQUEST_FAILURE', timestamp: 101 });
        sink.emit({ type: 'MANIFEST_LOAD_START', timestamp: 102 }); // non critical, should be dropped if buffer is full of criticals
        
        const snapshot = sink.getSnapshot();
        expect(snapshot.bufferedEvents).toBe(2);
        expect(snapshot.droppedEvents).toBe(1);
    });

    it('transport receives sanitized primitive events', async () => {
        const mockSend = vi.fn().mockResolvedValue(undefined);
        const sink = new StreamingTelemetrySink({ 
            enabled: true, 
            maxBatchSize: 1,
            transport: { send: mockSend }
        });

        sink.emit({ 
            type: 'CHUNK_REQUEST_START', 
            timestamp: 100,
            metadata: {
                chunkId: 'a.bin',
                count: 5,
                success: true,
                error: new Error('test error'),
                buffer: new ArrayBuffer(10), // Should be stripped
                manifest: { version: 1 } // Should be stripped
            }
        });

        expect(mockSend).toHaveBeenCalled();
        const batch = mockSend.mock.calls[0][0];
        expect(batch[0].metadata).toEqual({
            chunkId: 'a.bin',
            count: 5,
            success: true,
            error: 'Error: test error'
        });
        expect(batch[0].metadata.buffer).toBeUndefined();
        expect(batch[0].metadata.manifest).toBeUndefined();
    });

    it('concurrent flushes are serialized', async () => {
        let resolveSend: () => void;
        const mockSend = vi.fn().mockImplementation(() => {
            return new Promise<void>((resolve) => {
                resolveSend = resolve;
            });
        });
        const sink = new StreamingTelemetrySink({ 
            enabled: true, 
            maxBatchSize: 1,
            transport: { send: mockSend }
        });
        
        sink.emit({ type: 'CHUNK_REQUEST_START', timestamp: 100 }); // triggers flush 1
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(sink.getSnapshot().activeFlush).toBe(true);

        sink.emit({ type: 'CHUNK_REQUEST_SUCCESS', timestamp: 101 }); // queued, wait for flush 1
        expect(mockSend).toHaveBeenCalledTimes(1);

        resolveSend!();
        await Promise.resolve(); // let microtasks process promise resolution
        await Promise.resolve();

        expect(mockSend).toHaveBeenCalledTimes(2); // flush 2 is now triggered
    });

    it('dispose performs final flush and stops timers', () => {
        const mockSend = vi.fn().mockResolvedValue(undefined);
        const sink = new StreamingTelemetrySink({ 
            enabled: true, 
            maxBatchSize: 10,
            flushIntervalMs: 5000,
            transport: { send: mockSend }
        });

        sink.emit({ type: 'CHUNK_REQUEST_START', timestamp: 100 });
        sink.dispose();
        
        expect(mockSend).toHaveBeenCalledTimes(1);
        
        vi.advanceTimersByTime(5000);
        expect(mockSend).toHaveBeenCalledTimes(1); // Timer is stopped
    });

    it('transport failure does not break streaming operations', async () => {
        const mockSend = vi.fn().mockRejectedValue(new Error('Network error'));
        const sink = new StreamingTelemetrySink({ 
            enabled: true, 
            maxBatchSize: 1,
            transport: { send: mockSend }
        });

        sink.emit({ type: 'CHUNK_REQUEST_START', timestamp: 100 });
        expect(mockSend).toHaveBeenCalledTimes(1);
        
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        
        expect(sink.getSnapshot().failedFlushes).toBe(1);
        // sink is still operational
        expect(sink.getSnapshot().activeFlush).toBe(false);
    });

    it('URLs and query strings are sanitized', async () => {
        const mockSend = vi.fn().mockResolvedValue(undefined);
        const sink = new StreamingTelemetrySink({ 
            enabled: true, 
            maxBatchSize: 1,
            transport: { send: mockSend }
        });

        sink.emit({ 
            type: 'CHUNK_REQUEST_START', 
            timestamp: 100,
            metadata: {
                url: 'https://example.com/model.glb?token=secret123',
                relativeUrl: '/assets/texture.png?v=1'
            }
        });

        expect(mockSend).toHaveBeenCalled();
        const batch = mockSend.mock.calls[0][0];
        expect(batch[0].metadata).toEqual({
            url: 'https://example.com/model.glb',
            relativeUrl: '/assets/texture.png'
        });
    });
});
