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

function normalizeFields(fields = {}) {
    return Object.fromEntries(Object.entries(fields).map(([key, value]) => [
        key,
        value instanceof Error ? serializeError(value) : value
    ]));
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
