# Foundry discovery and usability changelog

## Discovery-first product slice

- Added public Play Now discovery and persistent Next Game actions.
- Added catalog, trending and deterministic recommendation paths.
- Added server-backed Library / Keep, Continue Playing, ratings and developer follows.
- Added discovery/session telemetry and developer funnel analytics.
- Removed the forced mock advertisement so the current promise remains instant play.
- Added tab-scoped discovery history so Play Something Now and Next Game do not repeat visited titles until the catalog cycle is exhausted.
- Made skips and runtime failures negative ranking signals instead of accidentally boosting Trending.
- Added URL-persisted catalog search, tag filters and stable Featured/Newest/Rating/Popularity/Name sorting.
- Added direct Saved Game removal, Continue Playing dismissal and creator unfollow controls inside Library.
- Kept dismissed play history out of the UI without deleting developer analytics; a later launch restores the entry automatically.

## Upload and publishing hardening

- Completed the real ZIP validation → extraction → publish pipeline.
- Added public delivery for extracted runtime assets while keeping uploaded ZIPs private.
- Persisted manifest version/runtime/entry metadata and the published project state.
- Added idempotent extracted-prefix cleanup for local storage and paginated R2 listings.
- Added package-size, extracted-size, file-count, individual-file, traversal, null-byte and case-collision defenses.
- Removed UI and backend placeholders that claimed an external storage connection or fake CDN URL.
- Preserved the exact validated streaming-manifest filename through upload, SQLite metadata, publishing, catalog delivery and Player startup.
- Added actual chunk byte-length and SHA-256 verification before upload, on the server, during extraction and in the Player fetcher.
- Rejected remote/traversing chunk URLs, malformed hashes, incomplete dependency metadata and ambiguous dual-manifest packages.
- Bound publishing to the SHA-256 of the ZIP that actually passed validation, closing the signed-upload replacement window.
- Added pre-decompression ZIP-bomb checks, portable path rules, metadata bounds, image-signature checks and isolated temporary directories.
- Persisted actionable publish failures, publication time, package permissions, thumbnails, tags and controls.
- Added a seven-day completed-upload retention window and explicit expired-source state; rejected/expired versions no longer consume the developer version quota forever.
- Enforced one active release per game and added unpublish, retained-runtime rollback, inactive-version deletion and whole-project deletion.
- Moved destructive object cleanup into idempotent durable jobs and gates `DELETING` targets before cleanup begins.
- Added upload byte progress, cancellation, same-session retry and off-main-thread validation in a Web Worker.

## Player runtime and saves

- Replaced timing-based Foundry launch messages with a typed, origin/source-verified sandbox handshake and launch IDs.
- Added real ready/error reporting, startup and heartbeat timeouts, retry actions and race-safe worker cleanup.
- Added a published ES-module contract for Foundry games, including async `start()` support without Engine changes.
- Persisted validated capabilities through publication and translated them into least-privilege iframe/worker policies.
- Added Foundry progress autosave and recovery in IndexedDB, isolated by viewer/game/published version, with ordered writes, a 5 MiB limit, visible save status and **Start Fresh** recovery.
- Kept generic web games opaque-origin; unsupported generic `storage` declarations now fail validation instead of silently weakening the sandbox.

## Catalog and delivery

- Added real package thumbnails across Discovery, Details and Library, plus searchable tags and published control hints.
- Added immutable CDN byte ranges, HEAD, ETag/date revalidation, `If-Range`, correct 416 responses and streaming-friendly CORS.
- Added document-level CSP sandboxing for direct HTML/SVG asset navigation, security headers and same-origin-by-default account/API CORS.
- Standardized malformed JSON, oversized request and missing API-route error envelopes.
- Moved catalog search, tags and stable sort modes into bounded SQL queries with opaque cursors and ETag revalidation.
- Added optional publication-gated signed R2 redirects for non-document assets while keeping executable documents on the CSP proxy.

## Operations

- Added database-backed rate-limit buckets, unique active jobs, worker leases, crash recovery and lease heartbeats.
- Added schema version tracking, request IDs, JSON request logs, liveness/readiness probes and production dependency fail-fast.
- Added a full PostgreSQL target schema, a deployment runbook and a reusable compiled-server HTTP smoke.

## Streaming runtime reliability

- Fixed relative, `./` and absolute runtime asset URLs resolving to the same streamed chunk.
- Released decoder-concurrency slots on memory-acquisition failures and made handle release idempotent for queue accounting.
- Disposed the streaming bridge and controller safely when the worker is reinitialized or streaming setup fails.
- Stopped probing every Foundry game for a manifest; only catalog entries with validated streaming metadata initialize streaming.

## Developer convenience

- Added `npm run dev:local`: development-only auth, SQLite, filesystem storage and inline jobs with no Firebase/R2 credentials.
- Added root aliases for local reset, Platform tests and the full non-browser check.
- Made startup, cleanup and Playwright preparation scripts work on Windows, macOS and Linux.
- Added a ready-to-upload sample at `apps/platform/e2e/fixtures/generic-valid-game.zip`.
- Added clear loading, empty, retry, validation, publish and action-feedback states throughout the dashboard and player UI.
- Kept the upload dialog open after transfer and made publishing an explicit, truthful next step.
- Added real drag-and-drop package selection and surfaced the detected streaming mode before and after upload.
- Scheduled stale-upload cleanup automatically and added graceful server/job/database shutdown.
- Made quota, upload-retention, cleanup cadence and trusted integration origins configurable from the environment.
- Added owner-only editing for project title and description without requiring a replacement package.
- Reused a newly created project and upload session when a network transfer is retried instead of generating duplicate drafts/versions.
- Made completed-upload finalization idempotent and committed READY metadata/session state atomically.

## Performance

- Lazy-loaded the editor, developer dashboard, player routes, GamePlayer and Firebase SDK.
- Reduced the main entry chunk from 2,588.04 kB to 377.25 kB (about 85.4%); package validation is isolated in a 114.84 kB Worker chunk.

## Verified

- 393 unit/integration tests pass across Contracts, Player and Platform.
- Import verification, Platform type checking, production web build and server bundle pass.
- Credential-free HTTP publish/delivery paths pass for both generic Web and Foundry streaming packages, including range, CSP/CORS, capabilities and malformed-request handling.
- All 156 Engine files are byte-for-byte unchanged from the supplied archive.

See `VALIDATION_REPORT.md` for the exact browser E2E limitation and remaining build warnings.
