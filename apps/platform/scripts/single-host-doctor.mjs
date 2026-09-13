import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateProductionConfiguration } from '../src/platform/backend/config/productionConfig.js';
import { verifySqliteDatabase } from '../src/platform/backend/database/SqliteRecovery.js';
import { verifySingleHostBackup } from '../src/platform/backend/recovery/SingleHostRecovery.js';
import { createRecoveryStorage, checkSqliteStorageIntegrity, EXTERNAL_STORAGE_BACKUP_FORMAT } from '../src/platform/backend/recovery/ExternalStorageRecovery.js';
import { resolveStorageProvider, profileSupportsStorage } from '../src/platform/backend/config/storageConfig.js';

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

export function checkReleaseCompatibility(releaseDirectory, databasePath, env = process.env) {
    const releaseRoot = path.resolve(releaseDirectory);
    const selected = resolveStorageProvider(env, 'single-host');
    if (selected === 'r2') {
        const client = readJson(path.join(releaseRoot, 'apps/platform/dist/client/deployment-profile.json'), 'Client deployment profile');
        if (!profileSupportsStorage(client, 'single-host', selected) || !client.supportedStorageProviders?.includes('r2')) {
            throw new Error('Rollback is unsafe: target release does not support single-host R2 storage.');
        }
    }
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

    let storage;
    if (config?.storageProvider === 'r2') {
        try {
            storage = createRecoveryStorage();
            if (!await storage.ping()) throw new Error('R2 is not available.');
            const integrity = await checkSqliteStorageIntegrity(databasePath, storage);
            if (integrity.status !== 'PASS') throw new Error(`Storage integrity failed (${integrity.counts.missingOrInvalid} issue(s)).`);
            checks.objects = { status: 'PASS', provider: 'r2', localObjects: false, integrity };
        } catch (error) {
            checks.objects = { status: 'FAIL', message: error.message };
            failures.push(`objects: ${error.message}`);
        }
    } else record('objects', () => {
        const objects = path.join(dataDirectory, 'objects');
        const stat = fs.lstatSync(objects);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Object root must be a real directory.');
        fs.accessSync(objects, fs.constants.R_OK | fs.constants.W_OK);
        return { path: objects, writable: true };
    });

    record('releaseProfiles', () => {
        const client = readJson(path.join(platformRoot, 'dist', 'client', 'deployment-profile.json'), 'Client deployment profile');
        const server = readJson(path.join(platformRoot, 'dist', 'server-profile.json'), 'Server profile');
        if (!profileSupportsStorage(client, 'single-host', config?.storageProvider || 'local-disk')) {
            throw new Error('Client artifact is not a single-host build.');
        }
        const currentMigration = Number(database?.schemaMigrations.at(-1)?.version || 0);
        if (currentMigration > server.maximumDatabaseMigration) {
            throw new Error(`Database migration ${currentMigration} is newer than this release maximum ${server.maximumDatabaseMigration}.`);
        }
        return {
            clientMode: client.deploymentMode,
            authProvider: client.authProvider,
            storageProvider: config?.storageProvider || client.storageProvider,
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
        if (!['foundry-single-host-backup-v1', EXTERNAL_STORAGE_BACKUP_FORMAT].includes(manifest.format)) throw new Error('Latest backup format is invalid.');
        return { latest: latest.path, createdAt: manifest.createdAt, objectCount: manifest.objects?.count,
            remoteObjectsIncluded: manifest.format === EXTERNAL_STORAGE_BACKUP_FORMAT ? false : undefined };
    }, { warning: true });

    if (argv.includes('--verify-backup') && checks.backup?.status === 'PASS') {
        try {
            const verified = await verifySingleHostBackup(checks.backup.latest, { storage });
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

    storage?.client?.destroy();
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
