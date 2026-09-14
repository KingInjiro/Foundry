# Single-host optional R2 acceptance — PR #10

Base: `4e316e726d745c9d324df01b11848c17fd1e4773`. The current pushed SHA and gate status are recorded in the existing Draft PR checkpoint. This document does not authorize production activation.

## CP3 evidence and implementation

The retained `controlledR2.mjs` helper now accepts real S3 HTTP requests from the real AWS SDK. It verifies SDK signatures and presigned PUT signatures, expiry, signed Content-Type and supplied CRC32; unsigned reads and bucket access are denied. Its two-object pages use an opaque last-key continuation token so deletion between pages does not skip objects. Failures can be injected for readiness, reads and cleanup. This is a deliberately bounded S3 subset, not proof of Cloudflare service behavior.

The application suite constructs storage using `createProductionProviders`, registers a local developer through the actual auth route, carries its session cookie/CSRF token, and calls real upload/complete/publish/catalog/CDN/lifecycle routes. It uses real SQLite, `LocalJobQueue`, `R2PackageSource`/`FileBackedZip`, extraction and cleanup. Only the SDK transport is redirected to the isolated S3 server; no provider method or app route is replaced.

The compiled production Chromium suite uses the ordinary single-host build, local registration, real browser upload UI, Release Manager and nested Player frames. A test-only CONNECT tunnel for the two synthetic R2 hosts preserves Chromium's networking, TLS, CSP and CORS stack. There is no `page.route` fulfillment of the R2 request. The actual preflight and PUT reach the HTTPS S3 server. The test launcher alone imports `r2E2E.mjs` to redirect SDK HTTP; release generation does not include tests or that preload. No runtime test switch was added.

An existing uncommitted CP3 fix was retained: the SDK otherwise presigns an optional CRC32 for an empty body, which cannot match the later non-empty browser ZIP. The presigning context alone uses `requestChecksumCalculation=WHEN_REQUIRED`. Server uploads, downloads and deletes retain the original client checksum policy. The test rejects the bad checksum/signature case rather than weakening it.

Coverage:

- Local developer auth, session/CSRF; Google is absent in this isolated R2 fixture.
- Signed browser upload, object existence, bounded ZIP validation and persisted full package SHA-256.
- Same-size replacement after validation fails extraction; malformed ZIP and more than the existing maximum number of entries are rejected. Quotas are unchanged.
- Extraction writes, READY/PUBLISHED states, Catalog and actual Player asset bytes.
- Exact HTML Content-Type, full bytes, 206 range bytes and Content-Range, plus 416 invalid range.
- Hide/restore, unpublish/reactivate, version deletion, project deletion and paginated namespace cleanup; other-installation objects survive.
- Invalid/expired upload signature, Content-Type mismatch, missing upload and resumability.
- Storage outage makes readiness 503; missing published entry or wrong prefix makes integrity FAIL. Missing published content is 404. There is no disk fallback.
- Cleanup outage produces persisted failed job evidence and retains DELETING metadata/objects. API returns accepted cleanup (202), not completed deletion. Repeating deletion after service recovery completes cleanup.
- Compiled process stop/restart preserves local session and remote asset delivery.
- R2 SQLite+inventory backup, verification and isolated read-only restore rehearsal check readiness, integrity and a real published asset.
- Browser rejects wrong CORS origin/extra request header and a CSP destination outside the exact allowlist. Minimal upload succeeds without exposed ETag.

`r2AppLifecycle.test.js` has 8 cases; `r2HttpContract.test.js` has 1 case. CP3 focused totals and Chromium results are recorded in the checkpoint after execution. Earlier incomplete browser logs that never reported completion are not counted as PASS.

## CSP, CORS and credentials

Platform `connect-src` adds only the validated account origin and its exact bucket virtual-host origin. No wildcard is required. R2 remains private; downloads and Player asset requests go through Foundry's same-origin CDN authorization/moderation gate. `R2_DIRECT_DOWNLOADS=false` remains mandatory in production.

For the Foundry origin, the minimum bucket CORS policy is:

```json
[
  {
    "AllowedOrigins": ["https://YOUR-EXACT-FOUNDRY-HOST"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": []
  }
]
```

Use the actual origin, including a non-default port if any, with no trailing slash or path. OPTIONS is the browser preflight, not an additional AllowedMethods entry. Foundry does not read the upload response ETag in browser JavaScript, so no response header exposure is needed. Browser GET/HEAD/DELETE permissions to R2 are unnecessary. Keep Foundry's cookie-auth CORS configuration same-origin; do not add R2 as an auth origin.

