# Foundry Release Candidate — Product Polish Report

Date: 2026-08-27

## A. Baseline

The pass began from the previously verified `FUNCTIONALLY READY FOR STAGING` tree:

- 471/471 unit/integration tests passing.
- 39/39 Chromium E2E tests passing.
- 25/25 navigation-focused E2E tests passing.
- Production build, artifact verification, and production smoke passing.
- All known P0/P1 navigation/runtime defects in the previous verified scope closed.
- Editor route already lazy-loaded, but approximately 4.8 MB minified / 1.23 MB gzip; TypeScript worker approximately 7 MB uncompressed.
- Project Manager ZIP pending/failure UX recorded only as a static P2 risk.
- Final-tree dependency audit not previously verified because npm registry DNS resolution failed.

This was a bounded polish pass, not a repeat navigation audit. No new product workflow, backend pipeline, lifecycle state, design system, CSP exception, or Engine-core change was introduced.

## B. Confirmed polish defects

| ID | Severity | Surface | Expected | Actual |
| --- | --- | --- | --- | --- |
| POLISH-001 | P2 | Editor Project Manager ZIP import/export | Pending protection and recoverable success/error feedback | Controls stayed active; parser/generator rejections were unhandled and invisible |
| POLISH-002 | P2 | Authenticated Landing, 375 px | Primary navigation fits the viewport | 489 px document width in a 375 px viewport |
| POLISH-003 | P2 | Empty Library sections | Explanation plus an existing-route next action | Continue Playing, Saved Games, and Following had no CTA |
| POLISH-004 | P2 | Project Manager 403 | Clear explanation, Retry, and safe Back action | Raw short message plus Retry left the user at a dead end |
| POLISH-005 | P2 | Long project title, 375 px | Full valid title remains readable | 2,595 px nowrap content inside a 288 px heading |
| POLISH-006 | P2 | Mobile Player Back control | Stable accessible name | Visible label disappeared at mobile width, leaving the button unnamed |
| POLISH-007 | P2 | Editor Project Manager, 375 px | Existing actions remain readable/reachable | 122 px action content clipped inside an 82 px column |
| POLISH-008 | P2 | Long Game Details content, 375 px | Title and metadata wrap within the hero | 3,398 px title content clipped inside a 262 px heading |
| POLISH-009 | P2 | Editor Export secondary-chunk failure | Safe visible failure and restored controls | Failure was caught/logged but the dialog showed no error |
| POLISH-010 | P2 | Editor mobile Play Stop control | Icon-only control has an accessible name | Rendered X control had no text, title, or ARIA label |

All ten entries were reproduced at runtime or through controlled promise/network failure injection before being changed. No static suspicion is counted as a confirmed bug.

## C. Fixes

- Added a local ZIP operation state to the existing Project Manager: `idle -> importing/exporting -> success/error -> stable idle`, competing-control guards, input reset for retry, safe live-region feedback, and rejection handling. The archive format and pipeline are unchanged.
- Compacted existing authenticated Landing navigation at small widths without changing destinations.
- Added `Browse games` links from the three existing empty Library sections to the existing `/player` route.
- Replaced the Project 403 dead end with a labelled alert, preserved safe server copy, Retry, and `Back to Developer Dashboard`.
- Allowed valid long project/game/developer/tag content to wrap instead of forcing single-line overflow.
- Stacked the existing Editor Project Manager panes at small widths while retaining the desktop layout from `md` upward.
- Added pending/error presentation to the existing Editor Export dialog when its secondary source chunk cannot load.
- Moved the raw Engine source map out of Editor startup and into a cached secondary chunk loaded only by Export/GitHub Export.
- Added stable accessible names to the mobile Player Back and Editor Stop-preview controls.

## D. UX improvements

| Surface | Loading / empty / error / feedback result |
| --- | --- |
| Landing / Catalog / Details | Existing loading, search-empty, retry, and filter-clear patterns retained; mobile and long-content overflow fixed |
| Player / Library | Existing launch/retry/persistence states retained; all three Library empty sections now have a correct next action |
| Developer Dashboard / Project | Existing skeleton, empty-project CTA, polling, form validation, and lifecycle controls retained; 403 recovery and long-title handling fixed |
| Upload/version flow | Existing validate/upload/progress/retry/double-submit protections retained and passed full E2E |
| Editor / Platform handoff | Existing handoff state machine retained; canonical export now exposes pending/failure feedback and remains retryable |
| Moderation | Existing role denial, busy guards, reason validation, conflict feedback, and audit refresh retained and passed full E2E |
| Auth/protected states | Existing preserved deep-link and role-denial behavior retained and passed full E2E |

Status semantics exercised by smoke/E2E include DRAFT, READY, PUBLISHED, ARCHIVED/restored, DELETED, and hidden/quarantined visibility. No impossible action/state combination was reproduced, and the lifecycle model was not changed.

## E. Accessibility improvements

- Mobile Player Back now retains the accessible name `Game Details` when its visible text is hidden.
- Editor Play-mode Stop control now exposes `Stop preview` and explicitly uses button semantics.
- ZIP operation feedback uses a live status region; failure feedback uses an alert region.
- The existing Project access error is now a meaningful alert with heading and keyboard-operable recovery actions.
- Runtime icon-button inventory passes in both normal Editor and mobile Play states.

## F. Performance

