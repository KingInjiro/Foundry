# Validation report

Validated on 2026-08-24 with Node.js 24.19.0 and npm 11.9.0.

## Confirmed

- Dependency installation: PASS. A reproducible root `package-lock.json` is included.
- Relative and cross-workspace imports: PASS.
- Platform TypeScript/JSX type check (`tsc --noEmit`): PASS.
- Contracts tests: PASS — 2 tests in 1 file.
- Player tests: PASS — 174 tests in 25 files.
- Platform tests: PASS — 217 tests in 30 files.
- Total unit/integration coverage run: PASS — 393 tests in 56 files (2 Contracts + 174 Player + 217 Platform).
- Complete `npm run check`: PASS — import verification, type check, all tests and both builds completed in one run.
- Production client build: PASS — 2,610 modules transformed, including a dedicated package-validation Worker chunk.
- Production server bundle: PASS — 188.9 kB (`dist/server.cjs`).
- Compiled-server HTTP smoke: PASS — a generic Web package completed health/readiness → create project → upload ZIP → server validation (`READY`) → publish → server catalog search → byte range 206 → unpublish → public 404 → rollback → public restore → queued project deletion → owner 404. The smoke uses isolated SQLite/filesystem providers and removes its temporary data.
- Streaming publication path: PASS — the selected manifest filename survives validation, persistence, publication and catalog delivery; non-streaming games do not trigger speculative manifest requests.
- Streaming integrity: PASS — declared size and SHA-256 are checked during browser/server validation, again during extraction, and in the Player before a chunk enters memory or persistent cache.
- Validated-ZIP immutability: PASS — replacing the package after validation is rejected before extraction by SHA-256/size binding.
- ZIP-bomb preflight: PASS — declared oversized output is rejected before entry decompression.
- Foundry progress storage: PASS — IndexedDB round-trip, viewer/version isolation, ordered concurrent writes, byte limits, removal and unavailable-storage fallback are covered.
- Discovery-cycle behavior: PASS — tab history de-duplication/bounds, multi-game API exclusion, catalog-exhaustion reset, blocked-session-storage fallback and immediate-repeat prevention are covered.
- Catalog and Library controls: PASS — combined query/tag filtering, every sort mode, partial Library loading, direct removal endpoints, non-destructive Continue Playing dismissal and replay restoration are covered.
- Developer iteration: PASS — bounded owner metadata updates, upload-session reuse after transfer failure, idempotent completion and atomic READY/session finalization are covered.
- Release lifecycle: PASS — the database enforces one active release; new activation archives the previous release; unpublish gates the catalog and CDN; rollback verifies retained runtime availability; inactive version and whole-project deletion use idempotent prefix cleanup jobs.
- Catalog scalability: PASS — SQL-backed search across title/description/developer/tags, exact tag filtering, stable sorting, bounded opaque cursors, cursor/filter binding, popular-tag aggregation and ETag revalidation are covered.
- Upload responsiveness: PASS — package validation is emitted as a Web Worker bundle; XHR byte progress, AbortSignal cancellation and same-session retry are covered.
- Operational foundation: PASS — database-backed fixed-window limits, unique active jobs, atomic claims, worker leases/recovery/heartbeats, request IDs, JSON logs, liveness/readiness and dependency fail-fast are covered locally.
- R2 delivery seam: PASS with mocks — non-document assets can receive gated short-lived signed redirects, executable documents remain on the CSP proxy, archived versions cannot mint a URL, and prefix deletion is batched.
- Engine package comparison against the supplied archive: PASS — 156 original/current files, zero missing, extra or changed files by per-file SHA-256 comparison.
- Game ZIP fixture integrity: PASS.

## Loading performance

The editor, dashboard, player shell, game player and Firebase SDK are loaded on demand. The main entry chunk is 377.25 kB uncompressed / 122.12 kB gzip. Before route splitting it was 2,588.04 kB, so the entry chunk remains about 85.4% smaller. Browser ZIP validation is isolated in a 114.84 kB Worker chunk.

The editor (1,880.62 kB) and Engine worker (1,177.32 kB) remain large, but they are no longer part of the initial landing-page route.

## Browser E2E status

Playwright discovers 11 Chromium tests in 7 files. Their application assertions were not executed here because the expected Chromium binary is not installed in this environment. This is intentionally reported as **not run**, not as a product pass.

Run on a machine with browser downloads available:

```bash
npx playwright install chromium
npm run test:e2e
```

## Remaining build warnings

- Vite reports `eval` in the Player worker's editor-console compatibility path. The channel is restricted to the exact trusted parent window/origin, but removing it requires a coordinated editor protocol change and was intentionally excluded with the locked Engine.
- Vite warns about the lazy editor and worker chunks exceeding 500 kB. They do not block the build, but further editor-level splitting remains worthwhile.
- R2/Firebase and the PostgreSQL target schema are covered by local interfaces, mocks or static contract review; live Cloudflare/Firebase credentials and a runtime PostgreSQL provider were not available for external acceptance tests.
