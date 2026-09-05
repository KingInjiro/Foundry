# Production operations

This is a compact map of implemented operational controls. Use `DEPLOYMENT_RUNBOOK.md` for procedures, `STORAGE_RECOVERY.md` for the DB/R2 consistency model, and the repository `RELEASE_CHECKLIST.md` for release evidence.

## Startup and runtime profile

- Production configuration is validated before providers are constructed. `cloud` fails closed on missing Firebase Admin/R2/persistent SQLite/build identity; `single-host` fails closed on missing persistent data directories/local secrets/loopback binding/single-host build identity.
- Production rejects E2E/local modes, auth bypass, inline jobs, readiness bypass, and direct R2 redirects.
- The generated client build profile must match runtime deployment mode. Cloud also binds the Firebase project; single-host profiles contain no Firebase identity.
- `GET /api/health` is liveness only. `GET /api/ready` checks SQLite, the selected storage/auth provider, and job-queue state and returns `503` when unavailable.
- `TRUST_PROXY_HOPS` is explicit. Defaulting to untrusted forwarded headers is not allowed.

## Logging and shutdown

- Responses include `X-Request-Id`; JSON request/job/moderation logs carry correlation IDs where available.
- Logger fields matching authorization, cookies, tokens, secrets, credentials, passwords, or game saves are recursively redacted.
- SIGTERM/SIGINT stops new HTTP acceptance and cleanup scheduling, drains active jobs and SQLite transactions, then closes the DB. Exceeding `SHUTDOWN_GRACE_MS` exits non-zero; durable jobs remain reclaimable after lease expiry.

## Jobs and lifecycle

- Jobs, attempts, errors, worker ownership, and expiring leases are persisted in SQLite.
- One active job per `(type,targetId)` and one `PUBLISHED` version per game are enforced by partial unique indexes.
- Version/project deletion revokes access by entering `DELETING` before R2 cleanup.
- Upload cleanup is idempotent; cleaned unpublished sources become explicitly `EXPIRED` when they can no longer be published.

## Delivery and moderation

- Uploaded ZIPs remain private in R2 or the local object tree. Only canonical extracted paths of the active `PUBLISHED` version of an `ACTIVE` game are served.
- Every `/api/cdn/*` read revalidates through SQLite using `Cache-Control: public, no-cache`. Executable documents receive a CSP sandbox.
- `R2_DIRECT_DOWNLOADS=false` is mandatory in production because already-issued signed GET URLs cannot be revoked immediately.
- Reports, report resolutions, game state changes, operator UID, timestamp, reason, and previous/next state are persisted. Only `ADMIN`/`MODERATOR` can use those endpoints.

## Recovery

- `db:backup` uses SQLite `VACUUM INTO`, not a raw live-file copy, and verifies integrity/FKs/migrations/hash.
- `db:restore` refuses overwrite and restores only to a new path.
- `db:rehearse` boots an isolated restored app and reads data.
- `storage:check` compares SQLite references with R2 and reports missing objects and non-destructive orphan candidates.
- R2 byte recovery requires an external retention/backup mechanism; the repository does not claim to provide one.
- Single-host `foundry backup` coordinates a verified SQLite snapshot with the hashed local object tree; `foundry rehearse` restores and boots it in isolation. Same-disk copies still require an off-host copy for disaster recovery.

## Single-host operator commands

```bash
sudo foundry status
sudo foundry logs 200
sudo foundry doctor --verify-backup
sudo foundry backup
sudo foundry rehearse --backup /absolute/backup-directory
sudo foundry storage-check
sudo foundry update /tmp/Foundry-next.zip
sudo foundry rollback
```

`foundry doctor` reports Node version, deployment profile, data/free-space state, SQLite quick/FK/migration checks, object directory, service state, and latest backup without printing secrets. Update and rollback preserve `/var/lib/foundry` and `/etc/foundry`; rollback never downgrades a DB schema.

Local account recovery is deliberate operator work. Use `foundry reset-password`, `disable-user`, and `enable-user`; reset/disable revoke existing sessions. Self-service email recovery is not available in single-host v1.

## Release gates

```bash
npm ci
npm run check
npm run test:smoke
npm run test:e2e
npm audit --audit-level=high
```

Single-host adds a separate production-mode acceptance gate:

```bash
npm run test:e2e:single-host
```

This gate uses local production auth/storage behind an HTTPS proxy and then restarts the compiled server against the same data root, checks Range/persistence/integrity, creates a coordinated backup, and performs an isolated restore rehearsal.

Real cloud acceptance is separate:

```bash
npm run verify:staging:firebase
npm run verify:staging:r2
npm run test:staging
npm run storage:check
```

Without real staging credentials, those checks are `NOT VERIFIED`, never local `PASS`.
