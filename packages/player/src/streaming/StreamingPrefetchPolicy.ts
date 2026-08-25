import { StreamingNetworkState, StreamingNetworkObserver, StreamingConnectionClass } from './StreamingNetworkState';
import { StreamingObservability } from './StreamingObservability';

export interface PrefetchPolicyConfig {
    maxConcurrentFast?: number;
    maxConcurrentModerate?: number;
    maxConcurrentSlow?: number;
    maxConcurrentUnknown?: number;
    observability?: StreamingObservability;
}

export class StreamingPrefetchPolicy {
    private observability: StreamingObservability;
    private config: Required<Omit<PrefetchPolicyConfig, 'observability'>>;
    
    private currentState: StreamingNetworkState;
    private onNetworkChange: (() => void) | null = null;
    
    private handleOnline = () => this.updateState();
    private handleOffline = () => this.updateState();
    private handleConnectionChange = () => this.updateState();
    
    private isDisposed = false;

    constructor(config: PrefetchPolicyConfig = {}) {
        this.observability = config.observability || new StreamingObservability();
        this.config = {
            maxConcurrentFast: config.maxConcurrentFast ?? 4,
            maxConcurrentModerate: config.maxConcurrentModerate ?? 2,
            maxConcurrentSlow: config.maxConcurrentSlow ?? 1,
            maxConcurrentUnknown: config.maxConcurrentUnknown ?? 1,
        };
        
        this.currentState = StreamingNetworkObserver.getState();
        this.attachListeners();
    }
    
    private attachListeners() {
        if (typeof window !== 'undefined') {
            window.addEventListener('online', this.handleOnline);
            window.addEventListener('offline', this.handleOffline);
            
            const nav = navigator as any;
            if (nav.connection && typeof nav.connection.addEventListener === 'function') {
                nav.connection.addEventListener('change', this.handleConnectionChange);
            }
        }
    }
    
    private removeListeners() {
        if (typeof window !== 'undefined') {
            window.removeEventListener('online', this.handleOnline);
            window.removeEventListener('offline', this.handleOffline);
            
            const nav = navigator as any;
            if (nav.connection && typeof nav.connection.removeEventListener === 'function') {
                nav.connection.removeEventListener('change', this.handleConnectionChange);
            }
        }
    }
    
    private updateState() {
        if (this.isDisposed) return;
        
        const newState = StreamingNetworkObserver.getState();
        const stateChanged = 
            newState.connectionClass !== this.currentState.connectionClass ||
            newState.saveData !== this.currentState.saveData ||
            newState.online !== this.currentState.online;
            
        if (stateChanged) {
            const previousState = { ...this.currentState };
            this.currentState = newState;
            
            this.observability.emit('NETWORK_STATE_CHANGED', {
                previous: previousState,
                current: this.currentState
            });
            
            this.observability.emit('PREFETCH_POLICY_CHANGED', {
                state: this.currentState
            });
            
            if (this.onNetworkChange) {
                this.onNetworkChange();
            }
        }
    }
    
    public setNetworkChangeCallback(callback: () => void) {
        this.onNetworkChange = callback;
    }
    
    public getState(): StreamingNetworkState {
        return { ...this.currentState };
    }
    
    public shouldPrefetch(): boolean {
        if (this.isDisposed) return false;
        if (!this.currentState.online) return false;
        if (this.currentState.saveData) return false;
        if (this.currentState.connectionClass === 'OFFLINE') return false;
        
        return this.getMaxBackgroundConcurrency() > 0;
    }
    
    public getMaxBackgroundConcurrency(): number {
        if (this.isDisposed || !this.currentState.online || this.currentState.saveData || this.currentState.connectionClass === 'OFFLINE') {
            return 0;
        }
        
        switch (this.currentState.connectionClass) {
            case 'FAST': return this.config.maxConcurrentFast;
            case 'MODERATE': return this.config.maxConcurrentModerate;
            case 'SLOW': return this.config.maxConcurrentSlow;
            case 'UNKNOWN': return this.config.maxConcurrentUnknown;
            default: return 0;
        }
    }
    
    public dispose() {
        if (this.isDisposed) return;
        this.isDisposed = true;
        this.removeListeners();
        this.onNetworkChange = null;
        this.observability.emit('PREFETCH_POLICY_DISPOSED');
    }
}
