import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateProductionConfiguration } from '../src/platform/backend/config/productionConfig.js';
import { verifySqliteDatabase } from '../src/platform/backend/database/SqliteRecovery.js';
import { verifySingleHostBackup } from '../src/platform/backend/recovery/SingleHostRecovery.js';

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argument(name, argv = process.argv) {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
}

function readJson(filePath, label) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        throw new Error(`${label} is missing or invalid: ${filePath}`);
    }
}

export function checkReleaseCompatibility(releaseDirectory, databasePath) {
    const releaseRoot = path.resolve(releaseDirectory);
    const profile = readJson(path.join(releaseRoot, 'apps', 'platform', 'dist', 'server-profile.json'), 'Server profile');
    if (profile.schemaVersion !== 1 || !Number.isSafeInteger(profile.maximumDatabaseMigration)) {
        throw new Error('Target release server profile is malformed.');
    }
    const database = verifySqliteDatabase(path.resolve(databasePath));
    const currentMigration = Number(database.schemaMigrations.at(-1)?.version || 0);
    if (currentMigration > profile.maximumDatabaseMigration) {
        throw new Error(`Rollback is unsafe: database migration ${currentMigration} is newer than target release maximum ${profile.maximumDatabaseMigration}.`);
    }
    return {
        status: 'PASS',
        releaseDirectory: releaseRoot,
        currentDatabaseMigration: currentMigration,
        releaseMaximumDatabaseMigration: profile.maximumDatabaseMigration
    };
}

function systemdStatus() {
    const run = verb => {
        const result = spawnSync('systemctl', [verb, 'foundry.service'], { encoding: 'utf8' });
        return { ok: result.status === 0, value: String(result.stdout || result.stderr || '').trim().split('\n')[0] };
    };
    return { enabled: run('is-enabled'), active: run('is-active') };
}