The secret access key never reaches the browser, client profile or logs. As required by SigV4, the **access-key identifier** appears in `X-Amz-Credential` inside the temporary presigned URL; this identifier is not the signing secret. A presigned URL is a temporary bearer capability: do not publish URLs/traces with live signatures. Browser PUT sends Content-Type but no Foundry cookie, Authorization header or CSRF token to R2. Session mutations remain same-origin.

Reference: [Cloudflare bucket CORS](https://developers.cloudflare.com/r2/buckets/cors/) and [presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), checked 2026-09-13. CORS is needed even with valid signatures; expired responses can be unreadable to browser JavaScript. The existing staging verifier checks transport; separately inspect the actual policy and browser preflight to enforce this exact-origin contract.

## Owner actions for real Cloudflare acceptance (later)

1. Complete CP4 and review its actual GitHub CI for the final implementation SHA. Keep PR #10 Draft until the owner independently decides otherwise. This task performs no merge, deployment or R2 activation.
2. After separate deployment authorization, obtain the verified prebuilt ZIP and its SHA-256 from the approved CI release. While the installation still selects **local-disk**, run that release's existing verified installer with `--archive /absolute/verified.zip --public-url https://EXACT-HOST`. It refreshes installed operator helpers as well as the release. An ordinary `foundry update` alone does not refresh `/usr/local/lib/foundry/common.sh`. Do not hand-edit installed helpers.
3. Retain and rehearse a local backup with `sudo foundry backup`, then `sudo foundry rehearse --backup /absolute/backup-directory`. Record doctor/readiness and current/previous release identity. Existing referenced disk objects are **not migrated** by selecting R2: use a separate clean acceptance installation/bucket or complete a separately approved migration before switching an installation with live disk-backed games.
4. Create a private dedicated R2 bucket; leave public access/custom public CDN disabled. Choose one stable unique installation prefix (1–64 lowercase letters/digits/underscore/hyphen). Configure bucket-scoped object read/write credentials in the server secret configuration only. Apply the exact CORS policy above using the acceptance origin; do not post credentials in chat or commit them.
5. On the isolated acceptance installation, keep `FOUNDRY_DEPLOYMENT_MODE=single-host` and all local DB/auth/jobs/proxy settings. Configure `FOUNDRY_STORAGE_PROVIDER=r2`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com`, `R2_OBJECT_PREFIX`, upload TTL 900, download TTL 120, and `R2_DIRECT_DOWNLOADS=false`. Preserve installed file permissions and local auth secret. No Firebase settings or quota changes are required.
6. With the server environment loaded securely, the existing optional transport verifier is `npm run verify:staging:r2`. It also needs `R2_STAGING_CORS_ORIGIN=https://EXACT-HOST`, a unique `R2_STAGING_TEST_PREFIX=staging-verification/RUN-ID`, and `R2_STAGING_VERIFY_CONFIRM=I_UNDERSTAND_THIS_WRITES_AND_DELETES_TEST_OBJECTS`. Its temporary keys are under the installation prefix. This explicitly writes/deletes only verification objects; it is not the application/browser acceptance.
7. Start/restart the isolated service. Require `/api/ready` 200, `sudo foundry doctor` PASS and `sudo foundry storage-check` PASS. In Chromium, register/sign in locally, upload a small known ZIP, verify OPTIONS/PUT and exact CORS headers, READY, publish, Catalog, actual Player bytes and a 206 range. Check bucket keys stay under the installation prefix; no persistent game bytes should appear on local disk.
8. Exercise hide/restore and unpublish/reactivate; then take `sudo foundry backup`. Confirm format `foundry-single-host-external-backup-v2`, matching bucket/endpoint/prefix and `remoteObjectsIncluded=false`. Run `sudo foundry rehearse --backup /absolute/backup-directory`; require readiness, storage integrity and published asset PASS. Optional explicit restore uses `sudo foundry restore --backup /absolute/backup-directory --target /absolute/NEW-data-directory --confirm-new-target`, never the active data directory.
9. Restart and verify the session/assets persist. Delete the acceptance version/project and confirm its namespace is cleaned, while an independent sentinel prefix survives. In isolation, verify unavailable R2 fails readiness, missing objects fail integrity/recovery and no disk fallback occurs. Avoid destructive fault injection on production data.
10. Keep remote retention/backup separate: the v2 backup contains SQLite and inventory, **no R2 bytes**. It cannot recreate objects deleted after capture. Verification requires matching size/opaque ETag and bounded read probes; it is not a full cryptographic asset audit. A pre-R2 rollback target is rejected while R2 is selected, even if SQLite migrations are compatible. Switching back to disk is not a migration or recovery procedure.

Real R2 service behavior, bucket permissions/CORS propagation, owner credentials and GCE systemd acceptance remain unverified until the owner performs this run. Controlled acceptance does not certify real Cloudflare or deploy anything.
