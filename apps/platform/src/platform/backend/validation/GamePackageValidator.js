import { StreamingManifestValidator } from './StreamingManifestValidator.js';
import { QuotaConfig } from '../config/quotas.js';
import {
    SUPPORTED_CAPABILITIES as SUPPORTED_CAPABILITY_NAMES,
    runtimeSupportsCapability
} from '../runtime/GameRuntimeAdapter.js';

export const SUPPORTED_CAPABILITIES = new Set(SUPPORTED_CAPABILITY_NAMES);

export const SUPPORTED_STREAMING_MANIFEST_PATHS = Object.freeze([
    'streaming-manifest.json',
    'foundry-streaming.json'
]);

const MAX_MANIFEST_BYTES = 256 * 1024;
const MANIFEST_STRING_LIMITS = Object.freeze({
    format: 32,
    gameId: 120,
    gameVersion: 64,
    name: 120,
    runtime: 32,
    entry: 512,
    engineVersion: 64,
    description: 2000,
    thumbnail: 512,
    streamingManifest: 128
});

const WINDOWS_RESERVED_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const PORTABLE_INVALID_SEGMENT_CHARS = /[<>:"|?*\x00-\x1f]/;
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
const SUPPORTED_THUMBNAIL_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);



export class GamePackageValidator {
    /**
     * Validates a game package.
     * @param {import('./GamePackageSource.js').GamePackageSource} source 
     * @returns {Promise<{valid: boolean, manifest: object|null, streamingManifestPath: string|null, errors: Array<{code: string, path?: string, message: string}>, warnings: Array<{code: string, message: string}>}>}
     */
    async validate(source) {
        const result = {
            valid: true,
            manifest: null,
            streamingManifestPath: null,
            errors: [],
            warnings: []
        };

        const addError = (code, message, path = undefined) => {
            result.valid = false;
            result.errors.push({ code, message, path });
        };

        const addWarning = (code, message) => {
            result.warnings.push({ code, message });
        };

        try {
            // 1. Check for path traversal and absolute paths in the archive itself
            const allFiles = await source.getFiles();
            const packageFiles = new Set(allFiles);
            if (allFiles.length > QuotaConfig.PLATFORM_MAX_FILES_PER_PACKAGE) {
                addError('TOO_MANY_FILES', `Package exceeds the maximum allowed number of files (${QuotaConfig.PLATFORM_MAX_FILES_PER_PACKAGE}).`);
                return result;
            }
            const portablePaths = new Map();
            for (const filePath of allFiles) {
                if (this.isUnsafePath(filePath)) {
                    addError('UNSAFE_FILE_PATH', `Package contains unsafe file path: ${filePath}`, filePath);
                    continue;
                }

                const portableKey = this.getPortablePathKey(filePath);
                const existingPath = portablePaths.get(portableKey);
                if (existingPath && existingPath !== filePath) {
                    addError(
                        'CASE_COLLIDING_PATH',
                        `Package paths collide on case-insensitive filesystems: ${existingPath} and ${filePath}`,
                        filePath
                    );
                } else {
                    portablePaths.set(portableKey, filePath);
                }
            }

            if (!result.valid) return result; // Stop early if zip slip detected

            // 2. Read and parse manifest
            const manifestRaw = await source.readManifest();
            if (!manifestRaw) {
                addError('MISSING_MANIFEST', 'manifest.json does not exist in the root of the package.', 'manifest.json');
                return result;
            }
            if (new TextEncoder().encode(manifestRaw).byteLength > MAX_MANIFEST_BYTES) {
                addError('MANIFEST_TOO_LARGE', `manifest.json exceeds the ${MAX_MANIFEST_BYTES}-byte limit.`, 'manifest.json');
                return result;
            }

            let manifest;
            try {
                manifest = JSON.parse(manifestRaw);
            } catch (e) {
                addError('INVALID_JSON', 'manifest.json contains invalid JSON.', 'manifest.json');
                return result;
            }

            if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
                addError('INVALID_MANIFEST_ROOT', 'manifest.json root must be an object.', 'manifest.json');
                return result;
            }

            // 3. Validate required fields & types
            const requiredStringFields = ['format', 'gameId', 'gameVersion', 'name', 'runtime', 'entry'];
            for (const field of requiredStringFields) {
                if (typeof manifest[field] !== 'string' || manifest[field].trim() === '') {
                    addError('MISSING_REQUIRED_FIELD', `manifest.json is missing or has invalid required string field: ${field}`, 'manifest.json');
                }
            }

            for (const [field, maxLength] of Object.entries(MANIFEST_STRING_LIMITS)) {
                if (manifest[field] !== undefined && typeof manifest[field] === 'string' && manifest[field].length > maxLength) {
                    addError('FIELD_TOO_LONG', `manifest.json "${field}" exceeds ${maxLength} characters.`, 'manifest.json');
                }
            }

            if (typeof manifest.gameId === 'string' && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(manifest.gameId)) {
                addError('INVALID_GAME_ID', '"gameId" must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens.', 'manifest.json');
            }

            if (typeof manifest.version !== 'number') {
                addError('INVALID_FIELD_TYPE', 'manifest.json "version" must be a number.', 'manifest.json');
            } else if (manifest.version !== 1) {
                addError('UNSUPPORTED_VERSION', `Manifest version ${manifest.version} is not supported.`, 'manifest.json');
            }

            if (manifest.format !== 'web-game' && manifest.format !== 'foundry-game') {
                addError('INVALID_FORMAT', `Unsupported format: ${manifest.format}`, 'manifest.json');
            }

            if (manifest.runtime !== 'web' && manifest.runtime !== 'foundry') {
                addError('INVALID_RUNTIME', `Unsupported runtime: ${manifest.runtime}`, 'manifest.json');
            }

            if (manifest.format && manifest.runtime) {
                if (manifest.format === 'web-game' && manifest.runtime !== 'web') {
                    addError('FORMAT_RUNTIME_MISMATCH', 'format "web-game" must have runtime "web".', 'manifest.json');
                }
                if (manifest.format === 'foundry-game' && manifest.runtime !== 'foundry') {
                    addError('FORMAT_RUNTIME_MISMATCH', 'format "foundry-game" must have runtime "foundry".', 'manifest.json');
                }
            }
            if (manifest.runtime === 'foundry') {
                if (typeof manifest.engineVersion !== 'string' || manifest.engineVersion.trim() === '') {
                    addError('MISSING_ENGINE_VERSION', 'Foundry runtime requires a valid "engineVersion" string.', 'manifest.json');
                }
            }

            if (manifest.description !== undefined) {
                if (typeof manifest.description !== 'string') {
                    addError('INVALID_FIELD_TYPE', '"description" must be a string.', 'manifest.json');
                } else {
                    manifest.description = manifest.description.trim();
                }
            }

            if (manifest.tags !== undefined) {
                if (!Array.isArray(manifest.tags) || manifest.tags.length > 10) {
                    addError('INVALID_TAGS', '"tags" must be an array of at most 10 strings.', 'manifest.json');
                } else {
                    const normalizedTags = [];
                    const seenTags = new Set();
                    for (const tag of manifest.tags) {
                        const normalizedTag = typeof tag === 'string' ? tag.trim() : '';
                        const comparisonKey = normalizedTag.toLocaleLowerCase('en-US');
                        if (!normalizedTag || normalizedTag.length > 32) {
                            addError('INVALID_TAG', 'Every tag must contain 1 to 32 characters.', 'manifest.json');
                        } else if (seenTags.has(comparisonKey)) {
                            addError('DUPLICATE_TAG', `Tag "${normalizedTag}" is declared more than once.`, 'manifest.json');
                        } else {
                            normalizedTags.push(normalizedTag);
                            seenTags.add(comparisonKey);
                        }
                    }
                    manifest.tags = normalizedTags;
                }
            }

            if (manifest.controls !== undefined) {
                if (!Array.isArray(manifest.controls) || manifest.controls.length > 20) {
                    addError('INVALID_CONTROLS', '"controls" must be an array of at most 20 action/key pairs.', 'manifest.json');
                } else {
                    const normalizedControls = [];
                    for (const control of manifest.controls) {
                        const action = typeof control?.action === 'string' ? control.action.trim() : '';
                        const key = typeof control?.key === 'string' ? control.key.trim() : '';
                        if (!action || action.length > 64 || !key || key.length > 32) {
                            addError('INVALID_CONTROL', 'Every control needs an action (up to 64 characters) and key (up to 32 characters).', 'manifest.json');
                        } else {
                            normalizedControls.push({ action, key });
                        }
                    }
                    manifest.controls = normalizedControls;
                }
            }

            if (manifest.capabilities !== undefined) {
                if (!Array.isArray(manifest.capabilities)) {
                    addError('INVALID_FIELD_TYPE', '"capabilities" must be an array.', 'manifest.json');
                } else {
                    const seenCapabilities = new Set();
                    for (const cap of manifest.capabilities) {
                        if (typeof cap !== 'string' || !SUPPORTED_CAPABILITIES.has(cap)) {
                            addError('INVALID_CAPABILITY', `Unknown or unsupported capability: ${cap}`, 'manifest.json');
                        } else if (seenCapabilities.has(cap)) {
                            addError('DUPLICATE_CAPABILITY', `Capability "${cap}" is declared more than once.`, 'manifest.json');
                        } else if ((manifest.runtime === 'web' || manifest.runtime === 'foundry') && !runtimeSupportsCapability(manifest.runtime, cap)) {
                            addError('CAPABILITY_RUNTIME_MISMATCH', `Capability "${cap}" is not available to the ${manifest.runtime} runtime.`, 'manifest.json');
                        }
                        seenCapabilities.add(cap);
                    }
                }
            }

            const presentStreamingManifests = SUPPORTED_STREAMING_MANIFEST_PATHS.filter(path => packageFiles.has(path));
            if (manifest.streamingManifest !== undefined) {
                if (typeof manifest.streamingManifest !== 'string' || manifest.streamingManifest.trim() === '') {
                    addError('INVALID_STREAMING_MANIFEST_PATH', '"streamingManifest" must be a non-empty root filename.', 'manifest.json');
                } else if (this.isUnsafePath(manifest.streamingManifest)) {
                    addError('UNSAFE_STREAMING_MANIFEST_PATH', '"streamingManifest" must not be absolute or contain traversal.', 'manifest.json');
                } else if (!SUPPORTED_STREAMING_MANIFEST_PATHS.includes(manifest.streamingManifest)) {
                    addError('UNSUPPORTED_STREAMING_MANIFEST_PATH', `Supported streaming manifest names are: ${SUPPORTED_STREAMING_MANIFEST_PATHS.join(', ')}.`, 'manifest.json');
                } else if (!packageFiles.has(manifest.streamingManifest)) {
                    addError('MISSING_STREAMING_MANIFEST', `Declared streaming manifest "${manifest.streamingManifest}" does not exist in the package.`, manifest.streamingManifest);
                } else {
                    result.streamingManifestPath = manifest.streamingManifest;
                    const unusedPaths = presentStreamingManifests.filter(path => path !== manifest.streamingManifest);
                    if (unusedPaths.length > 0) {
                        addWarning('EXTRA_STREAMING_MANIFEST', `Ignoring undeclared streaming manifest: ${unusedPaths.join(', ')}.`);
                    }
                }
            } else if (presentStreamingManifests.length === 1) {
                result.streamingManifestPath = presentStreamingManifests[0];
            } else if (presentStreamingManifests.length > 1) {
                addError('AMBIGUOUS_STREAMING_MANIFEST', 'Package contains multiple supported streaming manifests. Set "streamingManifest" in manifest.json to select one.', 'manifest.json');
            }

            if (result.streamingManifestPath && manifest.runtime !== 'foundry') {
                addError('STREAMING_RUNTIME_MISMATCH', 'Streaming manifests are supported only for the Foundry runtime.', result.streamingManifestPath);
            }

            // If there are errors so far, return
            if (!result.valid) return result;

            // 4. Validate paths (entry and thumbnail)
            const entry = manifest.entry;
            if (this.isUnsafePath(entry) || entry.endsWith('/')) {
                addError('UNSAFE_ENTRY_PATH', 'Entry path is unsafe (absolute or contains traversal).', entry);
            } else {
                const entryExists = await source.exists(entry);
                if (!entryExists) {
                    addError('MISSING_ENTRY', `Entry file "${entry}" does not exist in the package.`, entry);
                }
            }

            if (manifest.thumbnail) {
                if (typeof manifest.thumbnail !== 'string') {
                    addError('INVALID_FIELD_TYPE', '"thumbnail" must be a string.', 'manifest.json');
                } else if (this.isUnsafePath(manifest.thumbnail) || manifest.thumbnail.endsWith('/')) {
                    addError('UNSAFE_THUMBNAIL_PATH', 'Thumbnail path is unsafe (absolute or contains traversal).', manifest.thumbnail);
                } else {
                    const thumbExists = await source.exists(manifest.thumbnail);
                    if (!thumbExists) {
                        addError('MISSING_THUMBNAIL', `Thumbnail file "${manifest.thumbnail}" does not exist in the package.`, manifest.thumbnail);
                    } else {
                        const extension = manifest.thumbnail.split('.').pop()?.toLowerCase() || '';
                        if (!SUPPORTED_THUMBNAIL_EXTENSIONS.has(extension)) {
                            addError('UNSUPPORTED_THUMBNAIL_FORMAT', 'Thumbnail must be PNG, JPEG, GIF, WebP, or AVIF.', manifest.thumbnail);
                        } else {
                            const thumbnailBytes = await source.readFile(manifest.thumbnail);
                            if (!thumbnailBytes) {
                                addError('MISSING_THUMBNAIL', `Thumbnail file "${manifest.thumbnail}" could not be read.`, manifest.thumbnail);
                            } else if (thumbnailBytes.byteLength > MAX_THUMBNAIL_BYTES) {
                                addError('THUMBNAIL_TOO_LARGE', `Thumbnail exceeds the ${MAX_THUMBNAIL_BYTES}-byte limit.`, manifest.thumbnail);
                            } else if (!this.hasValidThumbnailSignature(thumbnailBytes, extension)) {
                                addError('INVALID_THUMBNAIL_CONTENT', 'Thumbnail bytes do not match the declared image format.', manifest.thumbnail);
                            }
                        }
                    }
                }
            }

            // 5. If the package contains a streaming manifest, validate it against the
            // same canonical contract used by the browser Player before accepting the package.
            if (result.valid && result.streamingManifestPath) {
                const streamingManifestRaw = await source.readStreamingManifest(result.streamingManifestPath);
                if (streamingManifestRaw) {
                    const streamingResult = new StreamingManifestValidator().validate(streamingManifestRaw, packageFiles);
                    for (const diagnostic of streamingResult.diagnostics) {
                        if (diagnostic.severity === 'ERROR') {
                            addError(diagnostic.code, diagnostic.message, result.streamingManifestPath);
                        } else {
                            addWarning(diagnostic.code, diagnostic.message);
                        }
                    }
                    if (streamingResult.valid) {
                        const parsedStreamingManifest = JSON.parse(streamingManifestRaw);
                        for (const chunk of parsedStreamingManifest.chunks) {
                            const chunkBytes = await source.readFile(chunk.url);
                            if (!chunkBytes) {
                                addError('STREAMING_MANIFEST_CHUNK_MISSING', `Chunk file ${chunk.url} could not be read.`, chunk.url);
                                continue;
                            }
                            if (chunkBytes.byteLength !== chunk.size) {
                                addError('STREAMING_MANIFEST_SIZE_MISMATCH', `Chunk ${chunk.id} declares ${chunk.size} bytes but contains ${chunkBytes.byteLength} bytes.`, chunk.url);
                                continue;
                            }
                            const digest = await globalThis.crypto.subtle.digest('SHA-256', chunkBytes);
                            const actualHash = `sha256-${Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
                            if (actualHash !== chunk.hash.toLowerCase()) {
                                addError('STREAMING_MANIFEST_HASH_MISMATCH', `Chunk ${chunk.id} does not match its declared SHA-256 hash.`, chunk.url);
                            }
                        }
                    }
                } else {
                    addError('MISSING_STREAMING_MANIFEST', `Streaming manifest "${result.streamingManifestPath}" could not be read.`, result.streamingManifestPath);
                }
            }

            if (result.valid) {
                result.manifest = manifest;
            }

        } catch (e) {
            addError('VALIDATION_EXCEPTION', `An unexpected error occurred during validation: ${e.message}`);
        }

        return result;
    }

    isUnsafePath(path) {
        if (!path || typeof path !== 'string') return true;
        if (path.length > 512) return true;
        // Null bytes
        if (path.indexOf('\0') !== -1) return true;
        // Encoded path traversal variants (e.g. %2e%2e, %2f)
        const lowerPath = path.toLowerCase();
        if (lowerPath.includes('%2e') || lowerPath.includes('%2f') || lowerPath.includes('%5c')) {
            return true; 
        }

        // Backslashes are rejected rather than normalized so a package has the
        // same paths on every storage backend and operating system.
        if (path.includes('\\')) return true;
        // Absolute paths (Unix & Windows)
        if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return true;

        const pathWithoutDirectorySlash = path.endsWith('/') ? path.slice(0, -1) : path;
        if (!pathWithoutDirectorySlash) return true;
        const parts = pathWithoutDirectorySlash.split('/');
        for (const part of parts) {
            if (!part || part === '.' || part === '..') return true;
            if (part.length > 255 || part.endsWith('.') || part.endsWith(' ')) return true;
            if (PORTABLE_INVALID_SEGMENT_CHARS.test(part) || WINDOWS_RESERVED_BASENAME.test(part)) return true;
        }
        return false;
    }

    getPortablePathKey(path) {
        const withoutDirectorySlash = path.endsWith('/') ? path.slice(0, -1) : path;
        return withoutDirectorySlash.normalize('NFC').toLocaleLowerCase('en-US');
    }

    hasValidThumbnailSignature(bytes, extension) {
        const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const ascii = (start, end) => String.fromCharCode(...data.slice(start, end));

        if (extension === 'png') {
            return data.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => data[index] === byte);
        }
        if (extension === 'jpg' || extension === 'jpeg') {
            return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
        }
        if (extension === 'gif') {
            return data.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a');
        }
        if (extension === 'webp') {
            return data.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
        }
        if (extension === 'avif') {
            if (data.length < 12 || ascii(4, 8) !== 'ftyp') return false;
            const brands = ascii(8, Math.min(data.length, 32));
            return brands.includes('avif') || brands.includes('avis');
        }
        return false;
    }
}
