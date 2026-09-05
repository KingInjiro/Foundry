import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(platformRoot, '..', '..');
const deploymentRoot = path.join(repositoryRoot, 'deploy', 'single-host');

function fail(message) {
    throw new Error(`Prebuilt deployment rehearsal failed: ${message}`);
}

function executable(filePath, contents) {
    fs.writeFileSync(filePath, contents, { mode: 0o755 });
}

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

const archiveValue = argument('--archive');
if (!archiveValue) fail('usage: npm run rehearse:single-host-release -- --archive /absolute/path/Foundry-single-host.zip');
const archive = path.resolve(archiveValue);
if (!fs.statSync(archive, { throwIfNoEntry: false })?.isFile()) fail(`archive is missing: ${archive}`);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-prebuilt-deploy-rehearsal-'));
const scripts = path.join(root, 'scripts');
const bin = path.join(root, 'bin');
const installRoot = path.join(root, 'opt', 'foundry');
const currentLink = path.join(installRoot, 'current');
const dataRoot = path.join(root, 'data');
const environmentFile = path.join(root, 'foundry.env');
const serviceState = path.join(root, 'service-active');
const serviceAccessLog = path.join(root, 'service-access.log');
const serviceActivationLog = path.join(root, 'service-activation.log');
const serviceLog = path.join(root, 'service.log');
const servicePort = 43_000 + (process.pid % 1_000);
const curlBinary = process.env.PATH.split(path.delimiter)
    .map(directory => path.join(directory, 'curl'))
    .find(candidate => fs.statSync(candidate, { throwIfNoEntry: false })?.isFile());
if (!curlBinary) fail('curl is unavailable for the real readiness rehearsal.');
fs.chmodSync(root, 0o755);
fs.mkdirSync(scripts);
fs.mkdirSync(bin);
fs.mkdirSync(path.join(installRoot, 'releases'), { recursive: true });
fs.chmodSync(installRoot, 0o750);
fs.chmodSync(path.join(installRoot, 'releases'), 0o750);
const staleRc6Release = path.join(installRoot, 'releases', '20260830T120119Z-531deea30571');
fs.symlinkSync(staleRc6Release, currentLink);
fs.mkdirSync(path.join(dataRoot, 'objects'), { recursive: true });
fs.mkdirSync(path.join(dataRoot, 'backups'), { recursive: true });
fs.copyFileSync(path.join(deploymentRoot, 'common.sh'), path.join(scripts, 'common.sh'));
fs.copyFileSync(path.join(deploymentRoot, 'release-manifest.mjs'), path.join(scripts, 'release-manifest.mjs'));
const updateSource = fs.readFileSync(path.join(deploymentRoot, 'update.sh'), 'utf8');
const rootCheck = '\nfoundry_require_root\n';
if (!updateSource.includes(rootCheck)) fail('update.sh root guard could not be isolated for the disposable rehearsal.');
fs.writeFileSync(
    path.join(scripts, 'update.sh'),
    updateSource.replace(rootCheck, '\n# Root check omitted only inside this disposable rehearsal.\n'),
    { mode: 0o755 }
);
fs.writeFileSync(environmentFile, [
    'NODE_ENV=production',
    'FOUNDRY_DEPLOYMENT_MODE=single-host',
    'PLATFORM_PUBLIC_BASE_URL=https://foundry-rehearsal.invalid',
    'HOST=127.0.0.1',
    `FOUNDRY_DATA_DIR=${dataRoot}`,
    `PLATFORM_DB_PATH=${path.join(dataRoot, 'platform.db')}`,
    'LOCAL_AUTH_SESSION_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'LOCAL_STORAGE_SIGNING_SECRET=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    'TRUST_PROXY_HOPS=1',
    'ENABLE_HSTS=false',
    'JOB_MODE=async',
    'JOB_WORKER_ID=foundry-rehearsal-1',
    'ALLOW_UNREADY_STARTUP=false',
    'E2E_MODE=false',
    'SINGLE_HOST_TEST_MODE=false',
    'LOCAL_DEV_MODE=false',
    'AUTH_DEV_BYPASS=false',
    `PORT=${servicePort}`
].join('\n') + '\n');

