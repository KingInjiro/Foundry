const REQUIRED_PACKAGE_VERSION_STATES = new Set(['READY', 'PUBLISHING', 'PUBLISH_FAILED']);
const REQUIRED_RUNTIME_VERSION_STATES = new Set(['PUBLISHED', 'ARCHIVED']);

function notFound(error) {
    return error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404;
}

async function objectExists(storage, key) {
    try {
        const metadata = await storage.getObjectMetadata(key);
        return { exists: true, metadata };
    } catch (error) {
        if (notFound(error)) return { exists: false, metadata: null };
        throw error;
    }
}

export async function checkStorageIntegrity(database, storage) {
    if (typeof database?.getStorageIntegritySnapshot !== 'function') throw new Error('Database provider does not support storage integrity snapshots.');
    if (typeof storage?.listObjects !== 'function') throw new Error('Storage provider does not support read-only object listing.');

    const snapshot = await database.getStorageIntegritySnapshot();
    const required = [];
    const knownExactObjects = new Set();
    const knownPrefixes = [];
    const issues = [];
    const versionsById = new Map(snapshot.versions.map(version => [version.id, version]));

    for (const session of snapshot.uploadSessions) {
        if (!session.objectKey) continue;
        if (session.status !== 'CLEANED') knownExactObjects.add(session.objectKey);
        const version = versionsById.get(session.versionId);
        if (session.status === 'VALIDATING' || REQUIRED_PACKAGE_VERSION_STATES.has(version?.status)) {
            required.push({ kind: 'source-package', key: session.objectKey, gameId: session.gameId, versionId: session.versionId, sessionId: session.id });
        }
    }

    for (const version of snapshot.versions) {
        if (!version.runtimeUrl) {
            if (REQUIRED_RUNTIME_VERSION_STATES.has(version.status)) {
                issues.push({ code: 'MISSING_RUNTIME_REFERENCE', gameId: version.gameId, versionId: version.id, status: version.status });
            }
            continue;
        }
        const expectedRuntimeUrl = `/api/cdn/games/${version.gameId}/versions/${version.id}/extracted`;
        if (version.runtimeUrl !== expectedRuntimeUrl) {
            issues.push({ code: 'INVALID_RUNTIME_REFERENCE', gameId: version.gameId, versionId: version.id, value: version.runtimeUrl, expected: expectedRuntimeUrl });
            continue;
        }
        const prefix = `games/${version.gameId}/versions/${version.id}/extracted/`;
        knownPrefixes.push(prefix);
        if (!version.entry) {
            issues.push({ code: 'MISSING_ENTRY_REFERENCE', gameId: version.gameId, versionId: version.id });
        } else {
            required.push({ kind: 'runtime-entry', key: `${prefix}${version.entry}`, gameId: version.gameId, versionId: version.id });
        }
        if (version.streamingManifestPath) {
            required.push({ kind: 'streaming-manifest', key: `${prefix}${version.streamingManifestPath}`, gameId: version.gameId, versionId: version.id });
        }
    }

    const uniqueRequired = [...new Map(required.map(item => [item.key, item])).values()];
    for (const item of uniqueRequired) {
        const result = await objectExists(storage, item.key);
        if (!result.exists) issues.push({ code: 'MISSING_STORAGE_OBJECT', ...item });
    }

    const objects = await storage.listObjects('games/');
    const orphanCandidates = objects
        .filter(object => !knownExactObjects.has(object.key) && !knownPrefixes.some(prefix => object.key.startsWith(prefix)))
        .map(object => ({ key: object.key, size: object.size, lastModified: object.lastModified || null }));

    return {
        status: issues.length ? 'FAIL' : 'PASS',
        checkedAt: Date.now(),
        counts: {
            versions: snapshot.versions.length,
            uploadSessions: snapshot.uploadSessions.length,
            requiredObjects: uniqueRequired.length,
            listedObjects: objects.length,
            missingOrInvalid: issues.length,
            orphanCandidates: orphanCandidates.length
        },
        issues,
        orphanCandidates,
        policy: 'Read-only: orphan candidates are reported and never deleted.'
    };
}
