# Foundry Single-Host Mode Handoff

Updated: 2026-08-31 — eighth real deployment completed; RC9 operational-tooling artifact validated for controlled update  
Status: **REAL SERVER RC9 READY FOR CONTROLLED UPDATE — CLEAN-RUNNER CHROMIUM GATE REQUIRED FOR AUTOMATED DEPLOYMENT**

## RC8 real-server completion and RC9 checkpoint

- Verified RC8 archive: `Foundry-single-host-RC8-2026-08-31.zip`, SHA-256 `34932d7194543085be5ea0577bab95c7ba92a77a44338b445e1399804c8a8c5e`, payload SHA-256 `95942dbc46183cc3fb53e311c1cec876e4238d7f13e1ebcce97f7647b0b7398b`; real release ID `20260831T093104Z-34932d719454`.
- RC8 automatically removed the Foundry-owned dangling RC6 `current` link and completed the real initial install. Prebuilt verification, target-native `npm ci --omit=dev`, compiled smoke, final immutable permissions, post-hardening service-user access, atomic activation, and real systemd readiness all passed. `foundry.service` is active at `127.0.0.1:3000`; the production VM ran no Vite build. Installer peak was approximately 710 MiB memory and 339 MiB swap.
- Public Caddy/TLS acceptance passed at `https://34-173-130-145.sslip.io`: HTTP redirects to HTTPS, `/api/ready` returns HTTP/2 200, HSTS is `max-age=31536000`, and Foundry/Caddy survived service and reboot checks. Coordinated backup, backup verification, storage integrity, first-admin provisioning, public local-auth session/logout, and CSRF fail-closed checks passed.
- RC9 blocker 1 is reproduced: the `foundry doctor` wrapper launches the active release's doctor script without changing to its platform directory. Production-profile fallback therefore depends on the caller's cwd and looks for `dist/client/deployment-profile.json` under the operator's directory instead of `<release>/apps/platform`. The wrapper execution context, not production-profile validation, must be corrected.
- RC9 blocker 2 is reproduced: a valid fresh-install backup restores and reaches health/readiness, then the rehearsal hard-fails solely because no published game fixture exists. RC9 must report the published-asset check as not applicable when no fixture exists, while retaining mandatory delivery verification whenever one does.
- RC9 blocker 3 is reproduced: generated Caddy logging targets `/var/log/caddy/foundry-access.log`, but the supported bootstrap did not provision a Caddy-owned log directory. The real first reload required a manual `0750 caddy:caddy` directory repair. RC9 must make this service-owned path automatic without changing Foundry release, secret, or systemd hardening permissions.
- RC9 additionally completes the existing CI/release architecture with a protected GitHub production job: build and verify the same trusted prebuilt artifact off-host, transfer it with host-key verification, invoke `foundry update`, then require both local and public readiness. Routine application deployments must remain atomic and unattended; full real-server acceptance remains reserved for deployment, migration, auth/security, recovery, systemd, or proxy changes.

## RC9 local completion checkpoint

- Doctor root cause and correction: the operator wrapper invoked the active release's doctor by absolute script path but retained the caller's cwd, so production-profile fallback resolved under the operator directory. `foundry doctor` now drops to the service account through `env --chdir=<active-release>/apps/platform`; production configuration validation is unchanged. The deployment integration runs the operator command from both `/` and `/tmp`, requires `dist/client/deployment-profile.json` to be readable relative to the resulting cwd, and PASSes.
- Fresh rehearsal root cause and correction: the restore/health/readiness/storage checks already succeeded and published bytes were already checked whenever a fixture existed, but `requirePublishedAsset=true` converted the legitimate absence of a game into a final error. The artificial presence requirement is removed. The real CLI path now PASSes an empty backup with zero objects and `publishedAsset={status:NOT_APPLICABLE, reason:NO_PUBLISHED_FIXTURE}`; the populated fixture path still performs real CDN delivery and PASSes only with HTTP 200 and non-empty bytes.
- Caddy bootstrap correction: the generated file logger needs a Caddy-owned writable parent, while neither release nor secret permissions should change. The installer now installs a `caddy.service` drop-in containing only `LogsDirectory=caddy` and `LogsDirectoryMode=0750`. systemd creates `/var/log/caddy` for the unit's existing `User=caddy`/`Group=caddy` on start, including when the package is installed after Foundry. No Caddy access to immutable releases, `/etc/foundry`, or the `foundry` group is added.
- Deployment automation: the existing GitHub CI workflow retains cloud `check`/smoke/49-test Chromium, then on default-branch pushes builds single-host on a clean worker, runs the 3-test Chromium plus restart/integrity/backup/restore gate, verifies/smokes/releases and rehearses the exact prebuilt ZIP, and publishes it as an Actions artifact. The protected `production` job uses a pinned SSH host key, verifies the uploaded SHA-256, calls a root-owned no-argument helper which clears the environment and invokes the installed `foundry update`, then requires local and public HTTPS readiness. It never builds on target, rsyncs `current`, disables host-key checking, exposes runtime secrets, or converts failure to success.
- CI privilege boundary: `foundry configure-deploy-user USER` creates only the user's `0700` upload directory and a `visudo`-validated rule for `/usr/local/lib/foundry/ci-update.sh`. That helper accepts no arguments, derives the fixed archive path from verified `SUDO_USER`/`SUDO_UID`, requires a regular non-symlink archive owned by that user with no group/world write bit, clears all inherited environment variables, and invokes the installed atomic updater. The updater now runs the root-phase manifest verification through the installed trusted verifier rather than executable JavaScript from the candidate archive.
- Versioned installer behavior: with a valid current link the RC9 installer invokes a normal update; with absent/dangling initial state it retains RC8's safe `--initial` recovery. This provides the supported RC8-to-RC9 tooling refresh without manual filesystem edits. Routine application releases after RC9 continue to use `foundry update` only; deployment-tool changes remain full-acceptance events.
- Focused regressions: `singleHostRecovery.test.js` and `singleHostDeploymentScripts.test.js` PASS 6/6. Coverage includes empty and published backup rehearsal, caller-independent doctor cwd, existing stale/current/rollback/retention and RC7 permission invariants, systemd Caddy directory contract, trusted verifier selection, narrow CI sudo policy, pinned SSH, local/public readiness, and rejection of direct writes into `current`.
- Full unit/integration result: Platform 53/53 files and 332/332 tests PASS with zero Vitest Errors/unhandled summary. Contracts 2/2 and Player 177/177 also PASS, giving 511/511 total. TypeScript/import/config checks, 3,698-module cloud build, 54-file cloud artifact verification, and cloud compiled smoke PASS.
- Single-host browser-independent gates: 3,698-module build PASS; 51-file artifact verification PASS; compiled smoke PASS. A seeded production restart/recovery path PASSes health/readiness, Range 206, graceful shutdown, storage integrity with zero missing/orphan candidates, coordinated backup, isolated restore, and published-asset delivery. The separate fresh-backup CLI rehearsal PASSes with zero objects and `NOT_APPLICABLE` published asset.
- Chromium reporting is deliberately exact: this container's cached Playwright revision 1234 is corrupt and exits `SIGSEGV` before a browser context exists (also on direct `--version`); the permitted network could not download a replacement. The attempted current 49-test and 3-test runs therefore executed no Foundry browser assertion and are **BLOCKED, not claimed as new PASS**. RC8's real release evidence remains 49/49 and 3/3, and manifest comparison proves RC9's complete 51-file client, `dist/server.cjs`, server profile, and package lock are byte-identical to RC8. The new clean-runner GitHub jobs make both Chromium gates mandatory before any automated production deployment.
- Dependency audit exited 0: high 0, critical 0, moderate 7, low 1; no force fix. Engine core remains 19 files with zero changes and digest `8c717a20891427abb30c16f57e5b175459aaf628c0dfa9155f4fb7bc3f7cd9e9`.
- RC9 archive: `Foundry-single-host-RC9-2026-08-31.zip`, 164 ZIP entries, 128 payload files, 4,470,310 bytes. Manifest: `releaseType=foundry-single-host-prebuilt`, `deploymentMode=single-host`, `buildOnTarget=false`, `dependencyInstall=npm ci --omit=dev`, payload SHA-256 `e481504305bff364526d50b82def4e34d442ec5ce13ca0dfb52a2c10a80fd65c`, and unchanged package-lock SHA-256 `1ec6b8a1bdef5f518a1e18ed5604943b419c3eae6072868691c1e06a1867ce80`. `unzip -t` PASSes; exact archive deployment rehearsal PASSes in 35,073 ms through dependency installation, manifest/artifact/smoke, final permissions, stale-initial recovery, activation/readiness, and graceful stop with `buildExecutedOnTarget=false` and no child `NODE_OPTIONS`.
- RC9 archive SHA-256: `67510b266ffec09b33d36885662c257d9868369c92e9e3720fe1570b2309306f`. RC1–RC8 are superseded for the next controlled deployment, but only the real RC9 update can close the three operational blockers; this is not a claim of real-server acceptance.

## RC8 local completion checkpoint

