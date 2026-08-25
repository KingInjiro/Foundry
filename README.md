# Foundry

Foundry is a modular npm-workspaces monorepo.

Prerequisite: Node.js 22 or newer.

## Ownership
- `packages/engine` — game engine runtime and engine-owned editor integration.
- `packages/player` — browser sandbox/worker, streaming, cache, and playback runtime.
- `packages/contracts` — stable cross-package contracts only.
- `apps/platform` — the user-facing web platform, backend, developer workflow, catalog, and E2E acceptance tests.

## Dependency direction
`@foundry/platform` -> `@foundry/player` -> `@foundry/engine`

`@foundry/player` and `@foundry/platform` may both depend on `@foundry/contracts`.
The Engine must not depend on Player or Platform.

## Quick start

From the repository root, start the credential-free Platform workflow with development-only auth, SQLite, filesystem storage and inline publishing:

```bash
npm ci
npm run dev:local
```

Then open `http://localhost:3000`. To try the complete flow immediately, upload `apps/platform/e2e/fixtures/generic-valid-game.zip`; use `apps/platform/e2e/fixtures/streaming-game.zip` to exercise verified Foundry chunk streaming. Open **Manage & Publish**, publish the ready version, and select **Public Page**.

The current Platform path includes typed sandbox launch/error handshakes, capability-aware isolation, local Foundry progress recovery, non-repeating discovery cycles, URL-persisted catalog filters, manageable Library history, real catalog artwork/tags/controls, editable project metadata, retry-safe validated-package publishing, range-capable game delivery and scheduled upload cleanup. These improvements live in Platform/Player; `packages/engine` remains unchanged.

Stop the server before deleting local data:

```bash
npm run local:reset
```

See `apps/platform/README.md` for connected Firebase/R2 development, package requirements, and browser-test setup.

Build the web application:

```bash
npm run build
```

Run unit/integration tests:

```bash
npm test
```

Run the complete non-browser verification set:

```bash
npm run check
```

Run browser E2E tests:

```bash
npm run test:e2e
```
