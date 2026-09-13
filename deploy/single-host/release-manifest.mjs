import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELEASE_MANIFEST_NAME = 'foundry-release.json';
export const RELEASE_TYPE = 'foundry-single-host-prebuilt';
export const RELEASE_SCHEMA_VERSION = 1;

const REQUIRED_FILES = [
    'package.json',
    'package-lock.json',
    'apps/platform/package.json',
    'apps/platform/dist/server.cjs',
    'apps/platform/dist/server-profile.json',
    'apps/platform/dist/client/index.html',
    'apps/platform/dist/client/deployment-profile.json',
    'apps/platform/scripts/verify-artifact.mjs',
    'apps/platform/scripts/smoke-production.mjs',
    'apps/platform/scripts/single-host-backup.mjs',
    'apps/platform/scripts/single-host-restore.mjs',
    'apps/platform/scripts/single-host-rehearsal.mjs',
    'apps/platform/scripts/single-host-doctor.mjs',
    'apps/platform/scripts/local-user.mjs',
    'apps/platform/scripts/check-storage-integrity.mjs',
    'deploy/single-host/Caddyfile.example',
    'deploy/single-host/caddy-logging.conf',
    'deploy/single-host/ci-update.sh',
    'deploy/single-host/common.sh',
    'deploy/single-host/configure-deploy-user.sh',
    'deploy/single-host/foundry',
    'deploy/single-host/install.sh',
    'deploy/single-host/release-manifest.mjs',
    'deploy/single-host/update.sh',
    'deploy/single-host/rollback.sh',
    'deploy/single-host/foundry.service.in'
];

const FORBIDDEN_RELEASE_PATH = /(?:^|\/)(?:node_modules|tests?|e2e|fixtures?|test-results|playwright-report|coverage)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:db|sqlite)(?:-(?:wal|shm))?$|\.map$|\.log$/i;

function fail(message) {
    throw new Error(`Single-host release verification failed: ${message}`);
}

function normalizedRelativePath(value) {
    if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) {
        fail(`invalid release path: ${String(value)}`);
    }
    const normalized = path.posix.normalize(value);
    if (normalized !== value || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
        fail(`unsafe release path: ${value}`);
    }
    if (FORBIDDEN_RELEASE_PATH.test(normalized)) fail(`forbidden release path: ${normalized}`);
    return normalized;
}

function sha256(contents) {
    return crypto.createHash('sha256').update(contents).digest('hex');
}

function payloadDigest(records) {
    const canonical = records.map(record => `${record.sha256} ${record.size} ${record.path}\n`).join('');
    return sha256(Buffer.from(canonical, 'utf8'));
}

export function createReleaseManifest(entries) {
    const records = [...entries.entries()].map(([entryPath, contents]) => {
        const safePath = normalizedRelativePath(entryPath);
        const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
        return { path: safePath, size: buffer.length, sha256: sha256(buffer) };
    }).sort((left, right) => left.path.localeCompare(right.path));

    if (!records.length) fail('payload is empty.');
    if (new Set(records.map(record => record.path)).size !== records.length) fail('payload paths are not unique.');
    for (const required of REQUIRED_FILES) {
        if (!records.some(record => record.path === required)) fail(`required payload file is missing: ${required}`);
    }
    const packageLock = records.find(record => record.path === 'package-lock.json');
    return {
        schemaVersion: RELEASE_SCHEMA_VERSION,
        releaseType: RELEASE_TYPE,
        deploymentMode: 'single-host',
        runtime: {
            minimumNodeMajor: 22,
            dependencyInstall: 'npm ci --omit=dev',
            buildOnTarget: false
        },
        payload: {
            algorithm: 'sha256',
            digest: payloadDigest(records),
            packageLockSha256: packageLock.sha256,
            files: records
        }
    };
}

function walkRelease(root, directory = root) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const absolute = path.join(directory, entry.name);
        const relative = path.relative(root, absolute).split(path.sep).join('/');
        const stat = fs.lstatSync(absolute);
        if (stat.isSymbolicLink()) fail(`symbolic link is forbidden: ${relative}`);
        if (stat.isDirectory()) files.push(...walkRelease(root, absolute));
        else if (stat.isFile() && relative !== RELEASE_MANIFEST_NAME) files.push(relative);
        else if (!stat.isFile()) fail(`special filesystem entry is forbidden: ${relative}`);
    }
    return files.sort((left, right) => left.localeCompare(right));
}

function readJson(filePath, label) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        fail(`${label} is missing or invalid.`);
    }
}

