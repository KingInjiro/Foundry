# Foundry Release Candidate hardening report

Date: 2026-08-26  
Scope: staging/Release Candidate readiness of the current npm-workspaces tree  
Release verdict: **READY FOR STAGING**

This report records only checks performed against the current source tree. It does not claim that Firebase rules, R2, TLS, the reverse proxy, persistent volume, monitoring, or the deployed application have passed staging: no real staging URL or cloud credentials were available.

## A. Release blockers before work

| Issue | Severity | Blocks staging? | Blocks public release? | Action completed |
| --- | --- | --- | --- | --- |
| Backend bundle and browser files shared one `dist` surface; debug fixtures/source-map risk | P0 | Yes | Yes | Split `dist/client` from `dist/server.cjs`; serve only the client root; add artifact allowlist/secret scan; remove public debug fixtures. |
| Production environment accepted incomplete or ambiguous Firebase/R2/SQLite/proxy/job configuration | P0 | Yes | Yes | Added fail-closed startup validation and build/runtime Firebase project binding. |
| Graceful shutdown did not prove that job and SQLite work drained before close | P0 | Yes | Yes | Stop HTTP admission, cleanup scheduling, and job claiming; drain active work; await SQLite transactions; add grace deadline and smoke evidence. |
| No WAL-aware backup, guarded restore, or restore rehearsal | P0 | Yes | Yes | Added `VACUUM INTO` backup/restore verification and an isolated server rehearsal. |
| Checked-in Firestore rules were not tied to an authoritative deployment config/live verifier | P1 | Yes | Yes | Added exact `firebase.json` mapping, static regression checks, and a two-user deployed-rules verifier. |
| R2 CORS/upload/HEAD/Range/list/delete path had no reusable live acceptance test | P1 | Yes | Yes | Added isolated staging R2 verifier with explicit namespace/confirmation and cleanup. |
| Player Worker exposed a literal `eval` editor command path | P1 | Yes | Yes | Removed literal `eval`; typed published launches cannot enable editor commands; legacy editor commands use Blob ES modules. |
| Platform, Foundry sandbox, generic sandbox, API, and executable CDN documents lacked separate header policies | P1 | Yes | Yes | Added surface-specific CSP and security/cache headers with regression tests. |
| Moderation had backend foundation but no protected operator workflow, audit trail, or provisioning path | P1 | No | Yes | Added ADMIN/MODERATOR queue/actions/UI, atomic audit records, and deliberate local provisioning CLI. |
| SQLite metadata and R2 objects had no consistency detector | P1 | No | Yes | Added a read-only missing/orphan integrity checker; no destructive cleanup mode. |
| Proxy/IP semantics and high-cost endpoints were inconsistently rate-limited | P1 | No | Yes | Added explicit trusted-hop policy, UID/IP identities, operation-specific durable rate buckets, and spoofing regression tests. |
| CI did not gate dependency severity, artifact hygiene, security/config tests, smoke, and real Chromium together | P1 | Yes | Yes | Expanded CI into a mandatory release gate with no `continue-on-error`. |
| Moderate/low transitive dependency advisories | P2 | No | Review before public release | High/critical audit gate passes; remaining advisories are classified below and were not force-fixed. |

## B. Changes made

### Production configuration and Firebase

- `apps/platform/src/platform/backend/config/productionConfig.js` validates production URL, persistent absolute SQLite path/mount, Firebase Admin credential mode, client/runtime Firebase project identity, complete R2 configuration, trusted proxy hops, async jobs, limits, TTLs, CORS, HSTS choice, and log level. Unsafe production fallbacks fail startup.
- `apps/platform/vite.config.js` requires production Firebase Web config and emits `dist/client/deployment-profile.json` without secrets.
- `apps/platform/server.js` validates before provider construction, checks dependencies before listening, serves only `dist/client`, and implements ordered shutdown.
- `apps/platform/src/platform/backend/auth/firebaseAdmin.js` now initializes lazily with explicit project/ADC status; `AuthContext.jsx` uses Vite Firebase values in production.
- `apps/platform/firebase.json`, `firestore.indexes.json`, `firestore.rules`, `verify-firebase-config.mjs`, and `verify-firebase-staging.mjs` define and verify the actual rules deployment boundary.
- `.env.example` now documents Core, Firebase, R2, SQLite, Jobs, Security, Observability, and Limits values used by runtime code.