- Exact reproduction before correction: with `current` symlinked to a missing generated release under `releases/`, RC7's `foundry_current_release` returned status 0 and the missing canonical target. Independently, RC7's EXIT trap removed every uncommitted `RELEASE_DIRECTORY` without checking whether `current` or `previous` still referenced it. On failed initial readiness, those behaviors created the real RC6 dangling link and made RC7 misclassify it as an installed release.
- Deployment-state contract: link inspection now distinguishes `absent`, `valid`, and `dangling`. Both valid and dangling targets must canonicalize to a direct child of the configured releases directory. Existing non-symlink objects, escaping links, existing non-directory targets, and existing releases without the required server/profile files fail closed. Normal update and rollback reject dangling `current` or `previous` with an explicit diagnostic.
- Existing-VM recovery is deliberately narrow: only `--initial`, only while `foundry.service` is inactive, and only a dangling target under `releases/` whose basename matches Foundry's generated `YYYYMMDDTHHMMSSZ-<12 lowercase hex>` release ID may be unlinked. A valid current/previous release is never discarded. The exact real RC6 state `/opt/foundry/current -> /opt/foundry/releases/20260830T120119Z-531deea30571` is automatically recovered; no manual filesystem command is part of deployment.
- Failed-initial cleanup now tracks whether `current` switched. Before deleting an uncommitted candidate it stops the candidate service, confirms `current` still targets that exact candidate, atomically unlinks it when no old release exists, or restores a still-valid old release for update failures. The generic cleanup then checks both `current` and `previous`; if either still references the candidate, the directory is retained rather than turned into a dangling link.
- Regression result: the existing 30-second deployment integration test remains one test and PASSes in 5.407 seconds locally and 10.800 seconds pinned to one CPU shared with an equal busy process. It covers failed initial activation leaving no links/release, immediate successful retry, exact RC6 stale-link recovery, retained content when unlink is forced to fail, out-of-tree/non-symlink/in-tree-invalid rejection without mutation, dangling-previous rejection, valid update readiness rollback, guarded manual rollback, and retention=2 preserving both referenced releases.
- RC7 permissions remain unchanged and PASS: finalized directories `0750 root:<service-group>`, regular files `0640`, genuine executables `0750`, world access zero, service-group write zero, post-hardening service-user read/traverse/dependency resolution, and systemd-like WorkingDirectory launch. No systemd hardening control changed.
- Exact RC8 archive rehearsal starts from the RC6 dangling-link state and PASSes in 29,825 ms through automatic recovery, archive/manifest verification, target-native `npm ci --omit=dev`, artifact verification, compiled smoke, final permissions, post-hardening access, atomic activation, real production readiness, and graceful SIGTERM. It reports `buildExecutedOnTarget=false`; no Vite, build command, heap assignment, or runtime `NODE_OPTIONS` is present. Local memory/swap peaks were not available; authoritative RC7 continuity remains approximately 690.1 MiB memory and 271 MiB swap on the e2-micro with no Vite process.
- Full Platform run 1: 53/53 files, 331/331 tests, zero Vitest Errors/unhandled summary. The CI-profile `npm run check` repeated Platform 331/331 with zero errors, Contracts 2/2 and Player 177/177, total 510/510; imports/config, TypeScript, 3,698-module cloud build, and 54-file artifact verification PASS. An initial environment-less check attempt correctly failed only at the explicit cloud/single-host build-profile guard after all 510 assertions; the authoritative rerun used the checked-in CI cloud identifiers and exited 0.
- Remaining release gates: cloud compiled smoke PASS; cloud/dev Chromium 49/49 PASS in 3.0 minutes; single-host build 3,698 modules and 51-file artifact PASS; single-host compiled smoke PASS; single-host Chromium 3/3 PASS plus restart/readiness, storage integrity (zero missing/invalid and zero orphan candidates), coordinated backup, isolated restore/boot/CDN, and graceful lifecycle PASS.
- Dependency audit exited 0: high 0, critical 0, moderate 7, low 1; no force fix. Engine core: 19 files, 0 changes, unchanged aggregate digest `8c717a20891427abb30c16f57e5b175459aaf628c0dfa9155f4fb7bc3f7cd9e9`.
- Exact repository files changed for RC8: `deploy/single-host/common.sh`, `deploy/single-host/update.sh`, `deploy/single-host/rollback.sh`, `deploy/single-host/install.sh`, `deploy/single-host/foundry`, `apps/platform/tests/platform/backend/singleHostDeploymentScripts.test.js`, `apps/platform/scripts/rehearse-prebuilt-deployment.mjs`, `apps/platform/DEPLOYMENT_RUNBOOK.md`, `RELEASE_CHECKLIST.md`, and this handoff. No application runtime source, cloud-mode logic, dependency, lockfile, timeout, systemd unit, security setting, or Engine-core file changed.
- RC7-to-RC8 archive comparison: 126 regular entries in each; only `common.sh`, `update.sh`, `rollback.sh`, `install.sh`, `foundry`, and generated `foundry-release.json` differ. All application client/server/backend payload, package files, lockfile, operational scripts, service unit, and Caddy configuration are byte-identical to RC7.
- RC8 archive: `Foundry-single-host-RC8-2026-08-31.zip`; 161 ZIP entries, 126 regular files including the manifest, 4,467,727 bytes. Manifest: 125 payload files, `releaseType=foundry-single-host-prebuilt`, `deploymentMode=single-host`, `buildOnTarget=false`, `dependencyInstall=npm ci --omit=dev`, payload SHA-256 `95942dbc46183cc3fb53e311c1cec876e4238d7f13e1ebcce97f7647b0b7398b`, and package-lock SHA-256 `1ec6b8a1bdef5f518a1e18ed5604943b419c3eae6072868691c1e06a1867ce80`. `unzip -t` and the exact archive deployment rehearsal PASS. Archive SHA-256: `34932d7194543085be5ea0577bab95c7ba92a77a44338b445e1399804c8a8c5e`.
- RC1 through RC7 are superseded for deployment. RC8 is ready for the initial-install acceptance path on the existing Google Cloud VM; only that eighth real systemd run can establish real-server acceptance.

## RC7 real-server failure checkpoint

- Concise progression: RC1 stopped with 4 failed tests / 18 errors; RC2 with 2 failed tests / 13 errors; RC3 passed 331/331 assertions but emitted 13 `DATABASE_CLOSING` errors; RC4 passed 331/331 with zero errors and then hit the approximately 512 MiB V8 heap boundary; RC5 avoided the immediate OOM with a 2 GiB heap but entered severe swap-thrashing; RC6 introduced the successful prebuilt path but failed systemd activation with `status=200/CHDIR`; RC7 retained prebuilt deployment and corrected final permissions, then stopped on a dangling `current` link left by RC6's failed initial activation.
- Verified RC7 archive: `Foundry-single-host-RC7-2026-08-30.zip`, SHA-256 `90bbaf7cf65bcd6ca006028af66f8a55f890df644d047ec654a556cd799f7362`; real release ID `20260831T074815Z-90bbaf7cf65b`.
- Real host: Google Compute Engine `e2-micro`, Debian GNU/Linux 13, Node 22.23.2, npm 10.9.8, approximately 964 MiB physical RAM, 4 GiB swap, 30 GB standard persistent disk, and real systemd.
- RC7 proved the RC6 permission correction: manifest verification, target-native installation of 479 production packages, artifact verification, compiled production smoke, and the post-hardening service-user access probes all passed. The old `status=200/CHDIR` failure did not recur before the new blocker. The immutable `0750` directory / `0640` file `root:foundry` contract remains required and is not being reverted.
- The prebuilt low-memory path also remains validated: `buildOnTarget=false`, no Vite process, 39.438 seconds installer CPU, approximately 690.1 MiB memory peak, and approximately 271 MiB swap peak. Application runtime, build payload, and dependency installation are not the blocker.
- Exact RC7 failure: updater startup treated `/opt/foundry/current -> /opt/foundry/releases/20260830T120119Z-531deea30571` as a current release even though that RC6 target no longer exists, then failed with `release is missing dist/server.cjs`. `/opt/foundry/previous` is absent and `foundry.service` is not successfully active.
- Exact stale-state cause: during RC6's initial-install readiness failure, `OLD_RELEASE` was empty after `current` had already switched to the candidate. The failure path stopped the service but did not remove or restore `current`; the EXIT trap then deleted the uncommitted candidate directory. This violated the invariant that a release directory must never be deleted while `current` or `previous` still references it.
- RC8 scope is limited to explicit deployment-link state validation, safe automatic recovery of a provably Foundry-owned dangling initial-install link, and reference-aware failed-activation cleanup. Unsafe/non-symlink/out-of-tree states must continue to fail closed. RC7 permissions, prebuilt architecture, systemd hardening, production application logic, and Engine core remain unchanged.

## RC7 local completion checkpoint

