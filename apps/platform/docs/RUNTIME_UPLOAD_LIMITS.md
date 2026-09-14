# Runtime upload limits

Base: `bf8667125c46252ad9e7bb7b372c4a79db48abc1`.

The upload dialog must use the running server's validated package quota, without
requiring a client rebuild. A same-origin API will expose only the numeric limits
needed by the dialog. Loading or failed configuration must prevent validation and
upload until the authoritative limit is available, with an explicit retry option.

This patch does not change operator quota values, storage transports, R2,
server ZIP bounds, authentication, database schema, jobs, deployment, or Engine
core. Server validation remains authoritative.

Before acceptance, inspect the JSZip browser validation and upload path for whole
archive allocations. Record the smallest safe bounded change if needed, and the
actual browser fixture sizes tested. A configured 2 GiB server quota alone does
not establish 2 GiB browser support.

Validation covers the runtime API allowlist, dialog display and size boundaries,
configuration failure/retry, small ZIP validation/upload recovery, unchanged
local-disk/R2 transports, standard checks, both Chromium profiles, production
artifacts, and compiled lifecycle smoke. Large fixtures stay outside the repo.