### Build artifact and HTTP surfaces

- Browser output moved to `apps/platform/dist/client`; backend output is `apps/platform/dist/server.cjs` with no source map.
- `verify-artifact.mjs` rejects `.env`, DBs, credentials, maps, debug/test fixtures, reports, traces, backend files under the public root, and unexpected top-level output.
- Removed unused browser-accessible debug pages and fixture directories from `apps/platform/public`.
- `securityHeaders.js` now has separate policies for Platform SPA, Foundry sandbox, generic Web sandbox, API, CDN, and executable CDN documents. Production Platform/Foundry policies do not allow `unsafe-eval`; generic compatibility exceptions remain confined to its opaque nested iframe surface.
- Vite-only inline preamble/HMR WebSocket allowances are enabled only in an explicit non-production profile. This fixed an E2E regression without weakening production CSP.
- CDN responses use moderation-aware `public, no-cache` revalidation; production rejects unrevocable direct signed-download mode.

### Player Worker

- `packages/player/src/worker.js`, `runtimeGameModule.js`, `sandboxProtocol.js`, and `sandbox.jsx` remove direct `eval` and prevent typed published launches from forwarding editor console commands.
- `packages/player/PLAYER_RUNTIME_SECURITY.md` records the actual threat model and residual generic/Engine-editor execution paths.
- No file under `packages/engine/src/engine/core` was changed.

### SQLite, jobs, backup, and storage integrity

- `SqliteMigrationRunner.js` adds migration 7 for moderation operations/audit and preserves fresh/upgrade equivalence.
- `LocalSqliteProvider.js` adds operator/report/audit/storage snapshot methods while retaining serialized transaction behavior.
- `LocalJobQueue.js` stops accepting/claiming work during shutdown, tracks active polls/jobs, drains them, and emits correlated job logs. Durable leases remain reclaimable after forced termination.
- `SqliteRecovery.js` plus `db-backup.mjs`, `db-restore.mjs`, and `db-rehearsal.mjs` provide verified WAL-safe backup and no-overwrite restore.
- `StorageIntegrityChecker.js`, provider object listing, and `check-storage-integrity.mjs` compare DB references with storage and report missing/invalid/orphan candidates without deletion.
- `verify-r2-staging.mjs` checks exact staging origin, signed PUT TTL, CORS, HEAD metadata, full/Range/signed GET, listing, delete, and cleanup in an isolated prefix.

### Moderation, abuse controls, and operations

- `ModerationDashboard.jsx` and `/moderation` provide a minimal protected queue, report/game context, resolve/dismiss, quarantine/hide/restore, required reason, and audit history.
- Moderation APIs require `ADMIN` or `MODERATOR`; ordinary authenticated developers receive 403. Actions and report resolution are atomic and record operator UID/time/reason/state transition.
- `provision-admin.mjs` is an idempotent, explicit local ADMIN/MODERATOR provisioning path; no public role-escalation endpoint exists.
- Durable rate limits cover project/version/upload/publish/lifecycle, editor writes, reports/moderation, ratings/follows, discovery, recommendations, catalog, and search. Forwarded IPs are trusted only for the configured proxy-hop count.
- `JsonLogger.js` recursively redacts sensitive field names and structured request/job/moderation events carry available correlation IDs.

### CI, staging acceptance, and documentation

- `.github/workflows/ci.yml` uses Node 22, locked install, high/critical audit gate, Chromium installation, `npm run check`, compiled smoke, and browser E2E; mandatory steps have no `continue-on-error`.
- `smoke-staging.mjs` validates the deployed health/auth/upload/publish/catalog/CDN/rollback/moderation flow with separate users and now waits until destructive cleanup is confirmed.
- Added `RELEASE_CHECKLIST.md`, `apps/platform/DEPLOYMENT_RUNBOOK.md`, `STORAGE_RECOVERY.md`, `PRODUCTION_OPERATIONS.md`, and Player security documentation; updated current README/security/schema documents.

