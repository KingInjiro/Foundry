# Single-host R2 storage — PR #10

Base: `4e316e726d745c9d324df01b11848c17fd1e4773`.
Branch: `feature/single-host-r2-storage-20260912`.
This CP0 records the code audit before runtime edits. PR CHECKPOINT holds current progress.

## Coupling confirmed in the pinned source

- `config/productionProviders.js:createProductionProviders` selects disk for single-host and R2 for cloud. SQLite is already local in both branches.
- `config/productionConfig.js:validateProductionConfiguration/loadClientBuildProfile` requires local objects/signing secret for single-host, validates R2 only in the cloud branch, and equates deployment mode with storage kind.
- `vite.config.js:createDeploymentProfile`, `scripts/verify-artifact.mjs`, `deploy/single-host/release-manifest.mjs:verifyReleaseManifest`, doctor and the single-host E2E runner encode single-host = local-disk. The client itself does not use this field to choose upload or download transports.
- `server/app.js:createApp` uses local auth by deployment mode and registers the local PUT route only for `storage.kind === 'local-disk'`. Upload session creation records `storage.kind` and returns the provider's signed URL. Readiness already awaits `storage.ping()` and fails on exceptions; production `server.js:startServer` requires readiness before listening.
- Upload completion uses `R2PackageSource` for either provider. `FileBackedZip` already bounds streamed ZIP/decompressed bytes. `GamePackageExtractor`, `GameVersionPublishService`, `UploadCleanupService` and `ReleaseLifecycleService` use storage methods, not filesystem paths.
- `/api/cdn/*` checks publication/moderation before metadata/range streaming. Runtime URLs remain same-origin. Production signed download redirects must remain forbidden; no Player/protocol change is needed.
- `StorageIntegrityChecker:checkStorageIntegrity` already uses provider HEAD/list, but its CLI selects disk by deployment mode. Recorded upload provider mismatches must not be concealed when changing configuration.
- `SingleHostRecovery` only supports a v1 SQLite + copied-local-objects snapshot. `SingleHostRehearsal` always creates local storage; doctor checks a local directory and assumes the v1 backup format. These cannot truthfully report remote-object backup/recovery without explicit external-storage semantics.
- `security/securityHeaders.js` platform connect-src currently has no R2 upload origin. Browser PUT therefore needs a narrowly derived CSP destination as well as bucket CORS. Foundry cookie-auth CORS remains same-origin; Player downloads continue through the existing CDN gate.
- `R2StorageProvider` already implements signed PUT, streaming/ranges, metadata, buffer PUT and paginated listing/deletion. Its constructor reads process.env even when the provider factory receives an explicit env; use a coherent env input for factories/operator tests. Empty-prefix guards exist; regressions must also cover malformed scope and incomplete pagination.
- `common.sh:foundry_check_release_compatibility` executes the target release's doctor and checks SQLite migrations only. A pre-R2 release can ignore the new selector and serve disk after rollback. Add an independent target storage-capability check before this existing compatibility call; do not redesign the update transaction.
- Installed operator scripts live in `/usr/local/lib/foundry` and are refreshed by the existing installer, not ordinary application updates. Controlled first R2 enablement must refresh these verified tools through that installer; ordinary later updates retain the existing pipeline. No hand-edited server scripts or permissions.

## Minimal configuration/profile contract

- Add `FOUNDRY_STORAGE_PROVIDER=local-disk|r2`; absent means local-disk in single-host and r2 in cloud. Cloud continues to require R2. Invalid values fail closed; no failure fallback.
- Single-host keeps local auth, SQLite, jobs, data/backup directories and loopback backend. Local mode needs no R2 credentials; R2 needs its existing five server variables and validated bounded TTLs. `R2_DIRECT_DOWNLOADS=true` remains rejected.
- Keep existing schema-2 client profiles compatible. New single-host builds advertise the explicit additive capability `supportedStorageProviders: ['local-disk', 'r2']`, retaining `storageProvider` as the build default. Runtime selection may use only an advertised capability. Legacy profiles without that capability permit only their declared provider. One normal prebuilt artifact therefore supports either choice without a target build or new CI secrets. Cloud identity/profile semantics stay unchanged.
- Endpoint/bucket values are validated server-side; no credentials or endpoint settings are emitted into client profiles. Platform CSP gains only the exact configured upload origin(s), never a wildcard. Sandbox/document delivery policies remain unchanged.

