# Foundry Platform single-node deployment runbook

Foundry supports two explicit production profiles. `cloud` uses Firebase Authentication, private Cloudflare R2, SQLite, and one Node.js Platform process. `single-host` runs the SPA, Express API, local production authentication, local object storage, SQLite, jobs, and backups on one Linux server. Both profiles use the same ownership, upload/version/READY/publish, moderation, CDN, and Player paths. There is no PostgreSQL, Redis, external queue, Kubernetes, or multi-node coordination in either profile.

## 1. Prerequisites

- Node.js 22.x and the committed `package-lock.json`.
- One staging hostname with TLS termination.
- Exactly one Platform process/replica.
- A persistent filesystem mount whose directory exists before startup and is writable by the Node process.
- Cloud only: a private R2 bucket with bucket-scoped credentials, plus a Firebase project/Web app/provider and server credentials.
- Single-host only: a Debian/Ubuntu-like Linux host with system-wide Node.js 22+ and npm, `systemd`, `unzip`, `curl`, `openssl`, standard user-management/core utilities, a same-server HTTPS reverse proxy, and persistent `/var/lib/foundry` storage. The target installs locked production dependencies and verifies a prebuilt release; it does not run Vite, TypeScript, Vitest, Playwright, or an application build. The `zip` command is not required on the server.
- An operator-controlled off-host destination for backup artifacts. A backup stored only on the server disk is not disaster recovery.

The process working directory must be `apps/platform` when `npm start -w @foundry/platform` is used. The server serves only `dist/client`; `dist/server.cjs` is not under the static root.

## Single-host one-time install and routine updates

The supported layout is:

```text
/opt/foundry/releases/<release-id>/   immutable application releases
/opt/foundry/current                  active-release symlink
/opt/foundry/previous                 rollback candidate
/var/lib/foundry/platform.db          SQLite + WAL/SHM
/var/lib/foundry/objects/             private object bytes
/var/lib/foundry/backups/             coordinated local backup artifacts
/etc/foundry/foundry.env              root:foundry 0640 secrets/config
```

Generate one prebuilt single-host release ZIP on the trusted release worker after the full tests, single-host build, artifact verification, smoke, E2E, recovery, and audit gates:

```bash
FOUNDRY_DEPLOYMENT_MODE=single-host npm run build
npm run verify:artifact
npm run test:smoke
npm run release:single-host -- \
  --output /absolute/path/Foundry-single-host-release.zip
```

The generator accepts only a fail-closed single-host `dist`, creates a deterministic content manifest, and packages the executable/client artifact, locked package metadata, backend/operator source required by doctor/backup/restore, and deployment scripts. It excludes tests, E2E fixtures, source maps, environment files, databases, logs, and `node_modules`. Legacy source-only ZIPs are not accepted by `foundry update`; there is one single-host deployment format rather than separate tiny-host and large-host update systems.

On the server, install system-wide Node.js 22 or newer, copy that one ZIP, extract its installer scripts, point DNS at the server, then run:

```bash
mkdir -p /tmp/foundry-installer
unzip -oq /tmp/Foundry-single-host-release.zip \
  'deploy/single-host/*' -d /tmp/foundry-installer
sudo /tmp/foundry-installer/deploy/single-host/install.sh \
  --archive /tmp/Foundry-single-host-release.zip \
  --public-url https://foundry.example.com
```

When running through SSH, start installation as a transient systemd unit so a disconnected terminal cannot kill it (use absolute paths):

```bash
sudo systemd-run \
  --unit=foundry-install \
  --property=Type=oneshot \
  /bin/bash /tmp/foundry-installer/deploy/single-host/install.sh \
  --archive /absolute/path/Foundry-single-host-release.zip \
  --public-url https://foundry.example.com

journalctl -fu foundry-install.service
```

