import { StreamingEvent, StreamingEventType, StreamingObservabilitySink } from './StreamingObservability';

export interface StreamingTelemetryEvent {
    type: string;
    timestamp: number;
    metadata?: Record<string, string | number | boolean | null>;
}

export interface StreamingTelemetryPayload {
    schemaVersion: 1;
    runtimeId: string;
    sentAt: number;
    droppedEvents: number;
    events: readonly StreamingTelemetryEvent[];
}

export interface StreamingTelemetryTransport {
    send(batch: readonly StreamingTelemetryEvent[], payload: Omit<StreamingTelemetryPayload, 'events'>): Promise<void>;
}

export interface StreamingTelemetryOptions {
    maxBatchSize?: number;
    flushIntervalMs?: number;
    maxBufferedEvents?: number;
    endpoint?: string;
    transport?: StreamingTelemetryTransport;
    enabled?: boolean;
}

export interface StreamingTelemetrySnapshot {
    bufferedEvents: number;
    droppedEvents: number;
    sentBatches: number;
    sentEvents: number;
    failedFlushes: number;
    activeFlush: boolean;
}

const CRITICAL_ERROR_TYPES = new Set<string>([
    'CHUNK_INTEGRITY_FAILURE',
    'CHUNK_REQUEST_FAILURE',
    'CHUNK_REQUEST_TIMEOUT',
    'MEMORY_BUDGET_EXCEEDED',
    'PERSISTENT_CACHE_CORRUPTION',
    'PERSISTENT_STORAGE_BUDGET_EXCEEDED',
    'ASSET_DECODE_FAILURE',
    'DECODER_QUEUE_SATURATED',
    'CONTROLLER_INITIALIZE_FAILURE'
]);

export class BrowserStreamingTelemetryTransport implements StreamingTelemetryTransport {
    constructor(private endpoint: string) {}

    async send(batch: readonly StreamingTelemetryEvent[], payloadInfo: Omit<StreamingTelemetryPayload, 'events'>): Promise<void> {
        const payload: StreamingTelemetryPayload = {
            ...payloadInfo,
            events: batch
        };
        const payloadStr = JSON.stringify(payload);

        // Best effort on hidden visibility (using keepalive)
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: payloadStr,
                credentials: 'omit',
                keepalive: true,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
        } catch (e) {
            throw e;
        }
    }
}

export class StreamingTelemetrySink implements StreamingObservabilitySink {
    private enabled: boolean;
    private maxBatchSize: number;
    private flushIntervalMs: number;
    private maxBufferedEvents: number;
    private endpoint: string | undefined;
    private transport: StreamingTelemetryTransport | undefined;

    private buffer: StreamingTelemetryEvent[] = [];
    private droppedEvents = 0;
    private sentBatches = 0;
    private sentEvents = 0;
    private failedFlushes = 0;
    private activeFlush = false;
    private flushRequested = false;

    private runtimeId: string;
    private timerId: ReturnType<typeof setInterval> | null = null;
    private boundVisibilityHandler: () => void;
    private isDisposed = false;

    constructor(options: StreamingTelemetryOptions = {}) {
        this.enabled = options.enabled ?? (!!options.transport || !!options.endpoint);
        this.maxBatchSize = options.maxBatchSize ?? 20;
        this.flushIntervalMs = options.flushIntervalMs ?? 5000;
        this.maxBufferedEvents = options.maxBufferedEvents ?? 100;
        this.endpoint = options.endpoint;
        this.transport = options.transport;

        if (!this.transport && this.endpoint) {
            this.transport = new BrowserStreamingTelemetryTransport(this.endpoint);
        }

        this.runtimeId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);

        this.boundVisibilityHandler = this.onVisibilityChange.bind(this);

