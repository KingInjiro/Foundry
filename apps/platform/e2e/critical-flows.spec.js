import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const validGamePath = path.resolve(__dirname, 'fixtures/generic-valid-game.zip');

async function installMockUser(context, uid, email) {
  await context.addInitScript(({ userId, userEmail }) => {
    try {
      window.localStorage.setItem('E2E_MOCK_USER_ID', userId);
      window.localStorage.setItem('E2E_MOCK_USER', JSON.stringify({ uid: userId, email: userEmail }));
    } catch {
      // Sandboxed game frames intentionally have an opaque origin.
    }
  }, { userId: uid, userEmail: email });
}

async function versionedGamePackage(gameVersion) {
  const zip = await JSZip.loadAsync(fs.readFileSync(validGamePath));
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  manifest.gameVersion = gameVersion;
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return {
    name: `generic-${gameVersion}.zip`,
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' })
  };
}

async function uploadThroughDialog(page, packageFile, { existingProject = false } = {}) {
  await page.getByRole('button', { name: existingProject ? 'Upload Version' : 'Upload Game Package' }).click();
  const dialog = page.getByRole('dialog', { name: existingProject ? 'Upload New Version' : 'Upload Game Package' });
  await dialog.getByLabel('Choose game ZIP package').setInputFiles(packageFile);
  await expect(dialog.getByText('Package is ready')).toBeVisible();
  await dialog.getByRole('button', { name: 'Upload Version' }).click();
  await expect(dialog.getByText('Version uploaded')).toBeVisible();
  if (existingProject) {
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
  } else {
    await dialog.getByRole('button', { name: 'Manage & Publish' }).click();
  }
}

async function createReadyProject(page, gameVersion = '1.0.0') {
  await page.goto('/developer');
  await expect(page.getByText('Developer Dashboard', { exact: true })).toBeVisible();
  await uploadThroughDialog(page, await versionedGamePackage(gameVersion));
  await expect(page.getByText('READY', { exact: true })).toBeVisible();
  return page.url().split('/').pop();
}

async function publishReadyVersion(page) {
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
}

test.describe('Production-critical product workflows', () => {
  test.beforeEach(async ({ request }) => {
    const reset = await request.post('/api/test-db/reset');
    expect(reset.ok()).toBeTruthy();
  });

  test('release lifecycle publishes v1 and v2, archives v1, then restores v1', async ({ page, context }) => {
    await installMockUser(context, 'release-dev', 'release@foundry.test');
    await createReadyProject(page, '1.0.0');
    await publishReadyVersion(page);

    await uploadThroughDialog(page, await versionedGamePackage('2.0.0'), { existingProject: true });
    const v2 = page.locator('article').filter({ hasText: 'v2.0.0' });
    await expect(v2.getByText('READY', { exact: true })).toBeVisible();
    await v2.getByRole('button', { name: 'Publish', exact: true }).click();

    const v1 = page.locator('article').filter({ hasText: 'v1.0.0' });
    await expect(v2.getByText('Active', { exact: true })).toBeVisible();
    await expect(v1.getByText('Archived', { exact: true })).toBeVisible();

    page.once('dialog', dialog => dialog.accept());
    await v1.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(v1.getByText('Active', { exact: true })).toBeVisible();
    await expect(v2.getByText('Archived', { exact: true })).toBeVisible();
  });

  test('landing to details to ready, then Keep, rate, follow and Continue Playing survive navigation', async ({ page, context, browser }) => {
    await installMockUser(context, 'retention-dev', 'creator@foundry.test');
    await createReadyProject(page);
    await publishReadyVersion(page);

    const playerContext = await browser.newContext();
    await installMockUser(playerContext, 'retention-player', 'player@foundry.test');
    const playerPage = await playerContext.newPage();
    await playerPage.goto('/');
    await playerPage.getByRole('link', { name: 'Browse Games' }).click();
    await expect(playerPage.getByText('PLAYABLE DISCOVERY')).toBeVisible();

    const allGames = playerPage.locator('#all-games');
    await allGames.getByRole('heading', { name: 'Generic E2E' }).click();
    await expect(playerPage.getByRole('heading', { name: 'Generic E2E', level: 1 })).toBeVisible();
    await playerPage.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(playerPage.getByRole('button', { name: 'Following', exact: true })).toBeVisible();
    await playerPage.getByRole('button', { name: 'Keep for Later' }).click();
    await expect(playerPage.getByRole('button', { name: 'Kept in Library' })).toBeVisible();
    await playerPage.getByTitle('5 stars').click();
    await expect(playerPage.getByText('1 ratings')).toBeVisible();

    const readyEvent = playerPage.waitForResponse(response => (
      response.url().includes('/api/discovery/events')
      && response.request().method() === 'POST'
      && response.request().postData()?.includes('game_ready')
    ));
    await playerPage.getByRole('button', { name: 'Play Now' }).click();
    const gameFrame = playerPage.frameLocator('iframe[title^="Game "]').frameLocator('iframe[title="Published web game"]');
    await expect(gameFrame.getByTestId('generic-game-ready')).toHaveText('GENERIC E2E GAME READY');
    await readyEvent;
    await expect(playerPage.getByTestId('game-launch-status')).toBeHidden();

    await playerPage.goto('/player/library');
    await expect(playerPage.getByRole('heading', { name: 'My Library' })).toBeVisible();
    const continueSection = playerPage.locator('section').filter({ has: playerPage.getByRole('heading', { name: 'Continue Playing' }) });
    const savedSection = playerPage.locator('section').filter({ has: playerPage.getByRole('heading', { name: 'Saved Games' }) });
    const followingSection = playerPage.locator('section').filter({ has: playerPage.getByRole('heading', { name: 'Following' }) });
    await expect(continueSection.getByRole('button', { name: 'Generic E2E', exact: true })).toBeVisible();
    await expect(savedSection.getByRole('button', { name: 'Generic E2E', exact: true })).toBeVisible();
    await expect(followingSection.getByRole('button', { name: 'Generic E2E', exact: true })).toBeVisible();
    await expect(followingSection.getByTitle(/Unfollow/)).toBeVisible();
    await playerContext.close();
  });

  test('Editor sends a private project through the normal upload pipeline to READY', async ({ page, context, request }) => {
    await installMockUser(context, 'editor-dev', 'editor@foundry.test');
    await page.goto('/editor');
    await page.getByRole('button', { name: 'Send to Platform' }).click();

    const dialog = page.getByRole('dialog', { name: 'Send to Platform' });
    await expect(dialog.getByText(/Package is valid and ready/)).toBeVisible({ timeout: 20_000 });
    await dialog.getByLabel('Game name').fill('Editor E2E Project');
    await dialog.getByRole('button', { name: 'Create project & version' }).click();

    await expect(page).toHaveURL(/\/developer\/project\/[A-Za-z0-9-]+(?:\?.*)?$/, { timeout: 30_000 });
    await expect(page.getByText('READY', { exact: true })).toBeVisible();
    const gameId = new URL(page.url()).pathname.split('/').pop();
    const editorProjectId = await page.evaluate(() => window.localStorage.getItem('foundry_editor_project_id'));
    expect(editorProjectId).toBeTruthy();

    const projectResponse = await request.get(`/api/editor-projects/${editorProjectId}`, {
      headers: { 'x-dev-uid': 'editor-dev' }
    });
    expect(projectResponse.ok()).toBeTruthy();
    const project = (await projectResponse.json()).data;
    expect(project.platformGameId).toBe(gameId);
    expect(project.lastReadyVersionId).toBeTruthy();
  });
});
