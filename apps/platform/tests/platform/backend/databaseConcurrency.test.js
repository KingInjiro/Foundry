import { afterEach, describe, it, expect, beforeEach } from 'vitest';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';

describe('Database Provider Concurrency & Jobs', () => {
    let db;
    
    beforeEach(() => {
        db = new LocalSqliteProvider(':memory:');
        
        // Setup base data
        db.db.exec(`
            INSERT INTO users (uid, email) VALUES ('user1', 'u1@test.com'), ('user2', 'u2@test.com');
            INSERT INTO games (id, ownerUid, storageMode) VALUES ('game1', 'user1', 'platform');
            INSERT INTO game_versions (id, gameId, status) VALUES ('v1', 'game1', 'READY'), ('v2', 'game1', 'PUBLISH_FAILED');
        `);
    });

    afterEach(async () => {
        if (db && !db.closed) await db.close();
    });

    it('atomic publish claim', async () => {
        const claim1 = await db.claimVersionForPublishing('v1', 'user1');
        const claim2 = await db.claimVersionForPublishing('v1', 'user1');
        
        expect(claim1).toBe(true);
        expect(claim2).toBe(false); // second claim fails
        
        const v = await db.getGameVersion('v1');
        expect(v.status).toBe('PUBLISHING');
    });
    
    it('atomic retry claim', async () => {
        const claim1 = await db.claimVersionForPublishing('v2', 'user1');
        const claim2 = await db.claimVersionForPublishing('v2', 'user1');
        
        expect(claim1).toBe(true);
        expect(claim2).toBe(false); // second claim fails
    });

    it('stores an actionable publish failure and clears it on retry', async () => {
        await db.markVersionPublishFailed('v1', 'Publishing this version would exceed the developer storage quota.');
        const failed = await db.getGameVersion('v1');
        expect(failed.status).toBe('PUBLISH_FAILED');
        expect(failed.publishError).toContain('storage quota');

        expect(await db.claimVersionForPublishing('v1', 'user1')).toBe(true);
        const retrying = await db.getGameVersion('v1');
        expect(retrying.status).toBe('PUBLISHING');
        expect(retrying.publishError).toBeNull();
    });

    it('transaction rollback on error', async () => {
        try {
            await db.transaction(async (tx) => {
                await tx.updateGameVersionStatus('v1', 'REJECTED');
                throw new Error("Simulated failure");
            });
        } catch (e) {
            expect(e.message).toBe("Simulated failure");
        }
        
        const v = await db.getGameVersion('v1');
        expect(v.status).toBe('READY'); // should roll back to initial state
    });

    it('serializes overlapping async transactions on one connection', async () => {
        db.db.exec('CREATE TABLE transaction_counter (value INTEGER NOT NULL); INSERT INTO transaction_counter VALUES (0);');

        await Promise.all([30, 5, 15].map(delayMs => db.transaction(async tx => {
            const current = tx.db.prepare('SELECT value FROM transaction_counter').get().value;
            await new Promise(resolve => setTimeout(resolve, delayMs));
            tx.db.prepare('UPDATE transaction_counter SET value = ?').run(current + 1);
        })));

        expect(db.db.prepare('SELECT value FROM transaction_counter').get().value).toBe(3);
    });

    it('recovers its transaction queue after a rollback', async () => {
        db.db.exec('CREATE TABLE transaction_recovery (value INTEGER NOT NULL); INSERT INTO transaction_recovery VALUES (0);');

        await expect(db.transaction(async tx => {
            tx.db.prepare('UPDATE transaction_recovery SET value = 100').run();
            await Promise.resolve();
            throw new Error('rollback this operation');
        })).rejects.toThrow('rollback this operation');

        await db.transaction(async tx => {
            tx.db.prepare('UPDATE transaction_recovery SET value = value + 1').run();
        });

        expect(db.db.prepare('SELECT value FROM transaction_recovery').get().value).toBe(1);
    });

    it('rejects nested transactions without deadlocking the queue', async () => {
        await expect(db.transaction(tx => tx.transaction(async () => {})))
            .rejects.toMatchObject({ code: 'NESTED_TRANSACTION_UNSUPPORTED' });

        await expect(db.transaction(async () => 'still-usable')).resolves.toBe('still-usable');
    });

    it('waits for accepted transaction work during shutdown and rejects new work', async () => {
        let release;
        let started;
        const startedPromise = new Promise(resolve => { started = resolve; });
        const releasePromise = new Promise(resolve => { release = resolve; });
        const transaction = db.transaction(async tx => {
            tx.db.prepare("UPDATE game_versions SET status = 'VALIDATING' WHERE id = 'v1'").run();
            started();
            await releasePromise;
            tx.db.prepare("UPDATE game_versions SET status = 'READY' WHERE id = 'v1'").run();
        });
        await startedPromise;

        const closing = db.close();
        await expect(db.transaction(async () => {})).rejects.toMatchObject({ code: 'DATABASE_CLOSING' });
        release();
        await transaction;
        await closing;

        expect(db.closed).toBe(true);
    });

    it('quota accounting calculates sizes correctly', async () => {
        db.db.exec(`
            UPDATE game_versions SET packageSizeBytes = 1000, extractedSizeBytes = 2000 WHERE id = 'v1';
        `);
        
        const usage = await db.getUserQuotaUsage('user1');
        expect(usage.totalStorageBytes).toBe(3000);
        expect(usage.versionCount).toBe(2);
    });

    it('does not permanently charge rejected or expired versions against the version quota', async () => {
        db.db.exec(`
            INSERT INTO game_versions (id, gameId, status, packageSizeBytes)
            VALUES ('v-rejected', 'game1', 'REJECTED', 5000), ('v-expired', 'game1', 'EXPIRED', 7000);
        `);

        const usage = await db.getUserQuotaUsage('user1');
        expect(usage.versionCount).toBe(2);
        expect(usage.totalStorageBytes).toBe(0);
    });

    it('job cannot operate on another owners version', async () => {
        // user2 tries to claim user1's version
        const claim = await db.claimVersionForPublishing('v1', 'user2');
        expect(claim).toBe(false);
    });

    it('keeps exactly one active release when a different version is activated', async () => {
        await db.activateGameVersion('game1', 'v1', 300);
        await db.activateGameVersion('game1', 'v2', 400);

        const current = await db.getPublishedGameVersion('game1');
        expect(current.id).toBe('v2');
        expect((await db.getGameVersion('v1')).status).toBe('ARCHIVED');
        expect((await db.getGameVersions('game1')).filter(version => version.status === 'PUBLISHED')).toHaveLength(1);
    });

    it('enforces the single-active-release invariant at the database boundary', async () => {
        await db.activateGameVersion('game1', 'v1', 100);
        expect(() => db.db.prepare("UPDATE game_versions SET status = 'PUBLISHED' WHERE id = 'v2'").run()).toThrow();
    });

    it('reclaims a durable job after its worker lease expires', async () => {
        const now = Date.now();
        await db.createJob({ id: 'leased-job', type: 'TEST', targetId: 'target', payload: '{}', status: 'QUEUED', attempts: 0, createdAt: now, updatedAt: now });
        const first = await db.claimNextJob('worker-a', 5000);
        expect(first.workerId).toBe('worker-a');

        db.db.prepare("UPDATE jobs SET leaseExpiresAt = ? WHERE id = 'leased-job'").run(now - 1);
        const recovered = await db.claimNextJob('worker-b', 5000);
        expect(recovered.id).toBe('leased-job');
        expect(recovered.workerId).toBe('worker-b');
        expect(recovered.attempts).toBe(2);
    });

    it('consumes rate-limit capacity atomically in the database', async () => {
        const config = { max: 2, windowMs: 60000 };
        expect((await db.consumeRateLimit('user1', 'publish', config, 1000)).allowed).toBe(true);
        expect((await db.consumeRateLimit('user1', 'publish', config, 1001)).allowed).toBe(true);
        const denied = await db.consumeRateLimit('user1', 'publish', config, 1002);
        expect(denied.allowed).toBe(false);
        expect(denied.remaining).toBe(0);
    });
});
