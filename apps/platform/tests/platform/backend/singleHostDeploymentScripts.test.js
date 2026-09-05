import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createReleaseManifest, RELEASE_MANIFEST_NAME } from '../../../../../deploy/single-host/release-manifest.mjs';

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const repositoryRoot = path.resolve(platformRoot, '..', '..');
const deploymentRoot = path.join(repositoryRoot, 'deploy', 'single-host');
const temporaryRoots = [];

function writeExecutable(filePath, contents) {
    fs.writeFileSync(filePath, contents, { mode: 0o755 });
}

function copyRootlessHarness(sourceName, destination) {
    const source = fs.readFileSync(path.join(deploymentRoot, sourceName), 'utf8');
    const rootCheck = '\nfoundry_require_root\n';
    expect(source).toContain(rootCheck);
    fs.writeFileSync(destination, source.replace(rootCheck, '\n# Root check is omitted only in this disposable test copy.\n'), { mode: 0o755 });
}

function copyRootlessOperatorHarness(destination) {
    const source = fs.readFileSync(path.join(deploymentRoot, 'foundry'), 'utf8');
    const rootCheck = '        foundry_require_root\n';
    expect(source).toContain(rootCheck);
    fs.writeFileSync(
        destination,
        source.replaceAll(rootCheck, '        # Root check is omitted only in this disposable test copy.\n'),
        { mode: 0o755 }
    );
}

async function createReleaseArchive(root, label, { failReadiness = false, legacySource = false, tamperAfterManifest = false } = {}) {
    const entries = new Map();
    const add = (name, contents = `fixture: ${name}\n`) => entries.set(name, Buffer.from(contents));
    add('package.json', JSON.stringify({ name: `foundry-${label}`, workspaces: ['packages/*', 'apps/*'] }));
    add('package-lock.json', JSON.stringify({ lockfileVersion: 3 }));
    add('apps/platform/package.json', JSON.stringify({ name: '@foundry/platform' }));
    add('apps/platform/dist/server.cjs', 'module.exports = {};\n');
    add('apps/platform/dist/server-profile.json', JSON.stringify({
        schemaVersion: 1,
        service: 'foundry-platform',
        minimumDatabaseMigration: 1,
        maximumDatabaseMigration: 8,
        migrations: [{ version: 8, name: 'fixture' }]
    }));
    add('apps/platform/dist/client/index.html', '<!doctype html>\n');
    add('apps/platform/dist/client/deployment-profile.json', JSON.stringify({
        schemaVersion: 2,
        deploymentMode: 'single-host',
        authProvider: 'local',
        storageProvider: 'local-disk'
    }));
    for (const script of [
        'verify-artifact.mjs',
        'smoke-production.mjs',
        'single-host-backup.mjs',
        'single-host-restore.mjs',
        'single-host-rehearsal.mjs',
        'single-host-doctor.mjs',
        'local-user.mjs',
        'check-storage-integrity.mjs'
    ]) add(`apps/platform/scripts/${script}`, '// stubbed by test PATH\n');
    add('deploy/single-host/Caddyfile.example');
    add('deploy/single-host/caddy-logging.conf');
    add('deploy/single-host/ci-update.sh');
    add('deploy/single-host/common.sh');
    add('deploy/single-host/configure-deploy-user.sh');
    add('deploy/single-host/foundry');
    add('deploy/single-host/install.sh');
    add('deploy/single-host/release-manifest.mjs', fs.readFileSync(path.join(deploymentRoot, 'release-manifest.mjs')));
    add('deploy/single-host/update.sh');
    add('deploy/single-host/rollback.sh');
    add('deploy/single-host/foundry.service.in', '[Service]\n');
    add('release-marker.txt', label);
    if (failReadiness) add('FAIL_READINESS', 'expected fixture failure\n');

    const archive = path.join(root, `Foundry-${label}.zip`);
    const zip = new JSZip();
    for (const [name, contents] of entries) zip.file(name, contents);
    if (!legacySource) zip.file(RELEASE_MANIFEST_NAME, `${JSON.stringify(createReleaseManifest(entries), null, 2)}\n`);
    if (tamperAfterManifest) zip.file('apps/platform/dist/server.cjs', 'tampered after manifest creation\n');
    fs.writeFileSync(archive, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }));
    return archive;
}