- Exact reproduction: a release whose repository is at ZIP root inherits the `mktemp -d` extraction root mode `0700`. The RC6 sequence left that bit pattern unchanged through `chmod -R go-w`, then changed ownership from `foundry:foundry` to `root:foundry`. The resulting effective contract was `0700 root:foundry`; a non-owner member of group `foundry` has no traversal bit, exactly matching systemd `status=200/CHDIR` before Node startup.
- Final permission contract: `/opt/foundry` and `/opt/foundry/releases` must remain `0750 root:foundry`; every finalized release directory is `0750 root:foundry`; regular files are `0640 root:foundry`; files that already require execute retain it as `0750 root:foundry`; npm-created symlinks are root/group-owned and are not followed by the mode transformer. World permissions are zero, the service group has no write bit, and writable database/object/backup state remains exclusively under `/var/lib/foundry`.
- Exact deployment change: `common.sh` now distinguishes the service group, deterministically finalizes directory/file modes while preserving existing executable files, verifies owner/group/mode inventory, and runs a fail-closed Node probe through `runuser` as the configured non-root service user. The probe performs the exact absolute `chdir` into `apps/platform`, reads `dist/server.cjs`, resolves and reads representative production dependencies (`express` and `jszip`), and on a real non-root account confirms both the release root and server bundle reject `W_OK`. `update.sh` invokes this only after all final ownership/mode hardening and before loading the environment, switching `current`, or calling systemd.
- Compiled smoke remains complete and still runs before final immutability because its explicit test mode intentionally starts Vite middleware and creates a Vite test cache. A temporary investigation of lazy Vite import was fully reverted; production application source and behavior are unchanged. The new post-hardening probe is write-free and validates the production filesystem contract.
- Regression gap closed: `singleHostDeploymentScripts.test.js` now begins with the real private extraction-root shape, asserts release root/platform/runtime dependency directories are `0750`, asserts server and normal dependency files are `0640`, asserts genuine executables retain `0750`, rejects group/world write and all world access, proves the post-hardening access hook runs for every attempted activation, and launches Node from the activated `current/.../apps/platform`. Focused result: 1/1 PASS in 2.43 seconds with the existing 30-second timeout unchanged.
- Exact prebuilt deployment rehearsal: PASS in 27,087 ms from archive verification through target-native `npm ci --omit=dev`, manifest/artifact/smoke, final hardening, post-hardening access check, atomic initial activation, a real production `dist/server.cjs` process using the activated WorkingDirectory, real `/api/ready`, and graceful SIGTERM shutdown. It reports directory `0750`, normal file `0640`, executable file `0750`, immutable-to-service-group true, `buildExecutedOnTarget=false`, and no child build heap setting. The local capability-restricted container cannot perform `setuid`/`chown`; its rehearsal therefore combines exact owner/mode inventory with a real production process. On the Google VM the same updater uses real `runuser --user foundry` and the non-root `W_OK` assertions before activation.
- Low-memory continuity: RC7 retains RC6's prebuilt target path and contains no Vite build or large `NODE_OPTIONS` assignment. The final local exact deployment path completed in 27.087 seconds; local memory/swap peaks were not available because GNU `time` is absent. The authoritative real RC6 path using the same 125-file runtime payload completed its installer work with 38.101 seconds CPU, 700.5 MiB memory peak, and 217.1 MiB swap peak. RC7 adds only bounded `find`/`chmod`/`chown` and read-only access checks after that path.
- Full Platform run 1: 53/53 files and 331/331 tests PASS with no Vitest Errors/unhandled-rejection summary. Full Platform run 2 inside `npm run check`: 53/53 and 331/331 PASS again; Contracts 2/2 and Player 177/177 also PASS, for 510/510 total. TypeScript, import/config checks, the 3,698-module cloud build, 54-file cloud artifact verification, and cloud compiled smoke PASS.
- Single-host build: 3,698 modules PASS; artifact verification PASS with 51 client files, `dist/server.cjs`, zero public source maps, and zero debug fixtures; compiled smoke PASS. The final RC7 and verified RC6 ZIPs have the same 126 regular-entry inventory, with differences only in `foundry-release.json`, `deploy/single-host/common.sh`, and `deploy/single-host/update.sh`. Every client, server, package, dependency lock, service unit, application source payload, and runtime script is byte-identical to RC6.
- Chromium evidence: the verified byte-identical RC6 runtime payload already passed cloud/dev Chromium 49/49 and single-host Chromium 3/3 plus restart/readiness/integrity/backup/restore. The current container's Playwright revision-1234 binary exits with `SIGSEGV` even for `--version`, so the attempted repeat never entered a Foundry test assertion. No test/config bypass was added; runtime byte identity preserves the prior gates while the new deployment-only behavior is covered separately above.
- Dependency audit exit 0: high 0, critical 0, moderate 7, low 1. No force fix. Engine core: 19 files, 0 changes, identical aggregate digest `8c717a20891427abb30c16f57e5b175459aaf628c0dfa9155f4fb7bc3f7cd9e9`.
- Exact RC7 files changed outside generated artifacts: `deploy/single-host/common.sh`, `deploy/single-host/update.sh`, `apps/platform/tests/platform/backend/singleHostDeploymentScripts.test.js`, `apps/platform/scripts/rehearse-prebuilt-deployment.mjs`, `RELEASE_CHECKLIST.md`, and this handoff. No systemd unit, application runtime source, cloud mode, dependency, lockfile, timeout, security control, or Engine-core file changed.
- RC7 archive: `Foundry-single-host-RC7-2026-08-30.zip`; 161 ZIP entries, 126 regular files including the manifest, 4,465,832 bytes. Manifest: 125 payload files, `releaseType=foundry-single-host-prebuilt`, `deploymentMode=single-host`, `buildOnTarget=false`, `dependencyInstall=npm ci --omit=dev`, payload SHA-256 `eaa25d46061cd339c5371d20d8d159a6543b87b5a1d79a4d5f1fb81a1e5dcb65`, unchanged package-lock SHA-256 `1ec6b8a1bdef5f518a1e18ed5604943b419c3eae6072868691c1e06a1867ce80`. `unzip -t` and the exact archive deployment rehearsal PASS. Archive SHA-256: `90bbaf7cf65bcd6ca006028af66f8a55f890df644d047ec654a556cd799f7362`.
- Historical local RC7 readiness is superseded by the real stale-link failure recorded above. RC8 is the only current redeploy candidate.

## RC6 real-server failure checkpoint

- Concise progression: RC1 stopped with 4 failed tests / 18 errors; RC2 with 2 failed tests / 13 errors; RC3 passed 331/331 assertions but emitted 13 `DATABASE_CLOSING` errors; RC4 passed 331/331 with zero errors and then hit the approximately 512 MiB V8 heap boundary; RC5 passed 331/331 with zero errors and avoided the immediate OOM with a 2 GiB heap but entered severe swap-thrashing; RC6 preserved 331/331 with zero errors and successfully deployed a prebuilt payload through every pre-activation gate, but systemd failed before Node startup with `status=200/CHDIR`.
- Verified RC6 archive: `Foundry-single-host-RC6-2026-08-30.zip`, SHA-256 `531deea3057136eefbb420a6f90fdf1e78918e724b0d6e06c054db7580068ebe`; real release ID `20260830T120119Z-531deea30571`.
- Real host: Google Compute Engine `e2-micro`, Debian GNU/Linux 13, Node 22.23.2, npm 10.9.8, approximately 964 MiB physical RAM, 4 GiB swap, 30 GB standard persistent disk, and real systemd.
- RC6 confirmed the prebuilt deployment design: no Vite process ran on target; the schema-1 manifest passed with `releaseType=foundry-single-host-prebuilt`, `deploymentMode=single-host`, 125 payload files, `buildOnTarget=false`, payload SHA-256 `62e0d90fe6719f79c230fef905f295efb5471097f090283465f961689d315391`, and package-lock SHA-256 `1ec6b8a1bdef5f518a1e18ed5604943b419c3eae6072868691c1e06a1867ce80`.
- Target-native `npm ci --omit=dev` installed 479 production packages in approximately 58 seconds. Post-install manifest verification passed. Artifact verification passed with 51 client files, `dist/server.cjs`, `dist/client`, zero public source maps, and zero public debug fixtures.
- Compiled smoke passed on the real VM: health/ready 200, READY/PUBLISHED lifecycle, catalog count 1, byte-range 206 (`bytes 0-8/65`), draft hidden 404, restoration, deletion, and final missing 404. This proves the prebuilt server, production dependencies, single-host configuration, SQLite, and local object paths are not the activation blocker.
- Installer accounting was 38.101 seconds CPU, 700.5 MiB memory peak, and 217.1 MiB swap peak. Compared with RC5's approximately 77 minutes at Vite `transforming...`, 1.6–1.8 GiB swap, and 78–99% I/O wait, RC6 resolves the build/swap-thrashing blocker and must not regress to on-target Vite.
- Exact activation failure: `foundry.service` runs as `foundry:foundry`, with `WorkingDirectory=/opt/foundry/current/apps/platform`. systemd failed at `CHDIR` before spawning Node: `Changing to the requested working directory failed: Permission denied` and `Failed at step CHDIR spawning /usr/bin/node: Permission denied`.
- Primary reproduced cause from the deployment sequence: when the ZIP has repository files at its root, the release root is the directory produced by `mktemp -d`, which starts private (`0700`). Pre-hardening smoke succeeds while that tree is owned by `foundry:foundry`; the final `chmod -R go-w` does not add group traversal, and `chown -R root:foundry` therefore preserves an effective `0700 root:foundry` release root. The service user ceases to be the owner and cannot traverse it. A previous real release directory was observed with the same inherited `0700` mode.
- RC6 cleanup remained fail closed: there was no compatible prior release; the service remained stopped, `current` and `previous` are absent, and the failed release directory was removed. No broken release was partially activated.
- RC7 scope is limited to an explicit least-privilege final release permission contract, a post-hardening service-user access check before symlink activation, and a rehearsal that exercises the finalized permissions and service-user working-directory transition. Production application logic, systemd hardening, prebuilt architecture, and Engine core remain unchanged.

