# Foundry — Staging Deployment & Acceptance Report

Date: 2026-08-27  
Report state: local pre-deployment acceptance complete; real deployment blocked by missing target/access.

## A. Environment

```text
Hosting/runtime: BLOCKED — no application hosting target or deployment manifest is available
Staging URL: NOT VERIFIED — STAGING_BASE_URL is unset
Node version: staging NOT VERIFIED; local gate ran on v24.19.0; checked-in CI targets Node 22
Region: NOT VERIFIED
Replica count: NOT VERIFIED
Persistent SQLite mount: NOT VERIFIED — PLATFORM_DB_PATH and volume configuration are unavailable
Firebase project: NOT VERIFIED — no staging binding; current local artifact uses CI project foundry-ci-12345
R2 bucket/prefix: NOT VERIFIED — no staging bucket/credentials/prefix
Proxy/CDN: NOT VERIFIED — topology and trusted-hop count are unavailable
```

No staging secrets or tokens were available or recorded. The current tree contains `apps/platform/firebase.json` for Firestore deployment mapping, but no application-hosting manifest.

## B. Baseline

| Command | Environment | Result | Evidence |
| --- | --- | --- | --- |
| `npm ci` | Local, Node 24.19.0 / npm 11.9.0 | PASS | Exit 0; 584 locked packages installed; lockfile SHA-256 `1ec6b8a1bdef5f518a1e18ed5604943b419c3eae6072868691c1e06a1867ce80` |
| `npm run check` | Local; checked-in CI public Firebase identifiers | PASS | Import/config mapping, TypeScript, 476/476 tests, production build, artifact verification |
| `npm run test:smoke` | Local compiled production smoke | PASS | health/ready 200; READY; PUBLISHED; catalog; Range 206; unpublish/restore/delete |
| `npm run test:e2e` | Local E2E mode, Chromium | PASS | 49/49 in 3.0 minutes |
| `npm audit --audit-level=high` | Current lockfile | PASS at requested threshold | Exit 0; high 0, critical 0, moderate 7, low 1 |

The exact Node-22 clean-install rerun is `BLOCKED` because this environment exposes only Node 24.19.0. The package declares `node >=22`, and the checked-in CI workflow selects Node 22, but neither fact substitutes for a freshly executed Node-22 run.

The generated artifact is not deployable to staging: `dist/client/deployment-profile.json` contains Firebase project `foundry-ci-12345` and auth domain `foundry-ci.firebaseapp.com`. No real staging `VITE_FIREBASE_*` binding was available for a rebuild.

## C. Firebase

```text
Deployment: BLOCKED — no Firebase project access or Firebase CLI
Rules: VERIFIED LOCALLY only — firebase.json maps the named database to firestore.rules/indexes; live deployment NOT VERIFIED
Authorized Domains: NOT VERIFIED
Token verification: NOT VERIFIED against staging
Two-user ownership: NOT VERIFIED against staging
Result: BLOCKED — missing project/admin access, rules-deployment authority, staging URL, and two distinct disposable ID tokens
```

The unexecuted live command is `npm run verify:staging:firebase`. Its current script requires an exact HTTPS `STAGING_BASE_URL`, matching `FIREBASE_PROJECT_ID`/`FIRESTORE_DATABASE_ID`, two distinct unexpired tokens, and the explicit destructive-scope confirmation. No token value is to be stored in this report.

## D. R2

```text
PUT: NOT VERIFIED
HEAD: NOT VERIFIED
GET: NOT VERIFIED
Range: NOT VERIFIED
CORS: NOT VERIFIED
List: NOT VERIFIED
Delete: NOT VERIFIED
Cleanup: NOT VERIFIED
CDN moderation gate: NOT VERIFIED against staging
Result: BLOCKED — staging-only bucket, credentials, exact origin, and CORS control are unavailable
```

The unexecuted live command is `npm run verify:staging:r2`. The current verifier uses an isolated `staging-verification/...` prefix and deletes its test object in normal and failure cleanup paths; no claim is made that cleanup happened because the command did not run.

## E. Deployment

```text
TLS: NOT VERIFIED
Proxy: NOT VERIFIED
Headers: VERIFIED LOCALLY only; external proxy/CDN preservation NOT VERIFIED
Persistent storage: NOT VERIFIED
Single replica: NOT VERIFIED
Restart/redeploy persistence: NOT VERIFIED
```

No HTTPS hostname, certificate, proxy/CDN route, trusted-hop count, deploy command, persistent-volume mount, replica control, or rollback API is available. HSTS was not enabled or claimed.

## F. Product staging smoke

```text
Auth: NOT VERIFIED against staging
Upload: NOT VERIFIED against staging
READY: NOT VERIFIED against staging
Publish: NOT VERIFIED against staging
Catalog: NOT VERIFIED against staging
CDN: NOT VERIFIED against staging
Player: NOT VERIFIED against staging
Editor handoff: NOT VERIFIED against staging
Lifecycle: NOT VERIFIED against staging
Moderation: NOT VERIFIED against staging
```

`npm run test:staging` was not executed because `STAGING_BASE_URL`, distinct developer/moderator ID tokens, the valid staging ZIP path, and deployed service are absent. Local smoke/E2E success is recorded only in sections B and J.

