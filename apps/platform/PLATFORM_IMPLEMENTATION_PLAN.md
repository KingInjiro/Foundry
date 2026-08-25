# Platform implementation status

## Complete in the current local/vertical slice

- Package and manifest validation, including optional streaming-manifest validation.
- Platform-hosted upload sessions, ZIP extraction and explicit publishing.
- Local filesystem and Cloudflare R2 storage providers.
- SQLite metadata with schema tracking, ownership checks, quotas, database-backed rate limits, leased durable jobs and upload cleanup.
- Developer project/version dashboard connected to the API.
- Public catalog, discovery, game details and sandboxed browser launch.
- Library, ratings, follows, play telemetry and developer funnel analytics.
- Credential-free local development and Playwright E2E infrastructure.
- One-active-release enforcement, unpublish/rollback and queued version/project deletion.
- Server-side catalog search/sort/cursor pagination with response revalidation.
- Web Worker package validation plus upload progress, cancellation and session reuse.
- JSON request logs, request IDs, liveness/readiness probes and production dependency fail-fast.

## Partially complete

- Runtime adapters and messaging: working for the current web/Foundry paths; the public protocol still needs formal versioning and broader adversarial testing.
- Production storage: R2 calls and mocked tests exist; live-account acceptance is still required.
- Authentication: Firebase verification exists; advanced role/ban/organization policy does not.
- E2E: 11 Chromium cases are defined; see `../../VALIDATION_REPORT.md` for the environment limitation on the latest run.

## Next slices

1. Implement and acceptance-test the PostgreSQL provider against the versioned target schema; the current concrete provider remains single-host SQLite.
2. Add metrics export, backup/restore drills, alerts and live Firebase/R2 acceptance tests.
3. Add provider-native cache purge and activity-based cold-storage policy on top of the implemented release lifecycle.
4. Content moderation, malware scanning and operator tooling.
5. External-storage publishing only after its real validation and security model exists.
6. Payments/revenue share only after the engagement loop is validated.