## RC5 real-server failure checkpoint

- Progression retained: RC1 stopped with 4 failed tests / 18 errors; RC2 with 2 failed tests / 13 errors; RC3 passed 331/331 assertions but emitted 13 errors; RC4 passed 331/331 with zero errors and then hit the default approximately 512 MiB V8 heap boundary during Vite; RC5 again passed 331/331 with zero errors and avoided the immediate heap OOM, but entered severe swap-thrashing during Vite.
- Verified RC5 archive: `Foundry-single-host-RC5-2026-08-30.zip`, SHA-256 `b59393078c3df2f52fdc70cb4d312f0217d617f6e0b7bb32c42fd490f3927823`.
- Real host: Google Compute Engine `e2-micro`, Debian GNU/Linux 13, Node 22.23.2, npm 10.9.8, approximately 964 MiB physical RAM, 4 GiB swap, 30 GB standard persistent disk, and real systemd.
- Platform remained clean: 53/53 files, 331/331 tests, and zero errors/unhandled rejections. Existing targeted crypto/runtime/deployment timeouts and test-fixture queue shutdown corrections remain validated and unchanged.
- The build-only `NODE_OPTIONS=--max-old-space-size=2048` prevented the prior immediate V8 OOM but did not make the source build operationally acceptable on the real host. After approximately 1 hour 27 minutes of installer wall time, Vite had remained at `transforming...` for approximately 1 hour 17 minutes and had not completed.
- Captured Vite process: `STAT Dl`, elapsed approximately 01:17:16, CPU time approximately 00:05:47, CPU approximately 7.4%, RSS 613,464 KiB. The esbuild service remained alive. This is an I/O/paging stall, not normal CPU-bound compilation.
- Captured systemd usage: approximately 684.5 MiB memory, 764.8 MiB memory peak, approximately 1.6 GiB swap, and approximately 1.7 GiB swap peak. Representative `vmstat` showed blocked processes `b=6`, continuous swap-in/out, and I/O wait rising from 78% to 92–99% while CPU idle approached zero. RC5 therefore proves pathological swap-thrashing, even though total RAM plus swap was not exhausted.
- The operator stopped `foundry-install-rc5.service` after diagnosis. The installer and all build processes are inactive, `foundry.service` is inactive, and both `/opt/foundry/current` and `/opt/foundry/previous` are absent. No RC was partially activated.
- The RC5 3 GiB `MemAvailable + SwapFree` preflight is disproved as an adequate compiler-capacity check because it treats swap capacity as equivalent to physical working memory. RC6 must either prove a bounded practical approximately 1 GiB on-host build or remove expensive compilation from the target VM while preserving verified atomic deployment.
- RC1 through RC5 are superseded for deployment. Real-server acceptance is not claimed.

## RC6 local completion checkpoint

- A practical approximately 1 GiB on-host source build was **not proven**. The available container has approximately 16.8 GB RAM, no swap, a read-only cgroup2 mount, and no user systemd bus, so it cannot reproduce the real `e2-micro` RAM/swap/disk topology. The 1664 MiB result from a normal host is therefore not reclassified as low-memory evidence. RC6 does not run Vite on the target at all.
- Deployment/build separation: a trusted release worker runs the unchanged 3,698-module single-host build and every release gate, then `npm run release:single-host -- --output ...` emits one unified prebuilt ZIP. The existing operator UX remains one uploaded ZIP followed by `foundry update /path/to/zip`; source-only ZIPs are rejected instead of maintaining a divergent on-host-build path.
- Runtime dependencies remain target-native: the archive contains no `node_modules`. The target runs locked `npm ci --omit=dev`; a clean extracted RC6 payload installed 479 production packages, then the compiled server, artifact verifier, and smoke all executed successfully. This exact dependency strategy is also supported by the real-host evidence that RC1–RC5 all completed the larger full `npm ci` phase before reaching their later gates.
- Trust/integrity: the external ZIP SHA-256 remains the operator trust anchor and immutable release-ID input. Inside the ZIP, schema-1 `foundry-release.json` identifies `foundry-single-host-prebuilt`, the single-host profile, Node 22 minimum, `buildOnTarget=false`, exact package-lock SHA-256, sorted size/SHA-256 records for all 125 payload files, and aggregate payload SHA-256 `62e0d90fe6719f79c230fef905f295efb5471097f090283465f961689d315391`. Verification runs both before and after dependency installation; malformed profiles, missing/extra files, size/hash changes, source-only archives, symlinks, unsafe paths, tests, fixtures, maps, env/database/log artifacts, and bundled `node_modules` fail closed.
- Target sequence: archive safety and manifest verification; immutable release extraction; `npm ci --omit=dev`; repeat manifest verification; artifact hygiene; compiled smoke; pre-update backup; atomic `current`/`previous` switch; readiness; existing compatible automatic recovery; existing guarded manual rollback. The RC5 3 GiB RAM-plus-swap compiler preflight and all build/heap commands are removed.
- Focused deployment regression: 1/1 PASS with the existing 30-second test budget. It now covers source-only rejection before npm, tampered `server.cjs` rejection before npm, prebuilt initial install, failed-readiness automatic recovery, successful update, guarded rollback, persistent DB preservation, exactly three `npm ci --omit=dev` invocations, zero build/test/lint invocations on target, inherited `NODE_OPTIONS` removal, and no service heap override.
- Final disposable deployment rehearsal against the exact RC6 ZIP: PASS in 17,003 ms from `foundry update` entry through target-native production dependency installation, both verification layers, compiled smoke, atomic activation, and readiness; `buildExecutedOnTarget=false`. A separate monitored local run completed in 19,218 ms with 9.302 seconds user CPU, 7.737 seconds system CPU, zero host swap-in/out pages, and 0.01% average host I/O wait. These are local release-path measurements, not a claim about the real VM's eventual wall time or swap use.
- Full Platform: 53/53 files, 331/331 tests, zero errors/unhandled rejections. Full cloud-profile `npm run check`: Contracts 2/2, Player 177/177, Platform 331/331, total 510/510; TypeScript/import/config, 3,698-module cloud build, and 54-file artifact verification PASS.
- Remaining gates: cloud compiled smoke PASS; Chromium 49/49 PASS; single-host 3/3 PASS; restart/readiness, integrity, backup, and isolated restore rehearsal PASS; single-host 3,698-module build, 51-file artifact, and compiled smoke PASS; audit exit 0 with high 0 / critical 0 / moderate 7 / low 1; deployment shell syntax PASS.
- Production runtime proof: no application source, server lifecycle, service template, cloud mode, timeout, security configuration, scrypt/rate-limit behavior, or queue/SQLite lifecycle changed. `foundry.service.in` contains no `NODE_OPTIONS`; updater sanitizes inherited `NODE_OPTIONS` and contains no heap assignment or build command.
- Engine core against exact RC5: 19 files, 0 changes, identical aggregate digest `8c717a20891427abb30c16f57e5b175459aaf628c0dfa9155f4fb7bc3f7cd9e9`. The deployable archive contains only `packages/engine/package.json`, not Engine source.
- RC6 archive: `Foundry-single-host-RC6-2026-08-30.zip`; 161 ZIP entries, 126 regular files including the manifest, 4,464,977 bytes; `unzip -t`, internal manifest, profile, package-lock, payload hash, unsafe-path, symlink, forbidden-artifact, no-build/no-heap, artifact, smoke, and deployment rehearsal checks PASS. SHA-256: `531deea3057136eefbb420a6f90fdf1e78918e724b0d6e06c054db7580068ebe`.
- RC1 through RC5 are superseded. Only the sixth real installation on the existing Google Cloud VM can establish low-memory deployment time, swap behavior, systemd activation, and real-server acceptance.

## RC4 real-server failure checkpoint

- RC1 real installer result: 4 failed tests and 18 unhandled errors.
- RC2 real installer result: 2 failed tests and 13 unhandled errors.
- RC3 real installer result: 53/53 Platform files and 331/331 assertions PASS, but 13 unhandled `DATABASE_CLOSING` errors; installer FAIL.
- RC4 real installer result: 53/53 Platform files and 331/331 tests PASS with no Vitest Errors/unhandled-rejection summary. The fixture lifecycle correction is therefore validated on the real Node 22/e2-micro host.
- Real RC4 examples: `localUserCli.test.js` passed 2/2 with the crypto/operator test at approximately 6,005 ms; `runtimeMode.test.js` passed 8/8 with the real production-process test at approximately 8,754 ms. Existing targeted test timeouts remain unchanged.
- After the complete clean Platform gate, `npm run build` entered Vite 6.4.3 `transforming...` and terminated with code 134: `FATAL ERROR: Reached heap limit — Allocation failed - JavaScript heap out of memory`. Reported V8 heap was approximately 480–495 MB.
- Whole-installer peak was approximately 740.8 MB physical memory and 635.2 MB swap. The VM had 4 GiB swap, so the captured failure was a Node/V8 heap boundary, not exhaustion of total RAM plus swap.
- RC4 archive verified on the VM: `Foundry-single-host-RC4-2026-08-30.zip`, SHA-256 `69b56f6ee98fbb93db0d5bd2908932d9ceacaa40a356f5e6b1b98c16ae40d884`.
- RC1 through RC4 are superseded for deployment. The RC5 task is restricted to the low-memory single-host build contract unless a separate defect is reproduced.

