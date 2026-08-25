# Discovery / Retention implementation audit

## Implemented in Platform

- Public discovery telemetry with a bounded in-memory rate limiter and no stored IP address.
- Visibility impressions from discovery game cards.
- Play start, game ready, game error, next game, and session duration events from the real GamePlayer path.
- Trending ranking from recent engagement.
- Transparent recommendation ranking that uses quality, successful starts, freshness, and signed-in play/library history.
- Account Library / Keep.
- Continue Playing.
- 1–5 game ratings.
- Developer follow graph and followed-developer games in Library.
- Best-effort `navigator.storage.persist()` request after Keep; Library remains server-side truth and does not depend on browser cache persistence.
- Developer Player Funnel analytics: impressions, play starts, play rate, ready rate, keeps, rating aggregate, duration data.

## Ownership preserved

- `packages/engine`: unchanged from the supplied archive.
- `packages/player/src`: unchanged; one test-only mock was simplified for current Vitest behavior.
- `packages/contracts/src`: unchanged except for adding the missing test fixture used by its schema test.
- All product discovery/retention work is Platform-owned.

## Recommendation status

The recommendation endpoint is deliberately not described as ML/AI. It is a deterministic first-stage ranking that can accumulate useful behavioral data before a more advanced recommender is justified.

## Deferred intentionally

- Cloud Saves public game API and quota/security model.
- Follow notifications.
- Discord/Steam login providers.
- Native desktop distribution/client.
- Revenue-share/payments.
- ML recommendation service.

These are separate architecture slices and should not be mixed into the current migration/retention change.
