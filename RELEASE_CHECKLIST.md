# Foundry Release Candidate checklist

This is the authoritative gate for the first controlled staging deployment. A real-environment item becomes `PASS` only when its command or observation has evidence attached to the release record. `PASS — VERIFIED LOCALLY` is not staging evidence.

Acceptance update: 2026-08-31. Status vocabulary is `PASS`, `FAIL`, `BLOCKED`, or `NOT APPLICABLE`.

The previously selected cloud staging architecture remains one paid Render native-Node Web Service with private Firebase/R2 resources. The repository now also contains a portable `single-host` profile for one Linux server with systemd/Caddy, local production auth/storage, and persistent `/var/lib/foundry`; this does not turn any unexecuted cloud staging item into a PASS.

## Single-host adaptation evidence

- **PASS — VERIFIED LOCALLY** — Explicit `cloud` and `single-host` production profiles fail closed and emit distinct schema-2 build identities; cloud Firebase/R2 requirements remain covered.
- **PASS — VERIFIED LOCALLY** — Single-host local auth uses scrypt password hashes, hashed opaque sessions, Secure/HttpOnly/SameSite=Strict `__Host-` cookies, exact-Origin/CSRF enforcement, durable rate limits, and the existing UID/role/ownership model.
- **PASS — VERIFIED LOCALLY** — Hardened local storage reuses the existing upload/READY/publish/CDN path and covers atomic writes, traversal/symlink denial, metadata/ETag, full/HEAD/Range/list/delete, and moderation/publication denial.
- **PASS — VERIFIED LOCALLY** — Production-like Single-Host Chromium 3/3 PASS: auth/logout/login, two-user ownership and non-owner 403, upload/READY/publish, CDN Range/Player/Library/rating/follow, Editor handoff/refresh, moderator provisioning, audit, quarantine/CDN denial, and restore.
- **PASS — VERIFIED LOCALLY** — Restart/recovery acceptance PASS: persisted health/readiness 200, CDN Range 206, graceful shutdown, storage integrity with 0 missing/invalid and 0 orphan candidates, coordinated DB+objects backup, and isolated restore/boot/CDN rehearsal.
- **PASS — VERIFIED LOCALLY** — Atomic deployment regression 1/1 PASS: initial deployment, failed-readiness automatic rollback, successful update, pre-switch backups, and guarded manual application rollback while persistent DB bytes remain unchanged.
- **PASS — VERIFIED LOCALLY FOR RC7** — Single-host release generation emits one prebuilt, hash-manifested ZIP. The target path rejects source-only/tampered archives, installs target-native production dependencies with `npm ci --omit=dev`, reruns manifest and artifact verification, executes compiled smoke, applies an immutable `0750`/`0640` root/service-group permission contract, performs a real service-user access probe before activation, and retains atomic readiness/automatic/manual rollback without invoking Vite or inheriting `NODE_OPTIONS`.
- **PASS — VERIFIED LOCALLY AFTER RC1 FAILURE FIXES** — Final current-tree gates: cloud `npm run check` PASS with 510/510 unit/integration tests plus build/artifact; compiled cloud and installer-equivalent single-host smoke PASS; cloud/dev Chromium 49/49 PASS; single-host build/artifact PASS; single-host Chromium 3/3 plus restart/integrity/backup/restore PASS; dependency gate high 0 and critical 0.
- **FAIL — REAL SERVER RC1 INSTALL ATTEMPT** — The exact SHA-verified RC1 ran through real systemd on a clean Google Compute Engine `e2-micro` (Debian 13, Node 22.23.2, npm 10.9.8, approximately 964 MiB RAM, 4 GiB swap, 30 GB persistent disk). Installation correctly stopped at `npm test`: 4 failed / 49 passed files, 4 failed / 327 passed tests, and 18 unhandled errors. It was not an OOM.
- **PASS — LOCAL REGRESSION FOR REAL FAILURE CAUSES** — Two named crypto-heavy tests now have narrow 15-second budgets with unchanged scrypt/rate-limit/CLI assertions; the deployment fixture no longer needs external `zip`; implicated test teardowns stop job queues before provider close; all 53 Platform files pass with no unhandled errors. The subsequent single-host compiled-smoke blocker was reproduced and fixed in the test harness without changing production auth/CSRF.
- **FAIL — REAL SERVER RC5 INSTALL ATTEMPT** — Platform passed 53/53 and 331/331 with zero errors, but the 2 GiB build-only heap moved Vite into pathological paging on the same `e2-micro`: approximately 77 minutes at `transforming...`, approximately 5 minutes 47 seconds CPU, `STAT Dl`, 613,464 KiB Vite RSS, approximately 1.6–1.7 GiB swap, and 78–99% I/O wait. The operator stopped the unit; no current or previous release exists. RC6 therefore moves compilation off the runtime host instead of increasing heap, swap, or VM requirements.
- **FAIL — REAL SERVER RC6 INSTALL ATTEMPT** — The prebuilt path completed manifest verification, target-native installation of 479 production packages, artifact verification, and compiled smoke with a 700.5 MiB memory peak and 217.1 MiB swap peak, but final `root:foundry` ownership preserved the extraction root's private `0700` mode. systemd failed before Node at `status=200/CHDIR`. RC7 corrects and verifies final permissions before switching `current`.
- **FAIL — REAL SERVER RC7 INSTALL ATTEMPT** — The RC7 final permission contract and service-user probe passed on the real VM, so the RC6 `status=200/CHDIR` defect is corrected. Installation then found the dangling RC6 link `/opt/foundry/current -> /opt/foundry/releases/20260830T120119Z-531deea30571`: RC6's failed initial readiness path had left `current` switched while its EXIT trap deleted that candidate. RC8 must recover this exact Foundry-owned stale initial state without manual unlinking, while unsafe/non-symlink/out-of-tree states still fail closed.
- **PASS — REAL SERVER RC8 DEPLOYMENT/RUNTIME** — RC8 automatically repaired the exact RC6 dangling state and completed the real prebuilt install with no Vite process, approximately 710 MiB memory and 339 MiB swap peaks. Artifact/smoke/final permissions/systemd activation passed; public HTTPS readiness, HSTS, restart/reboot survival, coordinated backup verification, storage integrity, and local-auth/CSRF acceptance passed. RC9 is limited to three subsequently reproduced operator-tooling gaps: cwd-independent doctor, fresh-backup rehearsal semantics, and automatic Caddy log-directory bootstrap, plus the protected routine GitHub deployment path.
- **PASS — VERIFIED LOCALLY FOR RC9** — Doctor runs from arbitrary caller cwd under the active platform working directory; a fresh backup rehearses with published asset `NOT_APPLICABLE`, while a populated backup retains real asset delivery; systemd owns a private Caddy log directory; and protected CI builds/rehearses the prebuilt artifact before a pinned-host-key, fixed-path, clean-environment atomic update plus local/public readiness. RC7 permissions and RC8 deployment-state recovery remain covered.
- **PASS — DOCUMENTED LIMITATION** — Single-host v1 has operator-driven password reset rather than self-service email recovery; same-disk backups are explicitly not claimed as disaster recovery.

