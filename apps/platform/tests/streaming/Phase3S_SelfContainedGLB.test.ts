import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GamePackageExtractor } from '../../src/platform/backend/extraction/GamePackageExtractor.js';
import JSZip from 'jszip';
import { Readable } from 'stream';

function createMockGLB(jsonObj) {
    const jsonString = JSON.stringify(jsonObj);
    // Align json length to 4 bytes
    const jsonPadding = (4 - (jsonString.length % 4)) % 4;
    const jsonLength = jsonString.length + jsonPadding;
    
    // total size = 12 (header) + 8 (chunk0 header) + jsonLength
    const buffer = Buffer.alloc(20 + jsonLength);
    
    // Header
    buffer.writeUInt32LE(0x46546c67, 0); // magic
    buffer.writeUInt32LE(2, 4); // version
    buffer.writeUInt32LE(buffer.length, 8); // length
    
    // Chunk 0
    buffer.writeUInt32LE(jsonLength, 12);
    buffer.writeUInt32LE(0x4e4f534a, 16); // JSON
    
    buffer.write(jsonString, 20, 'utf8');
    for (let i = 0; i < jsonPadding; i++) {
        buffer.writeUInt8(0x20, 20 + jsonString.length + i); // space padding
    }
    return buffer;
}

describe('Phase 3S - Browser Streaming: Self-Contained GLB Contract', () => {
    let extractor;
    let mockStorage;

    beforeEach(() => {
        mockStorage = {
            getObjectMetadata: vi.fn(),
            getDownloadStream: vi.fn(),
            uploadBuffer: vi.fn(),
            deletePrefix: vi.fn()
        };
        extractor = new GamePackageExtractor(mockStorage);
    });

    async function extractZip(zip) {
        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
        mockStorage.getObjectMetadata.mockResolvedValue({ contentLength: zipBuffer.length });
        mockStorage.getDownloadStream.mockResolvedValue(Readable.from(zipBuffer));
        // JSZip.loadAsync is already intercepted or we just let it run?
        // Wait, the extractor calls fs.promises.readFile on a temp file it downloads.
        // So we can mock the pipeline or getDownloadStream.
        // GamePackageExtractor.test.js mocks JSZip.loadAsync directly.
        vi.spyOn(JSZip, 'loadAsync').mockResolvedValue(zip);
        return extractor.extractPackage('game1', 'ver1', 'objkey');
    }

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const mockManifest = {
        chunks: [
            { id: 'c1', url: 'model.glb' },
            { id: 'c2', url: 'legacy.gltf' }
        ]
    };

    it('accepts valid self-contained GLB', async () => {
        const zip = new JSZip();
        zip.file('streaming-manifest.json', JSON.stringify(mockManifest));
        const glb = createMockGLB({
            asset: { version: "2.0" },
            buffers: [{ byteLength: 100 }], // embedded BIN
            images: [{ mimeType: "image/png" }]
        });
        zip.file('model.glb', glb);

        const result = await extractZip(zip);
        expect(result.success).toBe(true);
    });

    it('rejects external BIN URI in streamable GLB', async () => {
        const zip = new JSZip();
        zip.file('streaming-manifest.json', JSON.stringify(mockManifest));
        const glb = createMockGLB({
            asset: { version: "2.0" },
            buffers: [{ uri: "external.bin", byteLength: 100 }]
        });
        zip.file('model.glb', glb);

        await expect(extractZip(zip)).rejects.toThrow(/EXTERNAL_BUFFER_URI/);
    });

    it('rejects external image URI in streamable GLB', async () => {
        const zip = new JSZip();
        zip.file('streaming-manifest.json', JSON.stringify(mockManifest));
        const glb = createMockGLB({
            asset: { version: "2.0" },
            images: [{ uri: "texture.png" }]
        });
        zip.file('model.glb', glb);

        await expect(extractZip(zip)).rejects.toThrow(/EXTERNAL_IMAGE_URI/);
    });

    it('accepts data URI in streamable GLB', async () => {
        const zip = new JSZip();
        zip.file('streaming-manifest.json', JSON.stringify(mockManifest));
        const glb = createMockGLB({
            asset: { version: "2.0" },
            images: [{ uri: "data:image/png;base64,iVBORw0KGgo=" }]
        });
        zip.file('model.glb', glb);

        const result = await extractZip(zip);
        expect(result.success).toBe(true);
    });

    it('accepts legacy GLTF with external resources', async () => {
        const zip = new JSZip();
        // streaming-manifest doesn't declare it as chunk, or declares it but it's not a .glb file
        zip.file('streaming-manifest.json', JSON.stringify(mockManifest));
        // It's a .gltf file
        const gltf = JSON.stringify({
            asset: { version: "2.0" },
            buffers: [{ uri: "external.bin" }]
        });
        zip.file('legacy.gltf', gltf);
        zip.file('external.bin', Buffer.from('mock data'));

        const result = await extractZip(zip);
        expect(result.success).toBe(true);
    });

    it('rejects invalid GLB magic', async () => {
        const zip = new JSZip();
        zip.file('streaming-manifest.json', JSON.stringify(mockManifest));
        const glb = Buffer.alloc(20);
        glb.writeUInt32LE(0x12345678, 0); // wrong magic
        zip.file('model.glb', glb);

        await expect(extractZip(zip)).rejects.toThrow(/INVALID_GLB_MAGIC/);
    });

    it('rejects invalid GLB version', async () => {
        const zip = new JSZip();
        zip.file('streaming-manifest.json', JSON.stringify(mockManifest));
        const glb = Buffer.alloc(20);
        glb.writeUInt32LE(0x46546c67, 0); // magic
        glb.writeUInt32LE(1, 4); // wrong version
        zip.file('model.glb', glb);

        await expect(extractZip(zip)).rejects.toThrow(/UNSUPPORTED_GLB_VERSION/);
    });

    it('rejects missing JSON chunk', async () => {
        const zip = new JSZip();
        zip.file('streaming-manifest.json', JSON.stringify(mockManifest));
        const glb = Buffer.alloc(20);
        glb.writeUInt32LE(0x46546c67, 0); // magic
        glb.writeUInt32LE(2, 4); // version
        glb.writeUInt32LE(20, 8); // length
        glb.writeUInt32LE(0, 12); // chunk 0 length
        glb.writeUInt32LE(0x004E4942, 16); // BIN (not JSON)
        zip.file('model.glb', glb);

        await expect(extractZip(zip)).rejects.toThrow(/MISSING_JSON_CHUNK/);
    });

    it('rejects malformed JSON', async () => {
        const zip = new JSZip();
        zip.file('streaming-manifest.json', JSON.stringify(mockManifest));
        
        const jsonString = "{ malformed json }";
        const buffer = Buffer.alloc(20 + jsonString.length);
        buffer.writeUInt32LE(0x46546c67, 0);
        buffer.writeUInt32LE(2, 4);
        buffer.writeUInt32LE(buffer.length, 8);
        buffer.writeUInt32LE(jsonString.length, 12);
        buffer.writeUInt32LE(0x4e4f534a, 16);
        buffer.write(jsonString, 20, 'utf8');
        
        zip.file('model.glb', buffer);

        await expect(extractZip(zip)).rejects.toThrow(/INVALID_GLTF_JSON/);
    });
});
