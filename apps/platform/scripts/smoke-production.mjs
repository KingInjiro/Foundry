import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.SMOKE_PORT || 4179);
const baseUrl = `http://127.0.0.1:${port}`;
const ownerUid = 'production-smoke-owner';
const serverLogs = [];

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function api(route, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${route}`, {
        method,
        headers: {
            'x-dev-uid': ownerUid,
            ...(body !== undefined && { 'content-type': 'application/json' }),
            ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* Preserve text for diagnostics. */ }
    return { response, json, text };
}

async function waitUntilListening(child) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`Production server exited early (${child.exitCode}).`);
        try {
            const response = await fetch(`${baseUrl}/api/health`);
            if (response.ok) return;
        } catch {
            // Server is still starting.
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for the production server.');
}

const child = spawn(process.execPath, ['dist/server.cjs'], {
    cwd: platformRoot,
    env: {
        ...process.env,
        // Execute the compiled server bundle with isolated E2E providers. Test
        // mode is required so production authentication can never be bypassed.
        NODE_ENV: 'test',
        E2E_MODE: 'true',
        AUTH_DEV_BYPASS: 'true',
        JOB_MODE: 'inline',
        PORT: String(port),
        HOST: '127.0.0.1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', chunk => serverLogs.push(String(chunk)));
child.stderr.on('data', chunk => serverLogs.push(String(chunk)));

try {
    await waitUntilListening(child);
    await api('/api/test-db/reset', { method: 'POST', body: {} });

    const health = await api('/api/health');
    const ready = await api('/api/ready');
    assert(health.response.status === 200, `Health returned ${health.response.status}.`);
    assert(ready.response.status === 200, `Readiness returned ${ready.response.status}: ${ready.text}`);

    const created = await api('/api/games', {
        method: 'POST',
        body: { title: 'Lifecycle Smoke', description: 'Production bundle HTTP smoke' }
    });
    assert(created.response.ok, `Project creation failed: ${created.text}`);
    const gameId = created.json.data.id;

    const zip = await fs.readFile(path.join(platformRoot, 'e2e/fixtures/generic-valid-game.zip'));
    const session = await api(`/api/games/${gameId}/versions`, {
        method: 'POST',
        body: { expectedSize: zip.length }
    });
    assert(session.response.ok, `Upload session failed: ${session.text}`);

    const upload = await fetch(session.json.data.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/zip' },
        body: zip
    });
    assert(upload.ok, `Package transfer returned ${upload.status}.`);

    const completed = await api(`/api/uploads/${session.json.data.sessionId}/complete`, { method: 'POST', body: {} });
    assert(completed.response.ok && completed.json.data.status === 'READY', `Completion failed: ${completed.text}`);
    const published = await api(`/api/games/${gameId}/versions/${session.json.data.versionId}/publish`, { method: 'POST', body: {} });
    assert(published.response.ok && published.json.data.status === 'PUBLISHED', `Publish failed: ${published.text}`);

    const catalog = await api('/api/catalog/games?q=Lifecycle&limit=1');
    assert(catalog.response.ok && catalog.json.data.length === 1, `Catalog search failed: ${catalog.text}`);
    const detail = await api(`/api/catalog/games/${gameId}`);
    assert(detail.response.ok, `Published detail failed: ${detail.text}`);
    const range = await fetch(`${baseUrl}${detail.json.data.storageRef.location}/${detail.json.data.entry}`, {
        headers: { Range: 'bytes=0-8' }
    });
    assert(range.status === 206 && range.headers.get('content-range'), `Range delivery returned ${range.status}.`);

    const unpublished = await api(`/api/games/${gameId}/unpublish`, { method: 'POST', body: {} });
    assert(unpublished.response.ok && unpublished.json.data.status === 'DRAFT', `Unpublish failed: ${unpublished.text}`);
    const hidden = await api(`/api/catalog/games/${gameId}`);
    assert(hidden.response.status === 404, `Unpublished detail remained public (${hidden.response.status}).`);

    const restored = await api(`/api/games/${gameId}/versions/${session.json.data.versionId}/activate`, { method: 'POST', body: {} });
    assert(restored.response.ok && restored.json.data.status === 'PUBLISHED', `Restore failed: ${restored.text}`);
    const restoredDetail = await api(`/api/catalog/games/${gameId}`);
    assert(restoredDetail.response.ok, `Restored detail failed: ${restoredDetail.text}`);

    const deleted = await api(`/api/games/${gameId}`, { method: 'DELETE', body: { confirmTitle: 'Lifecycle Smoke' } });
    assert(deleted.response.ok && deleted.json.data.status === 'DELETED', `Project deletion failed: ${deleted.text}`);
    const missing = await api(`/api/games/${gameId}`);
    assert(missing.response.status === 404, `Deleted project still exists (${missing.response.status}).`);

    console.log(JSON.stringify({
        health: health.response.status,
        ready: ready.response.status,
        completed: completed.json.data.status,
        published: published.json.data.status,
        catalogCount: catalog.json.data.length,
        range: { status: range.status, contentRange: range.headers.get('content-range') },
        unpublished: unpublished.json.data.status,
        hidden: hidden.response.status,
        restored: restored.json.data.status,
        deleted: deleted.json.data.status,
        missing: missing.response.status
    }, null, 2));
} catch (error) {
    process.stderr.write(`${error.stack || error}\n${serverLogs.join('')}\n`);
    process.exitCode = 1;
} finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('close', resolve));
    await fs.rm(path.join(platformRoot, '.e2e'), { recursive: true, force: true });
}
