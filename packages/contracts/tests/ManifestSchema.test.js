import { describe, it, expect } from 'vitest';
import { AssetManifestSchema } from '../src/streaming/AssetManifestSchema';
import fs from 'fs';
import path from 'path';

describe('AssetManifestSchema', () => {
    it('should be a valid JSON schema definition', () => {
        expect(AssetManifestSchema.$schema).toBe("http://json-schema.org/draft-07/schema#");
        expect(AssetManifestSchema.type).toBe("object");
        expect(AssetManifestSchema.required).toContain("chunks");
    });
    
    it('mock manifest should match basic structure', () => {
        const mockPath = path.join(__dirname, '../src/streaming/__fixtures__/mock-manifest.json');
        const content = fs.readFileSync(mockPath, 'utf8');
        const manifest = JSON.parse(content);
        
        expect(manifest.schemaVersion).toBe(1);
        expect(manifest.runtime.entry).toBe("boot.chunk");
        expect(manifest.chunks.length).toBe(5);
        expect(manifest.chunks[0].priority).toBe("critical");
    });
});