        if (this.enabled) {
            this.startTimer();
            if (typeof document !== 'undefined') {
                document.addEventListener('visibilitychange', this.boundVisibilityHandler);
            }
        }
    }

    private startTimer() {
        if (!this.timerId && this.flushIntervalMs > 0 && typeof setInterval !== 'undefined') {
            this.timerId = setInterval(() => {
                if (this.buffer.length > 0) {
                    this.scheduleFlush();
                }
            }, this.flushIntervalMs);
        }
    }

    private stopTimer() {
        if (this.timerId && typeof clearInterval !== 'undefined') {
            clearInterval(this.timerId);
            this.timerId = null;
        }
    }

    private onVisibilityChange() {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            this.doFinalVisibilityFlush();
        }
    }

    private doFinalVisibilityFlush() {
        if (!this.enabled || this.isDisposed || this.buffer.length === 0 || !this.endpoint) {
            return;
        }

        const batch = this.buffer.splice(0, this.maxBatchSize);
        if (batch.length === 0) return;

        const payload: StreamingTelemetryPayload = {
            schemaVersion: 1,
            runtimeId: this.runtimeId,
            sentAt: Date.now(),
            droppedEvents: this.droppedEvents,
            events: batch
        };

        const payloadStr = JSON.stringify(payload);

        let sent = false;
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
            // sendBeacon payload size limit is around 64kb, so keep batch small
            sent = navigator.sendBeacon(this.endpoint, payloadStr);
        }

        if (!sent && typeof fetch !== 'undefined') {
            fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: payloadStr,
                credentials: 'omit',
                keepalive: true
            }).catch(() => {});
        }
    }

    emit(event: StreamingEvent): void {
        if (!this.enabled || this.isDisposed) return;

        const sanitized = this.sanitizeEvent(event);
        
        if (this.buffer.length >= this.maxBufferedEvents) {
            // Find an index to drop: first non-critical event starting from oldest (index 0)
            let dropIndex = -1;
            for (let i = 0; i < this.buffer.length; i++) {
                if (!CRITICAL_ERROR_TYPES.has(this.buffer[i].type)) {
                    dropIndex = i;
                    break;
                }
            }

            if (dropIndex !== -1) {
                this.buffer.splice(dropIndex, 1);
                this.droppedEvents++;
                this.buffer.push(sanitized);
            } else {
                // All buffered are critical. If new one is critical, drop the oldest critical. Else drop the new one.
                if (CRITICAL_ERROR_TYPES.has(sanitized.type)) {
                    this.buffer.shift();
                    this.droppedEvents++;
                    this.buffer.push(sanitized);
                } else {
                    this.droppedEvents++;
                    // Do not push the new one
                }
            }
        } else {
            this.buffer.push(sanitized);
        }

        if (this.buffer.length >= this.maxBatchSize) {
            this.scheduleFlush();
        }
    }

    private sanitizeEvent(event: StreamingEvent): StreamingTelemetryEvent {
        const result: StreamingTelemetryEvent = {
            type: event.type,
            timestamp: event.timestamp
        };

        if (event.metadata) {
            const safeMetadata: Record<string, string | number | boolean | null> = {};
            for (const [key, value] of Object.entries(event.metadata)) {
                if (typeof value === 'string') {
                    try {
                        if (value.startsWith('http://') || value.startsWith('https://')) {
                            const url = new URL(value);
                            safeMetadata[key] = url.origin + url.pathname;
                        } else if (value.includes('?')) {
                            // Simple heuristic for relative URLs with query strings
                            safeMetadata[key] = value.split('?')[0];
                        } else {
                            safeMetadata[key] = value;
                        }
                    } catch {
                        safeMetadata[key] = value;
                    }
                } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
                    safeMetadata[key] = value;
                } else if (value instanceof Error) {
                    safeMetadata[key] = value.name + ': ' + value.message;
                }
            }
            if (Object.keys(safeMetadata).length > 0) {
                result.metadata = safeMetadata;
            }
        }

        return result;
    }

    private scheduleFlush(): void {
        if (this.activeFlush) {
            this.flushRequested = true;
            return;
        }

        if (this.buffer.length === 0) return;

        this.activeFlush = true;
        this.flushRequested = false;

        const batch = this.buffer.splice(0, this.maxBatchSize);
        const payloadInfo = {
            schemaVersion: 1 as const,
            runtimeId: this.runtimeId,
            sentAt: Date.now(),
            droppedEvents: this.droppedEvents
        };

        if (this.transport) {
            this.transport.send(batch, payloadInfo)
                .then(() => {
                    this.sentBatches++;
                    this.sentEvents += batch.length;
                    this.activeFlush = false;
                    if (this.flushRequested) {
                        this.scheduleFlush();
                    }
                })
                .catch((e) => {
                    this.failedFlushes++;
                    // we don't requeue to avoid unbounded growth
                    this.activeFlush = false;
                    if (this.flushRequested) {
                        this.scheduleFlush();
                    }
                });
        } else {
            this.activeFlush = false;
        }
    }

    getSnapshot(): StreamingTelemetrySnapshot {
        return Object.freeze({
            bufferedEvents: this.buffer.length,
            droppedEvents: this.droppedEvents,
            sentBatches: this.sentBatches,
            sentEvents: this.sentEvents,
            failedFlushes: this.failedFlushes,
            activeFlush: this.activeFlush
        });
    }

    dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;

        this.stopTimer();

        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
        }

        if (this.enabled && this.buffer.length > 0) {
            this.scheduleFlush(); // Best-effort asynchronous final flush
        }
    }
}