### Regression coverage added or expanded

- Production/E2E mode rejection and production config/build-profile validation.
- Exact Firestore deployment mapping/ownership markers.
- Job drain behavior; concurrent/failed SQLite transactions remain covered.
- WAL backup, restore, corruption, and overwrite guardrails.
- Fresh/upgrade migration equivalence through migration 7.
- Player Worker editor-command boundary and Blob module generation.
- Security headers and moderation-aware direct asset delivery.
- Moderator authorization, report resolution, audit records, and CDN/catalog moderation gates.
- Proxy spoofing/trusted-hop behavior and structured log redaction.
- Local/R2 provider listing and storage integrity reports.

## C. Security verdict

| Area | Verdict | Evidence and limitation |
| --- | --- | --- |
| Firebase | **Locally ready for staging validation** | Production build/runtime project binding, explicit ADC, owned Platform editor APIs, restrictive Firestore rules, exact config mapping, and static tests pass. Actual rules deployment, Authorized Domains, and two-user token behavior are **NOT VERIFIED**. |
| R2 | **Locally ready for staging validation** | Fail-closed config, private provider path, short signed upload TTL, proxied revocable CDN gate, HEAD/Range/list/delete code and mock/local tests pass. Live credentials, CORS, bucket policy, latency, and object behavior are **NOT VERIFIED**. |
| Player Worker | **Acceptable for controlled staging** | No literal `eval` in the Worker; published typed protocol cannot enable editor commands; Foundry CSP has no `unsafe-eval`. Generic Web games intentionally retain `unsafe-eval` compatibility inside an opaque nested iframe. Engine editor export has a separate `new Function` compatibility path and was not changed. |
| Secrets | **Pass locally** | No persistent GitHub PAT path was found in the current editor flow; logger redaction covers authorization/token/secret/cookie/credential/save fields; artifact scan found no `.env`, credentials, DB, maps, or debug fixtures. Runtime secret-store configuration is **NOT VERIFIED**. |
| Moderation | **Implemented and locally tested** | ADMIN/MODERATOR-only endpoints, atomic audit, UI, catalog/detail/CDN gate, and report persistence exist. Real operator account and incident rehearsal are **NOT VERIFIED**. |
| Admin provisioning | **Implemented** | Local explicit idempotent CLI; no public elevation endpoint. First staging operator provisioning/audit record is **NOT VERIFIED**. |
| HTTP headers | **Pass locally** | Surface-specific tests pass. HSTS remains opt-in and must be enabled only after real HTTPS topology confirmation. External proxy/CDN header preservation is **NOT VERIFIED**. |
| Dependencies | **High/critical gate passes** | `npm audit --audit-level=high` exited 0. Remaining: 8 advisories (7 moderate, 1 low). DOMPurify is transitive through Monaco and browser-reachable in the editor, but Foundry does not directly call DOMPurify/config hooks; update should be compatibility-tested. UUID 9 is transitive through Firebase Admin/Google Cloud Storage; Foundry does not call affected v3/v5/v6 buffer APIs, and the proposed force fix is a breaking Firebase Admin downgrade. No `--force` fix was applied. |

This is not a penetration-test claim.

## D. Recovery verdict

| Area | Verdict | Evidence and limitation |
| --- | --- | --- |
| SQLite backup | **Pass locally** | A real E2E database with a 4,132,392-byte WAL was backed up using `VACUUM INTO`; `quick_check=ok`, zero FK violations, migrations 4–7 present. |
| Restore/rehearsal | **Pass locally** | Restore to a new isolated file, server start, health/readiness 200, schema/rows readable, and no-overwrite/corruption regressions pass. |
| R2 consistency | **Checker implemented; cloud not verified** | Read-only DB↔object checker reports missing/invalid references and orphan candidates. It never deletes. Live R2 inventory was unavailable. |
| R2 byte recovery | **Not complete for public release** | Repository does not provide external R2 backup/replication/retention. Operations must choose and rehearse one before public release. |
| Upload recovery | **Pass in existing automated coverage** | Pending/expired/READY/PUBLISHING/PUBLISH_FAILED states and same-ZIP retry UX remain in the existing platform flow. No live browser refresh against R2 was performed. |
| Jobs/shutdown | **Pass locally** | Durable leases, active-work drain, queue stop, serialized DB close, and compiled SIGTERM smoke pass; forced-deadline recovery still depends on lease expiry. |
| Application/release rollback | **Documented and locally tested** | Release activation/archiving is covered by E2E; application rollback remains an operator deployment action and real artifact rollback was not rehearsed. |