export function verifyReleaseDirectory(releaseDirectory) {
    const root = path.resolve(releaseDirectory);
    if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) fail(`release directory is missing: ${root}`);
    const manifest = readJson(path.join(root, RELEASE_MANIFEST_NAME), 'foundry-release.json');
    if (
        manifest.schemaVersion !== RELEASE_SCHEMA_VERSION
        || manifest.releaseType !== RELEASE_TYPE
        || manifest.deploymentMode !== 'single-host'
        || manifest.runtime?.minimumNodeMajor !== 22
        || manifest.runtime?.dependencyInstall !== 'npm ci --omit=dev'
        || manifest.runtime?.buildOnTarget !== false
        || manifest.payload?.algorithm !== 'sha256'
        || !/^[a-f0-9]{64}$/.test(manifest.payload?.digest || '')
        || !/^[a-f0-9]{64}$/.test(manifest.payload?.packageLockSha256 || '')
        || !Array.isArray(manifest.payload?.files)
    ) fail('manifest contract is malformed.');
    if (Number(process.versions.node.split('.')[0]) < manifest.runtime.minimumNodeMajor) {
        fail(`Node.js ${manifest.runtime.minimumNodeMajor} or newer is required.`);
    }

    const records = manifest.payload.files;
    const paths = records.map(record => normalizedRelativePath(record?.path));
    if (new Set(paths).size !== paths.length) fail('manifest payload paths are not unique.');
    if ([...paths].sort((left, right) => left.localeCompare(right)).some((value, index) => value !== paths[index])) {
        fail('manifest payload paths are not sorted.');
    }
    for (const required of REQUIRED_FILES) {
        if (!paths.includes(required)) fail(`required payload file is missing: ${required}`);
    }

    const actualPaths = walkRelease(root);
    if (actualPaths.length !== paths.length || actualPaths.some((value, index) => value !== paths[index])) {
        const missing = paths.filter(value => !actualPaths.includes(value));
        const unexpected = actualPaths.filter(value => !paths.includes(value));
        fail(`payload inventory mismatch; missing=[${missing.join(', ')}], unexpected=[${unexpected.join(', ')}]`);
    }

    for (const record of records) {
        if (!Number.isSafeInteger(record.size) || record.size < 0 || !/^[a-f0-9]{64}$/.test(record.sha256 || '')) {
            fail(`invalid payload record: ${record.path}`);
        }
        const contents = fs.readFileSync(path.join(root, record.path));
        if (contents.length !== record.size) fail(`size mismatch: ${record.path}`);
        if (sha256(contents) !== record.sha256) fail(`SHA-256 mismatch: ${record.path}`);
    }
    if (payloadDigest(records) !== manifest.payload.digest) fail('payload digest mismatch.');
    const packageLock = records.find(record => record.path === 'package-lock.json');
    if (packageLock?.sha256 !== manifest.payload.packageLockSha256) fail('package-lock identity mismatch.');

    const clientProfile = readJson(path.join(root, 'apps/platform/dist/client/deployment-profile.json'), 'client deployment profile');
    if (
        clientProfile.schemaVersion !== 2
        || clientProfile.deploymentMode !== 'single-host'
        || clientProfile.authProvider !== 'local'
        || !['local-disk', 'r2'].includes(clientProfile.storageProvider)
        || (clientProfile.supportedStorageProviders !== undefined && (
            !Array.isArray(clientProfile.supportedStorageProviders)
            || !clientProfile.supportedStorageProviders.includes(clientProfile.storageProvider)
            || new Set(clientProfile.supportedStorageProviders).size !== clientProfile.supportedStorageProviders.length
            || clientProfile.supportedStorageProviders.some(value => !['local-disk', 'r2'].includes(value))
        ))
        || clientProfile.firebaseProjectId
        || clientProfile.firebaseAuthDomain
    ) fail('client artifact is not a fail-closed single-host build.');
    const serverProfile = readJson(path.join(root, 'apps/platform/dist/server-profile.json'), 'server profile');
    if (
        serverProfile.schemaVersion !== 1
        || serverProfile.service !== 'foundry-platform'
        || !Number.isSafeInteger(serverProfile.minimumDatabaseMigration)
        || !Number.isSafeInteger(serverProfile.maximumDatabaseMigration)
        || serverProfile.minimumDatabaseMigration > serverProfile.maximumDatabaseMigration
    ) fail('server profile is malformed.');

    return {
        status: 'PASS',
        releaseType: manifest.releaseType,
        deploymentMode: manifest.deploymentMode,
        files: records.length,
        payloadSha256: manifest.payload.digest,
        packageLockSha256: manifest.payload.packageLockSha256,
        buildOnTarget: manifest.runtime.buildOnTarget,
        dependencyInstall: manifest.runtime.dependencyInstall
    };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
    try {
        console.log(JSON.stringify(verifyReleaseDirectory(process.argv[2] || '.'), null, 2));
    } catch (error) {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    }
}
