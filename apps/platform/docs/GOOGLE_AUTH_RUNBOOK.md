# Optional Google sign-in on single-host

Google sign-in supplements the existing local Sign In/Register dialog. It is available only when both `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are valid server settings. Missing/partial settings disable Google only; local authentication and readiness keep working. Cloud mode retains its existing Firebase path.

## Identity and session contract

- The backend exchanges the authorization code and verifies the Google RSA signature, issuer, audience, authorized presenter (if present), expiry, nonce and subject. No browser identity/role/email input is trusted.
- `(google, verified sub)` identifies the account. Email is optional profile data, never a lookup or linking key. New users receive a random Foundry UID and DEVELOPER role. They have no local username/password and cannot reserve an existing local username. Local ADMIN/MODERATOR accounts, including KingInjiro, are never linked automatically. Explicit linking is a separate future task.
- The existing opaque Foundry session, SQLite persistence, CSRF protection, Strict/HttpOnly/Secure cookie and logout are reused. Only the temporary OAuth binding cookie is Lax so the cross-site Google GET callback can carry it. State is browser-bound, one-time, bounded to 1,000 pending attempts and expires after ten minutes. S256 PKCE binds the code exchange. Restarting invalidates unfinished attempts; starting again is safe.
- Google access/refresh/ID tokens and client secrets are never stored in SQLite or browser storage. Google SDK errors are sanitized before reaching application logs/responses. Google-only users can be disabled/enabled with existing `foundry disable-user` / `enable-user --user <Foundry UID>` commands and confirmation flags. Disabling revokes Foundry sessions. Password reset refuses Google-only accounts.

## Owner setup (once, before enabling)

1. In Google Cloud Console, open **Google Auth Platform** for the intended project. Configure **Branding** (app name, support/contact email, homepage and any required policy links) and **Audience**. Add test users while the app is in Testing; publish the consent configuration when ready for public users.
2. Under **Clients**, create an OAuth client of type **Web application**. Add this exact authorized redirect URI for the current host:
   `https://34-173-130-145.sslip.io/api/auth/google/callback`
   For another hostname, use `PLATFORM_PUBLIC_BASE_URL` plus `/api/auth/google/callback`. Do not configure a callback using an untrusted Host header. This flow needs no browser client secret or JavaScript SDK.
3. Before enabling credentials, apply the OAuth log filters in `deploy/single-host/Caddyfile.example` to the existing `/etc/caddy/Caddyfile`, preserving the actual hostname, upstream and any other intentional site configuration. The filters apply to both **default/error** and **access** logs: they redact callback `code`/`state` and token query values and omit Referer headers. Request paths/status/duration/error reporting remain. Validate with `sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`, then `sudo systemctl reload caddy`. Existing updates deliberately do not overwrite the operator's Caddyfile; a release update alone cannot apply this configuration.
4. In protected `/etc/foundry/foundry.env`, set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` from that client. Keep the file's existing root:foundry 0640 permissions. Never add these values to VITE variables, GitHub build variables, source, command arguments, screenshots or logs. Do not change `LOCAL_AUTH_SESSION_SECRET`. No new GitHub Actions secrets are required.
5. Deploy the reviewed prebuilt release through the existing pipeline/`foundry update`; restart the service after any later env-only change. There is no Vite/build step on the VM. The existing automatic deployment workflow is unchanged.
6. Verify public `/api/ready`, open Sign In and try Continue with Google with a non-privileged test account. Check that the protected destination opens, logout works, cancel leaves local Sign In/Register usable, and a local account still signs in. Confirm logs retain callback status without codes/tokens. Never paste raw callback URLs into support logs.

Use only `openid email profile` scopes; no offline/refresh-token access or other Google APIs are requested. Google Console may require domain/consent verification; successful mocked tests do not prove that the owner's external Console configuration is accepted. The live Google login remains an owner acceptance step.

## Backup and rollback

Migration 9 is additive: `external_auth_identities` references existing users; existing credentials and sessions are not rewritten. Coordinated SQLite backups include this table automatically. Restore retains provider-to-UID mapping and ownership. Keep the protected environment available separately: backups exclude environment files/client secrets. Restoring an older pre-Google backup also predates its Google-created accounts; do not expect those newer identities or content to exist in that backup.

The existing release compatibility guard remains authoritative. A schema-8 release is rejected against a schema-9 database, even though the migration is additive. Do not bypass that guard. Keep the updater's pre-migration backup and use the existing coordinated application/data recovery procedure if returning to a pre-Google release is necessary. Subsequent releases supporting migration 9 use the ordinary guarded rollback path.

## References and validation

The implementation follows [Google's server-side OpenID Connect flow](https://developers.google.com/identity/openid-connect/openid-connect). Proxy filtering uses Caddy's built-in [log filter and query fields](https://caddyserver.com/docs/caddyfile/directives/log#filter). The optional button uses the unchanged [official Google G asset](https://developers.google.com/static/identity/images/g-logo.png), bundled locally, and the [Google sign-in branding rules](https://developers.google.com/identity/branding-guidelines).

`googleOAuth.test.js` verifies real RSA signatures using the production Google SDK with a test-only transport; `googleAuth.integration.test.js` covers HTTP state/replay/cancel/session/CSRF/local-auth/role/logging behavior. No test needs a live Google account or real credential. The draft PR CHECKPOINT records completed frontend/browser and release gates.

`single-host.spec.js` also navigates through a simulated Google page on the Google origin and back to the actual compiled callback. The isolated test launcher preloads `tests/helpers/googleOAuthE2E.mjs`, which replaces only the SDK's network transport and issues synthetic codes on loopback. Signature verification, PKCE, nonce, cookies, database and session routes remain real. The preload, issuer and synthetic credentials are never included in the prebuilt release or production service. Existing local-only compiled smoke and restore rehearsal still run without Google configuration.
