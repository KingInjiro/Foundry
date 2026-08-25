export class StreamableGlbValidator {
    /**
     * @param {Buffer | Uint8Array} buffer 
     * @returns {{valid: boolean, error?: string, code?: string}}
     */
    static validate(buffer) {
        if (!buffer || buffer.length < 12) {
            return { valid: false, error: 'Buffer too small', code: 'INVALID_GLB_MAGIC' };
        }

        const dataView = new DataView(buffer.buffer || buffer, buffer.byteOffset || 0, buffer.byteLength || buffer.length);
        
        const magic = dataView.getUint32(0, true);
        if (magic !== 0x46546c67) { // "glTF"
            return { valid: false, error: 'Invalid magic', code: 'INVALID_GLB_MAGIC' };
        }

        const version = dataView.getUint32(4, true);
        if (version !== 2) {
            return { valid: false, error: 'Unsupported version', code: 'UNSUPPORTED_GLB_VERSION' };
        }

        const length = dataView.getUint32(8, true);
        if (length > buffer.length || length === 0) {
            return { valid: false, error: 'Invalid length', code: 'INVALID_GLB_LENGTH' };
        }

        if (buffer.length < 20) {
            return { valid: false, error: 'Missing JSON chunk', code: 'MISSING_JSON_CHUNK' };
        }

        const chunk0Length = dataView.getUint32(12, true);
        const chunk0Type = dataView.getUint32(16, true);

        if (chunk0Type !== 0x4e4f534a) { // "JSON"
            return { valid: false, error: 'First chunk is not JSON', code: 'MISSING_JSON_CHUNK' };
        }

        if (20 + chunk0Length > buffer.length) {
            return { valid: false, error: 'Invalid JSON chunk length', code: 'INVALID_GLTF_JSON' };
        }

        let jsonString;
        try {
            // Support both Node Buffer and Uint8Array
            if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buffer)) {
                jsonString = buffer.toString('utf8', 20, 20 + chunk0Length);
            } else {
                const jsonSlice = new Uint8Array(buffer.buffer || buffer, (buffer.byteOffset || 0) + 20, chunk0Length);
                jsonString = new TextDecoder('utf-8').decode(jsonSlice);
            }
        } catch (e) {
            return { valid: false, error: 'Failed to decode JSON chunk', code: 'INVALID_GLTF_JSON' };
        }

        let gltf;
        try {
            gltf = JSON.parse(jsonString);
        } catch (e) {
            return { valid: false, error: 'Failed to parse JSON', code: 'INVALID_GLTF_JSON' };
        }

        // Validate buffers
        if (gltf.buffers && Array.isArray(gltf.buffers)) {
            for (const buf of gltf.buffers) {
                if (buf.uri !== undefined) {
                    if (!buf.uri.startsWith('data:')) {
                        return { valid: false, error: 'External buffer URI not supported', code: 'EXTERNAL_BUFFER_URI' };
                    }
                }
            }
        }

        // Validate images
        if (gltf.images && Array.isArray(gltf.images)) {
            for (const img of gltf.images) {
                if (img.uri !== undefined) {
                    if (!img.uri.startsWith('data:')) {
                        return { valid: false, error: 'External image URI not supported', code: 'EXTERNAL_IMAGE_URI' };
                    }
                }
            }
        }

        return { valid: true };
    }
}
