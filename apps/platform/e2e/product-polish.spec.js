import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import {
  collectRuntimeDiagnostics,
  createDraftProject,
  createPublishedGame,
  expectCleanDiagnostics,
  installMockUser
} from './qa-helpers.js';

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
}

async function expectTextFits(element) {
  const dimensions = await element.evaluate(node => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function unnamedRenderedButtons(page) {
  return page.locator('button').evaluateAll(buttons => buttons.filter(button => {
    const style = getComputedStyle(button);
    const rendered = button.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    const name = button.getAttribute('aria-label') || button.getAttribute('title') || button.innerText.trim();
    return rendered && !name;
  }).map(button => button.outerHTML.slice(0, 240)));
}

test.describe('Product polish regression coverage', () => {
  test.beforeEach(async ({ request }) => {
    const reset = await request.post('/api/test-db/reset');
    expect(reset.ok()).toBeTruthy();
  });

  test('authenticated Landing keeps all primary navigation usable at 375px', async ({ page, context }) => {
    await installMockUser(context, 'mobile-landing-user');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    await expect(page.getByRole('link', { name: 'Discover' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Library' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Developers' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('empty Library sections expose a direct existing-route next action', async ({ page, context }) => {
    await installMockUser(context, 'empty-library-user');
    await page.goto('/player/library');

    await expect(page.getByRole('heading', { name: 'Continue Playing' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Saved Games' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Following' })).toBeVisible();
    const browseLinks = page.getByRole('link', { name: 'Browse games' });
    await expect(browseLinks).toHaveCount(3);
    await browseLinks.first().click();
    await expect(page).toHaveURL(/\/player$/);
  });

  test('project access failure explains the state and offers a safe Back destination', async ({ page, context, request }) => {
    const project = await createDraftProject(request, { uid: 'polish-owner', title: 'Private Polish Project' });
    await installMockUser(context, 'polish-non-owner');
    await page.goto(`/developer/project/${project.id}`);

    await expect(page.getByRole('heading', { name: 'Project unavailable' })).toBeVisible();
    await expect(page.getByText('Not authorized', { exact: true })).toBeVisible();
    const back = page.getByRole('link', { name: 'Back to Developer Dashboard' });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(/\/developer$/);
  });

  test('long project titles remain readable on a small screen', async ({ page, context, request }) => {
    const longProjectTitle = `Project-${'P'.repeat(112)}`;
    const project = await createDraftProject(request, { uid: 'long-title-owner', title: longProjectTitle });
    await installMockUser(context, 'long-title-owner');
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(`/developer/project/${project.id}`);
    await expectTextFits(page.getByRole('heading', { name: longProjectTitle }));
    await expectNoHorizontalOverflow(page);
  });

  test('long published game titles remain readable on a small screen', async ({ page, context, request }) => {
    await installMockUser(context, 'long-game-title-owner');
    const gameId = await createPublishedGame(page);
    const longGameTitle = `Game-${'G'.repeat(115)}`;
    const update = await request.patch(`/api/games/${gameId}`, {
      headers: { 'x-dev-uid': 'long-game-title-owner' },
      data: { title: longGameTitle, description: 'Long-title polish fixture' }
    });
    expect(update.ok()).toBeTruthy();

    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(`/player/game/${gameId}`);
    const gameHeading = page.getByRole('heading', { name: longGameTitle, level: 1 });
    await expect(gameHeading).toBeVisible();
    await expectTextFits(gameHeading);
    await expectNoHorizontalOverflow(page);
  });

  test('mobile Player exposes an accessible Game Details back control', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/player/game/missing-polish-game/play');
    await expect(page.getByRole('button', { name: 'Game Details' })).toBeVisible();
  });

  test('Editor Project Manager actions do not clip at 375px', async ({ page, context }) => {
    await installMockUser(context, 'project-manager-mobile');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/editor');
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.getByRole('button', { name: 'Projects' }).click();

    const dialog = page.getByRole('dialog', { name: 'Project Manager' });
    await expect(dialog).toBeVisible();
    for (const label of ['New Blank Project', 'Export Project', 'Import Project']) {
      const action = dialog.getByRole('button', { name: new RegExp(label) });
      await expect(action).toBeVisible();
      await expectTextFits(action);
    }
    await expectNoHorizontalOverflow(page);
  });

  test('Editor source export still downloads after secondary sources are lazy-loaded', async ({ page, context }) => {
    await installMockUser(context, 'lazy-export-owner');
    const diagnostics = collectRuntimeDiagnostics(page);
    await page.goto('/editor');
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });

    await page.getByTitle('Export Project').click();
    const dialog = page.getByRole('dialog', { name: 'Export Game' });
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /Source Project/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('foundry-project.zip');
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    expect(fs.statSync(downloadPath).size).toBeGreaterThan(0);
    await expect(dialog).toBeHidden();
    expectCleanDiagnostics(diagnostics);
  });

  test('Editor export exposes a safe error when secondary sources cannot load', async ({ page, context }) => {
    await installMockUser(context, 'lazy-export-failure-owner');
    await page.route('**/engineExportSources.js*', route => route.abort('failed'));
    await page.goto('/editor');
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });

    await page.getByTitle('Export Project').click();
    const dialog = page.getByRole('dialog', { name: 'Export Game' });
    await dialog.getByRole('button', { name: /Source Project/ }).click();
    await expect(dialog.getByRole('alert')).toContainText('Project export could not be prepared. Reload the Editor and try again.');
    await expect(dialog.getByRole('button', { name: /Source Project/ })).toBeEnabled();
    await expect(dialog).not.toContainText('Failed to fetch dynamically imported module');
  });

  test('Editor rendered icon buttons expose an accessible name', async ({ page, context }) => {
    await installMockUser(context, 'editor-accessibility-owner');
    await page.goto('/editor');
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });
    expect(await unnamedRenderedButtons(page)).toEqual([]);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('button', { name: 'RUN', exact: true }).click();
    await expect(page.locator('iframe[src="/sandbox.html"]')).toBeVisible();
    expect(await unnamedRenderedButtons(page)).toEqual([]);
  });
});