The approximately 1 GiB host is a runtime/deployment target, not a compiler. RC4 proved that Node 22's approximately 512 MiB default heap OOMs during the 3,698-module Vite transform. RC5 proved that allowing 2 GiB old-space merely moves the working set into swap on the actual `e2-micro`: Vite remained in `transforming...` for approximately 77 minutes with only approximately 5 minutes 47 seconds of CPU time, `STAT Dl`, 1.6–1.7 GiB swap, and 78–99% I/O wait. The former `MemAvailable + SwapFree >= 3 GiB` compiler preflight is removed because swap capacity is not equivalent to physical working memory. No build heap override remains in installation, update, or production runtime.

Real-server progression is evidence, not a reason to weaken tests: RC1 stopped with 4 failed tests / 18 errors; RC2 with 2 failed tests / 13 errors; RC3 passed 331/331 assertions but emitted 13 errors; RC4 passed 331/331 with zero errors and then hit Node's default V8 heap boundary; RC5 passed 331/331 with zero errors but entered severe swap-thrashing; RC6's prebuilt path reached smoke but exposed a final release-permission defect; RC7 corrected permissions and then exposed a dangling `current` link left by RC6's failed initial activation. Existing targeted low-CPU test timeouts, password work factors, rate limits, queue/SQLite shutdown behavior, prebuilt architecture, and immutable permission contract remain unchanged.

The installer creates the service account/directories, generates two independent local secrets, installs the systemd unit and operator commands, verifies archive safety and every SHA-256 manifest entry, installs target-native production dependencies with `npm ci --omit=dev`, repeats manifest verification, runs artifact hygiene and compiled smoke, starts exactly one service, and waits for `http://127.0.0.1:3000/api/ready`. The externally published ZIP SHA-256 remains the operator trust anchor and the archive hash remains part of the immutable release ID. It writes a Caddy example to `/etc/foundry/Caddyfile` and installs a `caddy.service` drop-in with `LogsDirectory=caddy` and `LogsDirectoryMode=0750`. systemd therefore creates `/var/log/caddy` for the Caddy service account at service start, including when Caddy is installed after Foundry; no world permission or access to Foundry releases/secrets is granted. Install Caddy separately, review the hostname, enable it, and verify public HTTPS before setting `ENABLE_HSTS=true`.

Deployment links are validated as direct children of `/opt/foundry/releases`. A normal update fails closed on dangling, invalid, non-symlink, or escaping `current`/`previous` state. During an inactive initial installation only, the installer may remove a dangling link whose missing target has Foundry's generated release-ID form under that directory; this allows retry after a failed initial activation without manual filesystem repair. If initial readiness fails, the installer unlinks `current` only after confirming it still points to that candidate, and only then removes the candidate. Cleanup never deletes a release directory while `current` or `previous` still references it.

Routine application updates are one command after transferring the next ZIP:

```bash
sudo foundry update /tmp/Foundry-next.zip
```

Re-running the versioned installer with a valid current release performs a normal update instead of an initial install, then refreshes the versioned operator scripts and systemd drop-ins. Use that path for a release such as RC9 that changes deployment tooling itself. Ordinary application releases continue to use `foundry update` only.

The command validates/extracts into a new release directory, verifies the prebuilt payload before and after locked production dependency installation, runs artifact/smoke verification, gracefully stops the service only for the coordinated pre-update backup and symlink switch, then waits for readiness. No test or build is silently skipped: those remain mandatory release-worker/CI gates, while the server deploys only their verified output. A readiness failure automatically returns to the prior application release only when that release supports the current DB migration. Persistent DB, objects, backups, and `/etc/foundry` are never replaced. Manual rollback is:

```bash
sudo foundry rollback
```

Rollback never performs a schema downgrade. If compatibility fails, it stops before switching and requires an operator recovery decision.

## 2. Install and build

For `cloud`, build-time Firebase values are public identifiers, but they must belong to the same environment as runtime Firebase Admin:

```bash
npm ci
VITE_FIREBASE_API_KEY=... \
VITE_FIREBASE_AUTH_DOMAIN=staging.example.firebaseapp.com \
VITE_FIREBASE_PROJECT_ID=foundry-staging-123 \
VITE_FIREBASE_APP_ID=... \
npm run check
npm run test:smoke
```

