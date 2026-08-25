# Monetization roadmap

Status: **proposal only; no ad network, payment flow or revenue-share ledger is active in the current product**.

The discovery-first release deliberately launches games without a forced mock ad. Monetization should be a separate vertical slice after player/developer engagement is validated.

Any implementation must provide:

- a server-side provider abstraction and secrets boundary;
- explicit, versioned revenue-share policy rather than UI hardcoding;
- auditable impressions/completions and fraud handling;
- consent, privacy and age-region policy review;
- payout identity, tax and reconciliation workflows;
- failure behavior that never strands a user in a fake loading/ad state.

External-storage economics must not be designed until external-storage publishing itself has a real validation and security model.