## RC5 local completion checkpoint

- Exact cause of the RC4 build failure: the installer/update build command supplied no old-space override, so Node 22/V8 used its memory-aware default heap boundary on the approximately 1 GiB host. The real Vite transform reached that effective boundary at approximately 480–495 MiB. Swap increases available backing memory but does not increase V8's selected heap limit, so the process terminated with code 134 before total RAM plus swap was exhausted.
- Exact Node 22.23.2 focused matrix: `--max-old-space-size` values 512, 640, 704, 768, 832, 896, 1024, 1280, and 1536 MiB all reproduced `Reached heap limit` during the 3,698-module Vite transform. Values 1664 and 1792 MiB passed, and the selected 2048 MiB value passed repeatedly. At 2048 MiB, V8 reports a 2,096 MiB total heap limit.
- Selected build contract: only the `npm run build` child receives `NODE_OPTIONS=--max-old-space-size=2048`. This is bounded, supplies 384 MiB (approximately 23%) old-space headroom over the lowest observed pass at 1664 MiB, and stays below half of the accepted approximately 5 GiB RAM-plus-swap capacity. All other updater npm phases explicitly remove inherited `NODE_OPTIONS`.
- Early capacity check: `update.sh`, used by both install and update, now requires at least 3,221,225,472 currently available bytes (3 GiB) across `/proc/meminfo` `MemAvailable` plus `SwapFree` before extraction, dependency installation, tests, or build. This leaves approximately 976 MiB beyond the measured 2,096 MiB V8 heap limit for npm, native allocations, and the OS. The runtime-oriented post-install doctor is unchanged; the deployment runbook records the build contract.
- Runtime proof: `foundry.service.in`, `install.sh` environment generation, and application runtime configuration are unchanged and contain no `NODE_OPTIONS`. The deployment regression starts with a contaminated parent `NODE_OPTIONS=--max-old-space-size=64`, proves non-build phases see it unset, proves only each build sees 2048, and proves the service template contains no heap override.
- Exact RC5 source delta against the verified RC4 archive: `deploy/single-host/update.sh`, `apps/platform/tests/platform/backend/singleHostDeploymentScripts.test.js`, and `apps/platform/DEPLOYMENT_RUNBOOK.md`. This handoff is maintained outside the deployment archive. No production application source, cloud-mode source, timeout, security setting, or Engine-core file changed.
- Focused deployment regression: 1/1 PASS in 824 ms with the existing 30-second test timeout unchanged. It covers the 3 GiB preflight failure before npm, initial install, failed update plus automatic recovery, successful update, guarded rollback, build-only heap scoping, and runtime non-inheritance. Deployment shell syntax PASS.
- Focused production build: official Node 22.23.2 and npm 10.9.8, single-host profile, `NODE_OPTIONS=--max-old-space-size=2048`, 3,698 modules, PASS repeatedly. Single-host artifact scan PASS with 51 files, server bundle present, zero public source maps, and zero debug fixtures; compiled smoke PASS.
- Full Platform: 53/53 files and 331/331 tests PASS with zero errors/unhandled rejections. Full cloud-profile `npm run check`: PASS; Contracts 2/2, Player 177/177, Platform 331/331, total 510/510; TypeScript, 3,698-module cloud build, and 54-file cloud artifact scan PASS.
- Release gates: cloud compiled smoke PASS; cloud/dev Chromium 49/49 PASS; single-host Chromium 3/3 PASS; restart, storage integrity, backup, and isolated restore rehearsal PASS; single-host artifact and compiled smoke PASS.
- Dependency audit: exit 0; high 0, critical 0, moderate 7, low 1. Engine core against exact RC4: 19 files, 0 changes, identical aggregate digest `8c717a20891427abb30c16f57e5b175459aaf628c0dfa9155f4fb7bc3f7cd9e9`.
- RC5 archive: `Foundry-single-host-RC5-2026-08-30.zip`; 486 entries; 899,798 bytes; path manifest identical to RC4; exactly the three intended source entries differ. `unzip -t`, source-entry hashes, unsafe-path, symlink, runtime-artifact, and Engine-core checks PASS. SHA-256: `b59393078c3df2f52fdc70cb4d312f0217d617f6e0b7bb32c42fd490f3927823`.
- At this checkpoint RC5 was locally ready, but the subsequent real run disproved its on-host build contract. RC5 is superseded by the prebuilt RC6 format above.

## RC3 real-server failure checkpoint

- RC1 real installer result: 4 failed tests and 18 unhandled errors.
- RC2 real installer result: 2 failed tests and 13 unhandled errors.
- RC3 real installer result: 53/53 Platform files and 331/331 assertions PASS, but Vitest reported 13 unhandled `DATABASE_CLOSING` errors and exited 1; installer status: `1/FAILURE`.
- RC3 archive verified on the VM: `Foundry-single-host-RC3-2026-08-29.zip`, SHA-256 `4b42fdbd9c13091e2acd381d0b06ebc528406c9f57926177813067c2693b70d3`.
- The two RC2 low-CPU timeout failures are fixed on the real Node 22/e2-micro host. The 15-second `runtimeMode` timeout, 30-second deployment-test timeout, and existing targeted crypto timeout remain unchanged.
- Real RC3 evidence disproved the previous classification that all 13 `DATABASE_CLOSING` errors were caused only by timed-out tests. A `LocalJobQueue.poll` callback could reach `LocalSqliteProvider.claimNextJob` after database shutdown began. At this checkpoint the exact lifecycle owner and production relevance were not yet classified; the RC4 checkpoint below records the resolved classification.
- Peak memory was approximately 772.4 MB and swap peak approximately 640.7 MB. The failure was not OOM.

## RC4 local completion checkpoint

- Exact root cause: `createApp()` constructs a real asynchronous `LocalJobQueue` when a queue is not injected. Six backend test fixtures closed their `LocalSqliteProvider` or raw SQLite handle without first stopping the app-owned queue. On a fast host the file could end before the one-second interval fired again; on the constrained Node 22 host, old interval callbacks survived into later tests and called `claimNextJob()` after `close()` set the provider's fail-closed `closing` flag, producing unhandled `DATABASE_CLOSING` rejections.
- Deterministic pre-fix reproduction: with `discoveryRetention.test.js` pinned to one CPU shared with eight busy workers, all 11 assertions passed but Vitest reported 4 unhandled `DATABASE_CLOSING` errors and exited 1. The stack matched the real RC3 stack through `LocalJobQueue.poll` and `Timeout._onTimeout`.
- Classification: test-fixture-only lifecycle ownership bug. Production `server.js` already stops new HTTP/cleanup admission, awaits active cleanup scheduling, awaits `jobQueue.stop()` together with HTTP close, and only then awaits `database.close()`. `LocalJobQueue.stop()` already sets `stopping`, clears the interval, and awaits both `activePoll` and `activeJobs`. No production source or `LocalSqliteProvider` behavior changed.
- Enforced fixture invariant: stop queue admission; cancel its scheduled interval; drain any in-flight poll/jobs; only then close SQLite. The expanded `jobQueue.test.js` regression holds a real-provider poll in flight, verifies `stop()` waits, closes the provider after drain, advances beyond three poll intervals, and verifies that no second `claimNextJob()` occurs.
- Exact changed tests: `api.test.js`, `auth.test.js`, `directAssetDelivery.test.js`, `discoveryRetention.test.js`, `editorAndModeration.test.js`, `uploadRecovery.test.js`, and `jobQueue.test.js`. The first six now stop their app-owned queue before provider close; the seventh contains the shutdown regression. No production file changed.
- Focused post-fix result: `jobQueue` plus `discoveryRetention` 2/2 files and 18/18 tests PASS with zero unhandled errors. Under the same one-CPU/eight-busy-worker contention: 2/2 files, 18/18 tests PASS, zero errors, Vitest duration 9.82 seconds. All eleven relevant queue-owning fixture files passed 67/67 tests with zero errors.
- Full Platform run 1: 53/53 files, 331/331 tests, zero errors/unhandled rejections. Full Platform run 2, pinned to one CPU with two busy workers: 53/53 files, 331/331 tests, zero errors/unhandled rejections, 70.45 seconds.
- Full cloud-profile `npm run check`: PASS; imports/config, TypeScript, Contracts 2/2, Player 177/177, Platform 331/331, total 510/510, cloud production build 3,698 modules, and 54-file artifact scan PASS.
- `npm run test:smoke`: PASS after both cloud and single-host builds. Cloud/dev Chromium: 49/49 PASS. Single-host Chromium: 3/3 PASS; restart, integrity, backup, and isolated restore rehearsal PASS. Single-host build: 3,698 modules; 51-file artifact scan PASS.
- `npm audit --audit-level=high`: exit 0; high 0, critical 0, moderate 7, low 1. Deployment shell syntax PASS.
- Engine core comparison against exact RC3: 19 files, 0 changes; aggregate digest `8c717a20891427abb30c16f57e5b175459aaf628c0dfa9155f4fb7bc3f7cd9e9`.
- RC3 targeted timeouts remain unchanged: 15 seconds for the real production-process test and 30 seconds for the deployment lifecycle integration test. Existing targeted crypto timeout, scrypt, rate limiting, cloud mode, and production security remain unchanged.
- RC4 archive: `Foundry-single-host-RC4-2026-08-30.zip`; 486 entries; 898,640 bytes; manifest identical to RC3; exactly the seven intended test entries differ; `unzip -t`, source-entry hashes, unsafe-path, symlink, runtime-artifact, and Engine-core checks PASS. SHA-256: `69b56f6ee98fbb93db0d5bd2908932d9ceacaa40a356f5e6b1b98c16ae40d884`.
- RC1, RC2, and RC3 are superseded for deployment. Only a new real Google Cloud RC4 installation can establish real-server acceptance.

