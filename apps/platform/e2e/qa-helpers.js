import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { expect } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const genericGamePath = path.resolve(__dirname, 'fixtures/generic-valid-game.zip');
export const foundryGamePath = path.resolve(__dirname, 'fixtures/foundry-valid-game.zip');

export async function installMockUser(context, uid = 'qa-user', email = `${uid}@foundry.test`) {
  await context.addInitScript(({ userId, userEmail }) => {
    try {
      window.localStorage.setItem('E2E_MOCK_USER_ID', userId);
      window.localStorage.setItem('E2E_MOCK_USER', JSON.stringify({ uid: userId, email: userEmail, displayName: userId }));
      window.localStorage.setItem('v154_force_clear_cuberunner', 'true');
      window.localStorage.setItem('foundry_welcome_seen', 'true');
    } catch {
      // Foundry game sandboxes use an opaque origin and intentionally expose no localStorage.
    }
  }, { userId: uid, userEmail: email });
}

export async function versionedGamePackage(gameVersion, sourcePath = genericGamePath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(sourcePath));
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  manifest.gameVersion = gameVersion;
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return {
    name: `foundry-qa-${gameVersion}.zip`,
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' })
  };
}

export async function uploadReadyProject(page, packageFile = genericGamePath) {
  await page.goto('/developer');
  await expect(page.getByText('Developer Dashboard', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Upload Game Package' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload Game Package' });
  await dialog.getByLabel('Choose game ZIP package').setInputFiles(packageFile);
  await expect(dialog.getByText('Package is ready')).toBeVisible();
  await dialog.getByRole('button', { name: 'Upload Version' }).click();
  await expect(dialog.getByText('Version uploaded')).toBeVisible();
  await dialog.getByRole('button', { name: 'Manage & Publish' }).click();
  await expect(page.getByText('READY', { exact: true })).toBeVisible();
  return new URL(page.url()).pathname.split('/').pop();
}

export async function publishReadyVersion(page) {
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
}

export async function createPublishedGame(page, packageFile = genericGamePath) {
  const gameId = await uploadReadyProject(page, packageFile);
  await publishReadyVersion(page);
  return gameId;
}

export async function createDraftProject(request, { uid = 'qa-owner', title = 'QA Draft Project', description = 'QA route identity fixture' } = {}) {
  const response = await request.post('/api/games', {
    headers: { 'x-dev-uid': uid },
    data: { title, description }
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}

export async function provisionOperator(request, uid, role) {
  const response = await request.post(`/api/test-users/${encodeURIComponent(uid)}/role?role=${encodeURIComponent(role)}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}

export function collectRuntimeDiagnostics(page) {
  const diagnostics = { consoleErrors: [], pageErrors: [], requestFailures: [], httpErrors: [] };
  page.on('console', message => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  page.on('pageerror', error => diagnostics.pageErrors.push(error.message || String(error)));
  page.on('requestfailed', request => diagnostics.requestFailures.push({ url: request.url(), error: request.failure()?.errorText || 'unknown' }));
  page.on('response', response => {
    if (response.status() >= 400) diagnostics.httpErrors.push({ url: response.url(), status: response.status() });
  });
  return diagnostics;
}

export function expectCleanDiagnostics(diagnostics, {
  allowConsole = () => false,
  allowPageError = () => false,
  allowRequestFailure = () => false,
  allowHttpError = () => false
} = {}) {
  expect(diagnostics.consoleErrors.filter(value => !allowConsole(value)), 'unexpected console.error').toEqual([]);
  expect(diagnostics.pageErrors.filter(value => !allowPageError(value)), 'unexpected pageerror').toEqual([]);
  expect(diagnostics.requestFailures.filter(value => !allowRequestFailure(value)), 'unexpected requestfailed').toEqual([]);
  expect(diagnostics.httpErrors.filter(value => !allowHttpError(value)), 'unexpected HTTP 4xx/5xx').toEqual([]);
}

export async function interactiveInventory(page) {
  return page.locator('a[href], button, [role="button"], [role="menuitem"], [role="tab"], form').evaluateAll(nodes => nodes.map((node, index) => {
    const tag = node.tagName.toLowerCase();
    const href = tag === 'a' ? node.getAttribute('href') : null;
    const type = tag === 'form'
      ? 'form'
      : href
        ? (href.startsWith('http') ? 'external-navigation' : 'navigation')
        : node.getAttribute('type') === 'submit'
          ? 'form-submit'
          : node.getAttribute('aria-pressed') !== null
            ? 'toggle'
            : 'action';
    return {
      index,
      tag,
      type,
      text: (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160),
      href,
      disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true'),
      visible: Boolean(node.getClientRects().length)
    };
  }));
}
