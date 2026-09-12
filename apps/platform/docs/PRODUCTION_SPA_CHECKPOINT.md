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

## Next

Add a compiled single-host regression for legacy HTML validators, missing Google
credentials, visible root UI, critical asset MIME/status and local auth. Then
disable HTML storage/file validators in the production frontend handler, keeping
hashed asset caching and all CSP/auth protections. Run final gates; keep PR Draft.
No merge, deployment, Engine core, or age-gate work.