## RC2 real-server failure checkpoint

- RC1 real installer result: 4 failed tests and 18 unhandled errors. RC1 remains superseded for deployment.
- RC2 real installer result: 2 failed test files / 51 passed, 2 failed tests / 329 passed, and 13 unhandled errors. Installer exit status: `1/FAILURE`.
- RC2 archive verified on the VM: `Foundry-single-host-RC2-2026-08-29.zip`, SHA-256 `74744928722d50189b1f993d7660b201ce53ae37d5e2becd538bcbe4d6daacba`.
- RC2 remaining failure 1: `runtimeMode.test.js` — default 5,000 ms timeout in `terminates the actual production server process before exposing...`.
- RC2 remaining failure 2: `singleHostDeploymentScripts.test.js` — default 5,000 ms timeout in `installs, automatically recovers a failed update, and performs a guarded application rollback`; the real host reported approximately 9,497 ms elapsed.
- RC2 produced 13 `DATABASE_CLOSING` unhandled errors from `LocalJobQueue.poll` after the two timeouts. A local RC3 run did not reproduce them, but the real RC3 run produced the same 13 errors with all 331 assertions passing. RC3 therefore established a lifecycle race rather than timeout artifacts; RC4 identifies it as leaked test-fixture queue ownership.
- The previous targeted crypto timeout is validated by the real Node 22/e2-micro host: `localAuth.integration.test.js` passed 8/8, including the durable per-account login limit, in 11,231 ms. Scrypt and rate limiting remain unchanged.
- Other real RC2 evidence retained: `uploadValidation` 6/6 PASS, `singleHostRecovery` 4/4 PASS, Player 177/177 PASS, no external-`zip` failure, peak memory approximately 766.6 MB, swap peak approximately 533.2 MB, and no OOM.
- RC3 scope is restricted to the two named test time budgets plus documentation unless a separate production defect is reproduced.

## RC3 local completion checkpoint

- Exact source changes against RC2: `apps/platform/tests/platform/backend/runtimeMode.test.js` and `apps/platform/tests/platform/backend/singleHostDeploymentScripts.test.js` only. This handoff is updated outside the deployment archive. No production file changed.
- `runtimeMode` root cause: the child must load and evaluate `server.js`'s static ESM import graph before `startServer()` can execute the fail-closed assertion. Under ten equal-priority busy processes pinned to the same CPU, the real child exited 1 after 7,982 ms, contained `E2E_MODE cannot be enabled`, and never emitted `server_started`.
- `runtimeMode` timeout: 15,000 ms, explicit on that test only. This gives approximately 1.88x headroom over the measured 7,982 ms constrained lifecycle while retaining all exit/error/listening assertions.
- Deployment-test root cause: one test performs three JSZip fixture builds plus initial install, failed update with automatic recovery, successful update, and guarded manual rollback through real shell/filesystem/process operations. It reproduced the default timeout at 7,447 ms under eight same-CPU busy processes; the real e2-micro reported approximately 9,497 ms.
- Deployment-test timeout: 30,000 ms, explicit on that test only. This gives approximately 3.16x headroom over the real 9,497 ms result while keeping every install/recovery/update/rollback phase and assertion.
- Normal focused result: 2/2 files and 9/9 tests PASS. Constrained result: `runtimeMode` 8/8 PASS with the process test at 6,428 ms; deployment scripts 1/1 PASS at 5,002 ms. No global Vitest timeout changed.
- Local full Platform result before deployment: 53/53 files, 331/331 tests, and 0 unhandled errors. This local observation did not reproduce the timing-sensitive race and is superseded for lifecycle classification by the real RC3 result above.
- Full cloud-profile `npm run check`: PASS, 510/510 tests (Contracts 2, Player 177, Platform 331), TypeScript, 3,698-module production build, and 54-file cloud artifact scan.
- Compiled smoke PASS; cloud/dev Chromium 49/49 PASS in 2.3 minutes.
- Single-host gates PASS: fresh 3,698-module build, 51-file artifact scan, Chromium 3/3, restart health/ready 200, Range 206, integrity 0 missing/invalid and 0 orphan, backup 4 objects / 12,739 bytes, and isolated restore health/ready/CDN 200.
- `npm audit --audit-level=high`: exit 0; high 0, critical 0, moderate 7, low 1. Deployment shell syntax PASS.
- Engine core comparison against exact RC2: 19 files, 0 changes; aggregate digest remained `8c717a20891427abb30c16f57e5b175459aaf628c0dfa9155f4fb7bc3f7cd9e9`.
- RC3 archive: `Foundry-single-host-RC3-2026-08-29.zip`; 486 entries; 898,234 bytes; `unzip -t`, identical RC2 path manifest, source-entry hashes, path/symlink/runtime-artifact scans PASS; SHA-256 `4b42fdbd9c13091e2acd381d0b06ebc528406c9f57926177813067c2693b70d3`.
- RC1, RC2, and RC3 are superseded for deployment. Only the existing real Google Cloud VM can establish real-server acceptance by running the validated RC4 archive.

## Real GCP e2-micro acceptance checkpoint

- Environment verified by the operator: Google Cloud Compute Engine `e2-micro`, 2 shared vCPU visible, approximately 964 MiB RAM, 4 GiB swap, 30 GB standard persistent disk, Debian GNU/Linux 13, Node 22.23.2, npm 10.9.8, and real systemd.
- Prepared public origin: `https://34-173-130-145.sslip.io`; Caddy/TLS acceptance has not run because installation did not complete.
- Exact RC1 source archive was verified on the server: `Foundry-single-host-RC-2026-08-28.zip`, SHA-256 `bd63e1833a9a636afe9836f114e837a58bc15fe1bddb640f2844fd53651489b3`.
- Real invocation: `deploy/single-host/install.sh --archive ~/Foundry-single-host-RC-2026-08-28.zip --public-url https://34-173-130-145.sslip.io`, executed through `systemd-run` so SSH disconnects could not terminate it.
- Installer reached `npm test` and failed: 4 failed / 49 passed test files; 4 failed / 327 passed tests; 18 unhandled errors; exit code 1. Peak memory was approximately 622.8 MB and swap peak approximately 216 KB, so the captured failure was not RAM exhaustion.
- Confirmed failed tests from the operator log: local-auth durable per-account rate limit (5237 ms), privileged local-user CLI lifecycle (5239 ms), and atomic deployment scripts (about 251 ms). The fourth failed test is not yet identified and must not be invented.
- Evidence-backed RC1 causes were reproduced and fixed as recorded below. RC1 is superseded and must not be redeployed.
- Corrected archive: `/workspace/scratch/4804d1baf603/Foundry-single-host-RC2-2026-08-29.zip`; SHA-256 `74744928722d50189b1f993d7660b201ce53ae37d5e2becd538bcbe4d6daacba`.

## Baseline

- Product QA and Product Polish were complete before this adaptation.
- Inherited baseline: 476/476 unit/integration, 49/49 Chromium, production build/artifact/smoke, and high-severity dependency audit PASS.
- Current total after single-host coverage: 510/510 unit/integration PASS.
- Required dependency direction remains Platform → Player → Engine / Contracts.
- `packages/engine/src/engine/core` was not changed.
- Git metadata is unavailable; modified-file inventory was checked against the last Product Polish source archive.

## Completed

- Explicit fail-closed `cloud` and `single-host` production modes.
- Distinct schema-2 browser build profiles; cloud retains Firebase identity binding, single-host requires no Firebase identifiers, and runtime rejects a build/mode mismatch.
- Production local object provider under `<FOUNDRY_DATA_DIR>/objects`, reused through the existing upload/version/READY/publish/CDN/Player pipeline.
- Local production register/login/current-session/logout, stable SQLite UID/roles, scrypt passwords, hashed opaque sessions, secure cookies, exact-Origin/CSRF enforcement, and durable auth limits.
- Operator `create-user`, `reset-password`, `disable-user`, and `enable-user` flows; elevated roles require deliberate confirmation and no public elevation API exists.
- Coordinated SQLite + object backup, hash manifest, no-overwrite restore, integrity verification, and isolated boot/CDN rehearsal.
- Generic Linux systemd/Caddy assets, initial install, atomic one-command update with pre-update backup/readiness rollback, guarded application rollback, and doctor/operator command.
- Production-like single-host Chromium, restart persistence, storage integrity, backup/restore, cloud-compatible regression, artifact verification, and dependency audit.
- `RELEASE_CHECKLIST.md` and the authoritative operations/recovery/deployment docs are synchronized.
- Final report: `SINGLE_HOST_REPORT.md`.
- RC1 is retained only as failure evidence and is superseded for deployment.
- Clean RC2 source/update archive: `/workspace/scratch/4804d1baf603/Foundry-single-host-RC2-2026-08-29.zip`; 486 files; `unzip -t`, required-file/source-hash, path/symlink, runtime-state, and secret-pattern scans PASS; SHA-256 `74744928722d50189b1f993d7660b201ce53ae37d5e2becd538bcbe4d6daacba`. Session handoff/report files are deliberately outside the archive.

