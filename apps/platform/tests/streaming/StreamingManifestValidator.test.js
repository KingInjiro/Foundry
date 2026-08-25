import { describe, it, expect } from 'vitest';
import { StreamingManifestValidator } from '../../src/platform/backend/validation/StreamingManifestValidator.js';
import { QuotaConfig } from '../../src/platform/backend/config/quotas.js';

describe('StreamingManifestValidator', () => {
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

    const validPackageFiles = new Set([
        "chunks/boot.bin",
        "chunks/level1.bin",
        "index.html",
        "manifest.json",
        "streaming-manifest.json"
    ]);

    it('validates a correct manifest', () => {
        const validator = new StreamingManifestValidator();
        const result = validator.validate(JSON.stringify(validManifest), validPackageFiles);
        expect(result.valid).toBe(true);
        expect(result.diagnostics).toHaveLength(0);
        expect(result.validatedChunkCount).toBe(2);
    });

    it('rejects invalid JSON', () => {
        const validator = new StreamingManifestValidator();
        const result = validator.validate("{ bad json ", validPackageFiles);
        expect(result.valid).toBe(false);
        expect(result.diagnostics[0].code).toBe('STREAMING_MANIFEST_INVALID');
    });

    it('rejects duplicate chunk IDs', () => {
        const validator = new StreamingManifestValidator();
        const manifest = JSON.parse(JSON.stringify(validManifest));
        manifest.chunks[1].id = "boot-chunk-001"; // Duplicate
        
        const result = validator.validate(JSON.stringify(manifest), validPackageFiles);
        expect(result.valid).toBe(false);
        expect(result.diagnostics.find(d => d.code === 'STREAMING_MANIFEST_DUPLICATE_ID')).toBeDefined();
    });

    it('rejects missing dependencies', () => {
        const validator = new StreamingManifestValidator();
        const manifest = JSON.parse(JSON.stringify(validManifest));
        manifest.chunks[1].dependencies[0].chunkId = "missing-chunk";
        
        const result = validator.validate(JSON.stringify(manifest), validPackageFiles);
        expect(result.valid).toBe(false);
        expect(result.diagnostics.find(d => d.code === 'STREAMING_MANIFEST_MISSING_REFERENCE')).toBeDefined();
    });

    it('rejects dependency cycles', () => {
        const validator = new StreamingManifestValidator();
        const manifest = JSON.parse(JSON.stringify(validManifest));
        manifest.chunks[0].dependencies.push({ chunkId: "level-1", required: true });
        
        const result = validator.validate(JSON.stringify(manifest), validPackageFiles);
        expect(result.valid).toBe(false);
        expect(result.diagnostics.find(d => d.code === 'STREAMING_MANIFEST_CYCLE')).toBeDefined();
    });

    it('rejects self dependencies', () => {
        const validator = new StreamingManifestValidator();
        const manifest = JSON.parse(JSON.stringify(validManifest));
        manifest.chunks[0].dependencies.push({ chunkId: "boot-chunk-001", required: true });
        
        const result = validator.validate(JSON.stringify(manifest), validPackageFiles);
        expect(result.valid).toBe(false);
        expect(result.diagnostics.find(d => d.code === 'STREAMING_MANIFEST_SELF_DEPENDENCY')).toBeDefined();
    });

    it('rejects unsafe paths', () => {
        const validator = new StreamingManifestValidator();
        const manifest = JSON.parse(JSON.stringify(validManifest));
        manifest.chunks[1].url = "../outside.bin";
        
        const result = validator.validate(JSON.stringify(manifest), validPackageFiles);
        expect(result.valid).toBe(false);
        expect(result.diagnostics.find(d => d.code === 'STREAMING_MANIFEST_INVALID_PATH')).toBeDefined();
    });

    it('rejects missing chunk files in package', () => {
        const validator = new StreamingManifestValidator();
        const manifest = JSON.parse(JSON.stringify(validManifest));
        manifest.chunks[1].url = "chunks/missing.bin";
        
        const result = validator.validate(JSON.stringify(manifest), validPackageFiles);
        expect(result.valid).toBe(false);
        expect(result.diagnostics.find(d => d.code === 'STREAMING_MANIFEST_CHUNK_MISSING')).toBeDefined();
    });

    it('rejects remote chunk URLs', () => {
        const validator = new StreamingManifestValidator();
        const manifest = JSON.parse(JSON.stringify(validManifest));
        manifest.chunks[1].url = 'https://example.com/outside.bin';

        const result = validator.validate(JSON.stringify(manifest), validPackageFiles);
        expect(result.valid).toBe(false);
        expect(result.diagnostics.find(d => d.code === 'STREAMING_MANIFEST_INVALID_PATH')).toBeDefined();
    });

    it('rejects malformed SHA-256 values', () => {
        const validator = new StreamingManifestValidator();
        const manifest = JSON.parse(JSON.stringify(validManifest));
        manifest.chunks[1].hash = 'hash2';

        const result = validator.validate(JSON.stringify(manifest), validPackageFiles);
        expect(result.valid).toBe(false);
        expect(result.diagnostics.find(d => d.code === 'STREAMING_MANIFEST_INVALID_HASH')).toBeDefined();
    });

    it('requires dependency required flags', () => {
        const validator = new StreamingManifestValidator();
        const manifest = JSON.parse(JSON.stringify(validManifest));
        delete manifest.chunks[1].dependencies[0].required;

        const result = validator.validate(JSON.stringify(manifest), validPackageFiles);
        expect(result.valid).toBe(false);
        expect(result.diagnostics.some(d => d.message.includes('required flag'))).toBe(true);
    });
});
