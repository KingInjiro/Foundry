import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createSqliteBackup, restoreSqliteBackup, verifySqliteDatabase } from '../database/SqliteRecovery.js';

export const SINGLE_HOST_BACKUP_FORMAT = 'foundry-single-host-backup-v1';

function assertAbsoluteNonRoot(value, label) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) === path.parse(path.resolve(value)).root) {
        throw new Error(`${label} must be an absolute non-root path.`);
    }
    return path.resolve(value);
}

async function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return `sha256-${hash.digest('hex')}`;
}

function safeRelativePath(root, candidate, label = 'Backup path') {
    const relative = path.relative(root, candidate);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`${label} escapes its configured root.`);
    }
    return relative.split(path.sep).join('/');
}

async function listRegularFiles(root, { allowMissing = false, ignoreTemp = false } = {}) {
    const stat = await fs.promises.lstat(root).catch(error => {
        if (allowMissing && error.code === 'ENOENT') return null;
        throw error;
    });
    if (!stat) return [];
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Expected a real directory: ${root}`);
    const files = [];
    const visit = async current => {
        for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
            const entryPath = path.join(current, entry.name);
            const relative = safeRelativePath(root, entryPath, 'Object path');
            if (ignoreTemp && (relative === '.tmp' || relative.startsWith('.tmp/'))) continue;
            const entryStat = await fs.promises.lstat(entryPath);
            if (entryStat.isSymbolicLink()) throw new Error(`Symbolic links are forbidden in single-host data: ${relative}`);
            if (entryStat.isDirectory()) {
                await visit(entryPath);
                continue;
            }
            if (!entryStat.isFile()) throw new Error(`Non-regular object is forbidden in single-host data: ${relative}`);
            files.push({ path: entryPath, relative, size: entryStat.size });
        }
    };
    await visit(root);
    return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

async function copyFilesWithManifest(sourceRoot, targetRoot, { ignoreTemp = false } = {}) {
    const sourceFiles = await listRegularFiles(sourceRoot, { ignoreTemp });
    const entries = [];
    let totalBytes = 0;
    for (const file of sourceFiles) {
        const destination = path.join(targetRoot, ...file.relative.split('/'));
        await fs.promises.mkdir(path.dirname(destination), { recursive: true, mode: 0o750 });
        await fs.promises.copyFile(file.path, destination, fs.constants.COPYFILE_EXCL);
        const destinationStat = await fs.promises.lstat(destination);
        if (!destinationStat.isFile() || destinationStat.size !== file.size) {
            throw new Error(`Object copy verification failed: ${file.relative}`);
        }
        const sha256 = await sha256File(destination);
        entries.push({ key: file.relative, sizeBytes: file.size, sha256 });
        totalBytes += file.size;
    }
    return { count: entries.length, totalBytes, files: entries };
}

function readManifest(backupDirectory) {
    const manifestPath = path.join(backupDirectory, 'manifest.json');
    const stat = fs.statSync(manifestPath, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new Error('Single-host backup manifest.json is missing.');
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
        throw new Error('Single-host backup manifest.json is invalid JSON.');
    }
    if (manifest?.format !== SINGLE_HOST_BACKUP_FORMAT || manifest?.deploymentMode !== 'single-host') {
        throw new Error('Unsupported or mismatched single-host backup format.');
    }
    if (!Array.isArray(manifest?.objects?.files)) throw new Error('Single-host backup object manifest is invalid.');
    return manifest;
}

export async function verifySingleHostBackup(backupDirectory) {
    const backupRoot = assertAbsoluteNonRoot(backupDirectory, 'Backup directory');
    const manifest = readManifest(backupRoot);
    const databasePath = path.join(backupRoot, 'platform.db');
    const database = verifySqliteDatabase(databasePath);
    if (database.sha256 !== manifest.database?.sha256) throw new Error('Backup database hash does not match manifest.');

    const expected = new Map();
    for (const entry of manifest.objects.files) {
        if (
            typeof entry?.key !== 'string'
            || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0
            || typeof entry.sha256 !== 'string'
            || expected.has(entry.key)
        ) throw new Error('Single-host backup contains an invalid object manifest entry.');
        const resolved = path.resolve(backupRoot, 'objects', ...entry.key.split('/'));
        safeRelativePath(path.join(backupRoot, 'objects'), resolved, 'Manifest object path');
        expected.set(entry.key, entry);
    }

    const actualFiles = await listRegularFiles(path.join(backupRoot, 'objects'));
    let totalBytes = 0;
    for (const file of actualFiles) {
        const entry = expected.get(file.relative);
        if (!entry || entry.sizeBytes !== file.size || entry.sha256 !== await sha256File(file.path)) {
            throw new Error(`Backup object verification failed: ${file.relative}`);
        }
        totalBytes += file.size;
        expected.delete(file.relative);
    }
    if (expected.size) throw new Error(`Backup object is missing: ${expected.keys().next().value}`);
    if (actualFiles.length !== manifest.objects.count || totalBytes !== manifest.objects.totalBytes) {
        throw new Error('Backup object count or byte total does not match manifest.');
    }
    return {
        status: 'PASS',
        backupDirectory: backupRoot,
        format: manifest.format,
        createdAt: manifest.createdAt,
        database,
        objects: { count: actualFiles.length, totalBytes },
        manifest
    };
}

export async function createSingleHostBackup({
    dataDirectory,
    outputDirectory,
    databasePath = null,
    applicationVersion = 'unknown',
    releaseId = 'unknown'
}) {
    const dataRoot = assertAbsoluteNonRoot(dataDirectory, 'Data directory');
    const outputRoot = assertAbsoluteNonRoot(outputDirectory, 'Backup output directory');
    const sourceDatabase = path.resolve(databasePath || path.join(dataRoot, 'platform.db'));
    const sourceObjects = path.join(dataRoot, 'objects');
    if (!fs.statSync(dataRoot, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Data directory does not exist.');
    if (!fs.statSync(sourceObjects, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Object directory does not exist.');
    if (fs.existsSync(outputRoot)) throw new Error('Backup output already exists; backups are never overwritten.');
    const parent = path.dirname(outputRoot);
    if (!fs.statSync(parent, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Backup parent directory must already exist.');

    const temporary = path.join(parent, `.${path.basename(outputRoot)}.${crypto.randomUUID()}.partial`);
    try {
        await fs.promises.mkdir(temporary, { mode: 0o700 });
        await fs.promises.mkdir(path.join(temporary, 'objects'), { mode: 0o750 });
        const database = createSqliteBackup({ sourcePath: sourceDatabase, outputPath: path.join(temporary, 'platform.db') });
        const objects = await copyFilesWithManifest(sourceObjects, path.join(temporary, 'objects'), { ignoreTemp: true });
        const manifest = {
            format: SINGLE_HOST_BACKUP_FORMAT,
            deploymentMode: 'single-host',
            createdAt: new Date().toISOString(),
            applicationVersion: String(applicationVersion || 'unknown'),
            releaseId: String(releaseId || 'unknown'),
            consistency: 'Application service must be stopped while this coordinated DB + object snapshot is created.',
            database: {
                file: 'platform.db',
                sizeBytes: database.sizeBytes,
                sha256: database.sha256,
                quickCheck: database.quickCheck,
                foreignKeyViolations: database.foreignKeyViolations,
                schemaMigrations: database.schemaMigrations
            },
            objects: { directory: 'objects', ...objects },
            excluded: ['environment files', 'session secret', 'storage signing secret', 'TLS private keys', 'temporary uploads']
        };
        await fs.promises.writeFile(path.join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        await verifySingleHostBackup(temporary);
        await fs.promises.rename(temporary, outputRoot);
        return verifySingleHostBackup(outputRoot);
    } catch (error) {
        await fs.promises.rm(temporary, { recursive: true, force: true });
        throw error;
    }
}

export async function restoreSingleHostBackup({ backupDirectory, targetDataDirectory }) {
    const backupRoot = assertAbsoluteNonRoot(backupDirectory, 'Backup directory');
    const targetRoot = assertAbsoluteNonRoot(targetDataDirectory, 'Restore target data directory');
    if (fs.existsSync(targetRoot)) throw new Error('Restore target already exists; single-host restore never overwrites data.');
    const parent = path.dirname(targetRoot);
    if (!fs.statSync(parent, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Restore target parent directory must already exist.');
    const verifiedBackup = await verifySingleHostBackup(backupRoot);
    const temporary = path.join(parent, `.${path.basename(targetRoot)}.${crypto.randomUUID()}.partial`);
    try {
        await fs.promises.mkdir(temporary, { mode: 0o700 });
        await fs.promises.mkdir(path.join(temporary, 'objects'), { mode: 0o750 });
        const databaseRestore = restoreSqliteBackup({
            backupPath: path.join(backupRoot, 'platform.db'),
            targetPath: path.join(temporary, 'platform.db')
        });
        const copiedObjects = await copyFilesWithManifest(path.join(backupRoot, 'objects'), path.join(temporary, 'objects'));
        await fs.promises.mkdir(path.join(temporary, 'objects', '.tmp'), { mode: 0o750 });
        if (
            copiedObjects.count !== verifiedBackup.objects.count
            || copiedObjects.totalBytes !== verifiedBackup.objects.totalBytes
        ) throw new Error('Restored object totals do not match the verified backup.');
        for (let index = 0; index < copiedObjects.files.length; index += 1) {
            const copied = copiedObjects.files[index];
            const expected = verifiedBackup.manifest.objects.files[index];
            if (copied.key !== expected.key || copied.sha256 !== expected.sha256) {
                throw new Error(`Restored object hash mismatch: ${copied.key}`);
            }
        }
        await fs.promises.rename(temporary, targetRoot);
        return {
            status: 'PASS',
            targetDataDirectory: targetRoot,
            database: databaseRestore.restored,
            objects: copiedObjects,
            sourceCreatedAt: verifiedBackup.createdAt
        };
    } catch (error) {
        await fs.promises.rm(temporary, { recursive: true, force: true });
        throw error;
    }
}
