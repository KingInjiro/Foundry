# Foundry Platform

The Platform workspace owns the player-facing discovery experience, developer workflow, backend APIs, metadata database, package validation, publishing jobs, and public game delivery. It depends on `@foundry/player`; it must not import Engine internals directly.

## Fastest local workflow

From the monorepo root:

```bash
npm ci
npm run dev:local
```

Open <http://localhost:3000>. Local mode binds to the current computer only and provides an explicit development-only user, SQLite database, filesystem storage, inline publishing jobs, and the complete ZIP → validate → publish → play flow without Firebase or R2 credentials.

For a ready-made smoke test, upload `apps/platform/e2e/fixtures/generic-valid-game.zip`. To exercise verified chunk streaming, use `apps/platform/e2e/fixtures/streaming-game.zip`. After validation, select **Upload Version**, then **Manage & Publish**, **Publish**, and **Public Page**.

After editing the source files under `apps/platform/e2e/fixtures/streaming-game/`, regenerate its ZIP from the monorepo root with `npm run fixture:streaming`.

Local data is stored under `apps/platform/.local/` and is ignored by Git. Stop the server before resetting it:

```bash
npm run local:reset
```

`dev:local` cannot activate in production, and it does not expose the E2E database-reset route.

## Connected development

For a connected non-production environment, copy `.env.example` to `.env`, fill every R2 value, and configure Firebase Admin default credentials. Production builds use the explicit `VITE_FIREBASE_*` values rather than the bundled development JSON; production startup verifies that the built Firebase project matches Firebase Admin.

```bash
npm run dev
```

`firebase-applet-config.json` is development-only browser configuration. The server loads `.env` through `dotenv`; secrets must never be added to browser configuration or committed.

Account and metadata APIs are same-origin unless a trusted integration origin is listed in `CORS_ALLOWED_ORIGINS`. Public extracted assets keep their separate wildcard CORS policy because opaque game frames and streaming fetchers need it.

## Game packages

Upload a ZIP whose root contains `manifest.json` and the declared entry file. See [GAME_PACKAGE_SPEC.md](GAME_PACKAGE_SPEC.md) for fields and limits. The dashboard validates packages in a Web Worker first, including streaming chunk length and SHA-256 when present, so large ZIP inspection does not block the interface. Uploads expose byte progress, can be cancelled, and reuse the same signed upload session on retry. The server repeats validation before a version becomes `READY`; publishing is a separate explicit action and extraction verifies streaming integrity again.

Published package metadata drives the actual catalog: supported thumbnails appear in Discovery, Details and Library; tags participate in search; and control hints appear on the detail page. Declared runtime capabilities are persisted and translated into iframe/worker policy. Foundry packages that request `storage` receive local autosave/recovery with a visible status and a fresh-start escape hatch; generic web storage remains disabled to keep its iframe opaque-origin.

Discovery remembers visited titles for the current browser tab, so **Play Something Now** and **Next Game** traverse the catalog before starting a new cycle. Catalog query, selected tag and sort order are URL-backed; filtering, sorting and bounded cursor pagination run on the server, and public pages support ETag revalidation. Signed-in players can remove saved games, hide individual Continue Playing entries, and unfollow creators directly in Library; hiding history does not delete telemetry and the title reappears after a new launch.

The server binds publication to the validated ZIP hash, enforces one active release per game, serves only published extracted assets, supports byte ranges and conditional delivery, and applies a CSP sandbox to game documents even on direct navigation. Developers can unpublish, restore an archived runtime, delete an inactive version, or delete a whole project. Destructive cleanup is queued and idempotent; `DELETING` removes access before storage cleanup begins. Production asset responses revalidate through the SQLite moderation gate (`public, no-cache`); direct signed R2 downloads are rejected in production because an issued URL cannot be revoked immediately. Completed source ZIPs are retained for seven days by default so READY or failed versions can be published/retried; after cleanup an unpublished version is explicitly marked expired.

External-storage publishing is intentionally not exposed in the dashboard until its server-side validation and persistence flow exists. The UI does not claim that a URL was connected or published when no backend operation occurred.

Developers can edit a project's public title and description from its management page. A failed package transfer can reuse its project and upload session, and repeating completion after a lost response is safe; validated version metadata and completed-session state are committed together.

Operational endpoints separate liveness (`/api/health`) from dependency readiness (`/api/ready`). Responses carry `X-Request-Id`, server request/job logs are JSON with credential redaction, rate-limit counters are database-backed, and durable job claims use recoverable worker leases. `ADMIN`/`MODERATOR` users have a protected report queue and audited quarantine/hide/restore workflow at `/moderation`; the first operator is created only through the administrative CLI. See [PRODUCTION_OPERATIONS.md](PRODUCTION_OPERATIONS.md), [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md), and [STORAGE_RECOVERY.md](STORAGE_RECOVERY.md).

## Verification

From the monorepo root:

```bash
npm run verify
npm test
npm run build
```

Browser tests need Chromium once per machine:

```bash
npx playwright install chromium
npm run test:e2e
```

All scripts use Node-based cleanup and startup helpers, so they work in PowerShell/CMD as well as Linux and macOS shells.