## Backup, integrity and compatibility

- Local v1 backups/restores remain byte-for-byte object snapshots with existing hash checks.
- R2 uses a distinct external-storage backup format: local SQLite snapshot plus explicit non-secret bucket/endpoint identity and remote object inventory (keys, sizes, ETags). Remote bytes are NOT copied into local backups. Environment/secrets remain excluded.
- Remote verification/restore requires the matching configured provider and verifies recorded objects plus DB references. Missing/changed objects, mismatched destination, unavailable credentials or failed R2 calls must fail; a SQLite-only success cannot be reported as a complete recovery.
- Restore/rehearsal may only read remote objects and never overwrite/delete them. Rehearsal boots isolated SQLite with jobs unable to mutate remote state and still checks actual published-asset delivery.
- This is not automatic local-to-R2 data migration. Existing referenced local objects must not silently become R2 references. Report provider mismatch and fail closed. A separate controlled object migration remains follow-up if the owner has existing games.
- This is not independent R2 disaster recovery: deletion/lifecycle changes after the snapshot can invalidate an older metadata backup. Owner needs an independent remote-object retention/backup policy; verification must report the loss rather than claim restoration.
- Rollback while R2 is selected must reject artifacts without advertised R2 support even if their SQLite migration is compatible.

## Expected file scope

- New shared storage-selection/profile helper under backend config; `productionConfig.js`, `productionProviders.js`, and small `R2StorageProvider.js` guards/env seam.
- `vite.config.js`, artifact verifier, release-manifest verifier and single-host runner profile checks; preserve release format, pipeline and buildOnTarget=false.
- `securityHeaders.js` and its createApp wiring for the exact upload destination; readiness/startup integrity/provider-mismatch wiring where needed.
- `StorageIntegrityChecker.js`, `SingleHostRecovery.js`, `SingleHostRehearsal.js`; backup/restore/rehearsal/doctor/integrity operator scripts.
- Narrow `deploy/single-host/common.sh` compatibility guard; no systemd/Caddy hardening changes or GitHub workflow changes.
- `.env.example`, `foundry.env.example`, this checkpoint and R2 operator runbook; relevant configuration/provider/security/recovery/deployment tests and isolated S3/browser test support.
- Do not change Engine core, auth/Google implementation, SQLite schema, package format/quotas, extraction/publish architecture, dependency versions, or application UI.

## Acceptance plan

1. Focused config/provider/profile tests: legacy disk default; explicit hybrid; incomplete/invalid config; cloud preserved; no profile credentials; precise CSP destinations.
2. Controlled S3 transport with actual R2 provider: signed upload, bounded ZIP validation, extraction/publish, catalog/CDN/ranges, hide/restore/delete/cleanup and unavailable-storage readiness. No live Cloudflare credentials or runtime bypass.
3. Remote backup/inventory/missing-object/restore/rehearsal and local v1 regressions; rollback capability guard. Read-only remote recovery must never PUT/delete.
4. Compiled browser acceptance for upload and playback using isolated S3 transport, preserving actual CSP, local sessions and CSRF. Existing single-host Chromium remains required.
5. Full check/static/build/smoke, normal and single-host Chromium, artifact/prebuilt rehearsal, restart/integrity/backup/restore, audit high/critical and Engine diff. Publish every checkpoint; keep Draft; no deployment.

## Browser/operator evidence

Cloudflare documents that presigned browser requests still need bucket CORS.
Minimum upload policy: exact Foundry HTTPS origin, PUT, Content-Type; no wildcard origin and no public bucket. Downloads stay behind Foundry, so no browser GET permission is needed for R2.

- https://developers.cloudflare.com/r2/buckets/cors/
- https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/