function createCommandStubs(root) {
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    writeExecutable(path.join(bin, 'node'), `#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "\${1:-}" == "-p" ]]; then printf '22\\n'; exit 0; fi
if [[ "\${1:-}" == *"release-manifest.mjs" ]]; then exec "\${FOUNDRY_TEST_REAL_NODE}" "$@"; fi
if [[ "$*" == *"single-host-doctor.mjs"* && "$*" != *"--check-release"* ]]; then
    [[ "$PWD" == */apps/platform ]]
    [[ -r dist/client/deployment-profile.json ]]
    printf '%s\\n' "$PWD" >> "\${FOUNDRY_TEST_DOCTOR_LOG}"
fi
if [[ "$*" == *"single-host-backup.mjs"* ]]; then
    output=""
    while [[ "$#" -gt 0 ]]; do
        if [[ "$1" == "--output" ]]; then output="$2"; shift 2; else shift; fi
    done
    [[ -n "\${output}" ]]
    mkdir -p "\${output}"
    printf '{"status":"PASS"}\\n' > "\${output}/manifest.json"
fi
exit 0
`);
    writeExecutable(path.join(bin, 'npm'), `#!/usr/bin/env bash
set -Eeuo pipefail
prefix=""
arguments=("$@")
for ((index = 0; index < \${#arguments[@]}; index += 1)); do
    if [[ "\${arguments[index]}" == "--prefix" ]]; then prefix="\${arguments[index + 1]}"; fi
done
printf '%s|%s\n' "\${NODE_OPTIONS:-<unset>}" "$*" >> "\${FOUNDRY_TEST_NPM_LOG}"
[[ "$*" == *"ci --omit=dev"* ]]
[[ "\${NODE_OPTIONS:-<unset>}" == "<unset>" ]]
[[ -n "\${prefix}" ]]
mkdir -p "\${prefix}/node_modules/fixture-runtime"
printf 'module.exports = {};\n' > "\${prefix}/node_modules/fixture-runtime/index.js"
printf '#!/usr/bin/env node\n' > "\${prefix}/node_modules/fixture-runtime/cli.js"
chmod 0755 "\${prefix}/node_modules/fixture-runtime/cli.js"
exit 0
`);
    writeExecutable(path.join(bin, 'runuser'), `#!/usr/bin/env bash
set -Eeuo pipefail
if [[ " $* " == *" FOUNDRY_RELEASE_ACCESS_CHECK=1 "* ]]; then
    printf 'post-hardening-service-access\n' >> "\${FOUNDRY_TEST_ACCESS_LOG}"
fi
while [[ "$#" -gt 0 ]]; do
    case "$1" in
        --preserve-environment) shift ;;
        --user) shift 2 ;;
        --) shift; break ;;
        *) break ;;
    esac
done
exec "$@"
`);
    writeExecutable(path.join(bin, 'systemctl'), `#!/usr/bin/env bash
set -Eeuo pipefail
case "\${1:-}" in
    is-active) [[ -f "\${FOUNDRY_TEST_SERVICE_STATE}" ]] ;;
    start)
        target="$(readlink -f "\${FOUNDRY_CURRENT_LINK}" 2>/dev/null || true)"
        [[ -n "\${target}" ]]
        (
            cd "\${target}/apps/platform"
            [[ -r dist/server.cjs ]]
            env -u NODE_OPTIONS "\${FOUNDRY_TEST_REAL_NODE}" -e 'require("node:fs").accessSync("dist/server.cjs", require("node:fs").constants.R_OK)'
            printf '%s|%s\n' "\${target}" "$PWD" >> "\${FOUNDRY_TEST_ACTIVATION_LOG}"
        )
        : > "\${FOUNDRY_TEST_SERVICE_STATE}"
        ;;
    stop) rm -f "\${FOUNDRY_TEST_SERVICE_STATE}" ;;
    *) exit 0 ;;
esac
`);
    writeExecutable(path.join(bin, 'curl'), `#!/usr/bin/env bash
set -Eeuo pipefail
target="$(readlink -f "\${FOUNDRY_CURRENT_LINK}" 2>/dev/null || true)"
[[ -n "\${target}" && ! -f "\${target}/FAIL_READINESS" ]]
`);
    writeExecutable(path.join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
    writeExecutable(path.join(bin, 'chown'), '#!/usr/bin/env bash\nexit 0\n');
    writeExecutable(path.join(bin, 'stat'), [
        '#!/usr/bin/env bash',
        'set -Eeuo pipefail',
        'if [[ "${1:-}" == "-c" && "${2:-}" == "%u:%G:%a" && ( "${3:-}" == "${FOUNDRY_INSTALL_ROOT}" || "${3:-}" == "${FOUNDRY_INSTALL_ROOT}/releases" ) ]]; then',
        '    printf \'0:%s:750\\n\' "${FOUNDRY_SERVICE_GROUP}"',
        '    exit 0',
        'fi',
        'exec /usr/bin/stat "$@"',
        ''
    ].join('\n'));
    writeExecutable(path.join(bin, 'find'), [
        '#!/usr/bin/env bash',
        'set -Eeuo pipefail',
        'for arg in "$@"; do',
        '    if [[ "$arg" == "-user" || "$arg" == "-group" ]]; then exit 0; fi',
        'done',
        'exec /usr/bin/find "$@"',
        ''
    ].join('\n'));
    return bin;
}

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-deploy-scripts-'));
    temporaryRoots.push(root);
    const scripts = path.join(root, 'scripts');
    const installRoot = path.join(root, 'opt', 'foundry');
    const dataRoot = path.join(root, 'data');
    const environmentFile = path.join(root, 'foundry.env');
    const npmCache = path.join(root, 'npm-cache');
    const stateFile = path.join(root, 'service-active');
    const npmLog = path.join(root, 'npm-invocations.log');
    const accessLog = path.join(root, 'service-access.log');
    const activationLog = path.join(root, 'service-activation.log');
    const doctorLog = path.join(root, 'doctor-cwd.log');
    fs.mkdirSync(scripts);
    fs.mkdirSync(path.join(installRoot, 'releases'), { recursive: true });
    fs.chmodSync(installRoot, 0o750);
    fs.chmodSync(path.join(installRoot, 'releases'), 0o750);
    fs.mkdirSync(path.join(dataRoot, 'objects'), { recursive: true });
    fs.mkdirSync(path.join(dataRoot, 'backups'), { recursive: true });
    fs.copyFileSync(path.join(deploymentRoot, 'common.sh'), path.join(scripts, 'common.sh'));
    fs.copyFileSync(path.join(deploymentRoot, 'release-manifest.mjs'), path.join(scripts, 'release-manifest.mjs'));
    copyRootlessHarness('update.sh', path.join(scripts, 'update.sh'));
    copyRootlessHarness('rollback.sh', path.join(scripts, 'rollback.sh'));
    copyRootlessOperatorHarness(path.join(scripts, 'foundry'));
    const bin = createCommandStubs(root);
    const databasePath = path.join(dataRoot, 'platform.db');
    fs.writeFileSync(environmentFile, [
        'NODE_ENV=production',
        'FOUNDRY_DEPLOYMENT_MODE=single-host',
        `FOUNDRY_DATA_DIR=${dataRoot}`,
        `PLATFORM_DB_PATH=${databasePath}`,
        'PORT=3000'
    ].join('\n') + '\n');
    const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FOUNDRY_INSTALL_ROOT: installRoot,
        FOUNDRY_ENV_FILE: environmentFile,
        FOUNDRY_SERVICE_NAME: 'foundry-test.service',
        FOUNDRY_SERVICE_USER: 'foundry-test',
        FOUNDRY_SERVICE_GROUP: 'root',
        FOUNDRY_NPM_CACHE: npmCache,
        FOUNDRY_CURRENT_LINK: path.join(installRoot, 'current'),
        FOUNDRY_TEST_SERVICE_STATE: stateFile,
        FOUNDRY_TEST_NPM_LOG: npmLog,
        FOUNDRY_TEST_ACCESS_LOG: accessLog,
        FOUNDRY_TEST_ACTIVATION_LOG: activationLog,
        FOUNDRY_TEST_DOCTOR_LOG: doctorLog,
        FOUNDRY_TEST_REAL_NODE: process.execPath,
        NODE_OPTIONS: '--max-old-space-size=64'
    };
    return { root, scripts, installRoot, dataRoot, databasePath, npmLog, accessLog, activationLog, doctorLog, env };
}