## In progress

- No local RC8 code or validation gate remains. Await the eighth real deployment run on the existing Google Cloud VM; do not manually remove its RC6 dangling `current` link before invoking the RC8 initial installer.

## Real-failure reproduction findings

- Normal local focused run: the three named files passed 3/3 files and 11/11 tests; the two crypto-heavy tests completed in about 1.0 s and 0.7 s on the current host.
- Controlled single-core contention reproduced the default 5-second Vitest boundary without changing production code: the durable-login-rate test timed out at 5057 ms and the local-user CLI lifecycle test at 5260 ms. Their existing assertions exercise the real scrypt, durable limiter, CLI prompts, account state transitions, and final password verification. This supports narrow per-test time budgets, not lower crypto cost or a global timeout.
- A PATH with Node but no `zip` reproduced the deployment-test failure in 10 ms at its `spawnSync('zip', ...)` fixture builder. Runtime install/update only extract ZIPs with `unzip`, and the repository already ships JSZip; `zip` is therefore an unintended test-only host dependency, not a supported-host prerequisite.
- The 18 supplied `ERR_INVALID_STATE: database is not open` signatures were reproduced deterministically by creating a normal app, directly closing its SQLite handle, and leaving its one-second `LocalJobQueue` poller running. Stopping the queue and then awaiting `LocalSqliteProvider.close()` produced zero unhandled rejections. Production shutdown already uses that order, and existing transaction-close coverage passes; the evidence identifies a test teardown leak in `uploadValidation`/`catalogPagination`, not an independently reproducible production DB lifecycle race.
- The exact fourth failed GCP test file is absent from the captured logs, workspace artifacts, and prior context. It remains **NOT IDENTIFIED**; a synthetic extra timeout under harsher contention is not being mislabeled as that real failure.
- RC2 narrowed the real failure to exactly the two default 5,000 ms timeouts. Both were reproduced locally under pinned-CPU contention without changing production code.
- Direct constrained `server.js` measurement proved the process still terminates fail-closed: exit 1, expected safety error, and no listening marker after 7,982 ms.
- The deployment test's measured constrained lifecycle and real 9,497 ms e2-micro duration reflect its multi-phase filesystem/process work, not a skipped or weakened deployment assertion.

## Real-failure fixes completed

- Added a 15-second timeout only to the two real crypto-heavy failures. No global timeout, scrypt parameter, rate-limit behavior, CLI confirmation, or assertion changed.
- Replaced only the deployment test fixture's `spawnSync('zip')` archive builder with the repository's existing JSZip dependency. Install/update continue to require `unzip`; operators do not need the unrelated archive-creation binary `zip`.
- Updated `uploadValidation` and `catalogPagination` teardown to stop their app job queues and await the provider's guarded `close()` before removing test state. No production DB or shutdown code changed.
- Focused result: 5/5 files and 21/21 tests PASS. The deployment test also passes with a PATH-prepended `zip` command that always exits 1, proving it is no longer invoked.
- Constrained result: each named crypto-heavy test PASS while pinned to one CPU shared with one equal-priority busy process (rate-limit 1781 ms; CLI 1075 ms). An intentionally unrealistic two-hog/higher-priority stress run exceeded 15 seconds; it is recorded as a stress limit, not used to weaken security or inflate a global timeout.
- RC3 adds 15,000 ms only to the production-process fail-closed test and 30,000 ms only to the atomic deployment lifecycle test. No global timeout, production startup/shutdown, security configuration, shell phase, or assertion changed.
- A local 331/331 Platform run emitted 0 unhandled errors, but the real RC3 Node 22/e2-micro run emitted 13 `DATABASE_CLOSING` errors with the same 331/331 assertions passing. The former cascading-timeout classification is withdrawn; RC4 reproduces and fixes the fixture lifecycle leak as recorded above.

## DEPLOY-001 — single-host compiled smoke harness — FIXED

- **Expected:** after `update.sh` builds a single-host artifact, its mandatory `npm run test:smoke` validates that artifact before activation.
- **Actual:** an explicit run against the single-host build failed first on missing `LOCAL_AUTH_SESSION_SECRET`, then (when supplied externally) on `ORIGIN_DENIED` because the cloud-era harness sent no Origin header.
- **Root cause:** the shared compiled smoke harness enables its explicit test-only auth bypass but did not provide the single-host local-auth constructor inputs or same-origin mutation header. RC1 stopped earlier at `npm test`, so the real VM did not yet reach this deterministic failure.
- **Minimal fix:** the harness now generates ephemeral smoke-only session/storage secrets, binds its public origin to the existing loopback smoke URL, and sends that exact Origin on API/upload calls. Production auth/CSRF configuration and application code remain unchanged.
- **Regression:** the exact installer-equivalent command with all production/profile/test variables explicitly unset now PASSes against the single-host artifact: health/ready 200, READY/PUBLISHED, Range 206, lifecycle gates, and graceful shutdown.

## Auth

- Password hashing: Node `crypto.scrypt`, N=32768, r=8, p=1, random 16-byte salt, 64-byte key, timing-safe comparison.
- Sessions: 32 random bytes; only SHA-256 token hashes persisted.
- Production cookie: `__Host-foundry_session`; HttpOnly, Secure, SameSite=Strict, Path=/, bounded expiry.
- CSRF: session-bound HMAC plus exact configured Origin on authenticated mutations.
- Rate limits: existing durable SQLite limiter for register/login, including normalized account identity.
- Stable `uid`/`DEVELOPER|MODERATOR|ADMIN` contract continues to drive ownership, library, ratings, follows, projects, editor, and moderation.
- Anonymous session discovery returns HTTP 200 signed-out state; invalid/expired supplied sessions and protected APIs remain 401/403.
- Password reset/disable revokes sessions. Self-service email recovery is intentionally unavailable in v1.

## Storage

- Production root: `<FOUNDRY_DATA_DIR>/objects`; incomplete writes: `objects/.tmp`.
- Signed bounded same-origin PUT, metadata/ETag, HEAD/full/Range GET, list, delete, readiness, and integrity inventory are implemented.
- Absolute/drive/NUL/dot/traversal keys and symlinks are rejected.
- Writes use temp file → fsync → atomic rename; the temp directory is recreated before each write if an operator/test cleanup removed it.
- Object bytes are private. All public reads continue through the existing publication/moderation-aware Platform CDN gate.
- Cloud R2 implementation and verifiers remain intact.

## Backup

- `foundry backup` captures verified committed-WAL SQLite state plus the local object tree and a portable manifest with hashes/counts/bytes/schema metadata.
- Secrets, `.env`, TLS keys, symlinks, special files, and partial `.tmp` uploads are excluded.
- Restore requires a new empty root and never overwrites active data implicitly.
- Strict rehearsal boots the restored app and requires health, readiness, integrity, and a real ACTIVE/PUBLISHED fixture through the CDN gate.
- Final evidence: health/ready 200; Range 206; integrity 0 missing/invalid and 0 orphan; backup 4 objects / 12,739 bytes; restored CDN asset 200.
- A backup retained only on the same disk is not disaster recovery.

## Deploy tooling

- `/opt/foundry/releases/<id>` immutable releases; `current` and `previous` symlinks.
- `/var/lib/foundry` persistent DB/objects/backups; `/etc/foundry` secrets/proxy config.
- `deploy/single-host/install.sh` performs one-time install and readiness verification.
- `foundry update /path/to/Foundry.zip` validates, installs/checks/builds, backs up, switches, restarts, verifies readiness, and automatically restores the prior compatible application release on failure.
- `foundry rollback` refuses migration-incompatible application rollback and never downgrades the DB.
- `foundry doctor` checks runtime/profile/data/disk/SQLite/migration/storage/service/backup state without printing secrets.
- Disposable tooling regression PASS. The RC1 installer ran through real systemd to the test gate; service activation and Caddy/TLS remain outstanding because RC1 correctly stopped on failure.

## Tests passed

