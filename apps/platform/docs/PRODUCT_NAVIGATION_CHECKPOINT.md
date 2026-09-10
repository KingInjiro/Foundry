# Product navigation checkpoints

Base: `d8470d1e23bd7ec5683897555b43e8d15b90e1d2` on `main`.
Branch: `fix/product-navigation-exits-20260910`.

Scope: add an explicit safe Editor exit to Platform/Developer Dashboard and a public Home/Catalog exit from the protected sign-in gate. Keep dialog dismissal navigable and existing sign-in/register behavior intact.

Do not change auth backend, registration semantics, OAuth, storage/R2, deployment, GitHub Actions, or Engine core. Do not merge or deploy.

Resume from the draft PR's CHECKPOINT section (DONE, NEXT, TESTS RUN, CURRENT HEAD SHA). Each completed implementation stage must be committed and pushed before updating that section. Verify the published head before resuming; do not duplicate completed work.
