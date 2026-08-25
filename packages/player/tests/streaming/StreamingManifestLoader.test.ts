import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
    StreamingManifestLoader, 
    StreamingManifestNetworkError, 
    StreamingManifestHttpError, 
    StreamingManifestJsonError, 
    StreamingManifestValidationError 
} from '../../src/streaming/StreamingManifestLoader';

describe('StreamingManifestLoader', () => {
    let loader: StreamingManifestLoader;
    const HASH_A = `sha256-${'a'.repeat(64)}`;
    const HASH_B = `sha256-${'b'.repeat(64)}`;

    const validManifest = {
        schemaVersion: 1,
        runtime: {
            entry: "boot-chunk-001"
        },
        chunks: [
            {
                id: "boot-chunk-001",
                url: "chunks/boot.bin",
                size: 1024,
                hash: HASH_A,
                dependencies: [],
                priority: "critical",
                preload: true
            },
            {
                id: "level-1",
                url: "chunks/level1.bin",
                size: 2048,
                hash: HASH_B,
                dependencies: [
                    { chunkId: "boot-chunk-001", required: true }
                ],
                priority: "high",
                preload: false
            }
        ]
    };

    beforeEach(() => {
        loader = new StreamingManifestLoader();
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const mockFetchSuccess = (data: any) => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data))
        });
    };

    const mockFetchFailure = (status: number) => {
        (global.fetch as any).mockResolvedValue({
            ok: false,
            status: status
        });
    };

    describe('Network & HTTP', () => {
        it('throws NetworkError on fetch rejection', async () => {
            (global.fetch as any).mockRejectedValue(new Error('Connection failed'));
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(StreamingManifestNetworkError);
        });

        it('throws HttpError on 404', async () => {
            mockFetchFailure(404);
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(StreamingManifestHttpError);
        });

        it('throws HttpError on 500', async () => {
            mockFetchFailure(500);
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(StreamingManifestHttpError);
        });
    });

    describe('JSON parsing', () => {
        it('throws JsonError on malformed JSON', async () => {
            mockFetchSuccess('{ bad json ');
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(StreamingManifestJsonError);
        });

        it('throws JsonError on empty response', async () => {
            mockFetchSuccess('');
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(StreamingManifestJsonError);
        });

        it('throws ValidationError on non-object JSON', async () => {
            mockFetchSuccess('["array"]');
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(StreamingManifestValidationError);
        });
    });

    describe('Validation', () => {
        it('accepts valid manifest and normalizes it', async () => {
            mockFetchSuccess(validManifest);
            const result = await loader.load('https://cdn.example.com/manifest.json');
            
            expect(result.schemaVersion).toBe(1);
            expect(result.runtime.entry).toBe('boot-chunk-001');
            expect(result.chunks.size).toBe(2);
            expect(result.chunks.get('boot-chunk-001')?.url).toBe('chunks/boot.bin');
            expect(result.dependencies.get('level-1')).toEqual(['boot-chunk-001']);
        });

        it('rejects unsupported schema version', async () => {
            const manifest = { ...validManifest, schemaVersion: 2 };
            mockFetchSuccess(manifest);
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(StreamingManifestValidationError);
        });

        it('rejects missing runtime', async () => {
            const manifest = { ...validManifest, runtime: undefined };
            mockFetchSuccess(manifest);
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(StreamingManifestValidationError);
        });

        it('rejects missing entry', async () => {
            const manifest = { ...validManifest, runtime: { entry: '' } };
            mockFetchSuccess(manifest);
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(StreamingManifestValidationError);
        });

        it('rejects duplicate chunk IDs', async () => {
            const manifest = JSON.parse(JSON.stringify(validManifest));
            manifest.chunks[1].id = "boot-chunk-001";
            mockFetchSuccess(manifest);
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(StreamingManifestValidationError);
        });

        it('rejects dangling dependency', async () => {
            const manifest = JSON.parse(JSON.stringify(validManifest));
            manifest.chunks[1].dependencies[0].chunkId = "missing-chunk";
            mockFetchSuccess(manifest);
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(StreamingManifestValidationError);
        });

        it('rejects self dependency', async () => {
            const manifest = JSON.parse(JSON.stringify(validManifest));
            manifest.chunks[0].dependencies.push({ chunkId: "boot-chunk-001", required: true });
            mockFetchSuccess(manifest);
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(StreamingManifestValidationError);
        });

        it('rejects dependency cycle', async () => {
            const manifest = JSON.parse(JSON.stringify(validManifest));
            manifest.chunks[0].dependencies.push({ chunkId: "level-1", required: true });
            mockFetchSuccess(manifest);
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(StreamingManifestValidationError);
        });

        it('rejects unsafe path', async () => {
            const manifest = JSON.parse(JSON.stringify(validManifest));
            manifest.chunks[1].url = "../outside.bin";
            mockFetchSuccess(manifest);
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(StreamingManifestValidationError);
        });

        it('rejects remote chunk URLs', async () => {
            const manifest = JSON.parse(JSON.stringify(validManifest));
            manifest.chunks[1].url = 'https://example.com/outside.bin';
            mockFetchSuccess(manifest);
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(StreamingManifestValidationError);
        });

        it('rejects a non-cryptographic hash', async () => {
            const manifest = JSON.parse(JSON.stringify(validManifest));
            manifest.chunks[1].hash = 'hash2';
            mockFetchSuccess(manifest);
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(/SHA-256 hash/);
        });

        it('requires the dependency required flag', async () => {
            const manifest = JSON.parse(JSON.stringify(validManifest));
            delete manifest.chunks[1].dependencies[0].required;
            mockFetchSuccess(manifest);
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(/required flag/);
        });

        it('rejects invalid size', async () => {
            const manifest = JSON.parse(JSON.stringify(validManifest));
            manifest.chunks[1].size = -100;
            mockFetchSuccess(manifest);
            await expect(loader.load('https://cdn.example.com/manifest.json'))
                .rejects.toThrow(StreamingManifestValidationError);
        });
    });

    describe('Immutability & Determinism', () => {
        it('returns immutable runtime representation', async () => {
            mockFetchSuccess(validManifest);
            const result = await loader.load('https://cdn.example.com/manifest.json');
            
            // Try to mutate schemaVersion
            expect(() => {
                (result as any).schemaVersion = 2;
            }).toThrow(TypeError);

            // Try to mutate runtime
            expect(() => {
                (result.runtime as any).entry = "hack";
            }).toThrow(TypeError);

            // Try to mutate chunks
            const chunk = result.chunks.get('boot-chunk-001');
            expect(() => {
                (chunk as any).size = 0;
            }).toThrow(TypeError);

            // Try to mutate dependencies array
            const deps = result.dependencies.get('level-1');
            expect(() => {
                (deps as any).push('hack');
            }).toThrow(TypeError);
        });

        it('deduplicates concurrent loads', async () => {
            mockFetchSuccess(validManifest);
            const p1 = loader.load('https://cdn.example.com/manifest.json');
            const p2 = loader.load('https://cdn.example.com/manifest.json');
            expect(p1).toBe(p2);
            await Promise.all([p1, p2]);
            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(global.fetch).toHaveBeenCalledWith('https://cdn.example.com/manifest.json', expect.objectContaining({
                credentials: 'omit',
                cache: 'no-cache'
            }));
        });
    });
});
