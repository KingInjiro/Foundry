import { JobQueue } from './JobQueue.js';
import crypto from 'crypto';

export class LocalJobQueue extends JobQueue {
    constructor(dbProvider, handlers = {}) {
        super();
        this.db = dbProvider;
        this.handlers = handlers;
        this.mode = process.env.JOB_MODE || 'async';
        this.workerId = process.env.JOB_WORKER_ID || `worker-${crypto.randomUUID()}`;
        const configuredLeaseMs = Number(process.env.JOB_LEASE_MS);
        this.leaseMs = Number.isFinite(configuredLeaseMs) && configuredLeaseMs >= 5000
            ? configuredLeaseMs
            : 60000;
        this.polling = false;
        
        // Polling loop if async mode
        if (this.mode === 'async') {
            this.interval = setInterval(() => this.poll(), 1000);
            this.interval.unref?.();
        }
    }

    registerHandler(jobType, handler) {
        this.handlers[jobType] = handler;
    }

    async enqueue(jobType, targetId, payload) {
        // Enforce idempotency: one active job per target + type
        const existing = await this.db.getActiveJob(jobType, targetId);
        if (existing) {
            return existing.id;
        }

        const job = {
            id: crypto.randomUUID(),
            type: jobType,
            targetId,
            payload: JSON.stringify(payload),
            status: 'QUEUED',
            attempts: 0,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        try {
            await this.db.createJob(job);
        } catch (error) {
            // A second process may have inserted the same active target after
            // our read. The partial unique index decides the winner.
            const winner = await this.db.getActiveJob(jobType, targetId);
            if (winner) return winner.id;
            throw error;
        }

        if (this.mode === 'inline') {
            // Inline mode has no polling worker, so it must also own retries.
            // Persist every attempt just like claimNextJob() does in async mode.
            let status = 'RETRYING';
            while (status === 'RETRYING') {
                job.attempts += 1;
                await this.db.updateJobStatus(job.id, 'RUNNING', null, job.attempts);
                status = await this.processJob(job);
            }
        }
        
        return job.id;
    }

    async poll() {
        if (this.polling) return;
        this.polling = true;
        try {
            const job = await this.db.claimNextJob(this.workerId, this.leaseMs);
            if (job) await this.processJob(job);
        } finally {
            this.polling = false;
        }
    }

    async getStatus() {
        return {
            mode: this.mode,
            workerId: this.workerId,
            polling: this.polling,
            ...(typeof this.db.getJobQueueStats === 'function' ? await this.db.getJobQueueStats() : {})
        };
    }

    async processJob(job) {
        const handler = this.handlers[job.type];
        if (!handler) {
            await this.db.updateJobStatus(job.id, 'FAILED', 'No handler registered', null, job.workerId || null);
            return 'FAILED';
        }

        await this.db.updateJobStatus(job.id, 'RUNNING', null, null, job.workerId || null);
        const heartbeatIntervalMs = Math.max(1000, Math.floor(this.leaseMs / 3));
        const heartbeat = job.workerId && typeof this.db.renewJobLease === 'function'
            ? setInterval(() => {
                void this.db.renewJobLease(job.id, job.workerId, this.leaseMs).catch(() => {});
            }, heartbeatIntervalMs)
            : null;
        heartbeat?.unref?.();

        try {
            await handler(JSON.parse(job.payload), job);
            await this.db.updateJobStatus(job.id, 'SUCCEEDED', null, null, job.workerId || null);
            return 'SUCCEEDED';
        } catch (err) {
            const isPermanent = err.isPermanent || false;
            const newAttempts = job.attempts;
            const configuredAttempts = Number(process.env.MAX_JOB_ATTEMPTS);
            const maxAttempts = Number.isFinite(configuredAttempts) && configuredAttempts > 0
                ? configuredAttempts
                : 3;
            const nextStatus = isPermanent || newAttempts >= maxAttempts ? 'FAILED' : 'RETRYING';
            await this.db.updateJobStatus(job.id, nextStatus, err.message, newAttempts, job.workerId || null);
            return nextStatus;
        } finally {
            if (heartbeat) clearInterval(heartbeat);
        }
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }
}