`npm run check` generates and validates `apps/platform/dist/client/deployment-profile.json`. Production startup compares its Firebase project with `FIREBASE_PROJECT_ID` and refuses a mismatched artifact.

For `single-host`, Firebase browser identifiers are intentionally absent:

```bash
FOUNDRY_DEPLOYMENT_MODE=single-host npm run build
npm run verify:artifact
npm run test:smoke
npm run release:single-host -- --output /absolute/path/Foundry-single-host-release.zip
```

The generated profile must say `deploymentMode=single-host`, `authProvider=local`, and `storageProvider=local-disk`; both release generation and target verification reject a cloud/malformed profile. Runtime still refuses a cloud/single-host artifact mismatch.

Install Chromium and execute the browser gate on a clean release worker:

```bash
npx playwright install --with-deps chromium
npm run test:e2e
npm audit --audit-level=high
```

Do not place backend/operator source, tests, E2E fixtures, local databases, `.env`, Playwright output, or source maps under the public client root. The release contains the backend source required by operator recovery tools outside the public root; the only served tree remains `dist/client`, and the executable remains `dist/server.cjs`.

## 3. Runtime configuration

Start from `.env.example`. Production validation is fail-closed. Both profiles require:

- `NODE_ENV=production`
- `PLATFORM_PUBLIC_BASE_URL=https://...`
- `PLATFORM_DB_PATH=/absolute/persistent/path/platform.db`
- explicit `FOUNDRY_DEPLOYMENT_MODE=cloud|single-host`
- `JOB_MODE=async`
- explicit `TRUST_PROXY_HOPS`

Cloud additionally requires `FIREBASE_PROJECT_ID`, one deliberate Firebase Admin credential mode, and all required `R2_*` values. Single-host additionally requires `FOUNDRY_DATA_DIR`, the existing writable `objects` and `backups` directories, loopback `HOST`, empty `CORS_ALLOWED_ORIGINS`, and distinct 32-byte-or-longer `LOCAL_AUTH_SESSION_SECRET` and `LOCAL_STORAGE_SIGNING_SECRET`. Its DB must stay inside `FOUNDRY_DATA_DIR` unless `SINGLE_HOST_ALLOW_EXTERNAL_DB_PATH=true` is a deliberate mount decision.

The following values must stay disabled in production:

```text
E2E_MODE=false
SINGLE_HOST_TEST_MODE=false
LOCAL_DEV_MODE=false
AUTH_DEV_BYPASS=false
ALLOW_UNREADY_STARTUP=false
R2_DIRECT_DOWNLOADS=false
```

`R2_DIRECT_DOWNLOADS` is intentionally rejected in production: an issued signed URL cannot be revoked immediately after quarantine. Proxied `/api/cdn/*` responses use validators plus `Cache-Control: public, no-cache`, so each reuse passes the database publication/moderation gate.

Set `TRUST_PROXY_HOPS=0` if Node accepts the client connection directly. If TLS terminates at one trusted reverse proxy and no other proxy can reach Node, set `1`. Never infer this value from untrusted `X-Forwarded-For` headers.

Set `ENABLE_HSTS=true` only after confirming the public hostname is always HTTPS. The app never enables HSTS implicitly.

## 4. Firebase setup and validation (cloud only)

1. Add the exact staging hostname to Firebase Authentication → Authorized domains.
2. Enable the intended provider (the current UI uses Google popup sign-in outside local/E2E mode).
3. Ensure `VITE_FIREBASE_PROJECT_ID`, `FIREBASE_PROJECT_ID`, and both verification tokens target the same project.
4. Ensure the named Firestore database in `firebase.json` exists, or deliberately update `firebase.json`, `.env.example`, and the related tests together.
5. Deploy the checked-in rules from `apps/platform` using the authenticated Firebase CLI:

