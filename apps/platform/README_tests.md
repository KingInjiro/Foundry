# Platform testing

## Unit and integration tests

Run all workspaces from the monorepo root:

```bash
npm test
```

Run only Platform tests:

```bash
npm run test -w @foundry/platform
```

The Platform suite covers database operations, authentication and authorization, quotas, DB-backed rate limiting, leased job recovery, upload cleanup, ZIP/manifest security, extraction, the real publish pipeline, rollback/unpublish/deletion, CDN and gated R2 delivery, non-repeating discovery, server catalog search/cursors/cache revalidation, Library history controls, streaming validation, idempotent completion, upload progress/cancellation and client retry states.

After `npm run build`, run the compiled-backend HTTP acceptance smoke without browser binaries:

```bash
npm run test:smoke -w @foundry/platform
```

## Browser E2E

Install Chromium once, then run the E2E suite:

```bash
npx playwright install chromium
npm run test:e2e -w @foundry/platform
```

E2E uses a dedicated `.e2e/` SQLite database and filesystem storage, one worker, and an explicit test-only reset endpoint. The cross-platform preparation script removes only `.e2e/`, `test-results/`, and `playwright-report/` inside the Platform workspace.
