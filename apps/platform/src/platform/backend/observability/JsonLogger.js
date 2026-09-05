const LEVEL_PRIORITY = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

function serializeError(error) {
    if (!(error instanceof Error)) return error;
    return {
        name: error.name,
        message: error.message,
        code: error.code || undefined,
        stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
    };
}

const SENSITIVE_FIELD = /(?:authorization|cookie|token|secret|password|credential|privateKey|gameSave|saveData)/i;

function normalizeValue(value, key, seen, depth = 0) {
    if (SENSITIVE_FIELD.test(key)) return '[REDACTED]';
    if (value instanceof Error) return serializeError(value);
    if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return String(value);
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `[binary:${value.byteLength}]`;
    if (depth >= 5) return '[TRUNCATED]';
    if (typeof value === 'object') {
        if (seen.has(value)) return '[CIRCULAR]';
        seen.add(value);
        if (Array.isArray(value)) return value.slice(0, 100).map(item => normalizeValue(item, key, seen, depth + 1));
        return Object.fromEntries(Object.entries(value).slice(0, 100).map(([childKey, childValue]) => [
            childKey,
            normalizeValue(childValue, childKey, seen, depth + 1)
        ]));
    }
    return String(value);
}

function normalizeFields(fields = {}) {
    const seen = new WeakSet();
    return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, normalizeValue(value, key, seen)]));
}

export class JsonLogger {
    constructor({ level = process.env.LOG_LEVEL || 'info', write } = {}) {
        this.level = LEVEL_PRIORITY[level] ? level : 'info';
        this.write = write || (record => process.stdout.write(`${JSON.stringify(record)}\n`));
        this.silent = process.env.NODE_ENV === 'test' && process.env.TEST_JSON_LOGS !== 'true';
    }

    log(level, event, fields = {}) {
        if (this.silent || LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.level]) return;
        this.write({
            timestamp: new Date().toISOString(),
            level,
            event,
            service: 'foundry-platform',
            ...normalizeFields(fields)
        });
    }

    debug(event, fields) { this.log('debug', event, fields); }
    info(event, fields) { this.log('info', event, fields); }
    warn(event, fields) { this.log('warn', event, fields); }
    error(event, fields) { this.log('error', event, fields); }
}

export function createJsonLogger(options) {
    return new JsonLogger(options);
}
