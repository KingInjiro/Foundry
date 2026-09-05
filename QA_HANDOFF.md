# Foundry Product QA / Navigation Integrity — handoff

Updated: 2026-08-26

## Recovery evidence

- The working directory is **not a Git repository** (`git status` returns `fatal: not a git repository`), so there is no reliable Git diff/history. The changed-file inventory below is reconstructed from current source, newly added specs, modification markers, and preserved test output.
- Before the latest continuation, the new QA subset had passed **24/24 Chromium tests**. Its crawler reported `routes=8`, `links=9`, `controls=59`.
- The previous execution stopped immediately after adding the Editor Export/GitHub dialog hardening in `packages/engine/src/editor/App.jsx`; that patch had not yet received a regression test.
- This continuation added the missing regression, reproduced the remaining Changelog defect, fixed Changelog and Project Manager modal behavior, and reran the focused test successfully.
- Playwright currently lists **39 tests in 15 files**: 14 pre-existing release-critical tests plus 25 navigation/interaction tests added or extended during this QA pass.
- `packages/engine/src/engine/core` was not changed. No Engine → Platform dependency was introduced.

## Completed

- Static inventory of top-level/nested React routes and navigation primitives (`Link`, `Navigate`, `navigate`, direct route fallbacks).
- Chromium runtime QA of public player, catalog queries/history, details/play identity, Next Game, Library retention, developer project identity, upload modal, editor deep links/handoff, moderation roles/actions, deep-link refresh, negative HTTP/network/timeout states, and responsive navigation at 375/768/1440 px.
- Same-origin navigation crawler with destination-family and runtime-diagnostic assertions.
- Page identity assertions for games, projects, editor projects, and moderation targets.
- Console/page-error/request-failure/unexpected-HTTP diagnostics in the new semantic journeys.
- Critical/high bugs found in the covered scope are fixed and have regression coverage.
- Editor Export, GitHub Export, Changelog, and Project Manager dialog close semantics are now regression-tested.

## Bugs found and fixed

### QA-001

Classification: **CONFIRMED BUG — FIXED**  
Severity: P1  
Route: `/editor`  
Persona: Anonymous or authenticated editor user  
Action: Open the coding editor.  
Expected: Monaco loads under the production CSP.  
Actual: jsDelivr loader was blocked by CSP; the editor remained on `Loading…` with a console error and `pageerror: Event`.  
Root cause: `@monaco-editor/react` used its default external loader.  
Fix: Configure local `monaco-editor`, Vite worker imports, and Monaco 0.56 TypeScript API compatibility.  
Regression test: `responsive-navigation.spec.js` and editor deep-link coverage.  
Status: **FIXED**.

### QA-002

Classification: **CONFIRMED BUG — FIXED**  
Severity: P1  
Route: `/editor` at 375 px and desktop widths  
Persona: Editor user  
Action: Use RUN, Files, Send to Platform, and Inspector navigation.  
Expected: Critical controls remain reachable and mobile navigation is hidden on desktop.  
Actual: RUN was clipped; workspace editor Tailwind classes were not emitted; Files could hide the content needed to reach Send; mobile navigation leaked into desktop.  
Root cause: Platform Tailwind did not scan the engine editor source, plus inconsistent mobile panel visibility classes.  
Fix: Add the engine editor as a Tailwind source and correct responsive header/panel visibility.  
Regression test: `responsive-navigation.spec.js`.  
Status: **FIXED**.

### QA-003

Classification: **CONFIRMED BUG — FIXED**  
Severity: P2  
Route: `/player/invalid`  
Persona: Any  
Action: Open an unknown nested Player URL.  
Expected: Resolve to the Player catalog.  
Actual: Blank Player shell with HTTP 200.  
Root cause: No nested Player wildcard route.  
Fix: Add a `/player/*` family fallback to `/player`.  
Regression test: `navigation.spec.js`.  
Status: **FIXED**.

### QA-004

Classification: **CONFIRMED BUG — FIXED**  
Severity: P2  
Route: `/developer/invalid`  
Persona: Authenticated developer  
Action: Open an unknown nested Developer URL.  
Expected: Resolve to Developer Dashboard.  
Actual: Blank page with HTTP 200.  
Root cause: No nested Developer wildcard route.  
Fix: Add a Developer route-family fallback.  
Regression test: `navigation.spec.js`.  
Status: **FIXED**.

