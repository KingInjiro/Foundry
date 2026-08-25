# Architecture gaps — next production slices

1. **Distributed metadata infrastructure** — the concrete database is still SQLite. The DB-backed queue now has atomic claims, worker leases and crash recovery, but a horizontally scaled deployment still needs the planned PostgreSQL provider and migrations executed in the target environment.
2. **Cross-process rate limiting** — API limits now use atomic database buckets instead of process memory. This is shared across workers using the same database; PostgreSQL/Redis remains the multi-host production target.
3. **Lifecycle and deletion** — one-active-release enforcement, unpublish, retained-runtime rollback, version/project deletion and idempotent object cleanup are implemented. Provider-native cache purge and activity-based cold storage remain.
4. **External storage** — design real validation, persistence, credential handling and failure semantics before exposing this option again.
5. **Production identity policy** — add synchronized roles, bans, organizations and operator controls around Firebase authentication.
6. **Operations** — request IDs, JSON request logs, liveness/readiness probes, schema version tracking and production dependency fail-fast are implemented. Metrics export, alerts, automated backup/restore drills and a live R2/Firebase acceptance environment remain.
7. **Business systems** — payments, revenue share, notifications and moderation remain separate product slices. Discovery funnel analytics already exists, but it is not a substitute for production observability.
