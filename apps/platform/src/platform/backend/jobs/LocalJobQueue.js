import { JobQueue } from './JobQueue.js';
import crypto from 'crypto';

export class LocalJobQueue extends JobQueue {
    constructor(dbProvider, handlers = {}, options = {}) {
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
        this.stopping = false;
        this.activePoll = null;
        this.activeJobs = new Set();
        this.logger = options.logger || null;
        
        // Polling loop if async mode
        if (this.mode === 'async') {
            this.interval = setInterval(() => { void this.poll(); }, 1000);
            this.interval.unref?.();
        }
    }

    registerHandler(jobType, handler) {
        this.handlers[jobType] = handler;
    }

    async enqueue(jobType, targetId, payload) {
        if (this.stopping) {
            const error = new Error('Job queue is stopping and cannot accept new work.');
            error.code = 'JOB_QUEUE_STOPPING';
            throw error;
        }
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
        this.logger?.info('job_enqueued', { jobId: job.id, jobType, targetId });

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
        if (this.stopping) return;
        if (this.activePoll) return this.activePoll;
        const operation = (async () => {
            this.polling = true;
            try {
                if (this.stopping) return;
                const job = await this.db.claimNextJob(this.workerId, this.leaseMs);
                if (job) await this.processJob(job);
            } finally {
                this.polling = false;
            }
        })();
        this.activePoll = operation.finally(() => {
            if (this.activePoll === tracked) this.activePoll = null;
        });
        const tracked = this.activePoll;
        return tracked;
    }

    async getStatus() {
        return {
            mode: this.mode,
            workerId: this.workerId,
            polling: this.polling,
            stopping: this.stopping,
            ...(typeof this.db.getJobQueueStats === 'function' ? await this.db.getJobQueueStats() : {})
        };
    }

    async processJob(job) {
        const operation = this.processJobInternal(job);
        this.activeJobs.add(operation);
        try {
            return await operation;
        } finally {
            this.activeJobs.delete(operation);
        }
    }

    async processJobInternal(job) {
        const handler = this.handlers[job.type];
        if (!handler) {
            await this.db.updateJobStatus(job.id, 'FAILED', 'No handler registered', null, job.workerId || null);
            return 'FAILED';
        }

        await this.db.updateJobStatus(job.id, 'RUNNING', null, null, job.workerId || null);
        this.logger?.info('job_started', { jobId: job.id, jobType: job.type, targetId: job.targetId, workerId: job.workerId || this.workerId });
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
            this.logger?.info('job_succeeded', { jobId: job.id, jobType: job.type, targetId: job.targetId, attempts: job.attempts });
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
            this.logger?.error('job_failed', {
                jobId: job.id,
                jobType: job.type,
                targetId: job.targetId,
                attempts: newAttempts,
                nextStatus,
                error: err
            });
            return nextStatus;
        } finally {
            if (heartbeat) clearInterval(heartbeat);
        }
    }

    pausePolling() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    async stop() {
        if (this.stopping) {
            await Promise.allSettled([
                ...(this.activePoll ? [this.activePoll] : []),
                ...this.activeJobs
            ]);
            return;
        }
        this.stopping = true;
        this.pausePolling();
        await Promise.allSettled([
            ...(this.activePoll ? [this.activePoll] : []),
            ...this.activeJobs
        ]);
    }
}
