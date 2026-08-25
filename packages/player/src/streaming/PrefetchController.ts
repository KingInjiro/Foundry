import { StreamingRuntimeManifest } from './StreamingManifestLoader';
import type { ChunkDescriptor } from '@foundry/contracts/streaming/types';
import { MemoryBudgetManager } from './MemoryBudgetManager';
import { StreamingObservability } from './StreamingObservability';
import { StreamingPrefetchPolicy } from './StreamingPrefetchPolicy';

export interface PrefetchOptions {
    policy?: StreamingPrefetchPolicy;
    maxConcurrentPrefetches?: number;
    observability?: StreamingObservability;
}

export type FetchDelegate = (chunkId: string, options: { context: 'foreground' | 'background' }) => Promise<void>;

export class PrefetchController {
    private manifest: StreamingRuntimeManifest;
    private memoryManager: MemoryBudgetManager;
    private fetchDelegate: FetchDelegate;
    private observability: StreamingObservability;
    private policy: StreamingPrefetchPolicy;

    private activePrefetches = 0;
    
    private candidates: string[] = [];
    private isRunning = false;
    private isDisposed = false;
    
    // Tracking sets
    private completedPrefetches = new Set<string>();
    private failedPrefetches = new Set<string>();

    constructor(
        manifest: StreamingRuntimeManifest,
        memoryManager: MemoryBudgetManager,
        fetchDelegate: FetchDelegate,
        options: PrefetchOptions = {}
    ) {
        this.manifest = manifest;
        this.memoryManager = memoryManager;
        this.fetchDelegate = fetchDelegate;
        this.observability = options.observability || new StreamingObservability();
        this.policy = options.policy || new StreamingPrefetchPolicy({ observability: this.observability, maxConcurrentFast: options.maxConcurrentPrefetches, maxConcurrentModerate: options.maxConcurrentPrefetches, maxConcurrentSlow: options.maxConcurrentPrefetches, maxConcurrentUnknown: options.maxConcurrentPrefetches });
        
        this.policy.setNetworkChangeCallback(() => this.handlePolicyChange());
        
        this.buildCandidateList();
    }
    
    private buildCandidateList() {
        // Find all explicitly preloaded chunks
        const preloads = new Set<string>();
        for (const [id, chunk] of Array.from(this.manifest.chunks.entries())) {
            if (chunk.preload && id !== this.manifest.runtime?.entry) {
                preloads.add(id);
                // Also add dependencies recursively
                const addDeps = (chunkId: string) => {
                    const deps = this.manifest.dependencies.get(chunkId) || [];
                    for (const dep of deps) {
                        if (!preloads.has(dep)) {
                            preloads.add(dep);
                            addDeps(dep);
                        }
                    }
                };
                addDeps(id);
            }
        }
        
        const candidateDefs: { id: string, def: ChunkDescriptor, depth: number }[] = [];
        
        for (const id of Array.from(preloads)) {
            const def = this.manifest.chunks.get(id);
            if (def) {
                candidateDefs.push({ id, def, depth: this.getDependencyDepth(id, new Set()) });
            }
        }
        
        // Sort candidates
        // 1. priority descending
        // 2. explicit preload preference (preload=true > preload=false)
        // 3. dependency depth (leaf nodes first so they are ready for parents) -> smaller depth first? Or higher depth first? 
        // Leaves have 0 dependencies, so depth 0. Parents depend on leaves. Leaves should be prefetched first.
        // 4. lexical chunkId tie-break
        
        candidateDefs.sort((a, b) => {
            const priorityScore = (p: string) => {
                switch(p) {
                    case 'critical': return 3;
                    case 'high': return 2;
                    case 'medium': return 1;
                    case 'low': return 0;
                    default: return 0;
                }
            };
            
            const pA = priorityScore(a.def.priority);
            const pB = priorityScore(b.def.priority);
            if (pA !== pB) return pB - pA; // descending
            
            const plA = a.def.preload ? 1 : 0;
            const plB = b.def.preload ? 1 : 0;
            if (plA !== plB) return plB - plA;
            
            if (a.depth !== b.depth) return a.depth - b.depth;
            
            return a.id.localeCompare(b.id);
        });
        
        this.candidates = candidateDefs.map(c => c.id);
    }
    
    private getDependencyDepth(id: string, visited: Set<string>): number {
        if (visited.has(id)) return 0;
        visited.add(id);
        const deps = this.manifest.dependencies.get(id) || [];
        if (deps.length === 0) return 0;
        let maxDepth = 0;
        for (const dep of deps) {
            maxDepth = Math.max(maxDepth, this.getDependencyDepth(dep, visited));
        }
        return maxDepth + 1;
    }

    public async start(): Promise<void> {
        if (this.isDisposed) return;
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.observability.emit('PREFETCH_CYCLE_START');
        
        this.pump();
    }
    
    public cancelAll(): void {
        this.isRunning = false;
        this.observability.emit('PREFETCH_CANCELLED');
    }
    
    private handlePolicyChange() {
        if (this.isDisposed || !this.isRunning) return;
        if (!this.policy.shouldPrefetch()) return;
        if (!this.policy.shouldPrefetch()) {
            this.observability.emit('PREFETCH_PAUSED', { reason: 'network_policy' });
        } else {
            this.observability.emit('PREFETCH_RESUMED', { reason: 'network_policy' });
            this.pump();
        }
    }

    public dispose(): void {
        this.isDisposed = true;
        this.isRunning = false;
        this.policy.dispose();
        this.candidates = [];
    }
    
    private pump() {
        if (this.isDisposed || !this.isRunning) return;
        
        // Check memory budget
        const memSnapshot = this.memoryManager.getSnapshot();
        const available = memSnapshot.maxMemoryBytes - memSnapshot.currentMemoryBytes;
        if (available <= 0) {
            this.observability.emit('PREFETCH_PAUSED', { reason: 'memory_full' });
            return;
        }
        
        while (this.activePrefetches < this.policy.getMaxBackgroundConcurrency() && this.candidates.length > 0) {
            const nextCandidate = this.candidates.shift()!;
            
            if (this.completedPrefetches.has(nextCandidate) || this.failedPrefetches.has(nextCandidate)) {
                continue;
            }
            
            // Check memory estimate before fetching
            const def = this.manifest.chunks.get(nextCandidate);
            if (def && available < def.size) {
                // Not enough memory for this chunk, pause prefetching
                this.candidates.unshift(nextCandidate); // put it back
                this.observability.emit('PREFETCH_PAUSED', { reason: 'insufficient_memory', required: def.size, available });
                return;
            }
            
            this.activePrefetches++;
            this.observability.emit('PREFETCH_STARTED', { chunkId: nextCandidate });
            
            this.fetchDelegate(nextCandidate, { context: 'background' })
                .then(() => {
                    this.completedPrefetches.add(nextCandidate);
                    this.observability.emit('PREFETCH_COMPLETED', { chunkId: nextCandidate });
                })
                .catch(err => {
                    // Failures are non-fatal
                    if (err.name !== 'ChunkFetchAbortedError' && err.message !== 'Controller is disposed') {
                        this.failedPrefetches.add(nextCandidate);
                        this.observability.emit('PREFETCH_FAILED', { chunkId: nextCandidate, reason: err.message });
                    }
                })
                .finally(() => {
                    this.activePrefetches--;
                    if (this.isRunning && !this.isDisposed) {
                        this.pump();
                    }
                    if (this.candidates.length === 0 && this.activePrefetches === 0) {
                        this.observability.emit('PREFETCH_CYCLE_COMPLETE');
                    }
                });
        }
    }
}