### QA-005

Classification: **CONFIRMED BUG — FIXED**  
Severity: P1  
Route: `/developer/project/:id`, `/moderation`  
Persona: Anonymous user starting from a protected deep link  
Action: Follow the sign-in requirement.  
Expected: Keep the requested URL and continue/deny on that resource after authentication.  
Actual: The user was redirected to `/`; the original destination was lost.  
Root cause: Protected views returned `<Navigate to="/" replace>`.  
Fix: Introduce `ProtectedRouteGate`; authentication occurs without discarding the current route.  
Regression test: `navigation.spec.js`, `deep-links.spec.js`, `auth.spec.js`.  
Status: **FIXED**.

### QA-006

Classification: **CONFIRMED BUG — FIXED**  
Severity: P2  
Route: Catalog → Details → Play → Game Details → browser Back  
Persona: Player  
Action: Return from play using the application button and then browser Back.  
Expected: Application Game Details returns to the previous details entry; browser Back returns to catalog.  
Actual: Game Details pushed a duplicate entry, so browser Back returned to Play and created a history trap.  
Root cause: Unconditional navigation to the details URL.  
Fix: Mark details-origin play navigation and use `navigate(-1)` only for that history shape; direct play deep links still push details normally.  
Regression test: `navigation.spec.js`.  
Status: **FIXED**.

### QA-007

Classification: **CONFIRMED BUG — FIXED**  
Severity: P2  
Route: `/moderation`  
Persona: Moderator  
Action: Quarantine or restore the selected game.  
Expected: Audit action appears immediately for the same selected game.  
Actual: Audit history stayed stale until refresh/reselection.  
Root cause: Audit loading was keyed only by unchanged `selected.gameId`.  
Fix: Reuse and await `loadActions()` after moderation mutations.  
Regression test: `moderation-navigation.spec.js`.  
Status: **FIXED**.

### QA-008

Classification: **CONFIRMED BUG — FIXED**  
Severity: P2  
Route: `/developer/project/:id` upload-version modal  
Persona: Project owner  
Action: Complete upload of another version.  
Expected: CTA text matches its navigation behavior.  
Actual: `Back to Dashboard` only closed the modal and stayed on the project page.  
Root cause: Dashboard label reused for close-in-place behavior.  
Fix: Show `Close` for existing-project uploads; retain `Back to Dashboard` in the dashboard flow.  
Regression test: `interaction.spec.js` and updated critical flow assertion.  
Status: **FIXED**.

### QA-009

Classification: **CONFIRMED BUG — FIXED**  
Severity: P2  
Route: `/editor`, Send to Platform modal  
Persona: Authenticated editor user  
Action: Cancel using Escape or backdrop.  
Expected: Close while idle; remain protected while a mutation is pending.  
Actual: Only X/Cancel closed it.  
Root cause: Missing keyboard/backdrop handlers.  
Fix: Add idle-only Escape/backdrop handling.  
Regression test: `responsive-navigation.spec.js` editor handoff interactions.  
Status: **FIXED**.

### QA-010

Classification: **CONFIRMED BUG — FIXED**  
Severity: P3 (trivial fix)  
Route: All pages  
Persona: Any user in an offline/restricted environment  
Action: Load the application.  
Expected: No avoidable third-party font request errors.  
Actual: Google Fonts requests failed and polluted console/network diagnostics.  
Root cause: External font stylesheet in `index.html`.  
Fix: Remove the runtime Google Fonts dependency; retain local fallback fonts.  
Regression test: Runtime diagnostics across the navigation suite.  
Status: **FIXED**.

### QA-011

Classification: **CONFIRMED BUG — FIXED**  
Severity: P3 (trivial fix)  
Route: `/editor/invalid`, `/moderation/invalid`  
Persona: Any  
Action: Open an unknown nested route.  
Expected: Resolve to the matching route family.  
Actual: Root wildcard redirected to unrelated `/`.  
Root cause: No explicit family fallback.  
Fix: Add explicit `/editor/*` and `/moderation/*` redirects.  
Regression test: `navigation.spec.js`.  
Status: **FIXED**.

