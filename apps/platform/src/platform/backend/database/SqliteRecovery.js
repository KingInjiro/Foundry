import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function assertAbsoluteFilePath(filePath, label) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || filePath === path.parse(filePath).root) {
        throw new Error(`${label} must be an absolute non-root file path.`);
    }
}

function assertExistingDatabase(filePath, label) {
    assertAbsoluteFilePath(filePath, label);
    const stat = fs.statSync(filePath, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new Error(`${label} does not exist or is not a regular file.`);
}

function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return `sha256-${hash.digest('hex')}`;
}

function listTables(db) {
    return db.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    `).all().map(row => row.name);
}

export function verifySqliteDatabase(databasePath) {
    assertExistingDatabase(databasePath, 'Database');
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
        const quickCheckRows = db.prepare('PRAGMA quick_check').all();
        const quickCheck = quickCheckRows.map(row => Object.values(row)[0]);
        if (quickCheck.length !== 1 || quickCheck[0] !== 'ok') {
            throw new Error(`SQLite quick_check failed: ${quickCheck.join(', ')}`);
        }
        const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all();
        if (foreignKeyViolations.length) {
            throw new Error(`SQLite foreign_key_check found ${foreignKeyViolations.length} violation(s).`);
        }
        const tables = listTables(db);
        const schemaMigrations = tables.includes('schema_migrations')
            ? db.prepare('SELECT version, name, appliedAt FROM schema_migrations ORDER BY version').all()
            : [];
        const rowCounts = {};
        for (const table of ['users', 'games', 'game_versions', 'upload_sessions', 'jobs', 'editor_projects', 'game_reports', 'moderation_actions']) {
            if (tables.includes(table)) rowCounts[table] = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
        }
        const stat = fs.statSync(databasePath);
        return {
            status: 'ok',
            path: databasePath,
            sizeBytes: stat.size,
            sha256: sha256File(databasePath),
            quickCheck: 'ok',
            foreignKeyViolations: 0,
            tables,
            schemaMigrations,
            rowCounts
        };
    } finally {
        db.close();
    }
}

export function createSqliteBackup({ sourcePath, outputPath }) {
    assertExistingDatabase(sourcePath, 'Source database');
    assertAbsoluteFilePath(outputPath, 'Backup output');
    if (path.resolve(sourcePath) === path.resolve(outputPath)) throw new Error('Backup output must differ from the source database.');
    if (fs.existsSync(outputPath)) throw new Error('Backup output already exists; backups are never overwritten.');
    const parent = path.dirname(outputPath);
    if (!fs.statSync(parent, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error('Backup output directory must already exist.');
    }

    const source = new DatabaseSync(sourcePath, { readOnly: true });
    try {
        // VACUUM INTO reads a transactionally consistent snapshot, including
        // committed WAL content, without copying a live database file directly.
        source.prepare('VACUUM INTO ?').run(outputPath);
    } catch (error) {
        fs.rmSync(outputPath, { force: true });
        throw error;
    } finally {
        source.close();
    }
    return verifySqliteDatabase(outputPath);
}

export function restoreSqliteBackup({ backupPath, targetPath }) {
    const backupVerification = verifySqliteDatabase(backupPath);
    assertAbsoluteFilePath(targetPath, 'Restore target');
    if (path.resolve(backupPath) === path.resolve(targetPath)) throw new Error('Restore target must differ from the backup.');
    if (fs.existsSync(targetPath)) throw new Error('Restore target already exists; restore never overwrites a database.');
    const parent = path.dirname(targetPath);
    if (!fs.statSync(parent, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error('Restore target directory must already exist.');
    }

    const source = new DatabaseSync(backupPath, { readOnly: true });
    try {
        source.prepare('VACUUM INTO ?').run(targetPath);
    } catch (error) {
        fs.rmSync(targetPath, { force: true });
        throw error;
    } finally {
        source.close();
    }
    return { backup: backupVerification, restored: verifySqliteDatabase(targetPath) };
}
