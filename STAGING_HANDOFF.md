# Foundry staging deployment handoff

Updated: 2026-08-27 — infrastructure decision and deployment-preparation checkpoint

Status: `STAGING DEPLOYMENT READY — USER ACTION REQUIRED`

## Environment

- Workspace: `/workspace/scratch/4804d1baf603/work/Foundry`
- Git metadata: unavailable; do not attempt history recovery. A new private deployment repository is required.
- Local baseline from the preceding staging preflight: Node `v24.19.0`, npm `11.9.0`, 476/476 tests, 49/49 Chromium, production build/artifact/smoke and high-severity audit PASS.
- Current generated `apps/platform/dist` is bound to CI Firebase project `foundry-ci-12345` and must not be deployed.
- No Product QA, Product Polish, security audit, build, smoke, E2E, or dependency gate was repeated during this documentation-only preparation block.

## Staging URL

- Planned: `https://RENDER_SERVICE_NAME.onrender.com`, with a unique service name containing `staging`.
- Actual: `NOT CREATED / NOT VERIFIED`.

## Deployment target

- **Selected:** Render paid native-Node Web Service.
- **Runtime:** Node `24.19.0`; `npm start -w @foundry/platform` -> `node dist/server.cjs`.
- **Compute:** one Standard instance, 2 GB RAM.
- **Storage:** one 5 GB persistent disk mounted at `/var/data/foundry`.
- **SQLite:** `/var/data/foundry/platform.db`.
- **Health/readiness:** `/api/health` and Render health check `/api/ready`.
- **Proxy:** planned one Render load-balancer hop; initial `TRUST_PROXY_HOPS=1`, subject to real spoof/client-IP verification.
- **TLS:** Render managed certificate and HTTP-to-HTTPS redirect; HSTS remains false until verified.
- **Rollback:** Render retained-build rollback with the same disk; no schema downgrade.
- Full procedure: `STAGING_DEPLOYMENT_PLAN.md`.

## Target selected

- `YES` — Render was selected after comparing Render, Fly.io, and Railway against the current source-derived constraints.
- Selection basis: an attached Render disk is runtime-persistent, accessible by one service instance, and prevents horizontal scaling. This directly matches Foundry's intentional one-node SQLite topology without Docker or application vendor coupling.

## Infrastructure created

- `NO` — no Render service/project, persistent disk, Firebase staging project, R2 staging bucket, custom domain, or external backup destination was created.

## Credentials configured

- `NO` — no staging secret was requested in chat, written to the repository, or installed in a provider.
- Required secure destinations are documented: Render environment variables, Render `/etc/secrets/firebase-admin.json`, and a local secure operator environment for short-lived verifier tokens.

## Domain/TLS

- Initial model selected: Render-provided `onrender.com` hostname containing `staging`; custom DNS is optional after first acceptance.
- Planned `PLATFORM_PUBLIC_BASE_URL`: exact Render HTTPS origin.
- Planned `TRUST_PROXY_HOPS`: `1`; must be re-evaluated from real forwarded-header evidence.
- Planned `ENABLE_HSTS`: `false` for first deploy, then `true` only after certificate/redirect verification.
- State: `BLOCKED — RESOURCE NOT CREATED`.

## Firebase

- Required project shape is documented: dedicated staging project, Web app, Google sign-in, Authorized Domain, three disposable users, dedicated runtime service account, and the exact named Firestore database.
- Authoritative database ID: `ai-studio-foundryengine-2c0d9198-817d-437d-8b2b-d5a59c60420c`.
- Runtime credential mode selected: Render secret file `firebase-admin.json` with `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/firebase-admin.json` and `FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS=false`.
- Build/runtime identity equality and deployment-profile verification are documented.
- State: `BLOCKED — PROJECT/USERS/CREDENTIALS NOT CREATED`; rules not deployed and live verifier not run.

## R2

- Required shape is documented: separate private staging bucket, no public bucket URL, bucket-scoped Object Read & Write token, account endpoint, and exact-origin signed-PUT CORS.
- Foundry has no app-wide R2 prefix setting; staging isolation must be a dedicated bucket rather than a production prefix.
- `R2_DIRECT_DOWNLOADS=false` remains mandatory so public reads traverse the Platform moderation/CDN gate.
- State: `BLOCKED — BUCKET/CREDENTIALS/CORS NOT CREATED`; live verifier not run.

## Persistent SQLite

- Mount/path selected: `/var/data/foundry` -> `/var/data/foundry/platform.db`.
- Exactly one service instance is a deployment invariant; the selected disk structurally prevents horizontal scaling.
- Backups must use `db:backup`, run from the disk-backed service shell, then be transferred off-volume by SSH/SCP. Raw DB copy and disk-snapshot restore are not the recovery procedure.
- State: `BLOCKED — SERVICE/DISK NOT CREATED`; restart persistence and WAL backup/rehearsal not run.

## Deployment