## Infrastructure

- **BLOCKED** — Render target and HTTPS URL model are selected, but no service/hostname/certificate exists and `STAGING_BASE_URL` remains unset.
- **BLOCKED** — Single-node topology is specified and a Render disk will prevent horizontal scaling, but the service/disk/instance count has not been created or observed.
- **BLOCKED** — `/var/data/foundry/platform.db` is the selected persistent path, but no mounted disk exists and restart/redeploy persistence has not been tested.
- **BLOCKED** — Dedicated private staging R2 bucket and bucket-scoped credentials are specified but not created; `npm run verify:staging:r2` has not run.
- **BLOCKED** — Exact-origin signed-PUT CORS policy is documented but not applied or probed.
- **BLOCKED** — Dedicated Firebase Web project, Google sign-in, Authorized Domain, named Firestore database, and disposable users are specified but not created.
- **BLOCKED** — Checked-in Firestore mapping is locally valid, but rules have not been deployed to a real staging project and two-user verification has not run.
- **BLOCKED** — SQLite off-volume backup destination and R2 external byte-recovery destination are not created.

## Configuration and security

- **PASS — VERIFIED LOCALLY** — Current source/env review produced an exact build/runtime/secret/operator matrix without adding server secrets to `VITE_*` or repository files.
- **BLOCKED** — No real Render environment or `/etc/secrets/firebase-admin.json` exists; production fail-closed startup has not run in staging.
- **BLOCKED** — Planned Render topology uses `TRUST_PROXY_HOPS=1`, but real client-IP/protocol/spoof/rate-limit evidence is absent.
- **BLOCKED** — `R2_DIRECT_DOWNLOADS=false` is required by source and plan, but the real Platform/CDN moderation gate is unobserved.
- **BLOCKED** — Render managed TLS is selected, but no certificate/redirect exists; `ENABLE_HSTS` must remain false until real HTTPS verification.
- **BLOCKED** — No staging-cloud artifact has been built with a real Firebase project; the current local `dist` is intentionally the final single-host acceptance artifact. A cloud staging build must use matching real `VITE_FIREBASE_PROJECT_ID` and `FIREBASE_PROJECT_ID`.
- **PASS — VERIFIED LOCALLY** — `npm audit --audit-level=high` exited 0: high 0, critical 0, moderate 7, low 1; no force fix applied.
- **BLOCKED** — Operator provisioning command/path is documented, but no real Firebase UID, staging DB, or provisioning JSON exists.
- **BLOCKED** — Local authorization coverage passes, but Developer A/B and Moderator/Admin have not been exercised against staging.
- **PASS — VERIFIED LOCALLY** — Player Worker policy remains intact; the current 510-test unit/integration gate passed and no literal `eval(` call exists in `packages/player/src/worker.js`.

