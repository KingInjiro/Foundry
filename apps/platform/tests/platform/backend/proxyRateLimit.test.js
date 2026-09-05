import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/platform/backend/server/app.js';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';

class NoopStorage {
    constructor() { this.isConfigured = true; this.kind = 'test'; }
    async ping() { return true; }
}

class NoopJobs {
    registerHandler() {}
    async getStatus() { return { mode: 'test' }; }
}

const databases = [];
afterEach(async () => Promise.all(databases.splice(0).map(db => db.close())));

function appWithProxyHops(trustProxyHops, identities) {
    const db = new LocalSqliteProvider(':memory:');
    databases.push(db);
    const rateLimiter = {
        async consume(identity, operation) {
            identities.push({ identity, operation });
            return { allowed: true, remaining: 100, resetAfterMs: 0 };
        }
    };
    return createApp(db, new NoopStorage(), new NoopJobs(), { runtimeConfig: { trustProxyHops }, rateLimiter });
}

describe('reverse proxy and public rate-limit identity', () => {
    it('does not trust a spoofed forwarded address when proxy trust is disabled', async () => {
        const identities = [];
        const app = appWithProxyHops(0, identities);
        await request(app).get('/api/catalog/games').set('x-forwarded-for', '203.0.113.42').expect(200);
        expect(identities[0]).toMatchObject({ operation: 'catalog_read' });
        expect(identities[0].identity).not.toBe('ip:203.0.113.42');
    });

    it('uses the forwarded client address only at an explicitly trusted hop depth', async () => {
        const identities = [];
        const app = appWithProxyHops(1, identities);
        await request(app).get('/api/catalog/games').set('x-forwarded-for', '203.0.113.42').expect(200);
        expect(identities[0]).toEqual({ operation: 'catalog_read', identity: 'ip:203.0.113.42' });
    });
});
