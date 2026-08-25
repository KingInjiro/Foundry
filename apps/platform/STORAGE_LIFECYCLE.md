# Storage lifecycle roadmap

Status: **release lifecycle implemented; activity-based cold storage remains a proposal**.

The implemented lifecycle now covers incomplete-upload expiration, a configurable seven-day retention window for completed source ZIPs, scheduled cleanup jobs, explicit `EXPIRED` status for unpublished versions whose source is retired, one active release per game, unpublish, instant rollback to a retained runtime, version deletion and whole-project deletion. Destructive cleanup is idempotent and runs through the durable job table; a target enters `DELETING` first, which immediately removes it from catalog and CDN authorization before object deletion starts. Rejected/expired versions do not permanently consume the version quota.

Archived release runtimes remain stored until the developer deletes that version, so rollback does not require re-extraction. Source ZIP retention is independent: an archived runtime remains restorable after its source ZIP is cleaned up.

## Proposed activity states

1. `ACTIVE`: regular player activity.
2. `LOW_ACTIVITY`: candidate for a lower-cost storage class.
3. `DORMANT`: no meaningful activity for a configured period; notify the developer.
4. `ARCHIVED`: preserve metadata while removing or cold-storing runtime assets after a grace period.

## Activity lifecycle still required

- Activity thresholds and warning/grace-period configuration.
- Developer notifications and restore/re-upload UX.
- Storage-class transitions or provider lifecycle rules.
- Tests proving that metadata remains intact and archived games cannot return stale launch URLs.

Publication gating and deletion/rollback behavior are covered by automated tests. Provider-native cold storage transitions and CDN cache purge APIs still require a deployed provider environment.

External-storage lifecycle rules are deferred with the rest of external-storage publishing; the dashboard does not currently expose that mode.