### QA-012

Classification: **CONFIRMED BUG — FIXED**  
Severity: P3 (trivial fix)  
Route: `/player?sort=<invalid>`  
Persona: Player  
Action: Open an invalid sort deep link.  
Expected: URL and visible selected sort agree.  
Actual: URL retained an invalid value while UI silently displayed `featured`.  
Root cause: UI fallback did not normalize URL state.  
Fix: Remove invalid sort values from URL state.  
Regression test: `deep-links.spec.js`.  
Status: **FIXED**.

### QA-013

Classification: **CONFIRMED BUG — FIXED**  
Severity: P2  
Route: `/editor`, Export and Export to GitHub overlays  
Persona: Editor user  
Action: Open/close overlays and attempt GitHub export without a credential.  
Expected: Semantic dialogs, Escape/backdrop close while idle, disabled invalid/double submit, and cleared session credential on close.  
Actual: Overlays had no dialog semantics or Escape/backdrop close; `Create & Push` appeared enabled with no token and its handler silently returned; repeated submission was possible.  
Root cause: Missing modal state machine/accessibility semantics and pending/input guards.  
Fix: Add dialog roles/labels, idle-only close handlers, pending flags, input/button disabling, and token/status clearing.  
Regression test: `interaction.spec.js` (`editor dialogs support...`).  
Status: **FIXED**.

### QA-014

Classification: **CONFIRMED BUG — FIXED**  
Severity: P2  
Route: `/editor`, Changelog and Project Manager overlays  
Persona: Editor user  
Action: Open either overlay and use assistive dialog lookup, Escape, or backdrop.  
Expected: Semantic dialog identity and standard non-destructive close controls.  
Actual: Runtime regression failed because Changelog had no discoverable dialog; source confirmed neither overlay handled Escape/backdrop.  
Root cause: Plain visual overlays without modal semantics or global Escape handling.  
Fix: Add `role=dialog`, `aria-modal`, labelled headings, accessible close labels, Escape handlers, and backdrop close.  
Regression test: `interaction.spec.js` (`editor dialogs support...`).  
Status: **FIXED**.

### QA-015

Classification: **CONFIRMED BUILD-GATE BUG — FIXED**  
Severity: P1  
Route: Production build / lazy `/editor` artifact  
Persona: Release operator  
Action: Run the documented `npm run build` with Node's default heap after self-hosting Monaco for CSP compliance.  
Expected: Production build completes without undocumented machine-specific flags.  
Actual: Vite exhausted the default ~2 GB Node heap while transforming the Monaco/editor module graph (exit 134).  
Root cause: The Monaco package-root import pulled an unnecessarily broad distribution, and Rollup's default parallel file scheduling produced excessive peak memory for the remaining local worker graph.  
Fix: Import only the editor API, four used language services/workers and required editor contributions; cap Rollup `maxParallelFileOps` at 64. No heap override is required.  
Regression test: Standard `npm run build` with CI Firebase public build variables, then artifact verification and production smoke.  
Status: **FIXED**. Default-heap build PASS; lazy Editor chunk remains a documented P2 performance risk.

## Tests added or extended

New QA support/specs:

- `apps/platform/e2e/qa-helpers.js`
- `apps/platform/e2e/navigation.spec.js`
- `apps/platform/e2e/deep-links.spec.js`
- `apps/platform/e2e/interaction.spec.js`
- `apps/platform/e2e/responsive-navigation.spec.js`
- `apps/platform/e2e/error-navigation.spec.js`
- `apps/platform/e2e/moderation-navigation.spec.js`
- `apps/platform/e2e/links.spec.js`

Existing specs extended:

- `apps/platform/e2e/auth.spec.js`
- `apps/platform/e2e/critical-flows.spec.js`

Test-only server helpers (inside the existing `e2eMode` boundary only):

- `GET /api/test-delay` for real request-timeout recovery.
- `POST /api/test-users/:uid/role` for isolated moderator/admin personas.
- Production still fails closed when `NODE_ENV=production` and E2E mode is enabled.

## Tests executed