## E. Validation evidence

| Command | Exit code | Checks/tests | Result |
| --- | ---: | --- | --- |
| `npm ci` with writable workspace npm cache | 0 | Clean locked install; 584 packages; lockfile SHA-256 stayed `fab6f1bd...e939c` | PASS. An earlier attempt failed because the environment injected unwritable `/root/.npm`; it was not counted as a pass. |
| `npm run check` | 0 | Import verifier; static Firebase mapping; TypeScript; 73 test files / 471 tests; production build (2,615 modules); artifact hygiene | PASS. Contracts 1 file/2 tests, Player 26/177, Platform 46/292. |
| `npm run test:smoke` | 0 | Compiled server health/readiness, ZIP→READY→PUBLISHED, catalog, Range 206, unpublish, restore, delete, SIGTERM log | PASS. |
| `npm run test:e2e` | 0 | Real Chromium | PASS, 14/14 in 48.6s after clean install. |
| `npm audit --audit-level=high` | 0 | High/critical dependency gate | PASS threshold; 8 lower-severity advisories remain (7 moderate, 1 low). |
| `npm run db:backup -- ...` | 0 | WAL-safe snapshot, SHA-256, quick/FK checks, migrations and row counts | PASS. |
| `npm run db:rehearse -- ...` | 0 | Restore to clean location, app probes, readable schema/data | PASS; health 200, readiness 200. |
| Staging script `node --check` for Firebase/R2/full smoke | 0 | JavaScript syntax for all three acceptance scripts | PASS locally. |

Build note: the local `dist/client/deployment-profile.json` contains the non-secret CI Firebase placeholder used for reproducible local validation. It is **not** a deployable staging artifact. Build again with the real staging Vite Firebase identifiers; runtime will correctly refuse a Firebase project mismatch.

## F. Cloud validation

### VERIFIED LOCALLY

- Import direction and TypeScript.
- 471 unit/integration tests.
- Production browser/backend build split and artifact hygiene.
- Compiled production lifecycle smoke and graceful shutdown.
- Chromium E2E 14/14, including Editor→Platform handoff, publish lifecycle, retention, generic runtime, sandbox, streaming, and validation errors.
- Production config fail-closed tests, Firestore rules mapping, R2/provider behavior under tests, security headers, moderation authorization/audit, rate/proxy semantics, migrations, backup/restore, and storage integrity logic.

### VERIFIED AGAINST STAGING

- Nothing. No real staging URL, Firebase user tokens/Admin credentials, or R2 credentials were available.

### NOT VERIFIED

- Deployed Firestore rules and named database; Firebase Authorized Domains and real sign-in/token verification.
- Live R2 bucket policy/CORS/signed upload/full and Range reads/list/delete.
- Deployed TLS, reverse proxy hop count, HSTS, persistent SQLite mount, one-replica ownership, and header preservation.
- Full deployed `npm run test:staging` flow.
- Real first-admin provisioning, operator UI rehearsal, log ingestion/alerts, disk alerting, and application rollback.
- External R2 backup/retention and restore.

## G. Remaining risks

### Critical

- None found by the local source/build/test/recovery checks.

### High

- The release has not passed real Firebase, R2, or deployed staging acceptance. This blocks any public-release verdict.
- No external R2 backup/replication/retention mechanism has been selected and rehearsed. SQLite recovery alone cannot restore deleted runtime bytes.
- Deployment-specific TLS/proxy/persistent-volume/single-process/monitoring/rollback controls are documented but not accepted in a real environment.

### Medium

