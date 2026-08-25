import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
    ChunkFetcher, 
    ChunkFetchNetworkError, 
    ChunkFetchHttpError, 
    ChunkFetchAbortedError, 
    ChunkIntegrityError, 
    ChunkNotFoundError 
} from '../../src/streaming/ChunkFetcher';
import { StreamingRuntimeManifest } from '../../src/streaming/StreamingManifestLoader';

describe('ChunkFetcher', () => {
    let mockManifest: StreamingRuntimeManifest;
    
    // Helper to compute sha256 to mock manifest correctly
    async function getHashHex(str: string): Promise<string> {
        const buffer = new TextEncoder().encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return `sha256-${hashHex}`;
    }

    beforeEach(async () => {
        global.fetch = vi.fn();
        
        mockManifest = {
            schemaVersion: 1,
            runtime: { entry: 'a' },
            chunks: new Map([
                ['a', { id: 'a', url: 'a.bin', size: 6, hash: await getHashHex('a-data'), priority: 'low', dependencies: [], preload: false }],
                ['b', { id: 'b', url: 'b.bin', size: 6, hash: await getHashHex('b-data'), priority: 'high', dependencies: [], preload: false }],
                ['c', { id: 'c', url: 'c.bin', size: 6, hash: await getHashHex('c-data'), priority: 'medium', dependencies: [], preload: false }],
                ['d', { id: 'd', url: 'd.bin', size: 6, hash: await getHashHex('d-data'), priority: 'critical', dependencies: [], preload: false }],
                ['dep1', { id: 'dep1', url: 'dep1.bin', size: 9, hash: await getHashHex('dep1-data'), priority: 'low', dependencies: [], preload: false }],
                ['dep2', { id: 'dep2', url: 'dep2.bin', size: 9, hash: await getHashHex('dep2-data'), priority: 'low', dependencies: [], preload: false }]
            ]),
            dependencies: new Map([
                ['a', ['dep1']],
                ['dep1', ['dep2']]
            ])
        } as unknown as StreamingRuntimeManifest;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const mockFetchData = (dataStr: string, delayMs = 0) => {
        (global.fetch as any).mockImplementationOnce(async (url: string) => {
            if (delayMs) await new Promise(r => setTimeout(r, delayMs));
            return {
                ok: true,
                status: 200,
                arrayBuffer: async () => new TextEncoder().encode(dataStr).buffer
            };
        });
    };
    
    const mockFetchRoute = (routes: Record<string, string>, delayMs = 0) => {
        (global.fetch as any).mockImplementation(async (url: string) => {
            if (delayMs) await new Promise(r => setTimeout(r, delayMs));
            const key = url.split('/').pop()?.split('.')[0] || '';
            const dataStr = routes[key] || `${key}-data`;
            return {
                ok: true,
                status: 200,
                arrayBuffer: async () => new TextEncoder().encode(dataStr).buffer
            };
        });
    };

    const mockFetchFail = (status: number) => {
        (global.fetch as any).mockImplementationOnce(async () => ({ ok: false, status }));
    };

    describe('Basic functionality', () => {
        it('throws ChunkNotFoundError for unknown chunk', async () => {
            const fetcher = new ChunkFetcher(mockManifest, 'https://cdn.example.com');
            await expect(fetcher.fetchChunk('unknown')).rejects.toThrow(ChunkNotFoundError);
        });

        it('fetches a single chunk successfully', async () => {
            mockFetchData('b-data');
            const fetcher = new ChunkFetcher(mockManifest, 'https://cdn.example.com');
            const result = await fetcher.fetchChunk('b');
            
            expect(result.id).toBe('b');
            expect(result.sha256).toBe(mockManifest.chunks.get('b')?.hash);
            expect(global.fetch).toHaveBeenCalledWith('https://cdn.example.com/b.bin', expect.objectContaining({
                credentials: 'omit',
                cache: 'force-cache',
                method: 'GET'
            }));
        });

        it('throws ChunkIntegrityError if hash mismatches', async () => {
            mockFetchData('wrong-data');
            const fetcher = new ChunkFetcher(mockManifest, 'https://cdn.example.com');
            await expect(fetcher.fetchChunk('b')).rejects.toThrow(ChunkIntegrityError);
        });

        it('throws ChunkIntegrityError if the declared size mismatches', async () => {
            const original = mockManifest.chunks.get('b')!;
            (mockManifest.chunks as Map<string, any>).set('b', { ...original, size: original.size + 1 });
            mockFetchData('b-data');
            const fetcher = new ChunkFetcher(mockManifest, 'https://cdn.example.com');
            await expect(fetcher.fetchChunk('b')).rejects.toThrow(/size check failed/);
        });
        it('treats a simulated cache hit exactly like a normal response and verifies SHA-256', async () => {
            // A cache hit in fetch is just a normal Response object where the browser handled the cache
            // We simulate it by just resolving immediately
            mockFetchData('b-data');
            const fetcher = new ChunkFetcher(mockManifest, 'https://cdn.example.com');
            const result = await fetcher.fetchChunk('b');
            expect(result.id).toBe('b');
            expect(result.sha256).toBe(mockManifest.chunks.get('b')?.hash);
            expect(global.fetch).toHaveBeenCalledWith('https://cdn.example.com/b.bin', expect.objectContaining({
                cache: 'force-cache'
            }));
        });
    });

    describe('Deduplication', () => {
        it('deduplicates simultaneous fetch requests for same chunk', async () => {
            mockFetchRoute({ b: 'b-data' }, 10);
            const fetcher = new ChunkFetcher(mockManifest, 'https://cdn.example.com');
            
            const p1 = fetcher.fetchChunk('b');
            const p2 = fetcher.fetchChunk('b');
            
            await Promise.all([p1, p2]);
            
            // Should only call fetch once for b
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        
    });

    describe('Concurrency and Priority', () => {
        it('limits concurrent requests', async () => {
            let activeFetches = 0;
            let maxActiveFetches = 0;
            (global.fetch as any).mockImplementation(async (url: string) => {
                activeFetches++;
                maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
                await new Promise(r => setTimeout(r, 20));
                activeFetches--;
                const key = url.split('/').pop()?.split('.')[0] || '';
                return {
                    ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(`${key}-data`).buffer
                };
            });

            const fetcher = new ChunkFetcher(mockManifest, 'https://cdn.example.com', 2);
            
            await Promise.all([
                fetcher.fetchChunk('b'),
                fetcher.fetchChunk('c'),
                fetcher.fetchChunk('d')
            ]);
            
            expect(global.fetch).toHaveBeenCalledTimes(3);
            expect(maxActiveFetches).toBe(2);
        });

        it('respects priority order', async () => {
            let fetchLog: string[] = [];
            (global.fetch as any).mockImplementation(async (url: string) => {
                const key = url.split('/').pop()?.split('.')[0] || '';
                fetchLog.push(key);
                await new Promise(r => setTimeout(r, 10));
                return {
                    ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(`${key}-data`).buffer
                };
            });

            const fetcher = new ChunkFetcher(mockManifest, 'https://cdn.example.com', 1);
            
            // Request b (high), c (medium), d (critical)
            // d should be executed before b, b before c
            const pB = fetcher.fetchChunk('b');
            const pC = fetcher.fetchChunk('c');
            const pD = fetcher.fetchChunk('d');
            
            await Promise.all([pB, pC, pD]);
            
            // First one is whatever gets dispatched first (probably b since it was pushed first before c and d were added)
            // Wait, actually, all three enqueue calls happen synchronously before any await microtask yields to the pump.
            // Oh actually `await this.queue.enqueue` yields, but before the first one completes, the other two are enqueued.
            // Let's check fetchLog. The first one dispatched is definitely b. But between c and d, d (critical) should beat c (medium).
            expect(fetchLog[1]).toBe('d');
            expect(fetchLog[2]).toBe('c');
        });
    });

    describe('HTTP and Network Errors', () => {
        it('throws ChunkFetchHttpError on 404', async () => {
            mockFetchFail(404);
            const fetcher = new ChunkFetcher(mockManifest, 'https://cdn.example.com');
            await expect(fetcher.fetchChunk('b')).rejects.toThrow(ChunkFetchHttpError);
        });

        it('throws ChunkFetchHttpError on 500', async () => {
            mockFetchFail(500);
            const fetcher = new ChunkFetcher(mockManifest, 'https://cdn.example.com');
            await expect(fetcher.fetchChunk('b')).rejects.toThrow(ChunkFetchHttpError);
        });

        it('throws ChunkFetchNetworkError on network failure', async () => {
            (global.fetch as any).mockRejectedValueOnce(new Error('Connection failed'));
            const fetcher = new ChunkFetcher(mockManifest, 'https://cdn.example.com');
            await expect(fetcher.fetchChunk('b')).rejects.toThrow(ChunkFetchNetworkError);
        });
    });

    describe('Abort and Timeout', () => {
        it('aborts chunk fetch if signal is aborted', async () => {
            (global.fetch as any).mockImplementationOnce(async (url: string, opts: any) => {
                await new Promise((r, reject) => {
                    if (opts.signal) opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
                    setTimeout(r, 50);
                });
            });

            const fetcher = new ChunkFetcher(mockManifest, 'https://cdn.example.com');
            const ac = new AbortController();
            const p = fetcher.fetchChunk('b', { signal: ac.signal });
            
            ac.abort();
            
            await expect(p).rejects.toThrow(ChunkFetchAbortedError);
        });

        it('times out if timeoutMs is exceeded', async () => {
            (global.fetch as any).mockImplementationOnce(async (url: string, opts: any) => {
                return new Promise((r, reject) => {
                    const timer = setTimeout(() => r({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }), 50);
                    if (opts.signal) {
                        opts.signal.addEventListener('abort', () => {
                            clearTimeout(timer);
                            reject(new Error('TIMEOUT')); // Simulate fetch aborting
                        });
                    }
                });
            });

            const fetcher = new ChunkFetcher(mockManifest, 'https://cdn.example.com');
            await expect(fetcher.fetchChunk('b', { timeout: 10 })).rejects.toThrow(ChunkFetchNetworkError); // mapped to timeout
        });

        it('allows retrying after failure or abort', async () => {
            mockFetchFail(500); // Fail first time
            const fetcher = new ChunkFetcher(mockManifest, 'https://cdn.example.com');
            
            await expect(fetcher.fetchChunk('b')).rejects.toThrow(ChunkFetchHttpError);
            
            // Succeed second time
            mockFetchData('b-data');
            const result = await fetcher.fetchChunk('b');
            expect(result.id).toBe('b');
            expect(global.fetch).toHaveBeenCalledTimes(2);
        });
    });
});