- Post-fix focused regressions: 5/5 files, 21/21 tests PASS (`localAuth`, `localUserCli`, deployment scripts, upload validation, catalog pagination).
- Deployment missing-`zip` guard: 1/1 PASS with `zip` shadowed by `/usr/bin/false`.
- One-CPU moderate-contention crypto checks: durable rate-limit 1/1 PASS; privileged CLI lifecycle 1/1 PASS.
- Post-fix authoritative cloud `npm run check`: PASS; import/config verification, TypeScript, Contracts 2/2, Player 177/177, Platform 331/331 across all 53 files, cloud production build (3,698 modules), and artifact scan (54 client files, 0 public maps/debug fixtures). No unhandled Vitest errors occurred.
- Final post-`DEPLOY-001` cloud gates: `npm run check` PASS (510/510), compiled smoke PASS, and Chromium 49/49 PASS in 3.2 minutes.
- Final single-host gates: fresh 3,698-module build; Chromium 3/3 PASS; restart health/ready 200; Range 206; integrity 0 missing/invalid and 0 orphan; backup 4 objects / 12,739 bytes; isolated restore health/ready/CDN PASS.
- Final single-host artifact scan: PASS, 51 client files, backend only `dist/server.cjs`, 0 public source maps, 0 debug fixtures.
- Final installer-equivalent single-host smoke with deployment/test/local secrets unset: PASS, including graceful shutdown.
- Final dependency audit: exit 0; high 0, critical 0, moderate 7, low 1. No force fix.
- Engine-core comparison against exact RC1: 19 files checked, 0 mismatches.
- Deployment shell syntax: PASS.
- `npm ci`: PASS, 584 packages.
- `npm run check` in cloud profile: PASS; 510/510 total tests (Contracts 2, Player 177, Platform 331), TypeScript, production build, and artifact scan.
- `npm run test:smoke`: PASS against the compiled cloud-compatible production artifact.
- `npm run test:e2e`: 49/49 PASS; default Playwright config excludes the separate single-host spec.
- `npm run test:e2e:single-host`: PASS on the final tree after a fresh 3,698-module production build; Chromium 3/3 in 14.5 s plus restart/integrity/backup/restore rehearsal.
- Final single-host artifact scan: PASS; 51 client files, backend only `dist/server.cjs`, 0 public source maps, 0 debug fixtures.
- Deployment tooling: `bash -n` PASS for all shell files; disposable install/update/automatic rollback/manual rollback 1/1 PASS.
- `npm audit --audit-level=high`: exit 0; high 0, critical 0, moderate 7, low 1. No force fix applied.
- RC3 normal focused tests: 2/2 files, 9/9 tests PASS (`runtimeMode`, deployment scripts).
- RC3 constrained focused tests: `runtimeMode` 8/8 PASS (process test 6,428 ms); deployment scripts 1/1 PASS (5,002 ms).
- RC3 full Platform: 53/53 files, 331/331 tests, 0 unhandled errors.
- RC3 full check and release gates: 510/510, smoke PASS, cloud/dev Chromium 49/49, single-host Chromium 3/3 plus restart/integrity/backup/restore PASS, cloud artifact 54 files, single-host artifact 51 files, audit high 0 / critical 0, Engine core 0 changes.

## Tests failed

- Real GCP installer gate: 4 failed test files, 4 failed tests, and 18 unhandled errors. Installation stopped correctly before build/service activation.
- Known named failures: `localAuth.integration.test.js`, `localUserCli.test.js`, and `singleHostDeploymentScripts.test.js` as recorded above.
- The fourth failed test remains unidentified because the available real-host output contains no filename for it.
- Earlier RC1 teardown leaks were fixed, but the RC3 real-host result proved that additional queue-owning fixtures remained. RC4 classifies and fixes those remaining fixture leaks; production shutdown ordering was already correct and remains unchanged.
- One deliberately harsher-than-target synthetic run (two higher-priority busy loops on the test's sole CPU) exhausted the new 15-second per-test budget. This does not match the real VM evidence (5237 ms with no OOM) and is not a supported-host acceptance result.
- Pre-fix installer-equivalent single-host smoke failed on missing local session secret, then on `ORIGIN_DENIED`; `DEPLOY-001` now has a passing exact-command regression.
- Real RC2 installer gate: 2 failed test files / 51 passed, 2 failed tests / 329 passed, and 13 unhandled errors. The exact failures were the default-5,000 ms `runtimeMode` and deployment-script timeouts. RC2 stopped correctly and is superseded.
- Real RC3: 53/53 files and 331/331 assertions PASS, but 13 unhandled `DATABASE_CLOSING` errors caused Vitest and the installer to fail. Real-server acceptance is not claimed.

## Cloud regression

- Firebase Web/Admin and R2 production providers, Firestore rules/config, and live staging verifiers were retained.
- Cloud production configuration remains fail-closed on Firebase/R2/SQLite/build identity.
- Local cloud-compatible gates passed: 510/510, build/artifact, compiled smoke, and 49/49 Chromium.
- No real Firebase project, token, R2 bucket, or cloud staging URL was contacted; do not label these results `VERIFIED AGAINST STAGING`.

## Modified files

Full grouped inventory is in `SINGLE_HOST_REPORT.md` section K. Main groups:

- `.github/workflows/ci.yml`, root `package.json`, `RELEASE_CHECKLIST.md`, this handoff, and `SINGLE_HOST_REPORT.md`.
- Platform `.env.example`, package/build/server/Playwright configuration, deployment/recovery/operations docs.
- Local auth/context/API, deployment-mode/config/provider, SQLite/migrations, rate limits, recovery, server routing, and local storage source.
- Single-host build/operator/recovery scripts and separate Chromium/persistence harness.
- Focused auth/storage/config/migration/recovery/deployment tests.
- All eight files under `deploy/single-host/`.
- No Engine core file.
- Real-server regression patch: `localAuth.integration.test.js`, `localUserCli.test.js`, `singleHostDeploymentScripts.test.js`, `uploadValidation.test.js`, and `catalogPagination.test.js`; this handoff is synchronized.
- `DEPLOY-001`: `apps/platform/scripts/smoke-production.mjs` only.
- RC3 regression patch: `apps/platform/tests/platform/backend/runtimeMode.test.js` and `apps/platform/tests/platform/backend/singleHostDeploymentScripts.test.js` only; this handoff records the checkpoint. No Engine core or production file changed.
- RC5 regression patch against exact RC4: `deploy/single-host/update.sh`, `apps/platform/tests/platform/backend/singleHostDeploymentScripts.test.js`, and `apps/platform/DEPLOYMENT_RUNBOOK.md` only. No production application, cloud-mode, timeout, security, or Engine-core source changed.
- RC6 delta against exact RC5: `package.json`, `RELEASE_CHECKLIST.md`, `apps/platform/DEPLOYMENT_RUNBOOK.md`, `apps/platform/scripts/create-single-host-release.mjs`, `apps/platform/scripts/rehearse-prebuilt-deployment.mjs`, `apps/platform/scripts/smoke-production.mjs`, `apps/platform/tests/platform/backend/singleHostDeploymentScripts.test.js`, `deploy/single-host/foundry`, `deploy/single-host/install.sh`, `deploy/single-host/release-manifest.mjs`, and `deploy/single-host/update.sh`; this handoff is synchronized outside the ZIP. No production application source or Engine core changed.
- RC7 delta against exact RC6 runtime: `deploy/single-host/common.sh` and `deploy/single-host/update.sh` in the ZIP; the deployment regression, exact rehearsal, and this handoff are maintained outside it. No application runtime source, systemd unit, dependency, lockfile, cloud-mode source, or Engine core changed.

## Known limitations

- No self-service email password recovery in v1.
- One server/disk is a single point of failure; off-host copies are operator-owned.
- Application rollback cannot and must not downgrade a migration.
- General local gates ran on Node 24.19.0, which satisfies `>=22`; the focused heap matrix ran on exact Node 22.23.2/npm 10.9.8, and checked-in CI targets Node 22.
- The lazy Editor bundle remains large and intentionally unchanged.
- Real TLS, proxy hops, firewalling, service permissions, persistent-disk behavior, log sink, and alerts are host concerns not verified here.

## Remaining blockers

- Redeploy the verified prebuilt RC7 archive to the existing VM and record total install wall time, memory/swap, I/O wait, post-hardening service-user access, systemd activation, and readiness. RC1 through RC6 are superseded for deployment.
- After install PASS: verify exactly one systemd service, Caddy/DNS/TLS, persistent restart, real SIGTERM logs, proxy behavior, filesystem ownership, and disk checks.
- Public-release recovery: copy a coordinated backup off-host and rehearse restoration of that returned copy.
- Operations: configure and test service/readiness, disk-low, and backup-failure alerts.

## Exact next step

Do not redeploy RC1 through RC6. Upload `Foundry-single-host-RC7-2026-08-30.zip` to `/home/vladsemenyak53` on the existing VM, then run:

```bash
cd /home/vladsemenyak53
printf '%s  %s\n' \
  '90bbaf7cf65bcd6ca006028af66f8a55f890df644d047ec654a556cd799f7362' \
  'Foundry-single-host-RC7-2026-08-30.zip' | sha256sum --check
rc7_installer_dir="$(mktemp -d /tmp/foundry-rc7-installer.XXXXXX)"
unzip -oq \
  /home/vladsemenyak53/Foundry-single-host-RC7-2026-08-30.zip \
  'deploy/single-host/*' \
  -d "${rc7_installer_dir}"
sudo systemd-run \
  --unit=foundry-install-rc7 \
  --collect \
  /bin/bash \
  "${rc7_installer_dir}/deploy/single-host/install.sh" \
  --archive /home/vladsemenyak53/Foundry-single-host-RC7-2026-08-30.zip \
  --public-url https://34-173-130-145.sslip.io
sudo journalctl -fu foundry-install-rc7.service
```

Do not claim acceptance until this real RC7 installation completes the verified prebuilt deployment path and the remaining host checks pass.
