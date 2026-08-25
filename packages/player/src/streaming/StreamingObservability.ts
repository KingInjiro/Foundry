export type StreamingEventType =
    | 'PERSISTENT_CACHE_HIT'
    | 'PERSISTENT_CACHE_MISS'
    | 'PERSISTENT_CACHE_WRITE'
    | 'PERSISTENT_CACHE_WRITE_FAILURE'
    | 'PERSISTENT_CACHE_QUOTA_FAILURE'
    | 'PERSISTENT_CACHE_UNAVAILABLE'
    | 'PERSISTENT_CACHE_CORRUPTION'
    | 'PERSISTENT_CACHE_DELETE'
    | 'PERSISTENT_CACHE_CLEAR_PREFIX'
    | 'PERSISTENT_STORAGE_EVICTION_START'
    | 'PERSISTENT_STORAGE_EVICTION'
    | 'PERSISTENT_STORAGE_EVICTION_COMPLETE'
    | 'PERSISTENT_STORAGE_BUDGET_EXCEEDED'
    | 'PERSISTENT_STORAGE_QUOTA_FAILURE'
    | 'PERSISTENT_STORAGE_DELETE_FAILURE'
    | 'MANIFEST_LOAD_START'
    | 'MANIFEST_LOAD_SUCCESS'
    | 'MANIFEST_LOAD_FAILURE'
    | 'CONTROLLER_INITIALIZE_START'
    | 'CONTROLLER_READY'
    | 'CONTROLLER_INITIALIZE_FAILURE'
    | 'CONTROLLER_DISPOSE_START'
    | 'CONTROLLER_DISPOSED'
    | 'CHUNK_REQUEST_START'
    | 'CHUNK_REQUEST_SUCCESS'
    | 'CHUNK_REQUEST_FAILURE'
    | 'CHUNK_REQUEST_ABORTED'
    | 'CHUNK_REQUEST_TIMEOUT'
    | 'CHUNK_INTEGRITY_FAILURE'
    | 'DEPENDENCY_RESOLUTION_START'
    | 'DEPENDENCY_RESOLUTION_COMPLETE'
    | 'MEMORY_INSERT'
    | 'MEMORY_EVICTION'
    | 'MEMORY_BUDGET_EXCEEDED'
    | 'QUEUE_WAIT'
    | 'QUEUE_DISPATCH'
    | 'QUEUE_SATURATED'
    | 'PREFETCH_CYCLE_START'
    | 'PREFETCH_CANCELLED'
    | 'PREFETCH_PAUSED'
    | 'PREFETCH_RESUMED'
    | 'PREFETCH_STARTED'
    | 'PREFETCH_COMPLETED'
    | 'PREFETCH_FAILED'
    | 'PREFETCH_CYCLE_COMPLETE'
    | 'NETWORK_STATE_CHANGED'
    | 'PREFETCH_POLICY_CHANGED'
    | 'PREFETCH_POLICY_DISPOSED'
    | 'ASSET_DECODE_START'
    | 'ASSET_DECODE_SUCCESS'
    | 'ASSET_DECODE_FAILURE';

export interface StreamingEvent {
    type: StreamingEventType;
    timestamp: number;
    metadata?: Readonly<Record<string, unknown>>;
}

export interface StreamingObservabilitySink {
    emit(event: StreamingEvent): void;
}

export class NoOpStreamingObservabilitySink implements StreamingObservabilitySink {
    emit(event: StreamingEvent): void {}
}

export class StreamingObservability {
    private sink: StreamingObservabilitySink;

    constructor(sink: StreamingObservabilitySink = new NoOpStreamingObservabilitySink()) {
        this.sink = sink;
    }

    public emit(type: StreamingEventType, metadata?: Record<string, unknown>): void {
        if (this.sink instanceof NoOpStreamingObservabilitySink) return;
        this.sink.emit({
            type,
            timestamp: performance.now(),
            metadata: metadata ? Object.freeze({ ...metadata }) : undefined
        });
    }
}
