import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingPrefetchPolicy } from '../../src/streaming/StreamingPrefetchPolicy';
import { StreamingNetworkObserver } from '../../src/streaming/StreamingNetworkState';
import { StreamingObservability } from '../../src/streaming/StreamingObservability';

describe('Phase 3O - Network Policy', () => {
    let mockNavigator: any;
    let events: any[] = [];
    let observability: StreamingObservability;
    
    let originalNavigator: any;
    let originalWindow: any;

    beforeEach(() => {
        events = [];
        observability = new StreamingObservability({ emit: e => events.push(e) });
        
        mockNavigator = {
            onLine: true,
            connection: {
                effectiveType: '4g',
                saveData: false,
                listeners: {},
                addEventListener: function(evt: string, cb: any) { this.listeners[evt] = cb; },
                removeEventListener: function(evt: string) { delete this.listeners[evt]; }
            }
        };

        const mockWindow = {
            listeners: {} as Record<string, any>,
            addEventListener: function(evt: string, cb: any) { this.listeners[evt] = cb; },
            removeEventListener: function(evt: string) { delete this.listeners[evt]; }
        };
        
        // Mocking globals
        vi.stubGlobal('navigator', mockNavigator);
        vi.stubGlobal('window', mockWindow);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('classifies connection properly based on effectiveType', () => {
        const testCases = [
            { type: '4g', expected: 'FAST', conc: 4 },
            { type: '3g', expected: 'MODERATE', conc: 2 },
            { type: '2g', expected: 'SLOW', conc: 1 },
            { type: 'slow-2g', expected: 'SLOW', conc: 1 },
            { type: 'unknown', expected: 'UNKNOWN', conc: 1 }
        ];

        for (const tc of testCases) {
            mockNavigator.connection.effectiveType = tc.type;
            const policy = new StreamingPrefetchPolicy({ observability });
            expect(policy.getState().connectionClass).toBe(tc.expected);
            expect(policy.getMaxBackgroundConcurrency()).toBe(tc.conc);
            policy.dispose();
        }
    });
    
    it('handles missing Network Information API gracefully', () => {
        delete mockNavigator.connection;
        
        const policy = new StreamingPrefetchPolicy({ observability });
        expect(policy.getState().connectionClass).toBe('UNKNOWN');
        expect(policy.shouldPrefetch()).toBe(true);
        expect(policy.getMaxBackgroundConcurrency()).toBe(1);
        policy.dispose();
    });

    it('disables prefetch when saveData is true', () => {
        mockNavigator.connection.saveData = true;
        
        const policy = new StreamingPrefetchPolicy({ observability });
        expect(policy.getState().saveData).toBe(true);
        expect(policy.shouldPrefetch()).toBe(false);
        expect(policy.getMaxBackgroundConcurrency()).toBe(0);
        policy.dispose();
    });

    it('pauses prefetch when offline and resumes when online', () => {
        const policy = new StreamingPrefetchPolicy({ observability });
        expect(policy.shouldPrefetch()).toBe(true);
        
        // Simulate offline
        mockNavigator.onLine = false;
        (global.window as any).listeners['offline']();
        
        expect(policy.shouldPrefetch()).toBe(false);
        expect(policy.getMaxBackgroundConcurrency()).toBe(0);
        expect(policy.getState().connectionClass).toBe('OFFLINE');
        
        // Simulate online
        mockNavigator.onLine = true;
        (global.window as any).listeners['online']();
        
        expect(policy.shouldPrefetch()).toBe(true);
        expect(policy.getState().connectionClass).toBe('FAST');
        
        policy.dispose();
    });

    it('emits observability events on network changes', () => {
        const policy = new StreamingPrefetchPolicy({ observability });
        events = []; // clear initial
        
        mockNavigator.connection.effectiveType = '3g';
        mockNavigator.connection.listeners['change']();
        
        expect(events).toContainEqual(expect.objectContaining({ 
            type: 'NETWORK_STATE_CHANGED',
            metadata: expect.objectContaining({
                current: expect.objectContaining({ connectionClass: 'MODERATE' })
            })
        }));
        
        expect(events).toContainEqual(expect.objectContaining({ 
            type: 'PREFETCH_POLICY_CHANGED',
            metadata: expect.objectContaining({
                state: expect.objectContaining({ connectionClass: 'MODERATE' })
            })
        }));
        
        policy.dispose();
    });

    it('cleans up listeners on dispose and makes it idempotent', () => {
        const policy = new StreamingPrefetchPolicy({ observability });
        
        expect(mockNavigator.connection.listeners['change']).toBeDefined();
        expect((global.window as any).listeners['online']).toBeDefined();
        
        policy.dispose();
        
        expect(mockNavigator.connection.listeners['change']).toBeUndefined();
        expect((global.window as any).listeners['online']).toBeUndefined();
        
        const eventsBefore = events.length;
        policy.dispose(); // Should be safe
        expect(events.length).toBe(eventsBefore); // No new events emitted
    });

    it('calls network change callback', () => {
        const policy = new StreamingPrefetchPolicy({ observability });
        const cb = vi.fn();
        policy.setNetworkChangeCallback(cb);
        
        mockNavigator.connection.effectiveType = '3g';
        mockNavigator.connection.listeners['change']();
        
        expect(cb).toHaveBeenCalledTimes(1);
        policy.dispose();
    });
});
