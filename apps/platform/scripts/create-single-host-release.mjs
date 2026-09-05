import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { createReleaseManifest, RELEASE_MANIFEST_NAME } from '../../../deploy/single-host/release-manifest.mjs';

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(platformRoot, '..', '..');
const fixedZipDate = new Date('1980-01-01T00:00:00.000Z');
const operationalScripts = [
    'verify-artifact.mjs',
    'smoke-production.mjs',
    'single-host-backup.mjs',
    'single-host-restore.mjs',
    'single-host-rehearsal.mjs',
    'single-host-doctor.mjs',
    'local-user.mjs',
    'check-storage-integrity.mjs'
];

function fail(message) {
    throw new Error(`Single-host release creation failed: ${message}`);
}

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function addFile(entries, relativePath) {
    const normalized = relativePath.split(path.sep).join('/');
    const absolute = path.join(repositoryRoot, normalized);
    const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink()) fail(`required regular file is missing: ${normalized}`);
    entries.set(normalized, fs.readFileSync(absolute));
}

function addDirectory(entries, relativeDirectory, { exclude = () => false } = {}) {
    const absoluteDirectory = path.join(repositoryRoot, relativeDirectory);
    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
        const relative = path.join(relativeDirectory, entry.name);
        if (exclude(relative, entry)) continue;
        const absolute = path.join(repositoryRoot, relative);
        const stat = fs.lstatSync(absolute);
        if (stat.isSymbolicLink()) fail(`symbolic link is forbidden: ${relative}`);
        if (stat.isDirectory()) addDirectory(entries, relative, { exclude });
        else if (stat.isFile()) addFile(entries, relative);
        else fail(`special filesystem entry is forbidden: ${relative}`);
    }
}

async function main() {
    const outputValue = argument('--output');
    if (!outputValue) fail('usage: npm run release:single-host -- --output /absolute/path/Foundry-single-host.zip');
    const output = path.resolve(outputValue);
    if (fs.existsSync(output)) fail(`output already exists: ${output}`);
    if (!fs.statSync(path.dirname(output), { throwIfNoEntry: false })?.isDirectory()) fail('output parent directory does not exist.');

    const artifactVerification = spawnSync(process.execPath, [path.join(platformRoot, 'scripts', 'verify-artifact.mjs')], {
        cwd: platformRoot,
        encoding: 'utf8'
    });
    if (artifactVerification.status !== 0) {
        fail(`artifact verification did not pass:\n${artifactVerification.stdout}${artifactVerification.stderr}`);
    }
    const deploymentProfile = JSON.parse(fs.readFileSync(path.join(platformRoot, 'dist', 'client', 'deployment-profile.json'), 'utf8'));
    if (deploymentProfile.deploymentMode !== 'single-host') fail('dist/client is not a single-host production build.');

    const entries = new Map();
    for (const relative of ['package.json', 'package-lock.json', 'apps/platform/package.json']) addFile(entries, relative);
    for (const packageName of ['contracts', 'player', 'engine']) addFile(entries, `packages/${packageName}/package.json`);
    addFile(entries, 'packages/contracts/src/index.js');
    addFile(entries, 'packages/contracts/src/streaming/constants.js');
    addDirectory(entries, 'apps/platform/dist');
    addDirectory(entries, 'apps/platform/src/platform/backend');
    for (const script of operationalScripts) addFile(entries, `apps/platform/scripts/${script}`);
    addDirectory(entries, 'deploy/single-host');

    const manifest = createReleaseManifest(entries);
    entries.set(RELEASE_MANIFEST_NAME, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));

    const zip = new JSZip();
    for (const [relative, contents] of entries) {
        const executable = relative.startsWith('deploy/single-host/')
            && (relative.endsWith('.sh') || path.posix.basename(relative) === 'foundry');
        zip.file(relative, contents, {
            date: fixedZipDate,
            createFolders: true,
            unixPermissions: executable ? 0o100755 : 0o100644
        });
    }
    const archive = await zip.generateAsync({
        type: 'nodebuffer',
        platform: 'UNIX',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
    });
    fs.writeFileSync(output, archive, { flag: 'wx', mode: 0o644 });
    console.log(JSON.stringify({
        status: 'PASS',
        output,
        archiveBytes: archive.length,
        payloadFiles: manifest.payload.files.length,
        payloadSha256: manifest.payload.digest,
        deploymentMode: manifest.deploymentMode,
        buildOnTarget: manifest.runtime.buildOnTarget,
        dependencyInstall: manifest.runtime.dependencyInstall
    }, null, 2));
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
