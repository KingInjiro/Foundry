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
| Moderation | Authenticated reports; `ADMIN`/`MODERATOR` queue, reasoned quarantine/hide/restore, durable operator audit; catalog/detail/CDN gates |
| Abuse limits | SQLite-backed atomic per-identity limits on project/editor/upload/publish/report/rating/follow/discovery/catalog operations |
| Operations | Fail-closed production profile, build/runtime Firebase identity check, JSON log redaction, graceful drain, WAL-safe backup/restore |

## Explicit limitations

The first release is intentionally single-node. There is no developer-terms gate, organization/ban policy, malware scanner, full Trust & Safety case-management product, or external-storage credential flow. The implemented moderation surface is a minimum operator control, not a claim of complete abuse prevention. Real Firebase/R2 behavior and penetration testing remain deployment checks.