## Build and automated validation

- **PASS — REAL NODE-22 RC8 PLATFORM/RUNTIME** — RC8 completed the real prebuilt deployment and systemd activation on the Node 22 `e2-micro`; public readiness/HSTS, restart/reboot, backup verification, storage integrity, and local-auth/CSRF acceptance passed. RC9 does not alter the byte-identical compiled client/server runtime.
- **PASS — VERIFIED LOCALLY** — `npm run check` exited 0 on the RC9 tree: imports/config, TypeScript, Platform 332/332 with zero errors, Contracts 2/2, Player 177/177, total 511/511, cloud production build, and artifact verification PASS.
- **PASS — VERIFIED LOCALLY** — `npm run test:smoke` exited 0 with health/ready, READY/PUBLISHED, Range 206, lifecycle, and shutdown coverage.
- **BLOCKED — CURRENT CONTAINER CHROMIUM / PRESERVED BYTE IDENTITY** — The current cached Playwright revision exits `SIGSEGV` before a browser context, and the permitted network cannot replace it; no current browser assertion is claimed as PASS. RC8's 49/49 and single-host 3/3 evidence applies to byte-identical RC9 client/server artifacts, and the new clean-runner production workflow requires both browser gates before deployment with no `continue-on-error`.
- **PASS — VERIFIED LOCALLY** — Cloud artifact verification reported 54 client files; final single-host artifact verification reported 51. Both place the backend only at `dist/server.cjs`, with zero public source maps and zero debug fixtures.
- **BLOCKED** — Staging-specific production build, real `deployment-profile.json` identity check, and Render build identifier do not exist.

## Staging acceptance

