# Single-host Google authentication checkpoint

Base SHA: 18f9f7cf78e98a57d0fcbb44004891c2ce3616b2

This branch adds optional server-side Google OIDC authentication while preserving local username/password authentication and Foundry sessions. The existing prebuilt deployment architecture and Engine core remain unchanged. No merge or production deployment is authorized.

The draft PR CHECKPOINT is the authoritative recovery record. Resume by fetching this existing branch and reading that record; do not create another branch or PR.

CP1 complete: migration 9 adds `external_auth_identities` with unique `(provider, subject)` and a unique foreign-key UID. Local credentials are untouched. Google accounts have a random Foundry UID, no local username/password, and DEVELOPER role. The existing session reader accepts either a local credential or an external identity. Existing operator disable/enable works by Google user's Foundry UID; password reset cannot create a password for a Google-only user.

Google OAuth foundation uses the already-locked `google-auth-library` 10.9.1 as a direct production dependency (no dependency versions upgraded). Real SDK signature validation plus strict issuer/audience/expiry/nonce/subject checks precede mapping. State is browser-bound, one-time, expires after 10 minutes and is capped at 1,000 pending attempts in the single Node process. It carries nonce and S256 PKCE; restarting drops unfinished flows safely. Only the temporary binding cookie is SameSite=Lax; Foundry sessions stay Strict. No refresh/access/ID tokens are persisted and SDK errors are sanitized.

CP1 validation: 46/46 focused tests (Google 28 plus existing local auth/operator CLI/migrations/coordinated recovery), TypeScript and import boundaries PASS. Includes real RSA signature rejection and schema-8 upgrade/backup/restore identity persistence. Initial nested transaction failure was fixed by completing mapping first, then rechecking account status and issuing the session in one serialized transaction; the provider's nested-transaction guard remains intact.

CP2 complete: single-host createApp exposes an enabled-only configuration flag, same-origin POST start and GET callback. State is consumed before cancellation/code exchange; duplicate/bad parameters fail closed. The callback sets the existing Foundry session and redirects only to normalized application routes. Cancellation/errors use fixed, non-sensitive UI markers. Google start/callback rate limits are separate from local login limits. Sessions/CSRF/local registration/logout and role protection are covered by HTTP tests.

The Caddy template now applies one shared code/state/token query redaction filter to access AND default/error logs, preserving path/status/error reporting. The snippet must precede its imports (confirmed using Caddy 2.11.2 adapt/validate). A real local proxy rehearsal produced HTTP 502 and confirmed both logs retained that failure with redacted credentials. Existing Caddy installations require this one-time config change before Google credentials are enabled; updates do not overwrite the operator's proxy config. See GOOGLE_AUTH_RUNBOOK.md.

CP2 validation: focused Google/local-auth/recovery/doctor 58/58; full Platform 428/428 across 60 files, zero unhandled errors; TypeScript/import checks PASS. CP1 CI exposed two schema-8 expectations in databaseRecovery/singleHostDoctor; updated exact schema expectations to 9 and retained explicit refusal to roll back to schema 8. No deployment compatibility logic was changed.

Next: CP3, add optional Continue with Google to LocalAuthDialog and AuthContext. Preserve Sign In/Register, error/cancel navigation and PR7 focus restoration. Add an isolated mocked-provider browser flow exercising real cross-site redirect cookies, the compiled backend and actual RSA verification; never add a runtime auth bypass or live-Google test dependency.

Planned checkpoints:
1. Inspect the current authentication/database model; add verified provider identity persistence and tests. No email-based account linking; new external users receive DEVELOPER only.
2. Add server-side OAuth start/callback, one-time state, safe destination handling and existing sessions; test errors, cancellation, CSRF and local auth.
3. Add optional Google action to the existing local dialog; preserve navigation, dismissal and focus; add browser regressions.
4. Run static, unit/integration, build, smoke, Chromium, prebuilt/recovery and audit gates; record exact results in the PR.
