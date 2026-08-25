# Storage architecture

The upload, validation, extraction and CDN paths depend on a small `StorageProvider` contract: create an upload session, inspect/download an object, upload a buffer, delete an object and delete a prefix.

## Providers

### `R2StorageProvider`

Cloudflare R2 is the production-oriented Platform-hosted provider.

- Uses the S3-compatible API from `@aws-sdk/client-s3`.
- Produces presigned direct-upload URLs.
- Reads uploaded ZIP metadata and streams packages into validation/extraction.
- Uploads extracted runtime files with immutable cache metadata.
- Deletes paginated object listings under a prefix before a repeat extraction.

It is configured only when all R2 environment variables, including `R2_ENDPOINT`, are present.

### `LocalDiskStorageProvider`

Credential-free local development and E2E use filesystem storage under `.local/storage` and `.e2e/storage`. Object keys are confined to that root; traversal, absolute paths, empty segments and Windows drive paths are rejected.

## Lifecycle

1. `CREATED`: the API allocates a private `package.zip` object key and returns an upload URL.
2. `VALIDATING`: the client has uploaded the ZIP and the server is inspecting it.
3. `COMPLETED`: validation succeeded; the game version is `READY` for explicit publishing and is bound to the validated ZIP SHA-256.
4. `REJECTED`: validation failed; diagnostics are returned to the developer.
5. `PUBLISHING`: an extraction job atomically claims the ready version.
6. `PUBLISHED`: extracted assets have a real `/api/cdn/games/.../extracted` runtime URL.
7. `EXPIRED`: an unpublished version's retained source ZIP aged out; the dashboard explains that a new version upload is required.
8. `CLEANED`: an expired upload ZIP was removed; published extracted assets are not touched by upload cleanup.

Incomplete sessions expire after 24 hours by default. Successfully validated source ZIPs remain available for publish/retry for seven days by default. Both intervals are configurable.

Extraction first verifies that the source byte length and SHA-256 still match validation, preflights declared uncompressed sizes, deletes its existing version prefix and removes partial uploads on failure. This makes a repeated attempt deterministic in both local and R2 storage.

## Quotas

`QuotaConfig` bounds package bytes, extracted bytes, individual file bytes, file count, active uploads, version count and per-user storage. Environment overrides are parsed as non-negative numbers; invalid values fall back to defaults.

Permanent quota accounting uses the confirmed `packageSizeBytes` and `extractedSizeBytes` on game versions so an upload session awaiting cleanup is not double-counted. Rejected and expired versions are excluded from version/storage quota totals.
