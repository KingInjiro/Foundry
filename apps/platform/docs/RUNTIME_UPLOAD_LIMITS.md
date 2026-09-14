# Runtime upload limits

Base: `bf8667125c46252ad9e7bb7b372c4a79db48abc1`.

The upload dialog uses the running server's validated quotas without requiring a
client rebuild. `GET /api/config/upload-limits` returns `Cache-Control: no-store`
and the normal `{ success: true, data: { ... } }` API envelope. `data` contains
exactly five public numeric fields:

| Field | Source in the running process | Browser use |
| --- | --- | --- |
| `maxPackageSizeBytes` | `PLATFORM_MAX_PACKAGE_SIZE_BYTES` | Maximum label and selected file size check |
| `maxFileSizeBytes` | `PLATFORM_MAX_FILE_SIZE_BYTES` | Streaming chunk validation |
| `maxTotalExtractedSizeBytes` | `PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES` | Streaming total validation |
| `maxFilesPerPackage` | `PLATFORM_MAX_FILES_PER_PACKAGE` | Existing package file count check |
| `maxExtractedFilesPerPackage` | `PLATFORM_MAX_EXTRACTED_FILES_PER_PACKAGE` | Existing streaming chunk count check |

The endpoint reads `QuotaConfig`, which is resolved at process startup and whose
production settings are checked by the existing production configuration gate.
It does not read arbitrary request parameters or return an environment dump,
credentials, storage URLs, database settings, or filesystem paths. It needs no
cross-origin policy. With `PLATFORM_MAX_PACKAGE_SIZE_BYTES=2147483648`, the
response is numeric `2147483648` and the existing formatter displays `Maximum
2.0 GB` (binary units).

Every dialog opening fetches fresh configuration through the existing same-origin
API client. Selection, drop, validation, and upload are blocked while it is
unknown. Invalid or failed responses show a retry button; there is no numeric
fallback. Closed-dialog responses are ignored. Runtime quotas are passed to both
worker and direct local validation; server callers retain their existing defaults.

This patch does not change operator quota values, storage transports, R2,
server ZIP bounds, authentication, database schema, jobs, deployment, or Engine
core. Server validation remains authoritative.

## Browser memory boundary

Inspection of the installed JSZip 3.10.1 `lib/utils.js` (`prepareContent`) confirms
that a `File` is read with `FileReader.readAsArrayBuffer`. `loadAsync` retains this
complete archive buffer. `LocalZipPackageSource` also materializes each requested
manifest, thumbnail, or streaming chunk; `GamePackageValidator` hashes a complete
chunk with `crypto.subtle.digest`. Moving this to a worker does not make memory
usage bounded. The worker is now terminated on cancellation as well as completion.

The upload service itself passes the original File to `XMLHttpRequest.send`; it
does not build another whole-file buffer or compute a browser package SHA. The
server's existing FileBackedZip validation and SHA path are unchanged.

See the upstream [JSZip limitations](https://stuk.github.io/jszip/documentation/limitations.html)
and [loadAsync contract](https://stuk.github.io/jszip/documentation/api_jszip/load_async.html).
The API maximum is a server admission limit, not a promise that every browser has
enough memory. **2 GiB browser support is not established by this patch.** Reliable
support at that size needs a separate browser source that reads bounded Blob
slices, with bounded entry decoding and chunk hashing, preserving the existing
manifest/path/content validation contract. Replacing that ZIP reader is outside
this quota synchronization patch; local validation is retained.

Validation covers the runtime API allowlist, dialog display and size boundaries,
configuration failure/retry, small ZIP validation/upload recovery, unchanged
local-disk/R2 transports, standard checks, both Chromium profiles, production
artifacts, and compiled lifecycle smoke. Large fixtures stay outside the repo.
Actual large-file acceptance sizes and results are recorded in the PR checkpoint;
modeled `File.size` unit tests alone do not count as large-file browser evidence.