- Eight transitive dependency advisories remain. The high/critical CI threshold passes, but DOMPurify/Monaco should be upgraded after editor compatibility testing; UUID/Firebase Admin should follow an upstream non-breaking resolution.
- Generic Web compatibility requires inline/eval-capable game code in an opaque nested sandbox; this is an explicit residual UGC risk, not a trusted-code model.
- `packages/engine/src/editor/lib/exportProject.js` retains a separate `new Function` generated-export path outside the Player Worker. It should be reviewed if export CSP requirements tighten.
- Public-release operations still need real alerts, log ingestion, on-call ownership, and a completed moderation drill.
- Editor (about 1.40 MB minified) and Player Worker (about 1.11 MB) chunks trigger the Vite size warning. This is a performance follow-up, not a staging correctness blocker.

### Low

- Public production source maps are intentionally absent, improving artifact confidentiality but reducing client stack-symbolication unless a private upload process is added later.
- Unused prototype services (`AIToolingProvider`, legacy `ModerationService`, and related placeholders) remain outside the active runtime path and should be removed in a later bounded cleanup.

## H. Release verdict

**READY FOR STAGING**

Reasons:

- All locally executable mandatory code gates pass after a clean locked install.
- P0 source-level security, configuration, shutdown, artifact, and SQLite recovery blockers are closed with regression coverage.
- Required cloud acceptance checks are implemented as explicit, destructive-scope-controlled commands.
- Single-node topology is operationally documented and locally recoverable.

It is **not ready for public release** because no real staging validation has occurred and R2 byte recovery/production operations are not yet proven.

## I. Production readiness scores

| Area | Score | Rationale |
| --- | ---: | --- |
| Security | 7.8/10 | Strong local auth/ownership, fail-closed config, CSP, moderation, artifact and audit gates; real cloud policies and residual generic/engine dynamic code are unverified. |
| Reliability | 8.2/10 | Serialized transactions, durable jobs/leases, bounded graceful shutdown, smoke and E2E pass; live dependency behavior is unknown. |
| Data integrity | 8.3/10 | Versioned transactional migrations, ownership checks, atomic moderation/release operations, WAL backup and integrity checks. |
| Operations | 7.0/10 | Structured logs, probes, moderator surface, runbook and checklist exist; external alerting/on-call drills are absent. |
| Recovery | 7.2/10 | SQLite backup/restore is rehearsed and storage consistency is detectable; R2 byte recovery is not provisioned. |
| Deployment | 7.2/10 | Fail-closed profile, CI gates and staging scripts are ready; no actual deployment has been accepted. |
| Testing | 8.7/10 | 471 unit/integration tests, compiled smoke, and Chromium 14/14; no live cloud, load, chaos, or penetration testing. |
| Scalability | 6.8/10 | Bounded batch queries and single-node correctness are appropriate for v1; blocking SQLite and one process intentionally limit horizontal scale. |
| Overall production readiness | 7.5/10 | Evidence supports staging deployment, not public launch. |

## Architecture after hardening

```text
Editor
→ Platform-owned integration adapter
→ canonical package + client validation
→ existing upload session/version pipeline
→ server validation + durable extraction job
→ READY / ProjectManager
→ publish job + atomic release lifecycle
→ moderated Catalog/CDN gate
→ sandboxed Player runtime
```

Operational side paths:

```text
Firebase Auth token → Platform auth middleware → SQLite ownership/role checks
SQLite metadata ↔ read-only integrity checker ↔ private R2 objects
SIGTERM → stop HTTP/jobs → drain work/transactions → close SQLite
Reports → protected moderator action → audit record → Catalog/CDN visibility gate
```

## Required next staging actions

1. Build with the real staging Firebase Web identifiers and configure the matching runtime Firebase project/ADC.
2. Deploy the exact checked-in Firestore rules and run `npm run verify:staging:firebase` with two distinct disposable users.
3. Configure the private staging R2 bucket/CORS and run `npm run verify:staging:r2`.
4. Provision distinct disposable developer and moderator accounts; run `npm run test:staging` and retain its JSON output.
5. Mount persistent SQLite storage, provision the first operator, run backup + rehearsal + live storage integrity check.
6. Confirm TLS/proxy hops/headers/one replica/log alerts and rehearse application rollback.
7. Select and rehearse external R2 byte recovery before considering public release.