function runScript(filePath, args, env, { cwd } = {}) {
    return spawnSync('/bin/bash', [filePath, ...args], {
        env,
        cwd,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024
    });
}

function lstat(filePath) {
    return fs.lstatSync(filePath, { throwIfNoEntry: false });
}

function installedReleaseMarkers(installRoot) {
    const releases = path.join(installRoot, 'releases');
    return fs.readdirSync(releases)
        .filter(name => !name.startsWith('.extract-'))
        .map(name => path.join(releases, name, 'release-marker.txt'))
        .filter(marker => fs.existsSync(marker))
        .map(marker => fs.readFileSync(marker, 'utf8'))
        .sort();
}

function createMinimalValidRelease(installRoot, releaseId) {
    const release = path.join(installRoot, 'releases', releaseId);
    const dist = path.join(release, 'apps', 'platform', 'dist');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'server.cjs'), 'module.exports = {};\n');
    fs.writeFileSync(path.join(dist, 'server-profile.json'), '{}\n');
    return release;
}

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('single-host atomic deployment scripts', () => {
    it('installs, automatically recovers a failed update, and performs a guarded application rollback', async () => {
        const legacy = fixture();
        const legacyArchive = await createReleaseArchive(legacy.root, 'legacy-source', { legacySource: true });
        const legacyUpdate = runScript(path.join(legacy.scripts, 'update.sh'), [legacyArchive, '--initial'], legacy.env);
        expect(legacyUpdate.status).not.toBe(0);
        expect(legacyUpdate.stderr).toContain('release archive is missing foundry-release.json');
        expect(fs.existsSync(legacy.npmLog)).toBe(false);

        const tampered = fixture();
        const tamperedArchive = await createReleaseArchive(tampered.root, 'tampered', { tamperAfterManifest: true });
        const tamperedUpdate = runScript(path.join(tampered.scripts, 'update.sh'), [tamperedArchive, '--initial'], tampered.env);
        expect(tamperedUpdate.status).not.toBe(0);
        expect(tamperedUpdate.stderr).toMatch(/(?:size|SHA-256) mismatch: apps\/platform\/dist\/server\.cjs/);
        expect(fs.existsSync(tampered.npmLog)).toBe(false);

        const failedInitialSetup = fixture();
        const failedInitialUpdateScript = path.join(failedInitialSetup.scripts, 'update.sh');
        const failedInitialArchive = await createReleaseArchive(
            failedInitialSetup.root,
            'initial-fails-readiness',
            { failReadiness: true }
        );
        const failedInitial = runScript(
            failedInitialUpdateScript,
            [failedInitialArchive, '--initial'],
            failedInitialSetup.env
        );
        expect(failedInitial.status).not.toBe(0);
        expect(failedInitial.stderr).toContain('automatic rollback is unsafe or unavailable');
        expect(lstat(path.join(failedInitialSetup.installRoot, 'current'))).toBeUndefined();
        expect(lstat(path.join(failedInitialSetup.installRoot, 'previous'))).toBeUndefined();
        expect(installedReleaseMarkers(failedInitialSetup.installRoot)).toEqual([]);

        const retryArchive = await createReleaseArchive(failedInitialSetup.root, 'initial-retry');
        const retry = runScript(failedInitialUpdateScript, [retryArchive, '--initial'], failedInitialSetup.env);
        expect(retry.status, `${retry.stdout}\n${retry.stderr}`).toBe(0);
        expect(fs.readFileSync(
            path.join(fs.realpathSync(path.join(failedInitialSetup.installRoot, 'current')), 'release-marker.txt'),
            'utf8'
        )).toBe('initial-retry');
        expect(lstat(path.join(failedInitialSetup.installRoot, 'previous'))).toBeUndefined();

        const stale = fixture();
        const staleCurrent = path.join(stale.installRoot, 'current');
        const missingRc6Release = path.join(
            stale.installRoot,
            'releases',
            '20260830T120119Z-531deea30571'
        );
        fs.symlinkSync(missingRc6Release, staleCurrent);
        const staleArchive = await createReleaseArchive(stale.root, 'rc6-state-recovered');
        const staleRecovery = runScript(
            path.join(stale.scripts, 'update.sh'),
            [staleArchive, '--initial'],
            stale.env
        );
        expect(staleRecovery.status, `${staleRecovery.stdout}\n${staleRecovery.stderr}`).toBe(0);
        expect(staleRecovery.stdout).toContain('removed stale current link from failed initial release');
        expect(fs.realpathSync(staleCurrent)).not.toBe(missingRc6Release);
        expect(fs.readFileSync(path.join(fs.realpathSync(staleCurrent), 'release-marker.txt'), 'utf8'))
            .toBe('rc6-state-recovered');
        expect(lstat(path.join(stale.installRoot, 'previous'))).toBeUndefined();

        const unlinkBlocked = fixture();
        writeExecutable(path.join(unlinkBlocked.env.PATH.split(path.delimiter)[0], 'unlink'), '#!/usr/bin/env bash\nexit 1\n');
        const unlinkBlockedArchive = await createReleaseArchive(
            unlinkBlocked.root,
            'referenced-failed-candidate',
            { failReadiness: true }
        );
        const unlinkBlockedResult = runScript(
            path.join(unlinkBlocked.scripts, 'update.sh'),
            [unlinkBlockedArchive, '--initial'],
            unlinkBlocked.env
        );
        expect(unlinkBlockedResult.status).not.toBe(0);
        const retainedCurrent = path.join(unlinkBlocked.installRoot, 'current');
        expect(lstat(retainedCurrent)?.isSymbolicLink()).toBe(true);
        const retainedRelease = fs.realpathSync(retainedCurrent);
        expect(fs.readFileSync(path.join(retainedRelease, 'release-marker.txt'), 'utf8'))
            .toBe('referenced-failed-candidate');
        expect(unlinkBlockedResult.stderr).toContain('retaining failed release because a deployment link still references it');

        const escaping = fixture();
        const outside = path.join(escaping.root, 'outside-release');
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, 'operator-data'), 'must remain untouched');
        fs.symlinkSync(outside, path.join(escaping.installRoot, 'current'));
        const escapingArchive = await createReleaseArchive(escaping.root, 'must-not-install');
        const escapingResult = runScript(
            path.join(escaping.scripts, 'update.sh'),
            [escapingArchive, '--initial'],
            escaping.env
        );
        expect(escapingResult.status).not.toBe(0);
        expect(escapingResult.stderr).toContain('current deployment link escapes');
        expect(fs.readlinkSync(path.join(escaping.installRoot, 'current'))).toBe(outside);
        expect(fs.readFileSync(path.join(outside, 'operator-data'), 'utf8')).toBe('must remain untouched');
        expect(fs.existsSync(escaping.npmLog)).toBe(false);

        const nonLink = fixture();
        const nonLinkCurrent = path.join(nonLink.installRoot, 'current');
        fs.writeFileSync(nonLinkCurrent, 'not a deployment link');
        const nonLinkArchive = await createReleaseArchive(nonLink.root, 'non-link-state');
        const nonLinkResult = runScript(
            path.join(nonLink.scripts, 'update.sh'),
            [nonLinkArchive, '--initial'],
            nonLink.env
        );
        expect(nonLinkResult.status).not.toBe(0);
        expect(nonLinkResult.stderr).toContain('current deployment path exists but is not a symbolic link');
        expect(fs.readFileSync(nonLinkCurrent, 'utf8')).toBe('not a deployment link');
        expect(fs.existsSync(nonLink.npmLog)).toBe(false);

        const invalid = fixture();
        const invalidRelease = path.join(
            invalid.installRoot,
            'releases',
            '20260831T080000Z-0123456789ab'
        );
        fs.mkdirSync(invalidRelease);
        fs.symlinkSync(invalidRelease, path.join(invalid.installRoot, 'current'));
        const invalidArchive = await createReleaseArchive(invalid.root, 'invalid-current-state');
        const invalidResult = runScript(
            path.join(invalid.scripts, 'update.sh'),
            [invalidArchive, '--initial'],
            invalid.env
        );
        expect(invalidResult.status).not.toBe(0);
        expect(invalidResult.stderr).toContain('release is missing dist/server.cjs');
        expect(lstat(invalidRelease)?.isDirectory()).toBe(true);
        expect(fs.existsSync(invalid.npmLog)).toBe(false);

        const stalePrevious = fixture();
        const manuallyCurrent = createMinimalValidRelease(
            stalePrevious.installRoot,
            '20260831T081000Z-111111111111'
        );
        const missingPrevious = path.join(
            stalePrevious.installRoot,
            'releases',
            '20260831T075000Z-222222222222'
        );
        fs.symlinkSync(manuallyCurrent, path.join(stalePrevious.installRoot, 'current'));
        fs.symlinkSync(missingPrevious, path.join(stalePrevious.installRoot, 'previous'));
        const stalePreviousArchive = await createReleaseArchive(stalePrevious.root, 'stale-previous-state');
        const stalePreviousResult = runScript(
            path.join(stalePrevious.scripts, 'update.sh'),
            [stalePreviousArchive],
            stalePrevious.env
        );
        expect(stalePreviousResult.status).not.toBe(0);
        expect(stalePreviousResult.stderr).toContain('previous deployment link is dangling');
        expect(fs.realpathSync(path.join(stalePrevious.installRoot, 'current'))).toBe(manuallyCurrent);
        expect(fs.readlinkSync(path.join(stalePrevious.installRoot, 'previous'))).toBe(missingPrevious);
        expect(fs.existsSync(stalePrevious.npmLog)).toBe(false);

        const setup = fixture();
        setup.env.FOUNDRY_RELEASE_RETENTION = '2';
        const updateScript = path.join(setup.scripts, 'update.sh');
        const rollbackScript = path.join(setup.scripts, 'rollback.sh');

        const firstArchive = await createReleaseArchive(setup.root, 'release-a');
        const initial = runScript(updateScript, [firstArchive, '--initial'], setup.env);
        expect(initial.status, `${initial.stdout}\n${initial.stderr}`).toBe(0);
        const releaseA = fs.realpathSync(path.join(setup.installRoot, 'current'));
        expect(fs.readFileSync(path.join(releaseA, 'release-marker.txt'), 'utf8')).toBe('release-a');
        expect(fs.existsSync(path.join(releaseA, 'apps', 'platform', 'dist', 'server.cjs'))).toBe(true);
        expect(fs.statSync(releaseA).mode & 0o777).toBe(0o750);
        expect(fs.statSync(path.join(releaseA, 'apps', 'platform')).mode & 0o777).toBe(0o750);
        expect(fs.statSync(path.join(releaseA, 'apps', 'platform', 'dist', 'server.cjs')).mode & 0o777).toBe(0o640);
        expect(fs.statSync(path.join(releaseA, 'node_modules', 'fixture-runtime')).mode & 0o777).toBe(0o750);
        expect(fs.statSync(path.join(releaseA, 'node_modules', 'fixture-runtime', 'index.js')).mode & 0o777).toBe(0o640);
        expect(fs.statSync(path.join(releaseA, 'node_modules', 'fixture-runtime', 'cli.js')).mode & 0o777).toBe(0o750);

        const operator = path.join(setup.scripts, 'foundry');
        for (const cwd of ['/', os.tmpdir()]) {
            const doctor = runScript(operator, ['doctor'], setup.env, { cwd });
            expect(doctor.status, `${doctor.stdout}\n${doctor.stderr}`).toBe(0);
        }
        expect(fs.readFileSync(setup.doctorLog, 'utf8').trim().split('\n')).toEqual([
            path.join(releaseA, 'apps', 'platform'),
            path.join(releaseA, 'apps', 'platform')
        ]);

        fs.writeFileSync(setup.databasePath, 'persistent fixture metadata');
        const failedArchive = await createReleaseArchive(setup.root, 'release-fails-readiness', { failReadiness: true });
        const failed = runScript(updateScript, [failedArchive], setup.env);
        expect(failed.status).not.toBe(0);
        expect(failed.stderr, `${failed.stdout}\nstatus=${failed.status}\nsignal=${failed.signal}`).toContain('application symlink rolled back');
        expect(fs.realpathSync(path.join(setup.installRoot, 'current'))).toBe(releaseA);
        expect(fs.realpathSync(path.join(setup.installRoot, 'previous'))).toBe(releaseA);
        expect(installedReleaseMarkers(setup.installRoot)).toEqual(['release-a']);
        expect(fs.readFileSync(setup.databasePath, 'utf8')).toBe('persistent fixture metadata');

        const secondArchive = await createReleaseArchive(setup.root, 'release-b');
        const updated = runScript(updateScript, [secondArchive], setup.env);
        expect(updated.status, `${updated.stdout}\n${updated.stderr}`).toBe(0);
        const releaseB = fs.realpathSync(path.join(setup.installRoot, 'current'));
        expect(releaseB).not.toBe(releaseA);
        expect(fs.realpathSync(path.join(setup.installRoot, 'previous'))).toBe(releaseA);
        expect(installedReleaseMarkers(setup.installRoot)).toEqual(['release-a', 'release-b']);

        const rolledBack = runScript(rollbackScript, [], setup.env);
        expect(rolledBack.status, `${rolledBack.stdout}\n${rolledBack.stderr}`).toBe(0);
        expect(fs.realpathSync(path.join(setup.installRoot, 'current'))).toBe(releaseA);
        expect(fs.realpathSync(path.join(setup.installRoot, 'previous'))).toBe(releaseB);
        expect(installedReleaseMarkers(setup.installRoot)).toEqual(['release-a', 'release-b']);
        expect(fs.readFileSync(setup.databasePath, 'utf8')).toBe('persistent fixture metadata');

        const manifests = fs.readdirSync(path.join(setup.dataRoot, 'backups'), { recursive: true })
            .filter(name => path.basename(String(name)) === 'manifest.json');
        expect(manifests.length).toBeGreaterThanOrEqual(3);

        const npmInvocations = fs.readFileSync(setup.npmLog, 'utf8').trim().split('\n');
        expect(npmInvocations).toHaveLength(3);
        expect(npmInvocations.every(line => line.startsWith('<unset>|ci --omit=dev'))).toBe(true);
        expect(npmInvocations.some(line => /run (?:build|test|lint)/.test(line))).toBe(false);
        expect(fs.readFileSync(setup.accessLog, 'utf8').trim().split('\n')).toHaveLength(3);
        const activations = fs.readFileSync(setup.activationLog, 'utf8').trim().split('\n');
        expect(activations.length).toBeGreaterThanOrEqual(5);
        expect(activations.every(line => line.includes('/apps/platform'))).toBe(true);
        const finalizedEntries = fs.readdirSync(releaseA, { recursive: true }).map(name => path.join(releaseA, String(name)));
        for (const entry of [releaseA, ...finalizedEntries]) {
            const stat = fs.lstatSync(entry);
            if (stat.isSymbolicLink()) continue;
            const mode = stat.mode & 0o777;
            expect(mode & 0o022, entry).toBe(0);
            expect(mode & 0o007, entry).toBe(0);
            if (stat.isDirectory()) expect(mode, entry).toBe(0o750);
            if (stat.isFile()) expect([0o640, 0o750], entry).toContain(mode);
        }
        expect(fs.readFileSync(path.join(deploymentRoot, 'install.sh'), 'utf8'))
            .toContain('install -d -o root -g foundry -m 0750 /opt/foundry /opt/foundry/releases');
        const caddyLogging = fs.readFileSync(path.join(deploymentRoot, 'caddy-logging.conf'), 'utf8');
        expect(caddyLogging).toContain('LogsDirectory=caddy');
        expect(caddyLogging).toContain('LogsDirectoryMode=0750');
        expect(caddyLogging).not.toMatch(/(?:0777|0755|world)/i);
        const installer = fs.readFileSync(path.join(deploymentRoot, 'install.sh'), 'utf8');
        expect(installer).toContain('/etc/systemd/system/caddy.service.d/10-foundry-logging.conf');
        expect(installer).toContain('foundry_inspect_release_link "${FOUNDRY_CURRENT_LINK}" current');
        const updater = fs.readFileSync(path.join(deploymentRoot, 'update.sh'), 'utf8');
        expect(updater).toContain('node "${SCRIPT_DIRECTORY}/release-manifest.mjs" "${SOURCE_ROOT}"');
        expect(updater).not.toContain('node "${SOURCE_ROOT}/deploy/single-host/release-manifest.mjs"');
        const deploySetup = fs.readFileSync(path.join(deploymentRoot, 'configure-deploy-user.sh'), 'utf8');
        expect(deploySetup).toContain('UPLOAD_ARCHIVE="${UPLOAD_DIRECTORY}/Foundry-single-host.zip"');
        expect(deploySetup).toContain('NOPASSWD: /usr/local/lib/foundry/ci-update.sh');
        expect(deploySetup).not.toContain('NOPASSWD: ALL');
        const ciUpdate = fs.readFileSync(path.join(deploymentRoot, 'ci-update.sh'), 'utf8');
        expect(ciUpdate).toContain('exec env -i');
        expect(ciUpdate).toContain('/usr/local/lib/foundry/foundry update "${UPLOAD_ARCHIVE}"');
        expect(ciUpdate).toContain('! -L "${UPLOAD_ARCHIVE}"');
        expect(ciUpdate).toContain('-perm /022');
        const ciWorkflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
        expect(ciWorkflow).toContain('environment: production');
        expect(ciWorkflow).toContain('npm run rehearse:single-host-release');
        expect(ciWorkflow).toContain('StrictHostKeyChecking=yes');
        expect(ciWorkflow).toContain('sudo -n /usr/local/lib/foundry/ci-update.sh');
        expect(ciWorkflow).toContain('http://127.0.0.1:3000/api/ready');
        expect(ciWorkflow).toContain('${PUBLIC_URL%/}/api/ready');
        expect(ciWorkflow).not.toContain('StrictHostKeyChecking=no');
        expect(ciWorkflow).not.toContain('continue-on-error');
        expect(ciWorkflow).not.toMatch(/rsync[^\n]*\/opt\/foundry\/current/);
        expect(fs.readFileSync(path.join(deploymentRoot, 'foundry.service.in'), 'utf8')).not.toContain('NODE_OPTIONS');
    }, 30_000);
});