Live R2 verifier remains optional owner acceptance. Real bucket configuration, credentials and production changes are outside this PR's execution.

## CP1 — configuration/provider/profile foundation

- Explicit storage selection is implemented, with legacy defaults and fail-closed incomplete R2 configuration. Local auth/database topology is unchanged.
- New single-host profiles advertise both storage capabilities. Legacy profiles still require their declared provider; cloud remains Firebase/R2.
- Platform CSP permits only the two exact validated SDK account/bucket upload origins. Sandbox/CSRF/session policies remain unchanged.
- R2 uses the factory's explicit env. SDK errors remain rejecting/observable but omit request credentials; prefix scope and pagination fail closed.
- Focused testing proved the installed SDK signed only `host` for PUT by default. Explicit `signableHeaders: content-type` now binds the already-required upload content type; no client flow change or quota increase.
- Focused config/provider/profile/security/R2 tests: **72/72 PASS, 5 files**. An initial new assertion caught the unsigned Content-Type; it was fixed in the presigner rather than removed.
- Remote backup/restore/integrity, rollback and controlled S3/browser lifecycle acceptance are NEXT. This partial checkpoint is not ready for production enablement.

### CP1 installation namespace

- Single-host R2 requires `R2_OBJECT_PREFIX`: one explicit 1–64 character lowercase installation name (letters, digits, underscores, hyphens). Existing cloud without this variable retains its unprefixed keys.
- The provider maps every logical key to `<installation>/<key>`; SQLite, API paths and package format stay unchanged. Listings return logical keys; list/delete cannot target an empty/root prefix or another installation.
- Tests exercise equal logical keys in two installations, metadata, reads, both presigned URLs, listings, single-object and prefix deletion, and traversal rejection. **67/67 PASS, 3 focused files**; initial missing-setting diagnostic mismatch corrected without relaxing assertions.
- Namespace is not a substitute for bucket-scoped credentials. Use a private dedicated production bucket and a stable unique prefix; changing it is a storage change, not automatic data migration.

## CP2 — external recovery and compatibility

- Single-host startup checks selected storage integrity before API/job startup; required live references cannot silently switch between disk and R2. SQLite snapshot now includes the existing upload `storageProvider` field; no schema migration.
- Doctor and storage-check select the configured provider. Remote verification uses read-only SQLite access, HEAD/list and bounded one-byte GET probes (not full asset downloads).
- New `foundry-single-host-external-backup-v2` stores SQLite plus a bucket/endpoint/prefix-bound inventory (logical keys, sizes, opaque ETags). `remoteObjectsIncluded=false` is explicit. No remote asset directory is copied. Local `foundry-single-host-backup-v1` behavior is retained.
- Restore requires the matching configured private R2 storage and surviving unchanged/readable inventory; local backups cannot be treated as migrated R2 backups. Missing/mismatched objects fail before activation/restore-target publication. Rehearsal reads the same remote assets with mutating methods blocked, while its SQLite and session remain isolated.
- This is NOT independent R2 disaster recovery. A deleted remote object cannot be recreated from this backup. Stop service/external writers during inventory capture; separately retain remote bytes if historical restore after deletion is required. ETag comparison is an object-version indicator, not a cryptographic full-body audit.
- Installed `common.sh` checks target R2 capabilities independently before executing target doctor. This prevents a pre-R2 doctor from approving a disk-only rollback with a compatible SQLite version. Existing migration guards remain.
- **Before first real R2 enablement:** refresh installed operator tooling using the verified release's existing installer path while still configured for local disk. An ordinary `foundry update` does not replace `/usr/local/lib/foundry/common.sh`; source changes alone do not upgrade this guard. Do not manually edit installed helpers.
- Focused external/local recovery, integrity, doctor/rollback and deployment scripts: **13/13 PASS, 5 files**. Real SDK + loopback S3 HTTP transport exercises external inventory, read failures, fresh/published rehearsal and no remote mutation. TypeScript/import checks PASS. Full app/browser lifecycle is CP3 NEXT.