async function doctor(argv = process.argv) {
    const checkRelease = argument('--check-release', argv);
    const databasePath = path.resolve(argument('--db', argv) || process.env.PLATFORM_DB_PATH || '');
    if (checkRelease) return checkReleaseCompatibility(checkRelease, databasePath);

    const checks = {};
    const failures = [];
    const warnings = [];
    const record = (name, operation, { warning = false } = {}) => {
        try {
            checks[name] = { status: 'PASS', ...operation() };
        } catch (error) {
            checks[name] = { status: warning ? 'WARN' : 'FAIL', message: error.message };
            (warning ? warnings : failures).push(`${name}: ${error.message}`);
        }
    };

    record('node', () => {
        const major = Number(process.versions.node.split('.')[0]);
        if (!Number.isSafeInteger(major) || major < 22) throw new Error('Node.js 22 or newer is required.');
        return { version: process.versions.node, requiredMajor: 22 };
    });

    let config;
    record('productionConfig', () => {
        config = validateProductionConfiguration(process.env);
        if (config.deploymentMode !== 'single-host') throw new Error('Expected FOUNDRY_DEPLOYMENT_MODE=single-host.');
        return {
            deploymentMode: config.deploymentMode,
            publicOrigin: config.publicBaseUrl,
            host: config.host,
            port: config.port
        };
    });

    const dataDirectory = path.resolve(process.env.FOUNDRY_DATA_DIR || '');
    record('dataDirectory', () => {
        if (!path.isAbsolute(process.env.FOUNDRY_DATA_DIR || '') || dataDirectory === path.parse(dataDirectory).root) {
            throw new Error('FOUNDRY_DATA_DIR is not an absolute non-root path.');
        }
        fs.accessSync(dataDirectory, fs.constants.R_OK | fs.constants.W_OK);
        const stats = fs.statfsSync(dataDirectory);
        const freeBytes = Number(stats.bavail) * Number(stats.bsize);
        const minimumFreeBytes = Number(process.env.FOUNDRY_MIN_FREE_BYTES || 1_073_741_824);
        if (!Number.isSafeInteger(minimumFreeBytes) || minimumFreeBytes < 104_857_600) {
            throw new Error('FOUNDRY_MIN_FREE_BYTES must be an integer of at least 104857600.');
        }
        if (freeBytes < minimumFreeBytes) throw new Error(`Free space ${freeBytes} is below required ${minimumFreeBytes} bytes.`);
        return { path: dataDirectory, writable: true, freeBytes, minimumFreeBytes };
    });

    let database;
    record('sqlite', () => {
        database = verifySqliteDatabase(databasePath);
        return {
            path: database.path,
            quickCheck: database.quickCheck,
            foreignKeyViolations: database.foreignKeyViolations,
            sizeBytes: database.sizeBytes,
            migration: Number(database.schemaMigrations.at(-1)?.version || 0)
        };
    });

    record('objects', () => {
        const objects = path.join(dataDirectory, 'objects');
        const stat = fs.lstatSync(objects);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Object root must be a real directory.');
        fs.accessSync(objects, fs.constants.R_OK | fs.constants.W_OK);
        return { path: objects, writable: true };
    });

    record('releaseProfiles', () => {
        const client = readJson(path.join(platformRoot, 'dist', 'client', 'deployment-profile.json'), 'Client deployment profile');
        const server = readJson(path.join(platformRoot, 'dist', 'server-profile.json'), 'Server profile');
        if (client.deploymentMode !== 'single-host' || client.authProvider !== 'local' || client.storageProvider !== 'local-disk') {
            throw new Error('Client artifact is not a single-host build.');
        }
        const currentMigration = Number(database?.schemaMigrations.at(-1)?.version || 0);
        if (currentMigration > server.maximumDatabaseMigration) {
            throw new Error(`Database migration ${currentMigration} is newer than this release maximum ${server.maximumDatabaseMigration}.`);
        }
        return {
            clientMode: client.deploymentMode,
            authProvider: client.authProvider,
            storageProvider: client.storageProvider,
            maximumDatabaseMigration: server.maximumDatabaseMigration
        };
    });

    record('backup', () => {
        const backupRoot = path.join(dataDirectory, 'backups');
        const backups = fs.readdirSync(backupRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && entry.name.startsWith('foundry-backup-'))
            .map(entry => ({ name: entry.name, path: path.join(backupRoot, entry.name) }))
            .sort((a, b) => b.name.localeCompare(a.name));
        if (!backups.length) throw new Error('No coordinated single-host backup exists yet.');
        const latest = backups[0];
        const manifest = readJson(path.join(latest.path, 'manifest.json'), 'Latest backup manifest');
        if (manifest.format !== 'foundry-single-host-backup-v1') throw new Error('Latest backup format is invalid.');
        return { latest: latest.path, createdAt: manifest.createdAt, objectCount: manifest.objects?.count };
    }, { warning: true });

    if (argv.includes('--verify-backup') && checks.backup?.status === 'PASS') {
        try {
            const verified = await verifySingleHostBackup(checks.backup.latest);
            checks.backupIntegrity = { status: 'PASS', objectCount: verified.objects.count, databaseSha256: verified.database.sha256 };
        } catch (error) {
            checks.backupIntegrity = { status: 'FAIL', message: error.message };
            failures.push(`backupIntegrity: ${error.message}`);
        }
    }

    record('systemd', () => {
        const status = systemdStatus();
        if (!status.enabled.ok) throw new Error(`foundry.service is not enabled (${status.enabled.value || 'unknown'}).`);
        if (!status.active.ok) throw new Error(`foundry.service is not active (${status.active.value || 'unknown'}).`);
        return { enabled: status.enabled.value, active: status.active.value };
    }, { warning: true });

    return {
        status: failures.length ? 'FAIL' : (warnings.length ? 'WARN' : 'PASS'),
        checkedAt: new Date().toISOString(),
        checks,
        failures,
        warnings
    };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const result = await doctor();
        console.log(JSON.stringify(result, null, 2));
        if (result.status === 'FAIL') process.exitCode = 1;
    } catch (error) {
        console.error(JSON.stringify({ status: 'FAIL', message: error.message }));
        process.exitCode = 1;
    }
}
