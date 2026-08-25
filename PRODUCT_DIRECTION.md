# Foundry Product Direction — Discovery-First Platform

## Product thesis

Foundry is not primarily an indie storefront. Its core player loop is:

`Discover -> Play instantly -> Keep / Rate / Next -> Return`

For developers, Foundry shortens the path from a published build to a real player session through validation, browser delivery, the Foundry Player, streaming-ready assets, and direct engagement analytics.

## Implemented product loop

1. Instant browser launch without a forced platform ad/interstitial.
2. One-click `Play Something Now` discovery entry point.
3. `Next Game` directly inside the Player.
4. Anonymous/non-blocking play telemetry: play start, game ready, next, error, session end/duration.
5. Trending ranking based on real recent play, successful starts, ratings, and library keeps.
6. Lightweight recommendations; signed-in players deprioritize games they already played or saved.
7. Account Library / Favorites (`Keep`).
8. `Continue Playing` from signed-in play history.
9. 1–5 star ratings.
10. Follow developers and surface their published games in Library.
11. Best-effort persistent browser storage request after a game is kept; cache remains an optimization, never the source of Library truth.
12. Developer analytics for play starts, successful starts, ready rate, library keeps, ratings, and average session duration.
13. Tab-scoped discovery cycles that avoid repeating visited games until the playable catalog is exhausted.
14. Shareable catalog search, tag and sort state stored in the URL.
15. Direct Library cleanup: remove saved games, hide Continue Playing entries, and unfollow creators without opening each game page.
16. Continue Playing dismissals preserve analytics and automatically clear when the player launches that game again.
17. Editable project title/description plus retry-safe, idempotent package upload completion for the developer workflow.

## Boundary rule

- Discovery, ratings, library, follows, recommendations, telemetry aggregation and developer analytics belong to Platform.
- Player owns browser execution, sandbox, streaming and cache.
- Engine owns game runtime/build APIs.
- Contracts contains only schemas/protocols genuinely shared across packages.

## Deliberately not implemented in this slice

- Cloud Saves game-facing API: requires a stable public save contract and per-game quota/security model.
- Notifications for followed developers: follow graph exists first; notification delivery should be a separate subsystem.
- Discord/Steam OAuth: current Firebase flow supports Google; adding providers must use real provider configuration rather than a fake UI button.
- Native desktop client: browser instant-play remains the release focus.
- Payments/revenue share: should follow proof of player/developer engagement, not precede it.
- ML recommendations: the first ranking is deliberately transparent and deterministic until enough behavioral data exists.
