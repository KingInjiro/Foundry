# Single-host Google authentication checkpoint

Base SHA: 18f9f7cf78e98a57d0fcbb44004891c2ce3616b2

This branch adds optional server-side Google OIDC authentication while preserving local username/password authentication and Foundry sessions. The existing prebuilt deployment architecture and Engine core remain unchanged. No merge or production deployment is authorized.

The draft PR CHECKPOINT is the authoritative recovery record. Resume by fetching this existing branch and reading that record; do not create another branch or PR.

Initial checkpoint: branch created from the verified production main; implementation and validation have not started.

Planned checkpoints:
1. Inspect the current authentication/database model; add verified provider identity persistence and tests. No email-based account linking; new external users receive DEVELOPER only.
2. Add server-side OAuth start/callback, one-time state, safe destination handling and existing sessions; test errors, cancellation, CSRF and local auth.
3. Add optional Google action to the existing local dialog; preserve navigation, dismissal and focus; add browser regressions.
4. Run static, unit/integration, build, smoke, Chromium, prebuilt/recovery and audit gates; record exact results in the PR.