- **BLOCKED** — Firebase rules deployment, Authorized Domain, real sign-in, Admin token verification, and two-user ownership verifier not executed.
- **BLOCKED** — R2 signed PUT/CORS/HEAD/full GET/Range/list/delete/cleanup verifier not executed.
- **BLOCKED** — TLS, proxy hop, security-header preservation, spoofed-forwarding, and real-proxy rate-limit semantics not executed.
- **BLOCKED** — Persistent SQLite create/restart/redeploy test not executed.
- **BLOCKED** — First MODERATOR/ADMIN provisioning and normal-user denial not executed.
- **BLOCKED** — `npm run test:staging` has no real URL, users, or R2 path and was not executed.
- **BLOCKED** — Editor -> Platform -> READY -> Publish -> Catalog -> Player has not run against staging.
- **BLOCKED** — Real report -> hide/quarantine -> CDN denial -> restore moderation drill not executed.
- **BLOCKED** — Generic Web and Foundry runtime fixtures have not run against the deployed origin; only local Chromium evidence exists.
- **BLOCKED** — 375/768/1440 deployment-only browser smoke with console/page/network capture not executed.

## Recovery and rollback

- **BLOCKED** — No staging DB/off-volume destination; live-WAL `db:backup` and SCP transfer not executed.
- **BLOCKED** — No staging backup exists; isolated `db:rehearse` not executed.
- **BLOCKED** — No live SQLite/R2 pair; `storage:check` not executed against staging.
- **BLOCKED — PUBLIC RELEASE** — External R2 byte retention/replication/backup mechanism, RPO/RTO/retention/cost, and credential separation are not selected.
- **BLOCKED — PUBLIC RELEASE** — Isolated R2 object deletion/restore/CDN recovery rehearsal not executed.
- **BLOCKED** — Render rollback method is documented, but current/next deploy IDs and harmless rollback rehearsal do not exist.
- **BLOCKED** — Local release activation/archive/restore coverage passes, but no real staging release rollback was exercised.
- **BLOCKED** — Local compiled smoke covers graceful shutdown; no disposable live job plus Render SIGTERM/log drill was executed.

## Monitoring and operator readiness

- **BLOCKED** — Render logs/metrics are selected but no service/log sample exists.
- **BLOCKED** — Local redaction tests pass, but no real startup/request/job/moderation/shutdown log sample has been reviewed.
- **BLOCKED** — Render email/Slack failure notification path is selected but not configured/tested.
- **BLOCKED — PUBLIC RELEASE** — No automated disk-low, repeated-5xx, stuck-job, or backup-failure alert exists.
- **BLOCKED** — No named staging operator/on-call owner or real moderation/incident drill exists.
- **PASS — DEPLOYMENT PREPARATION** — `STAGING_DEPLOYMENT_PLAN.md`, `DEPLOYMENT_RUNBOOK.md`, `STORAGE_RECOVERY.md`, `PRODUCTION_OPERATIONS.md`, and this checklist provide a non-conflicting operator sequence.

## Release decision

- **PASS — LOCAL RC CONDITION ONLY:** `READY FOR STAGING` remains supported by 510/510, production smoke, cloud/dev 49/49 E2E, single-host 3/3 plus recovery acceptance, both build profiles/artifacts, and high-severity dependency evidence.
- **PASS — CONTROLLED RC9 UPDATE CONDITION:** The RC9 prebuilt archive, exact archive rehearsal, 511/511 tests, artifact/smoke/recovery/audit gates, and byte-identical RC8 runtime evidence support the short RC8-to-RC9 operational-tool update. The first clean GitHub runner must still execute mandatory 49/49 and 3/3 Chromium before automated deployment is enabled; only the real VM update can close real-server RC9 acceptance.
- **PASS — DEPLOYMENT PREPARATION ONLY:** target selected and operator procedure complete: `STAGING DEPLOYMENT READY — USER ACTION REQUIRED`.
- **BLOCKED:** `STAGING PASSED — NOT READY FOR PUBLIC RELEASE`; zero checks have run against a real staging URL.
- **BLOCKED:** `READY FOR CONTROLLED PUBLIC RELEASE`; real Firebase/R2/deployment acceptance, persistent recovery, external R2 byte recovery, rollback, logs, and alerts remain absent.