```bash
firebase deploy --only firestore --project "$FIREBASE_PROJECT_ID" --config firebase.json
```

6. Run the static mapping check:

```bash
npm run verify:firebase-config
```

7. Obtain short-lived ID tokens for two distinct disposable staging users and run the deployed-rules test:

```bash
STAGING_BASE_URL=https://staging.example.com \
FIREBASE_PROJECT_ID=foundry-staging-123 \
FIRESTORE_DATABASE_ID=... \
STAGING_FIREBASE_OWNER_TOKEN=... \
STAGING_FIREBASE_FOREIGN_TOKEN=... \
FIREBASE_STAGING_RULES_CONFIRM=I_UNDERSTAND_THIS_CREATES_AND_DELETES_A_FIRESTORE_TEST_DOCUMENT \
npm run verify:staging:firebase
```

The verifier checks Platform token verification and deployed Firestore ownership rules. Tokens are used only as authorization headers and are never printed.

Current editor cloud persistence uses authenticated Platform API endpoints backed by SQLite. Firestore rules protect legacy/direct project documents; they are not a substitute for the Platform ownership checks.

## 5. R2 setup and validation (cloud only)

Use the account endpoint form:

```text
https://ACCOUNT_ID.r2.cloudflarestorage.com
```

The bucket must remain private. Configure CORS for the exact staging origin and signed `PUT` with `Content-Type`. Range/HEAD used by players go through the Platform API. Run the isolated live check before application smoke:

```bash
R2_STAGING_TEST_PREFIX=staging-verification/foundry-rc \
R2_STAGING_CORS_ORIGIN=https://staging.example.com \
R2_STAGING_VERIFY_CONFIRM=I_UNDERSTAND_THIS_WRITES_AND_DELETES_TEST_OBJECTS \
npm run verify:staging:r2
```

The script creates one random object under that prefix, verifies CORS, signed upload, HEAD metadata, full and ranged reads, signed GET, listing, and deletion, then cleans up on failure when possible.

## 6. Start and probes

```bash
npm start -w @foundry/platform
```

Production startup validates configuration and selected providers before listening. Cloud readiness checks SQLite, R2, jobs, and Firebase Admin. Single-host readiness checks SQLite, local object storage, jobs, and local authentication. Neither profile falls back to mock auth, inline jobs, or E2E reset routes.

Use:

```bash
curl -fsS https://staging.example.com/api/health
curl -fsS https://staging.example.com/api/ready
```

- `/api/health` is liveness and does not contact external dependencies.
- `/api/ready` checks the selected DB/storage/auth providers and queue state. It returns `503` if a required check fails or the queue is stopping.
- Acceptance of a real Firebase token is verified by the staging Firebase/smoke scripts, not by liveness.

## 7. Provision the first operator

There is no public admin-escalation endpoint. In cloud mode, copy the exact Firebase UID from the Firebase console and run:

```bash
npm run admin:provision -- \
  --uid FIREBASE_UID \
  --role ADMIN \
  --db /absolute/persistent/path/platform.db \
  --confirm-provision
```

Allowed roles are `ADMIN` and `MODERATOR`. Repeating the same command is idempotent. Retain its JSON output in the deployment audit record. Then sign in and open `/moderation`; verify a normal `DEVELOPER` receives `403` from moderation APIs.

In single-host mode, create a local operator deliberately. Supply the password on stdin so it never appears in argv or shell history:

```bash
printf '%s\n' 'operator-chosen-password' | sudo foundry create-user \
  --username operator \
  --display-name 'Foundry Operator' \
  --role ADMIN \
  --confirm-create-user \
  --confirm-privileged-role \
  --password-stdin
```

Use `foundry reset-password --user UID_OR_USERNAME --confirm-reset-password --password-stdin`, `disable-user`, and `enable-user` for deliberate recovery/state changes. Password reset and disable revoke all active sessions. Self-service email password recovery is not available in single-host v1.

## 8. Backup and restore

