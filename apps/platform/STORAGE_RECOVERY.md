# SQLite and object-storage recovery model

## Authority and consistency

Foundry has two required stores in both production profiles:

- SQLite is authoritative for users, ownership, game/version lifecycle, moderation state, upload sessions, jobs, retention state, reports, and audit records.
- The selected object provider is authoritative for private uploaded ZIP bytes and extracted runtime object bytes: R2 in `cloud`, `<FOUNDRY_DATA_DIR>/objects` in `single-host`.

Neither store alone is a complete backup. Public delivery always checks SQLite first and then reads the selected provider. An object that has no corresponding live SQLite authorization is not served through `/api/cdn/*`. Single-host objects are never exposed as an unrestricted static directory.

The write order intentionally favors safe orphaning over broken publication:

1. package bytes are uploaded to an immutable version prefix;
2. server validation records `READY` only after the object exists;
3. extraction writes runtime objects;
4. SQLite atomically activates the version only after extraction succeeds;
5. failed extraction removes its partial extracted prefix when possible;
6. delete jobs revoke access in SQLite before removing the provider prefix.

A crash can therefore leave an orphan candidate, but should not publish metadata before its required bytes exist. The read-only checker exists to detect exceptions.

## Integrity checker

Run against the exact DB/object-provider pair. Configuration selects R2 or local disk:

```bash
PLATFORM_DB_PATH=/absolute/path/platform.db npm run storage:check
```

It verifies:

- source ZIPs still required by `READY`, `PUBLISHING`, `PUBLISH_FAILED`, or `VALIDATING` work;
- runtime entry objects for versions with a runtime URL;
- declared streaming manifest objects;
- the canonical runtime URL shape;
- objects under `games/` that are not explained by a live upload session or extracted version prefix.

Missing/invalid references make the command exit non-zero. Orphan candidates are warnings in the report and are never deleted. Review job state and backup age before removing anything manually.

## Restoring an older cloud SQLite backup

Restoring metadata to an earlier point has two asymmetric effects:

- Objects created after the DB backup become orphan candidates. This consumes storage but does not grant public access.
- Objects deleted after the DB backup may be referenced by restored rows. Those releases fail the integrity check and cannot be repaired from SQLite alone.

Safe procedure:

1. Stop the single Platform process gracefully.
2. Preserve the current DB and obtain an R2 inventory before changing either store.
3. Restore the SQLite backup to a new filename; never overwrite the current DB.
4. Point `PLATFORM_DB_PATH` at the restored file in an isolated rehearsal.
5. Run `db:rehearse` and `storage:check` with the production R2 bucket.
6. For every missing runtime object, restore the object from the external R2 backup/retention mechanism or keep the game unavailable. Do not mark a version published merely to silence the checker.
7. Review orphan candidates. Retain them through the incident window; cleanup is a separate explicit decision.
8. Start the Platform and validate catalog, CDN HEAD/Range, moderation, and release rollback.

## Required external R2 recovery control

The repository provides verification and consistency detection; it does not implement an R2 backup product. Before public release, operations must supply and rehearse an external bucket backup, replication, snapshot, or retention process capable of recovering deleted version prefixes. Without it, SQLite recovery alone cannot recover runtime bytes removed after the DB backup.

Record the selected mechanism, retention window, restore command, and owner in the release record. This is a public-release recovery gate, not a prerequisite for an isolated disposable staging test.

## Archived releases and cleanup

- `ARCHIVED` release runtime prefixes are live rollback material and must remain in R2.
- Unpublish changes metadata visibility but intentionally retains runtime bytes for restore.
- Source ZIP cleanup is time-based. A cleaned `READY`/`PUBLISH_FAILED` source is marked `EXPIRED`; it must be uploaded as a new version.
- Version/project deletion enters `DELETING`, immediately fails public authorization, deletes the version/game prefix through a durable job, then removes metadata.
- A failed cleanup job remains in SQLite for operator inspection. Do not manually delete DB rows before deciding what should happen to the corresponding R2 prefix.

## Coordinated backup note

`db:backup` uses `VACUUM INTO`, so it captures a transactionally consistent SQLite snapshot including committed WAL state while the service is active. It does not freeze R2 or queued deletes. For a release-critical coordinated recovery point, quiesce the Platform with SIGTERM first or use an external R2 retention policy that preserves objects across the DB backup window.

## Single-host coordinated backup and restore

Single-host backup covers both required stores in one portable directory:

```text
foundry-backup-<timestamp>/
├── platform.db
├── objects/
└── manifest.json
```

The manifest records format version, application/release metadata, schema version, database SHA-256, object count/bytes, and a SHA-256 for every object. Symlinks and special files are rejected; `.tmp` partial uploads are excluded. `.env`, password/session secrets, and TLS keys are never copied.

Use the installed coordinator so the one writer drains and restarts safely:

```bash
sudo foundry backup
sudo foundry rehearse --backup /var/lib/foundry/backups/foundry-backup-YYYYMMDDTHHMMSSZ
sudo foundry storage-check
```

Rehearsal restores to a temporary new data root, validates SQLite quick/FK checks and every object hash, boots an isolated application, checks `/api/health` and `/api/ready`, and requires a representative ACTIVE/PUBLISHED asset to pass through the CDN gate. A backup without published data can still be restored, but the strict release rehearsal deliberately fails until a published fixture exists.

Direct restore never overwrites active data:

```bash
sudo foundry restore \
  --backup /absolute/foundry-backup-directory \
  --target /absolute/new-data-directory \
  --confirm-new-target
```

Inspect and rehearse the restored root before any manual cutover. Do not copy `platform.db`, `-wal`, or `-shm` individually and do not merge object trees.

## Single-server disaster limitation

A backup retained only under `/var/lib/foundry/backups` is operational rollback material, not disaster recovery. Loss of the physical server/disk can destroy the DB, objects, and same-disk backups together. Copy completed backup directories to an operator-controlled PC, NAS, removable disk, or another host and periodically rehearse a downloaded copy. Single-host v1 intentionally does not require a managed backup provider.
