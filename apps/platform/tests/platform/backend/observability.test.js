import { describe, expect, it } from 'vitest';
import { JsonLogger } from '../../../src/platform/backend/observability/JsonLogger.js';

describe('structured operational logging', () => {
    it('keeps correlation fields and recursively redacts credentials and game saves', () => {
        const records = [];
        const previousMode = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        try {
            const logger = new JsonLogger({ write: record => records.push(record) });
            logger.error('publish_failed', {
                requestId: 'request-1',
                gameId: 'game-1',
                nested: { authorization: 'Bearer private', r2Secret: 'secret', gameSave: { progress: 99 } },
                error: Object.assign(new Error('boom'), { code: 'PUBLISH_FAILED' })
            });
        } finally {
            if (previousMode === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = previousMode;
        }
        expect(records[0]).toMatchObject({ event: 'publish_failed', requestId: 'request-1', gameId: 'game-1' });
        expect(records[0].nested).toEqual({ authorization: '[REDACTED]', r2Secret: '[REDACTED]', gameSave: '[REDACTED]' });
        expect(records[0].error).toMatchObject({ message: 'boom', code: 'PUBLISH_FAILED' });
        expect(JSON.stringify(records[0])).not.toContain('Bearer private');
    });
});