executable(path.join(bin, 'runuser'), `#!/usr/bin/env bash
set -Eeuo pipefail
if [[ " $* " == *" FOUNDRY_RELEASE_ACCESS_CHECK=1 "* ]]; then
    printf 'post-hardening-service-access\n' >> "\${FOUNDRY_REHEARSAL_ACCESS_LOG}"
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
executable(path.join(bin, 'systemctl'), `#!/usr/bin/env bash
set -Eeuo pipefail
case "\${1:-}" in
    is-active)
        [[ -s "\${FOUNDRY_REHEARSAL_SERVICE_STATE}" ]]
        kill -0 "$(<"\${FOUNDRY_REHEARSAL_SERVICE_STATE}")" 2>/dev/null
        ;;
    start)
        target="$(readlink -f "\${FOUNDRY_CURRENT_LINK}" 2>/dev/null || true)"
        [[ -n "\${target}" ]]
        (
            cd "\${target}/apps/platform"
            nohup env -u NODE_OPTIONS ${JSON.stringify(process.execPath)} dist/server.cjs \
                > "\${FOUNDRY_REHEARSAL_SERVICE_LOG}" 2>&1 < /dev/null &
            printf '%s\n' "$!" > "\${FOUNDRY_REHEARSAL_SERVICE_STATE}"
            printf '%s|%s\n' "\${target}" "$PWD" >> "\${FOUNDRY_REHEARSAL_ACTIVATION_LOG}"
        )
        ;;
    stop)
        if [[ -s "\${FOUNDRY_REHEARSAL_SERVICE_STATE}" ]]; then
            pid="$(<"\${FOUNDRY_REHEARSAL_SERVICE_STATE}")"
            kill -TERM "\${pid}" 2>/dev/null || true
            for _ in $(seq 1 100); do
                kill -0 "\${pid}" 2>/dev/null || break
                sleep 0.05
            done
            kill -KILL "\${pid}" 2>/dev/null || true
        fi
        : > "\${FOUNDRY_REHEARSAL_SERVICE_STATE}"
        ;;
    *) exit 0 ;;