- Earlier in this QA pass: platform TypeScript/lint — **PASS**.
- Earlier in this QA pass: combined new Chromium QA subset — **24/24 PASS**, approximately 1.5 minutes; crawler output `routes=8 links=9 controls=59`.
- Continuation, pre-fix: focused editor dialog regression — **1 FAIL**, reproducibly at missing Changelog dialog semantics. This was expected red-phase evidence, not an infrastructure failure.
- Continuation, post-fix: focused editor dialog regression — **1/1 PASS**.
- Continuation, expanded Escape/backdrop assertions: focused editor dialog regression — **1/1 PASS**.
- Continuation, complete QA-focused Chromium suite after the final modal patch — **25/25 PASS** in approximately 1.5 minutes; crawler output remained `routes=8 links=9 controls=59`.
- Continuation, `npm run check` — **PARTIAL PASS / FAIL**: relative imports PASS; Firebase config/rules source PASS (`liveDeployment: NOT VERIFIED`); TypeScript PASS; 471/471 unit/integration tests PASS (contracts 2, player 177, platform 292); production Vite build aborted with Node heap OOM near the default ~2 GB limit while transforming the newly local Monaco dependency. Artifact verification did not run. This is now the active task.
- Continuation, standard default-heap `npm run build` after QA-015 fix — **PASS**, 3,700 modules transformed, production client/server emitted. No `NODE_OPTIONS` override used.
- Continuation, `npm run verify:artifact` — **PASS**: 53 client files, server bundle present, 0 public source maps, 0 public debug fixtures.
- Continuation, `npm run test:smoke` — **PASS**: health/readiness 200, upload READY, publish PUBLISHED, catalog 1, CDN Range 206, unpublish hidden 404, restore PUBLISHED, delete/missing 404.
- Continuation, first full 39-test Chromium run — **FAIL: 36 PASS / 3 FAIL**. One deterministic test locator regression (`Close` matched both the exact CTA and `Close upload dialog`) was corrected with `{ exact: true }`. Timeout recovery and protected project reload failed only in the long suite after passing the 25-test focused run; both are being isolated before classification as product bugs.
- Continuation, isolated rerun of those three failures — **3/3 PASS**. Timeout and reload were therefore classified as suite scheduling flakes rather than confirmed product defects. Their assertions retain the real paths but now have 25s/20s CI scheduling margins; no product behavior was weakened.
- Continuation, corrected full Chromium suite — **39/39 PASS** in approximately 1.9 minutes; crawler output `routes=8 links=9 controls=59`.
- Continuation, clean uninterrupted `npm run check` after QA-015 — **PASS**: import boundaries PASS; Firebase config/rules source PASS with live deployment explicitly `NOT VERIFIED`; TypeScript PASS; **471/471** unit/integration tests PASS (2 contracts + 177 player + 292 platform); default-heap production build PASS; artifact hygiene PASS (53 client files, 0 public source maps/debug fixtures).
- Continuation, final `npm run test:smoke` against that artifact — **PASS** with the upload/publish/catalog/CDN/unpublish/restore/delete evidence recorded above.
- Continuation, `npm audit --audit-level=high` — **NOT VERIFIED**: npm registry DNS was unavailable in this sandbox (`EAI_AGAIN registry.npmjs.org`, exit 1). This is not reported as a vulnerability finding or a PASS. The pre-QA baseline audit passed, but the final tree adds `monaco-editor`, so CI must rerun the current audit.
- One earlier focused Playwright attempt failed before running tests because the local Playwright ffmpeg symlink was missing. The symlink was restored; this was tooling, not a Foundry product failure.

## Tests not yet executed after the latest patch

- Current-tree dependency audit could not reach the npm advisory endpoint; rerun it in network-enabled CI.

## Remaining P0

- None known in the covered runtime scope.

## Remaining P1

- None known in the covered runtime scope.

## Remaining P2 / static risks and coverage gaps

