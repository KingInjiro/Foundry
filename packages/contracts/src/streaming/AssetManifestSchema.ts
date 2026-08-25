import { MEMORY_PRIORITIES, STREAMING_SCHEMA_VERSION } from './constants.js';
export const AssetManifestSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    required: ["schemaVersion", "runtime", "chunks"],
    properties: {
        schemaVersion: {
            type: "integer",
            const: STREAMING_SCHEMA_VERSION
        },
        runtime: {
            type: "object",
            required: ["entry"],
            properties: {
                entry: { type: "string" },
                capabilities: {
                    type: "array",
                    items: { type: "string" }
                },
                minRuntimeVersion: { type: "string" }
            }
        },
        chunks: {
            type: "array",
            items: {
                type: "object",
                required: ["id", "url", "size", "hash", "dependencies", "priority", "preload"],
                properties: {
                    id: { type: "string" },
                    url: { type: "string" },
                    size: { type: "integer", minimum: 0 },
                    compressedSize: { type: "integer", minimum: 0 },
                    hash: { type: "string", pattern: "^sha256-[A-Fa-f0-9]{64}$" },
                    dependencies: {
                        type: "array",
                        items: {
                            type: "object",
                            required: ["chunkId", "required"],
                            properties: {
                                chunkId: { type: "string" },
                                required: { type: "boolean" }
                            }
                        }
                    },
                    priority: {
                        type: "string",
                        enum: [...MEMORY_PRIORITIES]
                    },
                    preload: { type: "boolean" }
                }
            }
        }
    }
};