- Build command selected: `npm ci && npm run verify:firebase-config && npm run build && npm run verify:artifact`.
- Start command selected: `npm start -w @foundry/platform`.
- Health check selected: `/api/ready`.
- Auto-deploy: off through acceptance and rollback rehearsal.
- No provider manifest or product-source change was added. Manual Render setup is intentional because Firebase Admin must be installed as a runtime secret file before the first successful deploy, and Render Blueprints do not declaratively prompt for secret-file contents.
- State: `NOT EXECUTED`.

## Completed

- Read all requested handoff, acceptance, checklist, polish, deployment, recovery, operations, and environment files completely.
- Re-derived Node/process, port, persistent path, Firebase, R2, proxy, health/readiness, shutdown, build-time, runtime, and verifier requirements from current source.
- Confirmed no application hosting target/manifest currently exists and no application-code deployment blocker is present.
- Compared three viable targets with current official provider documentation.
- Selected Render and documented architecture, resource creation, exact environment matrix, Firebase, R2, SQLite, TLS/proxy, build, deploy, acceptance, backup, rollback, and operator actions.
- Created `STAGING_DEPLOYMENT_PLAN.md`.
- Updated this handoff and synchronized `RELEASE_CHECKLIST.md` without converting any unexecuted staging item to PASS.

## Verified locally

Inherited evidence from the immediately preceding preflight, not re-executed in this preparation block:

- `npm ci`: PASS; 584 locked packages.
- `npm run check`: PASS; imports/config, TypeScript, 476/476 unit/integration, production build, artifact verification.
- `npm run test:smoke`: PASS.
- `npm run test:e2e`: PASS; 49/49 Chromium.
- `npm audit --audit-level=high`: PASS at requested threshold; high 0, critical 0, moderate 7, low 1.
- These used local/CI bindings and are not staging evidence.

## Verified against staging

- Nothing. Staging checks executed: `0`.

## Failed

- Local/source failures in this preparation block: none.
- Staging failures: none classifiable because deployment has not started.

## Blocked

- Private deployment repository/provider connection.
- Render project/service/region/disk and public URL.
- Firebase project/Web app/database/rules/Authorized Domain/users/runtime key.
- R2 private bucket/scoped credentials/CORS.
- Real deployment, TLS/proxy/header checks, persistent restart, operator provisioning, smoke/browser flows, backup/rehearsal, integrity, rollback, logs, and alerts.
- Public release additionally remains blocked on an external R2 byte-recovery mechanism/rehearsal and automated low-disk/backup-failure alerting.

## Credentials/infrastructure missing

- Hosting account access and connected private source repository.
- Firebase staging project access and authenticated Firebase CLI operator.
- Firebase Admin runtime secret file and short-lived user tokens.
- Cloudflare R2 account/bucket credentials.
- Render environment/disk access and operator notification destination.
- External SQLite backup destination and later R2 byte-backup destination.

## Files changed

- `STAGING_DEPLOYMENT_PLAN.md` — created.
- `STAGING_HANDOFF.md` — target-selection and exact checkpoint update.
- `RELEASE_CHECKLIST.md` — target plan synchronized; staging evidence remains blocked.
- No application source, Engine core, dependency, lockfile, build config, or provider manifest changed.

## Commands executed

- Required documentation reads and source/env inventory with `rg`/`sed`.
- Production validator, server lifecycle, security headers, Firebase/R2 provider and verifier, staging smoke, package scripts, rules mapping, and artifact verifier review.
- Git/provider-manifest inventory: `NO_GIT_METADATA`; no `render.yaml`, `fly.toml`, `railway.json`, or Dockerfile.
- Current official Render, Fly.io, Railway, and Cloudflare R2 documentation comparison.
- Documentation-only patches for the three staging preparation artifacts.
- No local release gate or live-provider verifier command executed in this block.

## Exact outputs/evidence

- Current source requires Node `>=22`, an absolute existing writable SQLite directory, exact Firebase build/runtime project match, private R2, explicit proxy hops, `JOB_MODE=async`, and production-safe disabled flags.
- Render documentation confirms an attached disk persists across restart/deploy, is accessible by one service instance, prevents multiple instances, and receives daily snapshots; database recovery still uses Foundry's SQLite tools.
- Render documentation confirms managed TLS/HTTP redirect, health probes, SIGTERM shutdown, build rollback, logs/metrics, and SSH/SCP.
- Cloudflare documentation confirms the private account endpoint, bucket-scoped R2 token, signed-PUT CORS schema, and that bucket durability alone does not recover deletion.

## Remaining blockers

- Execute the five operator actions in `STAGING_DEPLOYMENT_PLAN.md`.
- Do not deploy the current CI-bound `dist`.
- Do not claim `VERIFIED AGAINST STAGING` until commands run against the real HTTPS origin with real Firebase/R2 resources.

## Exact next action

Operator: publish this exact RC tree to a new private `staging-rc` Git branch, then create the dedicated Firebase staging project and private R2 staging bucket described in `STAGING_DEPLOYMENT_PLAN.md`. After their public identifiers and secrets are installed directly in Render, create the one-instance disk-backed service and trigger the real staging build/deploy.