| Metric | Before | After | Result |
| --- | ---: | ---: | ---: |
| Editor route JS, minified | 4,814,777 B | 4,209,577 B | -605,200 B (-12.6%) |
| Editor route JS, gzip level 9 | 1,222,128 B | 1,101,772 B | -120,356 B (-9.9%) |
| Deferred export-source chunk | eager in Editor | 540,262 B / 105,114 B gzip | loaded only for Export/GitHub Export |
| Editor + deferred export sources, gzip | 1,222,128 B | 1,206,886 B | -15,242 B (-1.3%) overall |
| Total client build | 17,419,832 B / 53 files | 17,354,894 B / 54 files | -64,938 B (-0.37%) |
| JavaScript total | 17,025,012 B | 16,960,074 B | -64,938 B (-0.38%) |
| Vite process maxRSS | 2,616,724 KiB | 2,519,892 KiB | -96,832 KiB (-3.7%) |
| Measured Vite build time | 65,792 ms | 62,413 ms | -5.1%; run-to-run variable |

Worker chunks are unchanged: TypeScript 7,043,070 B; CSS 1,053,319 B; HTML 715,949 B; JSON 406,181 B; editor worker 274,128 B. The configured JavaScript/TypeScript, JSON, CSS, and HTML services are all used, and no further worker removal or manual bundling met the safe-change criteria. Editor remains route-lazy and does not enter the initial Landing/Player bundle.

## G. Static risks not reproduced

- Deeper Monaco/worker splitting remains a non-blocking performance risk; no small behavior-preserving improvement beyond deferred export sources was identified.
- UPLOADING, PROCESSING, PUBLISHING, and PUBLISH_FAILED labels/actions were statically inspected but not each held under a separately injected long-running backend state in this pass. No incorrect combination was reproduced.
- Live GitHub push/export mutation was not executed. Local dialog semantics, credential clearing, pending protection, and canonical ZIP export are covered.
- Live Firebase/R2 staging integration was not exercised by this local pass; this is staging-verification work, not a confirmed product bug.
- Dependency audit reports transitive moderate/low advisories; none meets the requested high threshold. The suggested complete remediation would require breaking dependency changes and was not applied during this bounded pass.

## H. Tests added

| Bug(s) | Regression coverage |
| --- | --- |
| POLISH-001 | `apps/platform/tests/platform/editor/projectManagerZip.test.jsx`: 5 controlled tests for import start/success, invalid ZIP, entry parsing failure, export start/success/double-submit, and generation failure |
| POLISH-002–010 | `apps/platform/e2e/product-polish.spec.js`: 10 Chromium cases for mobile overflow, empty CTAs, 403 recovery, long project/game content, accessible controls, Project Manager mobile layout, real export download, and injected secondary-chunk failure |

Red-phase evidence was retained in `POLISH_HANDOFF.md`; after fixes, the focused suites pass 5/5 and 10/10.

## I. Validation

```text
npm run check: PASS
  import/config verification: PASS
  TypeScript: PASS
  unit/integration: 476/476 PASS
  production build (default heap): PASS
  artifact verification: PASS (54 client files, 0 public source maps, 0 debug fixtures)

npm run test:smoke: PASS

npm run test:e2e: 49/49 Chromium PASS
  prior release/navigation baseline: 39/39
  new product-polish regressions: 10/10

npm audit --audit-level=high: PASS at requested threshold (exit 0)
  high: 0
  critical: 0
  moderate: 7
  low: 1
```

No assertion, timeout contract, CSP, sandbox, authentication, moderation, ownership, E2E production guard, or artifact scan was weakened.

## J. Remaining P2/P3

- P2 performance follow-up: TypeScript worker remains approximately 7.0 MB uncompressed and the lazy Editor route remains approximately 4.21 MB minified. Address only in a dedicated, measured Monaco-loading investigation.
- P2 dependency follow-up: evaluate non-breaking upstream releases for the seven moderate transitive advisories; do not use the audit-proposed breaking `--force` downgrade.
- Operational follow-up: verify Firebase/R2 and optional GitHub integration against real staging fixtures.
- P3: no additional confirmed P3 defect remains in the bounded verified scope.
- Remaining P0/P1: none.

## K. Modified files

- `POLISH_HANDOFF.md`
- `PRODUCT_POLISH_REPORT.md`
- `apps/platform/e2e/product-polish.spec.js`
- `apps/platform/tests/platform/editor/projectManagerZip.test.jsx`
- `apps/platform/src/platform/LandingPage.jsx`
- `apps/platform/src/platform/developer/ProjectManager.jsx`
- `apps/platform/src/platform/player/GameDetails.jsx`
- `apps/platform/src/platform/player/GamePlayer.jsx`
- `apps/platform/src/platform/player/LibraryPage.jsx`
- `packages/engine/src/editor/App.jsx`
- `packages/engine/src/editor/components/ProjectManager.jsx`
- `packages/engine/src/editor/engineExportSources.js`

Generated `dist`, Playwright, and coverage artifacts are excluded from this source-change list. Git metadata was unavailable, so the list was reconstructed from this pass's authored files and checkpoints. `packages/engine/src/engine/core` was not changed.

## L. Final verdict

**POLISH COMPLETE WITH NON-BLOCKING FOLLOW-UPS**

All required release gates pass and no blocking defect remains in the verified scope. Stop local polish here and proceed to real staging deployment/verification.