Never copy a live `platform.db` file directly: WAL may contain committed pages not present in the main file. Cloud DB-only tools use SQLite `VACUUM INTO`, verify `quick_check`, foreign keys, migrations, row counts, size, and SHA-256, and refuse overwrite:

```bash
npm run db:backup -- \
  --source /absolute/persistent/path/platform.db \
  --output /absolute/backup/path/foundry-YYYYMMDD-HHMM.db

npm run db:rehearse -- \
  --backup /absolute/backup/path/foundry-YYYYMMDD-HHMM.db
```

Restore always targets a new path:

```bash
npm run db:restore -- \
  --backup /absolute/backup/path/foundry-YYYYMMDD-HHMM.db \
  --target /absolute/persistent/path/restored-platform.db \
  --confirm-new-target
```

To cut over: stop the Platform gracefully, rehearse the backup, restore to a new filename, update `PLATFORM_DB_PATH`, run the storage integrity checker, and only then start the process. Restore never overwrites the current database. Follow `STORAGE_RECOVERY.md` for R2 implications.

For single-host, always coordinate SQLite metadata and `objects/` bytes:

```bash
sudo foundry backup
sudo foundry rehearse --backup /var/lib/foundry/backups/foundry-backup-YYYYMMDDTHHMMSSZ
sudo foundry storage-check
```

`foundry backup` stops/drains the one process, creates the verified DB snapshot and hashed object-tree manifest, then restarts and waits for readiness. Restore is intentionally isolated and no-overwrite:

```bash
sudo foundry restore \
  --backup /var/lib/foundry/backups/foundry-backup-YYYYMMDDTHHMMSSZ \
  --target /var/lib/foundry-restore-test \
  --confirm-new-target
```

Copy each completed backup directory to another physical host/disk. Secrets, `.env`, and TLS keys are not included.

A fresh-install backup with no published game is still a complete restore rehearsal: restore, health, readiness, and storage integrity must pass, and `publishedAsset.status` is `NOT_APPLICABLE`. If any active published game with an entry asset exists, the rehearsal always performs the stronger CDN delivery check and fails unless the restored bytes are actually served.

## 9. Staging smoke (cloud)

Use disposable developer and moderator accounts, plus a known-valid ZIP:

```bash
STAGING_BASE_URL=https://staging.example.com \
STAGING_DEVELOPER_TOKEN=... \
STAGING_MODERATOR_TOKEN=... \
STAGING_TEST_PACKAGE=/absolute/path/generic-valid-game.zip \
STAGING_SMOKE_CONFIRM=I_UNDERSTAND_THIS_CREATES_AND_DELETES_STAGING_CONTENT \
npm run test:staging
```

The script refuses a hostname that is not recognizably staging unless a separate production-risk acknowledgement is provided. It uses a `[foundry-staging-smoke]` namespace and requests cleanup even after failure.

## 10. Deploy and rollback

### Routine GitHub deployment

The `package-single-host` and `deploy-single-host` jobs in `.github/workflows/ci.yml` run only for a push to the repository default branch after the normal `verify` job passes. The release job builds the single-host profile off-server, runs the single-host Chromium/restart/integrity/backup/restore gate, verifies and smokes the artifact, creates the hash-manifested ZIP, and rehearses that exact ZIP. The protected `production` environment then downloads the immutable Actions artifact, transfers it over SSH with a pinned host key, verifies its SHA-256 on the VM, invokes the installed `foundry update` transaction, and requires local plus public HTTPS readiness. It never builds on the VM, writes into `current`, or converts an update failure into success.

One-time production configuration:

1. Create a GitHub environment named `production`, restrict it to the protected production branch, and require a production reviewer for controlled deployments. This removes SSH work from routine updates while retaining an explicit release approval.
2. Add environment variables `FOUNDRY_DEPLOY_HOST`, `FOUNDRY_DEPLOY_USER`, and `FOUNDRY_PUBLIC_URL` (the latter must be the HTTPS origin).
3. Add environment secrets `FOUNDRY_DEPLOY_SSH_KEY` and `FOUNDRY_DEPLOY_HOST_KEY`. The host-key value is the exact trusted `known_hosts` line obtained out of band; the workflow deliberately does not use `ssh-keyscan` or disable host verification.
4. Install the matching public SSH key for the non-root Linux deployment user, then run once:

