import { describe, it, expect, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { LocalZipPackageSource } from '../../../src/platform/backend/validation/LocalZipPackageSource.js';
import { GamePackageValidator } from '../../../src/platform/backend/validation/GamePackageValidator.js';
import crypto from 'node:crypto';

async function createZipSource(files) {
    const zip = new JSZip();
    for (const [path, content] of Object.entries(files)) {
        zip.file(path, content);
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    return new LocalZipPackageSource(buffer);
}

const VALID_WEB_MANIFEST = {
    format: "web-game",
    version: 1,
    gameId: "test-game-1",
    gameVersion: "1.0.0",
    name: "Test Game",
    runtime: "web",
    entry: "index.html"
};

const VALID_FOUNDRY_MANIFEST = {
    ...VALID_WEB_MANIFEST,
    format: "foundry-game",
    runtime: "foundry",
    engineVersion: "1.0.0",
    entry: "game.js"
};

const STREAM_CHUNK = '{"streamed":true}';
const STREAM_CHUNK_HASH = `sha256-${crypto.createHash('sha256').update(STREAM_CHUNK).digest('hex')}`;
const VALID_STREAMING_MANIFEST = {
    schemaVersion: 1,
    runtime: { entry: 'game.js' },
    chunks: [{
        id: 'boot-data',
        url: 'chunks/boot.json',
        size: Buffer.byteLength(STREAM_CHUNK),
        hash: STREAM_CHUNK_HASH,
        dependencies: [],
        priority: 'critical',
        preload: false
    }]
};

describe('GamePackageValidator', () => {
    let validator;
    
    beforeEach(() => {
        validator = new GamePackageValidator();
    });

    it('validates a valid web package', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify(VALID_WEB_MANIFEST),
            'index.html': '<html></html>'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('validates a valid Foundry package', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify(VALID_FOUNDRY_MANIFEST),
            'game.js': 'console.log("game");'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('preserves an explicitly selected alternative streaming manifest', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify({ ...VALID_FOUNDRY_MANIFEST, streamingManifest: 'foundry-streaming.json' }),
            'game.js': 'console.log("game");',
            'foundry-streaming.json': JSON.stringify(VALID_STREAMING_MANIFEST),
            'chunks/boot.json': STREAM_CHUNK
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(true);
        expect(result.streamingManifestPath).toBe('foundry-streaming.json');
    });

    it('requires a selection when both supported streaming manifests exist', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify(VALID_FOUNDRY_MANIFEST),
            'game.js': 'console.log("game");',
            'streaming-manifest.json': JSON.stringify(VALID_STREAMING_MANIFEST),
            'foundry-streaming.json': JSON.stringify(VALID_STREAMING_MANIFEST),
            'chunks/boot.json': STREAM_CHUNK
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors.some(error => error.code === 'AMBIGUOUS_STREAMING_MANIFEST')).toBe(true);
    });

    it('rejects a missing declared streaming manifest', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify({ ...VALID_FOUNDRY_MANIFEST, streamingManifest: 'foundry-streaming.json' }),
            'game.js': 'console.log("game");'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors.some(error => error.code === 'MISSING_STREAMING_MANIFEST')).toBe(true);
    });

    it('rejects streaming metadata for the generic web runtime', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify({ ...VALID_WEB_MANIFEST, streamingManifest: 'streaming-manifest.json' }),
            'index.html': '<html></html>',
            'streaming-manifest.json': JSON.stringify(VALID_STREAMING_MANIFEST),
            'game.js': 'console.log("game");',
            'chunks/boot.json': STREAM_CHUNK
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors.some(error => error.code === 'STREAMING_RUNTIME_MISMATCH')).toBe(true);
    });

    it('rejects a streaming chunk whose bytes do not match its hash', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify({ ...VALID_FOUNDRY_MANIFEST, streamingManifest: 'streaming-manifest.json' }),
            'game.js': 'console.log("game");',
            'streaming-manifest.json': JSON.stringify(VALID_STREAMING_MANIFEST),
            'chunks/boot.json': '{"tampered":true}'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors.some(error => ['STREAMING_MANIFEST_SIZE_MISMATCH', 'STREAMING_MANIFEST_HASH_MISMATCH'].includes(error.code))).toBe(true);
    });

    it('fails on missing manifest', async () => {
        const source = await createZipSource({
            'index.html': '<html></html>'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors[0].code).toBe('MISSING_MANIFEST');
    });

    it('fails on invalid JSON manifest', async () => {
        const source = await createZipSource({
            'manifest.json': '{ bad json',
            'index.html': '<html></html>'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors[0].code).toBe('INVALID_JSON');
    });

    it('fails on missing entry file', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify(VALID_WEB_MANIFEST)
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors[0].code).toBe('MISSING_ENTRY');
    });

    it('fails on path traversal in zip', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify(VALID_WEB_MANIFEST),
            '../escaped.txt': 'danger'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors[0].code).toBe('UNSAFE_FILE_PATH');
    });

    it('fails on absolute path in zip', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify(VALID_WEB_MANIFEST),
            '/etc/passwd': 'danger'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors[0].code).toBe('UNSAFE_FILE_PATH');
    });

    it('fails on invalid runtime', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify({ ...VALID_WEB_MANIFEST, runtime: 'unity' }),
            'index.html': '<html></html>'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors.find(e => e.code === 'INVALID_RUNTIME')).toBeDefined();
    });

    it('fails when Foundry package is missing engineVersion', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify({ ...VALID_FOUNDRY_MANIFEST, engineVersion: undefined }),
            'game.js': 'console.log("game");'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors.find(e => e.code === 'MISSING_ENGINE_VERSION')).toBeDefined();
    });

    it('fails on invalid capability', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify({ ...VALID_WEB_MANIFEST, capabilities: ['mind-reading'] }),
            'index.html': '<html></html>'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors.find(e => e.code === 'INVALID_CAPABILITY')).toBeDefined();
    });

    it('rejects duplicate capabilities', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify({ ...VALID_FOUNDRY_MANIFEST, capabilities: ['audio', 'audio'] }),
            'game.js': 'console.log("game");'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors.find(e => e.code === 'DUPLICATE_CAPABILITY')).toBeDefined();
    });

    it('rejects persistent storage for opaque-origin generic web games', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify({ ...VALID_WEB_MANIFEST, capabilities: ['storage'] }),
            'index.html': '<html></html>'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors.find(e => e.code === 'CAPABILITY_RUNTIME_MISMATCH')).toBeDefined();
    });

    it('rejects overlong manifest metadata', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify({ ...VALID_WEB_MANIFEST, name: 'x'.repeat(121) }),
            'index.html': '<html></html>'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors.find(e => e.code === 'FIELD_TOO_LONG')).toBeDefined();
    });

    it('fails on missing thumbnail', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify({ ...VALID_WEB_MANIFEST, thumbnail: 'thumb.png' }),
            'index.html': '<html></html>'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors.find(e => e.code === 'MISSING_THUMBNAIL')).toBeDefined();
    });

    it('validates normalized discovery metadata and real thumbnail bytes', async () => {
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
        const source = await createZipSource({
            'manifest.json': JSON.stringify({
                ...VALID_WEB_MANIFEST,
                description: '  Fast arcade game  ',
                thumbnail: 'cover.png',
                tags: [' Arcade ', 'Quick Play'],
                controls: [{ action: ' Move ', key: ' Arrows ' }]
            }),
            'index.html': '<html></html>',
            'cover.png': png
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(true);
        expect(result.manifest.description).toBe('Fast arcade game');
        expect(result.manifest.tags).toEqual(['Arcade', 'Quick Play']);
        expect(result.manifest.controls).toEqual([{ action: 'Move', key: 'Arrows' }]);
    });

    it('rejects active or disguised thumbnail content', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify({ ...VALID_WEB_MANIFEST, thumbnail: 'cover.png' }),
            'index.html': '<html></html>',
            'cover.png': '<script>alert(1)</script>'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors.find(e => e.code === 'INVALID_THUMBNAIL_CONTENT')).toBeDefined();
    });

    it('rejects malformed tags and controls', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify({
                ...VALID_WEB_MANIFEST,
                tags: ['Arcade', ' arcade '],
                controls: [{ action: '', key: 'Space' }]
            }),
            'index.html': '<html></html>'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors.find(e => e.code === 'DUPLICATE_TAG')).toBeDefined();
        expect(result.errors.find(e => e.code === 'INVALID_CONTROL')).toBeDefined();
    });

    it('fails on Zip Slip attempt via entry path', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify({ ...VALID_WEB_MANIFEST, entry: '../index.html' })
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors.find(e => e.code === 'UNSAFE_ENTRY_PATH')).toBeDefined();
    });

    it('fails on invalid format', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify({ ...VALID_WEB_MANIFEST, format: 'unity-game' }),
            'index.html': '<html></html>'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors.find(e => e.code === 'INVALID_FORMAT')).toBeDefined();
    });

    it('fails on invalid field type', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify({ ...VALID_WEB_MANIFEST, version: "1" }),
            'index.html': '<html></html>'
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors.find(e => e.code === 'INVALID_FIELD_TYPE')).toBeDefined();
    });

    it('fails on Windows path traversal', async () => {
        const source = await createZipSource({
            'manifest.json': JSON.stringify({ ...VALID_WEB_MANIFEST, entry: '..\\\\index.html' })
        });
        const result = await validator.validate(source);
        expect(result.valid).toBe(false);
        expect(result.errors.find(e => e.code === 'UNSAFE_ENTRY_PATH')).toBeDefined();
    });
});
