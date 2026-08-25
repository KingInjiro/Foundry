# Security model

All uploaded games are untrusted code.

## Enforced now

- Generic web games run in an opaque-origin iframe. Optional pointer-lock/download/fullscreen/autoplay policy is granted only when declared; they never receive `allow-same-origin`.
- Foundry games run through the Platform-owned sandbox page and a worker. Typed bridge messages require the exact iframe/parent window and Platform origin, and launch IDs prevent duplicate/racing starts.
- Validated capabilities are persisted and fail closed. Generic web `storage` is rejected because enabling same-origin storage on same-origin untrusted HTML would weaken the isolation boundary.
- Foundry `storage` enables version/viewer-scoped IndexedDB progress only. Save payloads are size-limited and returned only to the same published game version.
- Uploaded ZIPs are private. Public `/api/cdn/*` delivery accepts only extracted game-asset paths.
- Publishing is bound to the SHA-256 and byte length of the ZIP that passed validation; changing the signed-upload object afterward invalidates the version.
- Validation and extraction reject traversal, absolute/encoded/non-portable paths, null bytes, missing entries, case/Unicode-colliding files, unsupported manifests/capabilities, disguised thumbnails and configured size/count-limit violations. Declared ZIP-bomb sizes are checked before decompression.
- Public game documents receive a CSP `sandbox` response policy even when opened directly, plus `nosniff`, immutable caching, conditional/range support and public-asset-only CORS.
- Platform/account APIs are same-origin by default; explicitly trusted integration origins are configured with `CORS_ALLOWED_ORIGINS`.
- Authentication is verified server-side for developer, Library, rating and follow mutations; game ownership is checked for project/version operations.
- Rate limits cover upload creation/completion, publishing and discovery telemetry. They are in-memory and single-instance today.
- Cloud credentials remain server-side. Browser Firebase configuration is public client configuration and must not contain R2 or Admin secrets.
- Credential-free local auth/storage mode is development-only, binds to loopback by default and cannot expose the destructive E2E reset route.

## Still required before distributed production

- Distributed rate limiting and a durable job queue.
- Deployment-level TLS/proxy validation and a CSP review whenever new third-party origins or browser capabilities are added.
- Firebase role/ban/organization policy enforcement.
- Malware/content moderation and abuse operations beyond structural package validation.
- Live R2/Firebase integration and penetration testing in the deployed environment.
- A separately designed credential and validation model before external-storage publishing can be enabled.