## G. Recovery

```text
SQLite backup: VERIFIED LOCALLY in RC evidence; NOT VERIFIED on staging
Restore rehearsal: VERIFIED LOCALLY in RC evidence; NOT VERIFIED on staging
Storage integrity: checker/tests VERIFIED LOCALLY; no live SQLite↔R2 inventory run
R2 backup: NOT SELECTED — public-release blocker
R2 restore rehearsal: NOT VERIFIED — public-release blocker
Application rollback: NOT VERIFIED — no deployment provider/artifact history
```

No restore was attempted over an active database. No R2 object was created, corrupted, deleted, or restored. `STORAGE_RECOVERY.md` correctly states that SQLite backup cannot recover lost game bytes and that the repository supplies no external R2 backup product.

## H. Operations

```text
Logs: structured/redaction behavior VERIFIED LOCALLY; deployment sink NOT VERIFIED
Alerts: BLOCKED — no alert provider/configuration
Disk monitoring: BLOCKED — no persistent volume/host metrics
First admin: BLOCKED — no staging UID/database/provisioning output
Moderation drill: BLOCKED — no real users or deployed service
```

No real log sample, secret-leak sample review, disk-capacity reading, alert trigger, operator UID, or audit record exists for staging.

## I. Failures Found

| ID | Severity | Staging failure | Fixed | Reverified |
| --- | --- | --- | --- | --- |
| None | — | No staging operation was attempted, so no runtime staging defect can be classified | — | — |

Missing infrastructure/credentials are acceptance blockers, not confirmed Foundry bugs, and therefore receive no `STG-*` defect ID.

## J. VERIFIED LOCALLY

- Clean locked install under the available Node 24.19.0 runtime.
- Import boundaries and static Firebase mapping.
- TypeScript and 476/476 unit/integration tests.
- Production client/server build with CI public Firebase identifiers.
- Artifact hygiene: 54 client files, zero public source maps/debug fixtures, backend outside the client root.
- Compiled lifecycle smoke with Range 206 and visibility/lifecycle checks.
- Chromium 49/49, including Editor→Platform local handoff, ownership, moderation, generic runtime, streaming, navigation, responsive and polish regressions.
- High/critical dependency threshold: 0 high, 0 critical; seven moderate and one low transitive advisories remain.
- Player Worker policy review and absence of a literal `eval(` call in `packages/player/src/worker.js`.

## K. VERIFIED AGAINST STAGING

- Nothing. There is no real staging URL or cloud operation result in this pass.

## L. NOT VERIFIED / BLOCKED

- Real staging-specific Firebase Web build and build/runtime/deployed-project identity equality.
- Firestore rules deployment, Authorized Domains, real sign-in/Admin token verification, and two-user ownership denial.
- R2 PUT/HEAD/GET/Range/CORS/list/delete/cleanup and real Platform/CDN moderation gate.
- Hosting/runtime, HTTPS certificate/redirects, proxy hops/spoofing/rate identity, header preservation, cookies, mixed content, and HSTS.
- Persistent SQLite mount, one replica, restart/redeploy persistence, real graceful shutdown, backup/rehearsal, disk/WAL capacity.
- Disposable Developer A, Developer B, Moderator/Admin; first-operator provisioning and full moderation drill.
- Full staging smoke, Editor→Platform→Publish→Player, Generic Web fault fixtures, and Foundry streaming fixture against cloud storage.
- Live DB↔R2 integrity inventory.
- External R2 byte-recovery selection and RPO/RTO/retention/cost documentation; R2 restore rehearsal.
- Application artifact rollback.
- Deployment log sink, secret sample review, operational alerts, on-call/deployment owner.
- Exact fresh Node-22 local gate in this execution environment.

## M. Remaining release blockers

- **P0:** none confirmed, because no staging runtime was available to test.
- **P1 acceptance blocker:** no hosting target, HTTPS URL, deployment authority, persistent volume, replica/proxy topology, or rollback control.
- **P1 acceptance blocker:** no real Firebase binding/rules authority/tokens and no staging-only R2 bucket/credentials/CORS control.
- **P1 acceptance blocker:** no real users/operator, staging smoke, Editor handoff, moderation drill, backup/integrity, or operations evidence.
- **Public-release blocker:** no external R2 byte-recovery mechanism or restore rehearsal.
- **Public-release blocker:** no application rollback rehearsal or operational logs/alerts/disk monitoring.
- **Non-blocking dependency follow-up:** seven moderate and one low advisories; no high/critical finding.

## N. Final verdict

**STAGING PARTIALLY VERIFIED**

This verdict means only that the local pre-deployment portion passed and the authoritative checklist is evidence-classified. It does **not** mean any check passed against staging: section K is empty. Deployment was not attempted and therefore did not fail; it is blocked before build/deploy by missing target, URL, credentials, persistent storage, and operator infrastructure.

`READY FOR CONTROLLED PUBLIC RELEASE` is not supportable. After scoped access is supplied, the exact next sequence is: real Firebase-bound build → artifact verification → Firestore/R2 verification → single-node persistent deployment → HTTPS/proxy/header acceptance → staging smoke/browser workflows → recovery/rollback/operations drills.
