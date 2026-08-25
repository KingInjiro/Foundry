# Platform security checklist

The canonical current/deferred security boundary is documented in `SECURITY_MODEL.md`.

## Request controls implemented

| Area | Current enforcement |
|---|---|
| Authentication | Firebase ID-token verification in connected mode; explicit loopback-only bypass in local/E2E modes |
| Authorization | Owner checks on project/version operations; authenticated mutations for Library, ratings and follows |
| Uploads | Private object keys, size/count quotas, expiration, portable path/image validation and server-side SHA-256 binding |
| Extraction | Atomic publish claim, validated-ZIP hash/length check, pre-decompression bomb checks, traversal/null/collision limits and idempotent prefix cleanup |
| Delivery | Only published `games/{id}/versions/{id}/extracted/...` paths; document CSP sandbox, security headers and range/conditional delivery |
| Runtime | Capability-aware iframe/worker; typed bridge pinned to exact windows/origin; version/viewer-isolated Foundry saves |
| Abuse limits | Local per-identity limits on upload creation/completion, publish and discovery telemetry |

## Explicit limitations

The current rate limiter, SQLite database and job queue are single-process components. There is no developer-terms gate, organization policy, malware scanner, content moderation system or external-storage credential flow in this slice. Those must not be implied by the UI or deployment documentation.