```bash
sudo foundry configure-deploy-user DEPLOY_LINUX_USERNAME
```

That command creates only `~/.foundry-deploy` with mode `0700` and a validated sudoers rule for one root-owned, no-argument CI helper. The helper accepts only the fixed regular file `~/.foundry-deploy/Foundry-single-host.zip`, requires deploy-user ownership and no group/world write bit, clears the caller environment, and then invokes the installed `foundry update` transaction. It does not grant general passwordless sudo. Treat the SSH key and GitHub production environment as production deployment credentials.

For routine changes the normal operator action is simply a push to the protected default branch (plus an environment approval if configured). Expected stages are CI, prebuilt artifact, verified transfer, atomic update, and public readiness; the practical target is approximately 5–15 minutes, not an instant deployment promise for an `e2-micro`.

### Full acceptance changes

Repeat the extended real-host doctor/backup/rehearsal/storage/restart/rollback/security evidence only when a release changes deployment state, database migrations, authentication/security, backup/restore, systemd, Caddy/networking, or another production boundary. Ordinary application releases still require CI, artifact verification, atomic update, local readiness, and public readiness, but not a manual replay of the full release-candidate acceptance program.

1. Record the current artifact identifier and take/rehearse a DB backup.
2. Stop the old process with SIGTERM and wait for `server_stopped`.
3. Deploy the already-validated artifact without rebuilding it with different Firebase values.
4. Start one process and wait for `/api/ready=200`.
5. Run Firebase, R2, and staging smoke gates.
6. If application behavior fails, SIGTERM the new process, restore the previous application artifact, and start it against the same DB only after confirming schema compatibility.

Migrations 4–8 are forward-only and additive. No automatic down migration exists. Application rollback and game release rollback are separate: restoring an archived game version uses the Developer Project Manager and does not roll back the application binary.

The installed single-host `foundry update` and `foundry rollback` commands implement this same application-only policy and consult `dist/server-profile.json` before returning to a previous release.

A DB restore to an older point can leave newer R2 objects orphaned and can reference objects deleted after that backup. Never auto-delete orphan candidates. Run:

```bash
PLATFORM_DB_PATH=/absolute/restored.db npm run storage:check
```

## 11. Logs, failed jobs, and moderation

Logs are newline-delimited JSON. Correlate incidents with `requestId`, `userUid`, `gameId`, `versionId`, `jobId`, `uploadSessionId`, and `reportId`. Sensitive field names are recursively redacted. Never add raw headers, tokens, R2 credentials, GitHub credentials, or game saves to log fields.

Job failures are durable in SQLite. Inspect without changing state:

```sql
SELECT id, type, targetId, status, attempts, error, updatedAt
FROM jobs
WHERE status IN ('FAILED', 'RETRYING')
ORDER BY updatedAt DESC;
```

Use `/moderation` for the report queue, quarantine/hide/restore controls, resolution reasons, operator identity, timestamps, and per-game audit history. Quarantine is enforced by catalog/detail and every `/api/cdn/*` request.

## 12. Graceful and emergency shutdown

Send SIGTERM (or SIGINT locally). The process stops accepting new connections, stops cleanup scheduling, drains the active cleanup scheduler and job work, waits for queued SQLite transactions, closes Vite if present, closes SQLite, and emits `server_stopped`.

If `SHUTDOWN_GRACE_MS` expires, the process logs `shutdown_grace_exceeded`, closes remaining HTTP connections, and exits non-zero. An interrupted durable job remains reclaimable after its lease expires. Use SIGKILL only after this deadline; inspect `RUNNING`/`RETRYING` jobs and `/api/ready` after restart.
