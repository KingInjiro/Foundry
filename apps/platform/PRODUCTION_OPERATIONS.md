# Production operations

This document describes the production-facing controls already present in the Platform. It does not claim that external services have been acceptance-tested without deployment credentials.

## Probes and startup

- `GET /api/health` is the liveness probe. It does not contact dependencies.
- `GET /api/ready` verifies the database, storage provider and job queue and returns `503` if any dependency is unavailable.
- Production startup performs the same database and storage checks before listening. `ALLOW_UNREADY_STARTUP=true` bypasses this only for controlled diagnostics.
- Every response includes `X-Request-Id`. A valid caller-supplied ID is preserved, which makes support traces deterministic.
- Request and lifecycle logs are newline-delimited JSON. Set `LOG_LEVEL=debug|info|warn|error`.

## Jobs and release cleanup

The concrete queue is persisted in the metadata database. Claims use a worker ID and an expiring lease; another worker can recover a job abandoned by a crashed process. Configure `JOB_LEASE_MS` longer than the expected uninterrupted unit of work. Cleanup handlers are idempotent, and object prefixes are removed before metadata is finalized.

Publishing, restoring and unpublishing preserve exactly one active `PUBLISHED` version. A version or project enters `DELETING` before cleanup is queued, immediately preventing catalog discovery and asset authorization.

## R2 delivery

Uploaded ZIPs are private. Executable documents continue through `/api/cdn/*`, where Foundry applies publication checks and document sandbox headers. With `R2_DIRECT_DOWNLOADS=true`, non-document assets are redirected only after that publication check to short-lived signed R2 URLs. The redirect itself is `private, no-store`; the final immutable object can use its R2 cache metadata.

The R2 bucket CORS policy must allow the Platform origin to perform `GET` and range requests and must expose `Content-Length`, `Content-Range`, `ETag` and `Last-Modified`. Keep the signed URL TTL short; unpublish blocks new URLs immediately, while an already issued URL remains valid until its configured TTL expires.

## Deployment checklist

1. Run the complete test/build check and verify the Engine integrity manifest.
2. Back up the metadata database and test a restore before schema changes.
3. Configure Firebase and R2 credentials; keep development auth bypass disabled.
4. Confirm `/api/ready` from the deployment network.
5. Exercise upload, validation, publish, range delivery, rollback, unpublish and deletion against the real bucket.
6. Configure alerts for readiness failures, HTTP 5xx rates, failed jobs and cleanup backlog.

The current SQLite profile is suitable for a single host. Multi-host API deployment still requires the PostgreSQL provider/backups and a production acceptance environment; do not infer those checks from local mocks.
