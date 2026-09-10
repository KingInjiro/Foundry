import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { LocalSqliteProvider } from '../src/platform/backend/database/LocalSqliteProvider.js';

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
