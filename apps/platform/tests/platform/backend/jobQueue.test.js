import { afterEach, describe, it, expect, beforeEach } from 'vitest';
import { LocalSqliteProvider } from '../../../src/platform/backend/database/LocalSqliteProvider.js';
import { LocalJobQueue } from '../../../src/platform/backend/jobs/LocalJobQueue.js';

describe('LocalJobQueue', () => {
    let db;
    let queue;

    beforeEach(() => {
        db = new LocalSqliteProvider(':memory:');
        
        // Use 'async' mode to avoid auto-processing on enqueue during tests, we will manually trigger it
        process.env.JOB_MODE = 'async';
        queue = new LocalJobQueue(db);
        queue.stop(); // stop auto polling
    });

    afterEach(() => {
        queue.stop();
        db.db.close();
        delete process.env.MAX_JOB_ATTEMPTS;
        delete process.env.JOB_MODE;
    });

    it('job enqueue and duplicate submission', async () => {
        const id1 = await queue.enqueue('TEST_JOB', 'target1', { foo: 'bar' });
        const id2 = await queue.enqueue('TEST_JOB', 'target1', { foo: 'bar2' });
        
        expect(id1).toBeDefined();
        expect(id2).toBe(id1); // idempotency ensures same active job is returned
        
        const job = await db.getActiveJob('TEST_JOB', 'target1');
        expect(job).toBeDefined();
        expect(job.status).toBe('QUEUED');
    });

    it('job execution updates state to SUCCEEDED', async () => {
        let executed = false;
        queue.registerHandler('TEST_JOB', async (payload, job) => {
            executed = true;
            expect(payload.foo).toBe('bar');
        });

        const id = await queue.enqueue('TEST_JOB', 'target2', { foo: 'bar' });
        await queue.poll();

        expect(executed).toBe(true);
        const job = await db.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
        expect(job.status).toBe('SUCCEEDED');
    });

    it('transient failure triggers RETRYING', async () => {
        queue.registerHandler('TEST_JOB', async () => {
            throw new Error("Temporary network glitch");
        });

        const id = await queue.enqueue('TEST_JOB', 'target3', {});
        await queue.poll();

        const job = await db.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
        expect(job.status).toBe('RETRYING');
        expect(job.attempts).toBe(1);
    });

    it('permanent failure triggers FAILED', async () => {
        queue.registerHandler('TEST_JOB', async () => {
            const err = new Error("Invalid manifest");
            err.isPermanent = true;
            throw err;
        });

        const id = await queue.enqueue('TEST_JOB', 'target4', {});
        await queue.poll();

        const job = await db.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
        expect(job.status).toBe('FAILED');
        expect(job.attempts).toBe(1);
    });

    it('max retries triggers FAILED', async () => {
        process.env.MAX_JOB_ATTEMPTS = '2';
        
        queue.registerHandler('TEST_JOB', async () => {
            throw new Error("Temporary glitch");
        });

        const id = await queue.enqueue('TEST_JOB', 'target5', {});
        
        await queue.poll(); // attempt 1 -> RETRYING
        const j1 = await db.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
        expect(j1.status).toBe('RETRYING');
        
        await queue.poll(); // attempt 2 -> FAILED
        const j2 = await db.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
        expect(j2.status).toBe('FAILED');
        expect(j2.attempts).toBe(2);
    });

    it('inline mode performs transient retries without a polling worker', async () => {
        queue.stop();
        process.env.JOB_MODE = 'inline';
        process.env.MAX_JOB_ATTEMPTS = '3';
        queue = new LocalJobQueue(db);
        let attempts = 0;
        queue.registerHandler('TEST_JOB', async () => {
            attempts += 1;
            if (attempts === 1) throw new Error('Temporary glitch');
        });

        const id = await queue.enqueue('TEST_JOB', 'inline-target', {});
        const job = db.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);

        expect(attempts).toBe(2);
        expect(job.status).toBe('SUCCEEDED');
        expect(job.attempts).toBe(2);
    });
});
