import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(platformRoot, 'dist');
const clientRoot = path.join(distRoot, 'client');
const serverBundle = path.join(distRoot, 'server.cjs');
const serverProfilePath = path.join(distRoot, 'server-profile.json');

function fail(message) {
    throw new Error(`Artifact hygiene check failed: ${message}`);
}

function walk(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const absolute = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(absolute) : [absolute];
    });
}

if (!fs.existsSync(serverBundle)) fail('dist/server.cjs is missing.');
if (!fs.existsSync(serverProfilePath)) fail('dist/server-profile.json is missing.');
if (!fs.existsSync(path.join(clientRoot, 'index.html'))) fail('dist/client/index.html is missing.');
const deploymentProfilePath = path.join(clientRoot, 'deployment-profile.json');
if (!fs.existsSync(deploymentProfilePath)) fail('generated deployment-profile.json is missing.');
const deploymentProfile = JSON.parse(fs.readFileSync(deploymentProfilePath, 'utf8'));
const serverProfile = JSON.parse(fs.readFileSync(serverProfilePath, 'utf8'));
if (
    serverProfile.schemaVersion !== 1
    || serverProfile.service !== 'foundry-platform'
    || !Number.isSafeInteger(serverProfile.minimumDatabaseMigration)
    || !Number.isSafeInteger(serverProfile.maximumDatabaseMigration)
    || serverProfile.minimumDatabaseMigration > serverProfile.maximumDatabaseMigration
    || !Array.isArray(serverProfile.migrations)
    || serverProfile.migrations.at(-1)?.version !== serverProfile.maximumDatabaseMigration
) fail('server-profile.json is malformed.');
const validBaseProfile = deploymentProfile.schemaVersion === 2
    && new Set(['cloud', 'single-host']).has(deploymentProfile.deploymentMode)
    && deploymentProfile.authProvider === (deploymentProfile.deploymentMode === 'cloud' ? 'firebase' : 'local')
    && deploymentProfile.storageProvider === (deploymentProfile.deploymentMode === 'cloud' ? 'r2' : 'local-disk');
const validCloudIdentity = deploymentProfile.deploymentMode !== 'cloud'
    || (Boolean(deploymentProfile.firebaseProjectId) && Boolean(deploymentProfile.firebaseAuthDomain));
const validSingleHostIdentity = deploymentProfile.deploymentMode !== 'single-host'
    || (!deploymentProfile.firebaseProjectId && !deploymentProfile.firebaseAuthDomain);
if (!validBaseProfile || !validCloudIdentity || !validSingleHostIdentity) {
    fail('deployment-profile.json is malformed.');
}

const unexpectedDistEntries = fs.readdirSync(distRoot)
    .filter(entry => !new Set(['client', 'server.cjs', 'server-profile.json']).has(entry));
if (unexpectedDistEntries.length) fail(`unexpected dist entries: ${unexpectedDistEntries.join(', ')}`);

const clientFiles = walk(clientRoot);
const forbiddenPath = /(?:^|\/)(?:\.env(?:\.|$)|node_modules|tests?|e2e|fixtures?|test-results|playwright-report|\.local|\.e2e|coverage)(?:\/|$)|\.(?:db|sqlite)(?:-(?:wal|shm))?$|\.map$/i;
for (const file of clientFiles) {
    const relative = path.relative(clientRoot, file).replaceAll(path.sep, '/');
    if (forbiddenPath.test(relative)) fail(`forbidden public file: ${relative}`);
    if (relative === 'server.cjs' || relative.startsWith('server.')) fail(`backend artifact is public: ${relative}`);
}

const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/
];
for (const file of [...clientFiles, serverBundle]) {
    const stat = fs.statSync(file);
    if (stat.size > 5 * 1024 * 1024) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (secretPatterns.some(pattern => pattern.test(content))) {
        fail(`credential-like material detected in ${path.relative(distRoot, file)}.`);
    }
}

const publicTopLevel = new Set(clientFiles.map(file => path.relative(clientRoot, file).split(path.sep)[0]));
for (const required of ['index.html', 'sandbox.html', 'generic-sandbox.html', 'assets']) {
    if (!publicTopLevel.has(required)) fail(`required browser artifact is missing: ${required}`);
}

console.log(JSON.stringify({
    status: 'PASS',
    clientFiles: clientFiles.length,
    serverBundle: path.relative(platformRoot, serverBundle),
    publicRoot: path.relative(platformRoot, clientRoot),
    publicSourceMaps: 0,
    publicDebugFixtures: 0
}, null, 2));
