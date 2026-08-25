# Foundry package boundaries

## `@foundry/engine`
Owns the game runtime: rendering, physics, ECS/world, assets, audio, simulation and engine-side editor integration. It must not import Platform or Player.

## `@foundry/player`
Owns browser playback: iframe sandbox, Web Worker, streaming runtime, IndexedDB persistent cache, memory budget and the Engine bridge. It depends on Engine and Contracts.

## `@foundry/contracts`
Owns only stable data/protocol definitions shared across package boundaries. It contains no database, UI, network or Engine implementation.

## `@foundry/platform`
Owns the website/application shell, authentication, catalog, developer workflow, publishing/storage/backend, player-facing UI and E2E acceptance tests. It consumes Player public exports and the optional Engine editor export.

## Forbidden dependency directions
- Engine -> Player
- Engine -> Platform
- Player -> Platform
- Contracts -> Engine/Player/Platform
- Platform -> Player internal source paths

## Platform discovery/retention modules

The release-facing player loop now lives entirely in `apps/platform` and depends only on Player public execution APIs:

`Catalog/Discovery -> GamePlayer -> @foundry/player -> @foundry/engine`

Platform-owned persistence adds four tables:

- `user_library` — account-level saved games; independent from browser cache.
- `game_ratings` — one 1–5 rating per user/game.
- `developer_follows` — player-to-developer follow graph.
- `discovery_events` — minimal session events used for Continue Playing, Trending and developer analytics.

No discovery/recommendation/social code is allowed inside Engine or Player.
