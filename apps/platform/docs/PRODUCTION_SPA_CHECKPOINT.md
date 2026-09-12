# Production SPA cache regression — PR #9

Base: `b53124bcb9be169821cf404743798672e56e2437`.
Previous production: `18f9f7cf78e98a57d0fcbb44004891c2ce3616b2`.

## CP0: evidence collected before runtime changes

On 2026-09-11 both actual GitHub deployment artifacts were downloaded and
verified against their included SHA-256 files:

| | Previous production | Current production |
| --- | --- | --- |
| Workflow run | 34482448617 | 34598172669 |
| Artifact ID | 10154554843 | 10263558153 |
| Release ZIP SHA-256 | `16e9effb2af020954c020b464f2467d0272ddfc7b381e64fe796ccca21526dea` | `872a3265e054a1f959f793b35e91223056266a9789e109e177171670bb970e71` |
| index.html bytes | 573 | 573 |
| ZIP timestamp | 1980-01-01 00:00:00 UTC | 1980-01-01 00:00:00 UTC |
| Entry module | `/assets/main-BKt2b4dO.js` | `/assets/main-CWkDzf1s.js` |
| Stylesheet | `/assets/main-v6ERGp6H.css` | `/assets/main-BSwjLV95.css` |

`scripts/create-single-host-release.mjs` normalizes ZIP timestamps.
`server.js:startServer` serves the frontend through default `express.static` and
`res.sendFile` file validators. These use **size and mtime**, not content. Both
different HTML documents therefore have **`W/"23d-4977387000"`** and identical
Last-Modified dates. This latent defect predates Google auth; PR #8 changed the
hashed assets and exposed it during an update.

Read-only production observations:

- Fresh Chrome rendered the Foundry home/header/Sign In. Google configuration
  returned `{ "success": true, "data": { "enabled": false } }`.
- `GET /` with `If-None-Match: W/"23d-4977387000"` returned **304**, incorrectly
  allowing reuse of the previous cached HTML.
- `GET /assets/main-BKt2b4dO.js` returned **200 text/html**: the SPA fallback,
  because the previous asset no longer exists in the current release.

Isolated Chromium used the actual current compiled server, previous/current CI
clients, archive timestamps, HTTPS, and **no Google credentials or auth bypass**.
It explicitly modeled HTTP cached-document revalidation (self-signed local HTTPS
did not retain the browser cache): an actual server 304 reused previously
received HTML; a 200 used the new body. Script, stylesheet, auth and rendering
behavior were real. The visible `Foundry home` assertion failed with:

- `#root.childElementCount === 0`;
- `Failed to load module script: Expected a JavaScript-or-Wasm module script but
  the server responded with a MIME type of "text/html"`;
- the previous stylesheet also rejected for MIME `text/html`.

Fresh compiled rendering passed; the revalidated previous document reproduced
the white page. This proves a cache/asset-serving defect, not an auth exception.
The owner's own console/cache was not captured; the reproduced path matches the
reported symptom and the actual production responses.

The 2026-09-12 recovery found the scratch workspace rolled back before these
diagnostics. This record is restored from the completed tool outputs in the
conversation. No unpublished runtime edits existed. The focused reproduction
will be persisted as a regression and run again before applying the fix.

## Why existing CI missed it

Browser gates use fresh contexts and freshly built files, without revalidating
a previous deployment's HTML after a release switch. ZIP timestamps are normalized
after the browser gate. API lifecycle smoke, prebuilt rehearsal and public
readiness do not render the cached SPA. The existing single-host browser fixture
also enables a mock Google provider; its disabled-config test mocks availability
rather than launching a server with credentials absent.

## Fix checkpoint

`server.js:startServer` now serves entry HTML with `Cache-Control: no-store`,
`etag: false` and `lastModified: false`. This also handles validators cached before
the fix. Explicit index/sandbox documents and fallback SPA routes share this
policy; static hashed JS/CSS retain their existing caching. No auth, CSP, Google
configuration, release format, updater, or Engine implementation changed.

`e2e/single-host.spec.js` adds two tests to the existing Chromium gate, using
`tests/helpers/productionSpaServer.mjs` to launch an isolated real compiled server
without Google credentials or a Google preload. The helper models extracted ZIP
timestamps. Tests cover cached-document revalidation, visible root landmarks,
uncaught errors, critical JS/CSS status and MIME, HTML GET/HEAD validators, local
Register/Sign In, and optional Google configuration failure with accessible local
auth still available.

On 2026-09-12 the persisted regression failed against the checksum-verified
`b53124b` CI artifact at the missing `Foundry home` assertion, with the same module
and stylesheet MIME errors. After rebuilding only the corrected server bundle
against that same compiled client, both focused tests passed: **2/2, 5.9 seconds**.
No assertion or timeout was weakened. A test-only assumption that reopening a
dialog resets its selected tab was corrected by explicitly selecting Sign In.

## Final gate tracking

See PR #9 CHECKPOINT for results on the published head. Required gates: full
check, normal/single-host Chromium, build/smoke/artifact, prebuilt rehearsal,
audit high/critical, and Engine core comparison. Keep PR Draft; no merge,
deployment or age-gate work. No production fix is claimed until owner deployment.