- **STATIC RISK — NOT FIXED:** Engine editor Project Manager ZIP import/export promises have no explicit pending/error UI; failure injection has not yet reproduced a concrete user-visible case.
- **STATIC RISK — NOT FIXED:** Dormant Welcome overlay lacks dialog semantics, but `showWelcome` initializes `false` and no active opener was found; it is not a currently reproduced route bug.
- **PERFORMANCE RISK — NOT FIXED:** `/editor` is lazy-loaded, but its production JavaScript chunk is approximately 4.8 MB minified / 1.23 MB gzip and the TypeScript worker is approximately 7.0 MB uncompressed. This did not break tested navigation, but warrants a separate post-QA loading/performance pass.
- Live GitHub mutation was intentionally not executed; tests verify credential lifecycle/button semantics only. Existing lower-level export tests cover per-operation HTTP failure handling.
- Safe crawler inventories controls but does not automatically execute destructive mutations. Semantic isolated tests cover the critical mutations; exhaustive button-by-button destructive crawling remains out of scope.
- Empty-state CTA coverage is not exhaustive for every possible zero-data combination.

## Final Product QA snapshot

- Runtime crawler: **8 routes visited, 9 same-origin links followed, 59 interactive controls inventoried**.
- Personas exercised: anonymous, authenticated developer/player, project owner, authenticated non-owner, moderator, and admin.
- Core journeys exercised: Landing/Catalog/Details/Play/Back; Play Now/Next Game; Keep/Library/Resume/rating/follow; Dashboard/project/upload/release lifecycle; Editor cloud identity/Send to Platform/READY; moderation quarantine/restore.
- Confirmed defects closed: **15 total** — 4 P1, 8 P2, and 3 trivial P3. No confirmed P0 remained.
- Navigation-focused Chromium tests: **25/25 PASS**.
- Complete Chromium tests: **39/39 PASS**.
- Unit/integration tests: **471/471 PASS**.
- Production build, artifact hygiene, and production smoke: **PASS**.
- Dependency audit: **NOT VERIFIED on the final lockfile** because the sandbox could not resolve the npm advisory endpoint.
- Product QA verdict: **FUNCTIONALLY READY FOR STAGING**. This is a functional/navigation verdict, not evidence that live Firebase/R2 staging integration has been executed in this session.

## Exact next task

1. In network-enabled CI, run `npm audit --audit-level=high` against the final lockfile without force-fixing dependencies.
2. Do not reopen P0/P1 navigation discovery unless that gate or staging use reproduces a new defect.
3. Treat Editor bundle/loading optimization and the unverified ZIP import/export error UI as separate P2 follow-up work.

## Modified files

Because Git metadata is unavailable, this is the reconstructed current QA change set.

Production/source/config:

- `apps/platform/index.html`
- `apps/platform/package.json`
- `apps/platform/server.js`
- `apps/platform/src/App.jsx`
- `apps/platform/src/index.css`
- `apps/platform/vite.config.js`
- `apps/platform/src/platform/auth/ProtectedRouteGate.jsx` (new)
- `apps/platform/src/platform/developer/DeveloperDashboard.jsx`
- `apps/platform/src/platform/developer/UploadGameModal.jsx`
- `apps/platform/src/platform/editor/EditorPlatformHandoffModal.jsx`
- `apps/platform/src/platform/moderation/ModerationDashboard.jsx`
- `apps/platform/src/platform/player/GameCatalog.jsx`
- `apps/platform/src/platform/player/GameDetails.jsx`
- `apps/platform/src/platform/player/GamePlayer.jsx`
- `apps/platform/src/platform/player/PlayerPlatform.jsx`
- `package-lock.json`
- `packages/engine/package.json`
- `packages/engine/src/editor/App.jsx`
- `packages/engine/src/editor/components/ChangelogModal.jsx`
- `packages/engine/src/editor/components/ProjectManager.jsx`

QA tests:

- `apps/platform/e2e/auth.spec.js`
- `apps/platform/e2e/critical-flows.spec.js`
- `apps/platform/e2e/qa-helpers.js` (new)
- `apps/platform/e2e/navigation.spec.js` (new)
- `apps/platform/e2e/deep-links.spec.js` (new)
- `apps/platform/e2e/interaction.spec.js` (new)
- `apps/platform/e2e/responsive-navigation.spec.js` (new)
- `apps/platform/e2e/error-navigation.spec.js` (new)
- `apps/platform/e2e/moderation-navigation.spec.js` (new)
- `apps/platform/e2e/links.spec.js` (new)
