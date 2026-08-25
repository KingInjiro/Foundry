import { describe, it, expect, beforeEach } from 'vitest';
import { GamePackageValidator } from '../../../src/platform/backend/validation/GamePackageValidator.js';
import { MockPackageSource } from './MockPackageSource.js';

const VALID_MANIFEST = {
    format: "web-game",
    version: 1,
    gameId: "test-game",
    gameVersion: "1.0.0",
    name: "Test",
    runtime: "web",
    entry: "index.html"
};

describe('GamePackageValidator - Security', () => {
    let validator;
    beforeEach(() => { validator = new GamePackageValidator(); });

    it('rejects nested ../ traversal', async () => {
        const source = new MockPackageSource({
            'manifest.json': JSON.stringify(VALID_MANIFEST),
            'index.html': '',
            'a/../../etc/passwd': 'evil'
        });
        const res = await validator.validate(source);
        expect(res.valid).toBe(false);
        expect(res.errors[0].code).toBe('UNSAFE_FILE_PATH');
    });

    it('rejects URL-encoded traversal (%2e%2e)', async () => {
        const source = new MockPackageSource({
            'manifest.json': JSON.stringify(VALID_MANIFEST),
            'index.html': '',
            '%2e%2e/etc/passwd': 'evil'
        });
        const res = await validator.validate(source);
        expect(res.valid).toBe(false);
        expect(res.errors[0].code).toBe('UNSAFE_FILE_PATH');
    });

    it('rejects backslash traversal', async () => {
        const source = new MockPackageSource({
            'manifest.json': JSON.stringify(VALID_MANIFEST),
            'index.html': '',
            '..\\Windows\\System32\\config\\SAM': 'evil'
        });
        const res = await validator.validate(source);
        expect(res.valid).toBe(false);
        expect(res.errors[0].code).toBe('UNSAFE_FILE_PATH');
    });

    it('rejects absolute Windows drive paths', async () => {
        const source = new MockPackageSource({
            'manifest.json': JSON.stringify(VALID_MANIFEST),
            'index.html': '',
            'C:\\Windows\\System32': 'evil'
        });
        const res = await validator.validate(source);
        expect(res.valid).toBe(false);
        expect(res.errors[0].code).toBe('UNSAFE_FILE_PATH');
    });

    it('rejects null bytes in paths', async () => {
        const source = new MockPackageSource({
            'manifest.json': JSON.stringify(VALID_MANIFEST),
            'index.html': '',
            'file\0.txt': 'evil'
        });
        const res = await validator.validate(source);
        expect(res.valid).toBe(false);
        expect(res.errors[0].code).toBe('UNSAFE_FILE_PATH');
    });

    it('rejects paths that collide by case before extraction', async () => {
        const source = new MockPackageSource({
            'manifest.json': JSON.stringify(VALID_MANIFEST),
            'index.html': '',
            'Textures/player.png': 'first',
            'textures/player.png': 'second'
        });
        const res = await validator.validate(source);
        expect(res.valid).toBe(false);
        expect(res.errors.some(error => error.code === 'CASE_COLLIDING_PATH')).toBe(true);
    });

    it.each([
        'assets//player.png',
        'assets/./player.png',
        'assets/CON.txt',
        'assets/file?.png',
        'assets/trailing. '
    ])('rejects non-portable package path %s', async unsafePath => {
        const source = new MockPackageSource({
            'manifest.json': JSON.stringify(VALID_MANIFEST),
            'index.html': '',
            [unsafePath]: 'unsafe'
        });
        const res = await validator.validate(source);
        expect(res.valid).toBe(false);
        expect(res.errors[0].code).toBe('UNSAFE_FILE_PATH');
    });

    it('rejects more than 10,000 files', async () => {
        const files = { 'manifest.json': JSON.stringify(VALID_MANIFEST) };
        for (let i = 0; i < 10001; i++) {
            files[`file${i}.txt`] = 'x';
        }
        const source = new MockPackageSource(files);
        const res = await validator.validate(source);
        expect(res.valid).toBe(false);
        expect(res.errors[0].code).toBe('TOO_MANY_FILES');
    });

    it('rejects format/runtime mismatch', async () => {
        const source = new MockPackageSource({
            'manifest.json': JSON.stringify({ ...VALID_MANIFEST, format: 'web-game', runtime: 'foundry' }),
            'index.html': ''
        });
        const res = await validator.validate(source);
        expect(res.valid).toBe(false);
        expect(res.errors[0].code).toBe('FORMAT_RUNTIME_MISMATCH');
    });
});
