import { FetchedChunk } from '../../../src/streaming/ChunkFetcher';
import { vi } from 'vitest';

export interface TransportRequest {
    url: string;
    resolve: (res: Response) => void;
    reject: (error: Error) => void;
    signal: AbortSignal;
}

export class DeterministicTransport {
    public customResponses: Map<string, ArrayBuffer> = new Map();
    public activeRequests: TransportRequest[] = [];
    public completedRequests = 0;
    public abortedRequests = 0;
    public allRequestedUrls: string[] = [];
    public fetchDelayMs = 0;
    public autoResolve = false;

    private originalFetch = globalThis.fetch;
    private originalCrypto = globalThis.crypto;

    public setup() {
        globalThis.fetch = vi.fn().mockImplementation((url: string | URL | globalThis.Request, init?: RequestInit) => {
            const urlStr = url.toString();
            this.allRequestedUrls.push(urlStr);
            return new Promise((resolve, reject) => {
                const req: TransportRequest = { 
                    url: urlStr, 
                    resolve: (r: any) => resolve(r), 
                    reject, 
                    signal: init?.signal || new AbortController().signal 
                };
                this.activeRequests.push(req);

                if (req.signal.aborted) {
                    this.removeReq(req);
                    this.abortedRequests++;
                    reject(new DOMException('Aborted', 'AbortError'));
                    return;
                }

                req.signal.addEventListener('abort', () => {
                    this.removeReq(req);
                    this.abortedRequests++;
                    reject(new DOMException('Aborted', 'AbortError'));
                });

                if (this.autoResolve) {
                    if (this.fetchDelayMs > 0) {
                        setTimeout(() => {
                            if (!req.signal.aborted) this.resolveRequest(req);
                        }, this.fetchDelayMs);
                    } else {
                        this.resolveRequest(req);
                    }
                }
            });
        });

        // Mock crypto so hash check is instant and always matches what our test uses
        // We will encode a byte array that produces our expected hex when mapped
        // sha256-cd00e2... we just need the digest to return 32 bytes that when hex encoded equal `cd00e292c5970d3c5e2f0ffa5171e555bc46bfc4faddfb4a418b6840b86e79a3`
        // Or we can just return a dummy buffer, but ChunkFetcher checks it.
        // Let's parse the hex string to a Uint8Array:
        const hex = 'cd00e292c5970d3c5e2f0ffa5171e555bc46bfc4faddfb4a418b6840b86e79a3';
        const dummyHash = new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))).buffer;

        Object.defineProperty(globalThis, 'crypto', {
            value: {
                subtle: {
                    digest: vi.fn().mockResolvedValue(dummyHash)
                }
            },
            configurable: true,
            writable: true
        });
    }

    public teardown() {
        globalThis.fetch = this.originalFetch;
        Object.defineProperty(globalThis, 'crypto', {
            value: this.originalCrypto,
            configurable: true,
            writable: true
        });
    }

    private removeReq(req: TransportRequest) {
        const idx = this.activeRequests.indexOf(req);
        if (idx !== -1) {
            this.activeRequests.splice(idx, 1);
        }
    }

    public resolveRequest(req: TransportRequest, bufferSize = 100) {
        this.removeReq(req);
        this.completedRequests++;
        const arrayBuffer = this.customResponses.get(req.url) || new ArrayBuffer(bufferSize);
        req.resolve({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(arrayBuffer)
        } as unknown as Response);
    }

    public resolveUrl(urlStr: string, bufferSize = 100) {
        const reqs = this.activeRequests.filter(r => r.url === urlStr);
        for (const req of reqs) {
            this.resolveRequest(req, bufferSize);
        }
    }

    public rejectUrl(urlStr: string, error: Error) {
        const reqs = this.activeRequests.filter(r => r.url === urlStr);
        for (const req of reqs) {
            this.removeReq(req);
            req.reject(error);
        }
    }

    public resolveAll(bufferSize = 100) {
        const reqs = [...this.activeRequests];
        for (const req of reqs) {
            this.resolveRequest(req, bufferSize);
        }
    }
}