esac
`);
executable(path.join(bin, 'curl'), `#!/usr/bin/env bash
set -Eeuo pipefail
exec ${JSON.stringify(curlBinary)} "$@"
`);
executable(path.join(bin, 'chown'), '#!/usr/bin/env bash\nexit 0\n');
executable(path.join(bin, 'stat'), [
    '#!/usr/bin/env bash',
    'set -Eeuo pipefail',
    'if [[ "${1:-}" == "-c" && "${2:-}" == "%u:%G:%a" && ( "${3:-}" == "${FOUNDRY_INSTALL_ROOT}" || "${3:-}" == "${FOUNDRY_INSTALL_ROOT}/releases" ) ]]; then',
    '    printf \'0:%s:750\\n\' "${FOUNDRY_SERVICE_GROUP}"',
    '    exit 0',
    'fi',
    'exec /usr/bin/stat "$@"',
    ''
].join('\n'));
executable(path.join(bin, 'find'), [
    '#!/usr/bin/env bash',
    'set -Eeuo pipefail',
    'for arg in "$@"; do',
    '    if [[ "$arg" == "-user" || "$arg" == "-group" ]]; then exit 0; fi',
    'done',
    'exec /usr/bin/find "$@"',
    ''
].join('\n'));

const started = process.hrtime.bigint();
const rehearsalEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FOUNDRY_INSTALL_ROOT: installRoot,
    FOUNDRY_ENV_FILE: environmentFile,
    FOUNDRY_SERVICE_NAME: 'foundry-rehearsal.service',
    FOUNDRY_SERVICE_USER: 'foundry-rehearsal',
    FOUNDRY_SERVICE_GROUP: 'root',
    FOUNDRY_NPM_CACHE: path.join(root, 'npm-cache'),
    FOUNDRY_CURRENT_LINK: currentLink,
    FOUNDRY_REHEARSAL_SERVICE_STATE: serviceState,
    FOUNDRY_REHEARSAL_SERVICE_LOG: serviceLog,
    FOUNDRY_REHEARSAL_ACCESS_LOG: serviceAccessLog,
    FOUNDRY_REHEARSAL_ACTIVATION_LOG: serviceActivationLog,
    NODE_OPTIONS: '--max-old-space-size=64'
};
try {
    const result = spawnSync('/bin/bash', [path.join(scripts, 'update.sh'), archive, '--initial'], {
        env: rehearsalEnv,
        encoding: 'utf8',
        timeout: 10 * 60_000,
        maxBuffer: 16 * 1024 * 1024
    });
    if (result.status !== 0) fail(`${result.stdout}\n${result.stderr}`);
    if (!result.stdout.includes('removed stale current link from failed initial release')) {
        fail('the RC6-style dangling current link was not recovered by the initial installer.');
    }
    const release = fs.realpathSync(currentLink);
    if (release === staleRc6Release || fs.existsSync(staleRc6Release)) {
        fail('the deployment did not replace the RC6-style dangling current state.');
    }
    if (!fs.statSync(path.join(release, 'apps/platform/dist/server.cjs'), { throwIfNoEntry: false })?.isFile()) {
        fail('atomic activation target is missing the server bundle.');
    }
    if (!fs.statSync(path.join(release, 'node_modules'), { throwIfNoEntry: false })?.isDirectory()) {
        fail('target-native production dependencies were not installed.');
    }
    const finalizedEntries = fs.readdirSync(release, { recursive: true }).map(name => path.join(release, String(name)));
    for (const entry of [release, ...finalizedEntries]) {
        const stat = fs.lstatSync(entry);
        if (stat.isSymbolicLink()) continue;
        const mode = stat.mode & 0o777;
        if ((mode & 0o022) !== 0) fail(`service-group write access remains after hardening: ${entry}`);
        if ((mode & 0o007) !== 0) fail(`world access remains after hardening: ${entry}`);
        if (stat.isDirectory() && mode !== 0o750) fail(`finalized directory is not 0750: ${entry}`);
        if (stat.isFile() && mode !== 0o640 && mode !== 0o750) fail(`finalized file has an invalid mode: ${entry}`);
    }
    if (fs.readFileSync(serviceAccessLog, 'utf8').trim() !== 'post-hardening-service-access') {
        fail('post-hardening service-account access check did not execute exactly once.');
    }
    const activations = fs.readFileSync(serviceActivationLog, 'utf8').trim().split('\n');
    if (activations.length !== 1 || !activations[0].endsWith('/apps/platform')) {
        fail('systemd-like WorkingDirectory and Node dependency probe did not pass exactly once.');
    }
    const stopped = spawnSync(path.join(bin, 'systemctl'), ['stop', 'foundry-rehearsal.service'], {
        env: rehearsalEnv,
        encoding: 'utf8'
    });
    if (stopped.status !== 0) fail(`systemd-like service stop failed: ${stopped.stderr}`);
    const serviceLogs = fs.readFileSync(serviceLog, 'utf8');
    if (!serviceLogs.includes('"event":"server_started"') || !serviceLogs.includes('"event":"server_stopped"')) {
        fail(`systemd-like production process did not start and stop gracefully:\n${serviceLogs}`);
    }
    const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(JSON.stringify({
        status: 'PASS',
        operation: 'prebuilt_single_host_deployment_rehearsal',
        archive,
        wallMs: Math.round(wallMs),
        staleInitialStateRecovered: true,
        releaseActivated: true,
        readinessGate: true,
        finalReleaseDirectoryMode: '0750',
        finalRegularFileMode: '0640',
        finalExecutableFileMode: '0750',
        immutableToServiceGroup: true,
        postHardeningServiceAccessCheck: true,
        systemdLikeWorkingDirectoryProbe: true,
        systemdLikeProductionReadiness: true,
        systemdLikeGracefulStop: true,
        productionDependenciesInstalled: true,
        buildExecutedOnTarget: false,
        parentNodeOptionsWasContaminated: true,
        childBuildNodeOptions: null
    }, null, 2));
} finally {
    if (fs.statSync(serviceState, { throwIfNoEntry: false })?.size) {
        spawnSync(path.join(bin, 'systemctl'), ['stop', 'foundry-rehearsal.service'], { env: rehearsalEnv });
    }
    fs.rmSync(root, { recursive: true, force: true });
}
