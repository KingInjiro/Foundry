import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { LocalSqliteProvider } from '../src/platform/backend/database/LocalSqliteProvider.js';
import { startProductionSpaServer } from '../tests/helpers/productionSpaServer.mjs';
import { controlledR2 } from '../tests/helpers/controlledR2.mjs';
import { createSingleHostBackup, verifySingleHostBackup } from '../src/platform/backend/recovery/SingleHostRecovery.js';
import { rehearseSingleHostBackup } from '../src/platform/backend/recovery/SingleHostRehearsal.js';

test.describe.serial('compiled single-host with private R2 objects', () => {
  test.use({ proxy: { server: 'http://127.0.0.1:3447', bypass: '127.0.0.1,localhost' } });
  let server;
  let r2;
  test.beforeAll(async () => {
    r2 = await controlledR2({ browserProxyPort: 3447 });
    server = await startProductionSpaServer({ r2 });
    r2.setAllowedOrigin(server.origin);
  });
  test.afterAll(async () => { await server?.close(); await r2?.close(); });

  test('local auth, signed browser upload, publish/Player, recovery and revocation use R2 without local objects', async ({ page, context }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('requestfailed', request => errors.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
    const origins = [r2.env.R2_ENDPOINT, `https://${r2.env.R2_BUCKET_NAME}.${new URL(r2.env.R2_ENDPOINT).host}`];
    const landing = await page.goto(server.origin);
    const csp = landing.headers()['content-security-policy'];
    expect(csp).toContain(`connect-src 'self' ${origins.join(' ')}`);
    expect(csp).not.toContain('*.r2.');
    await expect(page.getByRole('link', { name: 'Foundry home' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    const auth = page.getByRole('dialog');
    await expect(auth.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
    await auth.getByRole('tab', { name: 'Register' }).click();
    await auth.getByLabel('Username').fill('r2-owner');
    await auth.getByLabel('Password').fill(password);
    await auth.getByRole('button', { name: 'Create Account' }).click();
    await expect(auth).toBeHidden();
    const currentSession = async () => (await (await context.request.get(`${server.origin}/api/auth/local/session`)).json()).data;
    const signedIn = await currentSession();
    expect(signedIn.user.role).toBe('DEVELOPER');
    expect((await context.request.post(`${server.origin}/api/games`, { headers: { Origin: server.origin }, data: { title: 'CSRF must reject' } })).status()).toBe(403);
    const mutation = async (endpoint, method, data) => context.request.fetch(server.origin + endpoint, {
      method, data, headers: { Origin: server.origin, 'X-CSRF-Token': (await currentSession()).csrfToken }
    });
    await page.goto(`${server.origin}/developer`);
    await page.getByRole('button', { name: 'Upload Game Package' }).click();
    const upload = page.getByRole('dialog', { name: 'Upload Game Package' });
    await upload.getByLabel('Choose game ZIP package').setInputFiles(packagePath);
    await expect(upload.getByText('Package is ready')).toBeVisible();
    const remotePut = page.waitForResponse(response => origins.includes(new URL(response.url()).origin) && response.request().method() === 'PUT');
    await upload.getByRole('button', { name: 'Upload Version' }).click();
    const putResponse = await remotePut;
    expect(putResponse.status()).toBe(200);
    expect(putResponse.headers()['access-control-allow-origin']).toBe(server.origin);
    expect(putResponse.headers()['access-control-expose-headers']).toBeUndefined();
    const putHeaders = await putResponse.request().allHeaders();
    expect(putHeaders['content-type']).toBe('application/zip');
    expect(putHeaders.cookie).toBeUndefined();
    expect(putHeaders.authorization).toBeUndefined();
    expect(putHeaders['x-csrf-token']).toBeUndefined();
    expect(putResponse.url()).not.toContain(r2.env.R2_SECRET_ACCESS_KEY);
    expect(r2.requests.some(r => r.method === 'OPTIONS' && r.origin === server.origin && r.requestedMethod === 'PUT' && r.requestedHeaders === 'content-type')).toBe(true);
    await expect(upload.getByText('Version uploaded')).toBeVisible({ timeout: 60000 });
    await upload.getByRole('button', { name: 'Manage & Publish' }).click();
    await expect(page.getByText('READY', { exact: true })).toBeVisible({ timeout: 60000 });
    const gameId = new URL(page.url()).pathname.split('/').pop();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible({ timeout: 60000 });
    const detail = await context.request.get(`${server.origin}/api/catalog/games/${gameId}`);
    expect(detail.status()).toBe(200);
    const game = (await detail.json()).data;
    const entry = server.origin + game.storageRef.location + '/' + game.entry;
    const versionId = game.storageRef.location.split('/')[6];
    const ranged = await context.request.get(entry, { headers: { Range: 'bytes=0-8' } });
    expect(ranged.status()).toBe(206);
    const fullEntry = await context.request.get(entry);
    expect(fullEntry.headers()['content-type']).toMatch(/^text\/html/);
    expect(ranged.headers()['content-range']).toBe(`bytes 0-8/${(await fullEntry.body()).length}`);
    expect(await ranged.body()).toEqual((await fullEntry.body()).subarray(0, 9));
    await page.goto(`${server.origin}/player/game/${gameId}`);
    await page.getByRole('button', { name: 'Play Now' }).click();
    await expect(page.frameLocator('iframe[title^="Game "]').frameLocator('iframe[title="Published web game"]').getByTestId('generic-game-ready')).toHaveText('GENERIC E2E GAME READY', { timeout: 30000 });
    expect(errors).toEqual([]);
    expect([...r2.objects.keys()].some(key => key.startsWith(`${r2.env.R2_OBJECT_PREFIX}/games/${gameId}/versions/`) && key.endsWith('/extracted/index.html'))).toBe(true);
    expect(fs.readdirSync(path.join(server.data, 'objects'))).toEqual(['.tmp']);
    let projectTitle;
    const db = new LocalSqliteProvider(path.join(server.data, 'platform.db'));
    try {
      expect((await db.getStorageIntegritySnapshot()).uploadSessions.every(session => session.storageProvider === 'r2')).toBe(true);
      projectTitle = (await db.getGame(gameId)).title;
      // Test-only operator provisioning in this isolated DB; production auth is unchanged.
      await db.provisionUserRole({ uid: signedIn.user.uid, role: 'MODERATOR' });
    } finally { await db.close(); }
    for (const state of ['QUARANTINED', 'ACTIVE']) {
      const moderation = await mutation(`/api/moderation/games/${gameId}`, 'PATCH', { moderationState: state, reason: 'Isolated private R2 revocation acceptance.' });
      expect(moderation.status()).toBe(200);
      expect((await context.request.get(entry)).status()).toBe(state === 'ACTIVE' ? 200 : 404);
    }
    expect((await mutation(`/api/games/${gameId}/unpublish`, 'POST', {})).status()).toBe(200);
    expect((await context.request.get(entry)).status()).toBe(404);
    expect((await mutation(`/api/games/${gameId}/versions/${versionId}/activate`, 'POST', {})).status()).toBe(200);
    expect((await context.request.get(entry)).status()).toBe(200);
    await page.goto(server.origin);
    r2.setUnavailable(true);
    const unavailable = await context.request.get(`${server.origin}/api/ready`);
    expect(unavailable.status()).toBe(503);
    expect((await unavailable.json()).data.checks.storage).toBe(false);
    r2.setUnavailable(false);
    expect((await context.request.get(`${server.origin}/api/ready`)).status()).toBe(200);
    await server.stopBackend();
    const backupDirectory = path.join(server.data, 'backups', 'foundry-backup-r2-browser');
    const backup = await createSingleHostBackup({ dataDirectory: server.data, outputDirectory: backupDirectory, storage: r2.storage });
    expect(backup.objects.remoteObjectsIncluded).toBe(false);
    expect((await verifySingleHostBackup(backupDirectory, { storage: r2.storage })).status).toBe('PASS');
    const rehearsal = await rehearseSingleHostBackup({ backupDirectory, storage: r2.storage });
    expect(rehearsal).toMatchObject({ status: 'PASS', readiness: { httpStatus: 200 }, storageIntegrity: { status: 'PASS' }, publishedAsset: { status: 'PASS' } });
    await server.restart();
    expect((await currentSession()).user.uid).toBe(signedIn.user.uid);
    expect((await context.request.get(entry, { headers: { Range: 'bytes=0-8' } })).status()).toBe(206);
    const deleted = await mutation(`/api/games/${gameId}`, 'DELETE', { confirmTitle: projectTitle });
    expect(deleted.status()).toBe(202);
    expect((await deleted.json()).data.status).toBe('DELETING');
    expect((await context.request.get(entry)).status()).toBe(404);
    await expect.poll(() => [...r2.objects.keys()].filter(key => key.startsWith(`${r2.env.R2_OBJECT_PREFIX}/games/${gameId}/`)).length).toBe(0);
    expect(r2.requests.some(request => request.method === 'POST')).toBe(true);
    expect(r2.requests.filter(request => request.list).every(request => request.key === '')).toBe(true);
    expect(server.logs.join('')).not.toContain(r2.env.R2_ACCESS_KEY_ID);
    expect(server.logs.join('')).not.toContain(r2.env.R2_SECRET_ACCESS_KEY);
    expect(server.logs.join('')).not.toContain('X-Amz-Signature');
    await page.reload();
    await page.getByRole('button', { name: 'Sign Out' }).click();
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
  });

  test('Chromium enforces exact CSP and minimal CORS without exposed headers or public reads', async ({ page }) => {
    await page.goto(server.origin);
    const put = (url, headers = { 'Content-Type': 'application/zip' }) => page.evaluate(async ({ url, headers }) => {
      try {
        const response = await fetch(url, { method: 'PUT', headers, body: 'browser transport bytes' });
        return { status: response.status, etag: response.headers.get('etag') };
      } catch { return { rejected: true }; }
    }, { url, headers });
    const signed = async name => (await r2.storage.createUploadSession(`games/cors/${name}.zip`)).uploadUrl;
    expect(await put(await signed('minimal'))).toEqual({ status: 200, etag: null });
    const readUrl = new URL(await signed('minimal')); readUrl.search = '';
    expect((await r2.forwardRequest(readUrl.href, { method: 'GET' })).status).toBe(403);
    expect(await put(await signed('content-type'), { 'Content-Type': 'text/plain' })).toEqual({ status: 403, etag: null });
    const offset = r2.requests.length;
    expect(await put(await signed('extra-header'), { 'Content-Type': 'application/zip', 'X-Not-Allowed': 'blocked' })).toEqual({ rejected: true });
    r2.setAllowedOrigin('https://different-installation.invalid');
    try { expect(await put(await signed('wrong-origin'))).toEqual({ rejected: true }); }
    finally { r2.setAllowedOrigin(server.origin); }
    expect(r2.requests.slice(offset).filter(r => r.method === 'PUT')).toEqual([]);
    const violation = page.evaluate(() => new Promise(resolve => {
      document.addEventListener('securitypolicyviolation', event => resolve({ directive: event.effectiveDirective, blocked: event.blockedURI }), { once: true });
      void fetch('https://different-account.r2.cloudflarestorage.com/upload', { method: 'PUT', body: 'blocked' }).catch(() => {});
    }));
    expect(await violation).toEqual({ directive: 'connect-src', blocked: 'https://different-account.r2.cloudflarestorage.com/upload' });
    await r2.storage.deletePrefix('games/cors');
  });
});

test.describe.serial('compiled SPA without Google credentials', () => {
  let server;
  test.beforeAll(async () => { server = await startProductionSpaServer(); });
  test.afterAll(async () => { await server?.close(); });

  test('a returning visitor renders the current root after legacy HTML revalidation', async ({ page, request }) => {
    const runtimeErrors = watchRuntime(page);
    const criticalAssets = [];
    page.on('response', response => {
      if (['script', 'stylesheet'].includes(response.request().resourceType())) {
        criticalAssets.push({ url: response.url(), status: response.status(), type: response.headers()['content-type'], kind: response.request().resourceType() });
      }
    });
    expect(await (await request.get(`${server.origin}/api/auth/google/config`)).json())
      .toEqual({ success: true, data: { enabled: false } });

    // Model the legacy cached document with different, same-length bundle
    // hashes, as in the two real deployed releases. The normalized ZIP mtime
    // and length collide under Express's old stat-based HTML validators.
    const legacyHtml = server.index.replace(/(\/assets\/main-)[^./"']+(\.(?:js|css))/g, '$1previous$2');
    expect(legacyHtml).not.toBe(server.index);
    expect(Buffer.byteLength(legacyHtml)).toBe(Buffer.byteLength(server.index));
    let revalidationStatus;
    // Chromium does not reliably cache self-signed test HTTPS. Emulate only
    // cache revalidation: the REAL compiled server decides 304 vs a new body.
    // Assets, CSP, Google-disabled config, SQLite and sessions are not mocked.
    await page.route(`${server.origin}/`, async route => {
      const response = await request.get(route.request().url(), {
        headers: { 'If-None-Match': server.legacyEtag, 'If-Modified-Since': server.lastModified }
      });
      revalidationStatus = response.status();
      await route.fulfill({ response, status: 200, contentType: 'text/html', body: response.status() === 304 ? legacyHtml : await response.text() });
    });
    await page.goto(server.origin);
    await expect(page.getByRole('link', { name: 'Foundry home' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    expect(revalidationStatus).toBe(200);
    expect(runtimeErrors).toEqual([]);
    expect(criticalAssets.some(asset => asset.kind === 'script')).toBe(true);
    expect(criticalAssets.some(asset => asset.kind === 'stylesheet')).toBe(true);
    for (const asset of criticalAssets) {
      expect(asset.status, asset.url).toBe(200);
      expect(asset.type, asset.url).toMatch(asset.kind === 'script' ? /javascript/ : /text\/css/);
    }
    await page.unroute(`${server.origin}/`);

    // Existing cached validators must also fail to suppress direct, fallback,
    // HEAD and sandbox HTML. Hashed JS/CSS caching remains intact.
    for (const pathname of ['/', '/index.html', '/developer', '/sandbox.html', '/generic-sandbox.html']) {
      const initial = await request.get(server.origin + pathname);
      for (const headers of [
        { 'If-None-Match': server.legacyEtag },
        { 'If-Modified-Since': server.lastModified }
      ]) {
        for (const method of ['GET', 'HEAD']) {
          const response = await request.fetch(server.origin + pathname, { method, headers });
          expect(response.status(), `${method} ${pathname}`).toBe(200);
          expect(response.headers()['cache-control']).toBe('no-store');
          expect(response.headers().etag).toBeUndefined();
          expect(response.headers()['last-modified']).toBeUndefined();
          expect(response.headers()['content-security-policy']).toBe(initial.headers()['content-security-policy']);
        }
      }
    }
    const script = await request.get(criticalAssets.find(asset => asset.kind === 'script').url);
    expect(script.headers().etag).toBeTruthy();
    expect(script.headers()['cache-control']).not.toContain('no-store');

    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
    await dialog.getByRole('tab', { name: 'Register' }).click();
    await dialog.getByLabel('Username').fill('cache-regression-user');
    await dialog.getByLabel('Password').fill(password);
    await dialog.getByRole('button', { name: 'Create Account' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Sign Out' }).click();
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Sign In', exact: true }).click();
    await dialog.getByLabel('Username').fill('cache-regression-user');
    await dialog.getByLabel('Password').fill(password);
    await dialog.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(dialog).toBeHidden();
    const currentSession = await page.context().request.get(`${server.origin}/api/auth/local/session`);
    expect((await currentSession.json()).data.user.role).toBe('DEVELOPER');
    await page.getByRole('button', { name: 'Sign Out' }).click();
    expect(runtimeErrors).toEqual([]);
  });

  test('optional Google config failure leaves the root and local auth usable', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route(`${server.origin}/api/auth/google/config`, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"success":false}' }));
    const config = page.waitForResponse(`${server.origin}/api/auth/google/config`);
    await page.goto(server.origin);
    expect((await config).status()).toBe(503);
    await expect(page.getByRole('link', { name: 'Foundry home' })).toBeVisible();
    const signIn = page.getByRole('button', { name: 'Sign In', exact: true });
    await signIn.click();
    const dialog = page.getByRole('dialog', { name: 'Sign in to Foundry' });
    await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
    await expect(dialog.getByLabel('Username')).toBeVisible();
    await dialog.getByRole('tab', { name: 'Register' }).click();
    await expect(page.getByRole('dialog', { name: 'Create a Foundry account' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(signIn).toBeFocused();
    expect(pageErrors).toEqual([]);
  });
});

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseURL = 'https://127.0.0.1:3443';
const password = 'single host acceptance password';
const packagePath = path.join(platformRoot, 'e2e', 'fixtures', 'generic-valid-game.zip');
const testRoot = process.env.SINGLE_HOST_E2E_ROOT
  ? path.resolve(process.env.SINGLE_HOST_E2E_ROOT)
  : path.join(platformRoot, '.single-host-e2e');
const databasePath = path.join(testRoot, 'data', 'platform.db');
let publishedGameId;
let publishedEntryUrl;
let reportId;

function watchRuntime(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText}`));
  return errors;
}

async function register(page, username, displayName = username) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Sign in to Foundry');
  await dialog.getByRole('tab', { name: 'Register' }).click();
  await expect(dialog).toHaveAccessibleName('Create a Foundry account');
  await dialog.getByLabel('Username').fill(username);
  await dialog.getByLabel(/Display name/).fill(displayName);
  await dialog.getByLabel('Password').fill(password);
  await dialog.getByRole('button', { name: 'Create Account' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();
  const response = await page.context().request.get('/api/auth/local/session');
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}

async function login(page, username, passwordValue = password) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign in to Foundry' });
  await dialog.getByLabel('Username').fill(username);
  await dialog.getByLabel('Password').fill(passwordValue);
  await dialog.getByRole('button', { name: 'Sign In', exact: true }).click();
  return dialog;
}

async function session(context) {
  const response = await context.request.get('/api/auth/local/session');
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}

async function mutate(context, endpoint, method, data, origin = baseURL) {
  const current = await session(context);
  return context.request.fetch(endpoint, {
    method,
    data,
    headers: { Origin: origin, 'X-CSRF-Token': current.csrfToken }
  });
}

async function mockGooglePage(page, { cancel = false, claims = {} } = {}) {
  await page.route('https://accounts.google.com/o/oauth2/v2/auth?**', async route => {
    const authorization = new URL(route.request().url());
    expect(authorization.searchParams.get('response_type')).toBe('code');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('redirect_uri')).toBe(`${baseURL}/api/auth/google/callback`);
    const callback = new URL(authorization.searchParams.get('redirect_uri'));
    callback.searchParams.set('state', authorization.searchParams.get('state'));
    if (cancel) {
      callback.searchParams.set('error', 'access_denied');
    } else {
      const issued = await page.context().request.post('http://127.0.0.1:3445/issue', {
        data: { nonce: authorization.searchParams.get('nonce'), challenge: authorization.searchParams.get('code_challenge'), claims }
      });
      expect(issued.status()).toBe(200);
      callback.searchParams.set('code', (await issued.json()).code);
    }
    // A real top-level cross-site GET carries the Lax binding cookie. The
    // backend, callback, session cookie and RSA verifier are not mocked.
    await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><title>Test Google consent</title><link rel="icon" href="data:,"></head><body><a href="${callback.href.replaceAll('&', '&amp;')}">${cancel ? 'Cancel Google sign-in' : 'Complete Google sign-in'}</a></body></html>` });
  });
}

async function startGoogle(page, destination) {
    await page.goto(destination);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAccessibleName('Sign in to Foundry');
  await expect(dialog.getByLabel('Username')).toBeVisible();
  await expect(dialog.getByLabel('Password')).toBeVisible();
  await dialog.getByRole('tab', { name: 'Register' }).click();
  await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create Account' })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Sign In', exact: true }).click();
  const started = page.waitForRequest(request => new URL(request.url()).pathname === '/api/auth/google/start');
  await dialog.getByRole('button', { name: 'Continue with Google' }).click();
  const request = await started;
  expect(request.method()).toBe('POST');
  expect(request.postDataJSON()).toEqual({ returnTo: destination });
  expect(request.headers().origin).toBe(baseURL);
  await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  const binding = (await page.context().cookies(baseURL)).find(cookie => cookie.name === '__Host-foundry_google');
  expect(binding).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
}

test.describe.serial('production-like single-host acceptance', () => {
  test('protected local auth can be dismissed, exited, and resumed through register or sign-in', async ({ page }) => {
    const runtimeErrors = watchRuntime(page);
    for (const { destination, exit, method } of [
      { destination: '/developer/project/navigation-private?tab=versions', exit: 'Back to Home', method: 'close' },
      { destination: '/moderation', exit: 'Browse Catalog', method: 'escape' }
    ]) {
      await page.goto(destination);
      const signIn = page.getByRole('button', { name: 'Sign In', exact: true });
      await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
      await signIn.click();
      const dialog = page.getByRole('dialog', { name: 'Sign in to Foundry' });
      await expect(dialog).toBeVisible();
      if (method === 'close') {
        await dialog.getByRole('button', { name: 'Close authentication dialog' }).click();
      } else {
        await dialog.getByRole('tab', { name: 'Register' }).click();
        await page.keyboard.press('Escape');
      }
      await expect(page.getByRole('dialog')).toBeHidden();
      expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(destination);
      await expect(signIn).toBeEnabled();
      await expect(signIn).toBeFocused();
      await page.getByRole('link', { name: exit, exact: true }).click();
      await expect(page).toHaveURL(exit === 'Back to Home' ? /\/$/ : /\/player$/);
      await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
    }

    const protectedDestination = '/developer?from=navigation-test';
    await page.goto(protectedDestination);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Register' }).click();
    await expect(dialog).toHaveAccessibleName('Create a Foundry account');
    await dialog.getByLabel('Username').fill('navigation-gate-user');
    await dialog.getByLabel(/Display name/).fill('Navigation Gate User');
    await dialog.getByLabel('Password').fill(password);
    await dialog.getByRole('button', { name: 'Create Account' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Developer Dashboard', { exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(protectedDestination);

    await page.goto('/');
    await page.getByRole('button', { name: 'Sign Out' }).click();
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
    await page.goto(protectedDestination);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(dialog).toHaveAccessibleName('Sign in to Foundry');
    await dialog.getByLabel('Username').fill('navigation-gate-user');
    await dialog.getByLabel('Password').fill(password);
    await dialog.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Developer Dashboard', { exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(protectedDestination);
    expect(runtimeErrors).toEqual([]);
  });

  test('local account session uses secure cookies, CSRF, logout, and login', async ({ page, context }) => {
    const runtimeErrors = watchRuntime(page);
    const landing = await page.goto('/');
    expect(landing.headers()['strict-transport-security']).toContain('max-age=');
    const signIn = page.getByRole('button', { name: 'Sign In', exact: true });
    await signIn.click();
    const keyboardDialog = page.getByRole('dialog');
    await expect(keyboardDialog.getByLabel('Username')).toBeFocused();
    await keyboardDialog.getByRole('button', { name: 'Sign In', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(keyboardDialog.getByRole('button', { name: 'Close authentication dialog' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(keyboardDialog.getByRole('button', { name: 'Sign In', exact: true })).toBeFocused();
    await keyboardDialog.getByRole('tab', { name: 'Sign In', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(keyboardDialog.getByRole('tab', { name: 'Register' })).toBeFocused();
    await expect(keyboardDialog.getByLabel('Password')).toHaveAccessibleDescription(/at least 12 characters/);
    await page.keyboard.press('Escape');
    await expect(keyboardDialog).toBeHidden();
    await expect(signIn).toBeFocused();
    const registered = await register(page, 'local-session-user', 'Local Session User');
    expect(registered.user.role).toBe('DEVELOPER');

    const cookies = await context.cookies();
    const sessionCookie = cookies.find(cookie => cookie.name === '__Host-foundry_session');
    expect(sessionCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });

    const denied = await mutate(context, '/api/games', 'POST', { title: 'Cross-origin blocked' }, 'https://attacker.example');
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error.code).toBe('ORIGIN_DENIED');

    await page.getByRole('button', { name: 'Sign Out' }).click();
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
    const anonymous = await context.request.get('/api/auth/local/session');
    expect(anonymous.status()).toBe(200);
    expect((await anonymous.json()).data).toEqual({ user: null, csrfToken: null, expiresAt: null });

    let dialog = await login(page, 'local-session-user', 'incorrect but long password');
    await expect(dialog.getByRole('alert')).toContainText('incorrect');
    expect(runtimeErrors.splice(0)).toEqual([
      'console.error: Failed to load resource: the server responded with a status of 401 (Unauthorized)'
    ]);
    await dialog.getByLabel('Password').fill(password);
    await dialog.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();
    expect(runtimeErrors).toEqual([]);
  });

  test('Google resumes the protected destination with a real Foundry session, CSRF and logout', async ({ page, context }) => {
    const runtimeErrors = watchRuntime(page);
    const destination = '/developer?from=google-test';
    await mockGooglePage(page, { claims: { sub: 'browser-google-developer', email: 'local-session-user@example.test', email_verified: true, name: 'Google Developer', role: 'ADMIN' } });
    await startGoogle(page, destination);
    await page.getByRole('link', { name: 'Complete Google sign-in' }).click();
    await expect(page.getByText('Developer Dashboard', { exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(destination);
    const signedIn = await session(context);
    expect(signedIn.user).toMatchObject({ role: 'DEVELOPER', displayName: 'Google Developer' });
    expect(signedIn.user.uid).not.toBe('browser-google-developer');
    expect(signedIn.csrfToken).toBeTruthy();
    const cookies = await context.cookies();
    expect(cookies.find(cookie => cookie.name === '__Host-foundry_session')).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    expect(cookies.some(cookie => cookie.name === '__Host-foundry_google')).toBe(false);
    const denied = await context.request.post('/api/auth/local/logout', { headers: { Origin: baseURL, 'X-CSRF-Token': 'invalid' } });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error.code).toBe('CSRF_TOKEN_INVALID');
    expect((await session(context)).user.uid).toBe(signedIn.user.uid);
    await page.goto('/moderation');
    await expect(page.getByRole('alert')).toContainText('Moderator access required');
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign Out' }).click();
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
    expect((await session(context)).user).toBeNull();
    await startGoogle(page, destination);
    await page.getByRole('link', { name: 'Complete Google sign-in' }).click();
    await expect(page.getByText('Developer Dashboard', { exact: true })).toBeVisible();
    expect((await session(context)).user.uid).toBe(signedIn.user.uid);
    expect(runtimeErrors).toEqual([]);
  });

  for (const outcome of ['cancelled', 'failed']) {
    test(`Google ${outcome} keeps local auth, focus and public exits usable`, async ({ page, context }) => {
      const runtimeErrors = watchRuntime(page);
      const destination = '/developer?from=google-error-test';
      // Wrong nonce is signed correctly: the actual OIDC verifier must reject it.
      await mockGooglePage(page, outcome === 'cancelled' ? { cancel: true } : { claims: { nonce: 'wrong-nonce' } });
      await startGoogle(page, destination);
      await page.getByRole('link', { name: outcome === 'cancelled' ? 'Cancel Google sign-in' : 'Complete Google sign-in' }).click();
      await expect(page.getByRole('status', { name: 'Sign-in feedback' })).toContainText(outcome === 'cancelled' ? 'Google sign-in was cancelled' : 'Google sign-in could not be completed');
      expect((await session(context)).user).toBeNull();
      const signIn = page.getByRole('button', { name: 'Sign In', exact: true });
      for (const dismiss of ['close', 'escape']) {
        await signIn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
        await dialog.getByRole('tab', { name: 'Register' }).click();
        await expect(dialog.getByRole('button', { name: 'Create Account' })).toBeEnabled();
        if (dismiss === 'close') await dialog.getByRole('button', { name: 'Close authentication dialog' }).click();
        else await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(signIn).toBeEnabled();
        await expect(signIn).toBeFocused();
      }
      await expect(page.getByRole('link', { name: 'Back to Home', exact: true })).toHaveAttribute('href', '/');
      await page.getByRole('link', { name: 'Browse Catalog', exact: true }).click();
      await expect(page).toHaveURL(/\/player$/);
      await page.getByRole('button', { name: 'Dismiss sign-in message' }).click();
      await expect(page.getByRole('status', { name: 'Sign-in feedback' })).toBeHidden();
      const dialog = await login(page, 'local-session-user');
      await expect(dialog).toBeHidden();
      expect((await session(context)).user.displayName).toBe('Local Session User');
      expect(runtimeErrors).toEqual([]);
    });
  }

  test('disabled Google availability leaves both local authentication modes usable', async ({ page }) => {
    const runtimeErrors = watchRuntime(page);
    await page.route('**/api/auth/google/config', route => route.fulfill({ json: { success: true, data: { enabled: false } } }));
    await page.goto('/developer?googleAuth=__proto__');
    await expect(page.getByRole('status', { name: 'Sign-in feedback' })).toBeHidden();
    const signIn = page.getByRole('button', { name: 'Sign In', exact: true });
    await signIn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
    await dialog.getByRole('tab', { name: 'Register' }).click();
    await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Create Account' })).toBeEnabled();
    await dialog.getByRole('tab', { name: 'Sign In', exact: true }).click();
    await dialog.getByLabel('Username').fill('local-session-user');
    await dialog.getByLabel('Password').fill(password);
    await dialog.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page.getByText('Developer Dashboard', { exact: true })).toBeVisible();
    expect(runtimeErrors).toEqual([]);
  });

  test('owner upload/publish/CDN/Player and Editor handoff use local providers; non-owner is denied', async ({ page, context, browser }) => {
    const runtimeErrors = watchRuntime(page);
    await register(page, 'single-host-owner', 'Single Host Owner');
    await page.goto('/developer');
    await expect(page.getByText('Developer Dashboard', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Upload Game Package' }).click();
    const uploadDialog = page.getByRole('dialog', { name: 'Upload Game Package' });
    await uploadDialog.getByLabel('Choose game ZIP package').setInputFiles(packagePath);
    await expect(uploadDialog.getByText('Package is ready')).toBeVisible();
    await uploadDialog.getByRole('button', { name: 'Upload Version' }).click();
    await expect(uploadDialog.getByText('Version uploaded')).toBeVisible({ timeout: 60000 });
    await uploadDialog.getByRole('button', { name: 'Manage & Publish' }).click();
    await expect(page.getByText('READY', { exact: true })).toBeVisible({ timeout: 60000 });
    publishedGameId = new URL(page.url()).pathname.split('/').pop();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible({ timeout: 60000 });

    const detail = await context.request.get(`/api/catalog/games/${publishedGameId}`);
    expect(detail.status()).toBe(200);
    const game = (await detail.json()).data;
    publishedEntryUrl = `${game.storageRef.location}/${game.entry}`;
    const range = await context.request.get(publishedEntryUrl, { headers: { Range: 'bytes=0-8' } });
    expect(range.status()).toBe(206);
    expect(range.headers()['content-range']).toMatch(/^bytes 0-8\//);

    const playerContext = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
    const playerPage = await playerContext.newPage();
    const playerErrors = watchRuntime(playerPage);
    await register(playerPage, 'single-host-player', 'Single Host Player');
    const denied = await mutate(playerContext, `/api/games/${publishedGameId}`, 'PATCH', { title: 'Not mine' });
    expect(denied.status()).toBe(403);

    await playerPage.goto(`/player/game/${publishedGameId}`);
    await playerPage.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(playerPage.getByRole('button', { name: 'Following', exact: true })).toBeVisible();
    await playerPage.getByRole('button', { name: 'Keep for Later' }).click();
    await expect(playerPage.getByRole('button', { name: 'Kept in Library' })).toBeVisible();
    await playerPage.getByTitle('5 stars').click();
    await playerPage.getByRole('button', { name: 'Play Now' }).click();
    const gameFrame = playerPage.frameLocator('iframe[title^="Game "]').frameLocator('iframe[title="Published web game"]');
    await expect(gameFrame.getByTestId('generic-game-ready')).toHaveText('GENERIC E2E GAME READY', { timeout: 30000 });
    await playerPage.goto('/player/library');
    await expect(playerPage.getByRole('heading', { name: 'My Library' })).toBeVisible();
    await expect(playerPage.getByText('Generic E2E', { exact: true }).first()).toBeVisible();

    const report = await mutate(playerContext, `/api/games/${publishedGameId}/reports`, 'POST', {
      category: 'OTHER',
      reason: 'Single-host moderation acceptance report.'
    });
    expect(report.status()).toBe(201);
    reportId = (await report.json()).data.id;
    await playerPage.goto('/moderation');
    await expect(playerPage.getByRole('alert')).toContainText('Moderator access required');

    await page.goto('/editor');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Send to Platform' }).click();
    const handoff = page.getByRole('dialog', { name: 'Send to Platform' });
    await expect(handoff.getByText(/Package is valid and ready/)).toBeVisible({ timeout: 30000 });
    await handoff.getByLabel('Game name').fill('Single Host Editor Project');
    await handoff.getByRole('button', { name: 'Create project & version' }).click();
    await expect(page).toHaveURL(/\/developer\/project\/[A-Za-z0-9-]+(?:\?.*)?$/, { timeout: 60000 });
    await expect(page.getByText('READY', { exact: true })).toBeVisible({ timeout: 60000 });
    await page.reload();
    await expect(page.getByText('READY', { exact: true })).toBeVisible();

    expect(runtimeErrors).toEqual([]);
    expect(playerErrors).toEqual([]);
    await playerContext.close();
  });

  test('operator role provisioning, quarantine/CDN denial, audit, and restore use the existing moderation gate', async ({ page, context }) => {
    const runtimeErrors = watchRuntime(page);
    const moderator = await register(page, 'single-host-moderator', 'Single Host Moderator');
    const database = new LocalSqliteProvider(databasePath);
    await database.provisionUserRole({ uid: moderator.user.uid, role: 'MODERATOR' });
    await database.close();

    await page.goto('/moderation');
    const selectedReport = page.getByRole('heading', { name: 'OTHER' }).locator('..');
    await expect(selectedReport.getByText('Single-host moderation acceptance report.', { exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByLabel('Operator reason').fill('Confirmed isolated single-host moderation drill.');
    await page.getByRole('button', { name: 'Resolve + quarantine' }).click();
    await expect(page.getByText('Report resolved; game is quarantined.', { exact: true })).toBeVisible();

    expect((await context.request.get(`/api/catalog/games/${publishedGameId}`)).status()).toBe(404);
    expect((await context.request.get(publishedEntryUrl)).status()).toBe(404);
    const actions = await context.request.get(`/api/moderation/games/${publishedGameId}/actions`);
    expect(actions.status()).toBe(200);
    const audit = (await actions.json()).data;
    expect(audit[0]).toMatchObject({
      reportId,
      operatorUid: moderator.user.uid,
      previousState: 'ACTIVE',
      nextState: 'QUARANTINED'
    });

    await page.getByRole('button', { name: 'ALL', exact: true }).click();
    const resolvedReport = page.getByRole('region', { name: 'Reports' })
      .getByRole('button')
      .filter({ hasText: 'Single-host moderation acceptance report.' });
    await expect(resolvedReport).toBeVisible();
    await resolvedReport.click();
    await page.getByLabel('Operator reason').fill('Restore after successful single-host moderation drill.');
    await page.getByRole('button', { name: 'Restore active' }).click();
    await expect(page.getByText('Game moderation state changed to ACTIVE.', { exact: true })).toBeVisible();
    expect((await context.request.get(`/api/catalog/games/${publishedGameId}`)).status()).toBe(200);
    const bytes = await context.request.get(publishedEntryUrl, { headers: { Range: 'bytes=0-8' } });
    expect(bytes.status()).toBe(206);
    const finalActions = await context.request.get(`/api/moderation/games/${publishedGameId}/actions`);
    expect(finalActions.status()).toBe(200);
    expect((await finalActions.json()).data[0]).toMatchObject({
      operatorUid: moderator.user.uid,
      previousState: 'QUARANTINED',
      nextState: 'ACTIVE'
    });
    expect(runtimeErrors).toEqual([]);
  });
});
