import { test, expect } from '@playwright/test';
import {
  collectRuntimeDiagnostics,
  createDraftProject,
  expectCleanDiagnostics,
  installMockUser,
  uploadReadyProject,
  versionedGamePackage
} from './qa-helpers.js';

test.describe('Buttons, forms, and modal semantics', () => {
  test.beforeEach(async ({ request }) => {
    const reset = await request.post('/api/test-db/reset');
    expect(reset.ok()).toBeTruthy();
  });

  test('upload dialog closes by Escape/backdrop and resets stale validation state on reopen', async ({ page, context }) => {
    await installMockUser(context, 'modal-owner');
    await page.goto('/developer');

    await page.getByRole('button', { name: 'Upload Game Package' }).click();
    let dialog = page.getByRole('dialog', { name: 'Upload Game Package' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Upload Game Package' }).click();
    dialog = page.getByRole('dialog', { name: 'Upload Game Package' });
    await page.mouse.click(2, 2);
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Upload Game Package' }).click();
    dialog = page.getByRole('dialog', { name: 'Upload Game Package' });
    // setInputFiles bypasses enabled checks; wait for runtime quotas first.
    await expect(dialog.getByLabel('Choose game ZIP package')).toBeEnabled();
    await dialog.getByLabel('Choose game ZIP package').setInputFiles('e2e/fixtures/missing-manifest-game.zip');
    await expect(dialog.getByText('Package needs attention')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Upload Game Package' }).click();
    dialog = page.getByRole('dialog', { name: 'Upload Game Package' });
    await expect(dialog.getByText('Drop a ZIP here or click to browse')).toBeVisible();
    await expect(dialog.getByText('Package needs attention')).toBeHidden();
    await expect(dialog.getByLabel('Choose game ZIP package')).toHaveValue('');
  });

  test('existing-project upload success closes in place and labels the action honestly', async ({ page, context }) => {
    await installMockUser(context, 'version-owner');
    const gameId = await uploadReadyProject(page);
    const projectUrl = page.url();

    await page.getByRole('button', { name: 'Upload Version' }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload New Version' });
    await expect(dialog.getByLabel('Choose game ZIP package')).toBeEnabled();
    await dialog.getByLabel('Choose game ZIP package').setInputFiles(await versionedGamePackage('2.0.0'));
    await expect(dialog.getByText('Package is ready')).toBeVisible();
    await dialog.getByRole('button', { name: 'Upload Version' }).click();
    await expect(dialog.getByText('Version uploaded')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Back to Dashboard' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    await expect(page).toHaveURL(projectUrl);
    await expect(page.getByText(gameId, { exact: true })).toBeVisible();
    await expect(page.locator('article').filter({ hasText: 'v2.0.0' }).getByText('READY', { exact: true })).toBeVisible();
  });

  test('project form keeps its entity route on server validation failure and recovers without refresh', async ({ page, context, request }) => {
    await installMockUser(context, 'form-owner');
    const project = await createDraftProject(request, { uid: 'form-owner', title: 'Original Form Title' });
    await page.goto(`/developer/project/${project.id}`);
    await page.getByRole('button', { name: 'Edit Details' }).click();

    await page.getByLabel('Title').fill('   ');
    await expect(page.getByRole('button', { name: 'Save Details' })).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Original Form Title' })).toBeVisible();

    await page.getByRole('button', { name: 'Edit Details' }).click();
    await page.getByLabel('Title').fill('Recovered Form Title');
    await page.route(`**/api/games/${project.id}`, async route => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: { code: 'INVALID_TITLE', message: 'Synthetic title rejection.' } })
        });
      } else {
        await route.continue();
      }
    });
    await page.getByRole('button', { name: 'Save Details' }).click();
    await expect(page.getByText('Synthetic title rejection.')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/developer/project/${project.id}$`));

    await page.unroute(`**/api/games/${project.id}`);
    await page.getByRole('button', { name: 'Save Details' }).click();
    await expect(page.getByText('Project details updated.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recovered Form Title' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Recovered Form Title' })).toBeVisible();
  });

  test('editor dialogs support semantic close, Escape, backdrop, and safe GitHub credential state', async ({ page, context }) => {
    await installMockUser(context, 'editor-modal-owner');
    const diagnostics = collectRuntimeDiagnostics(page);
    await page.goto('/editor');
    await expect(page.locator('.monaco-editor')).toBeVisible();

    await page.getByTitle('Export Project').click();
    let dialog = page.getByRole('dialog', { name: 'Export Game' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByTitle('Export Project').click();
    dialog = page.getByRole('dialog', { name: 'Export Game' });
    await page.mouse.click(2, 2);
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Export to GitHub' }).click();
    dialog = page.getByRole('dialog', { name: 'Export to GitHub' });
    const pushButton = dialog.getByRole('button', { name: 'Create & Push' });
    await expect(pushButton).toBeDisabled();
    await dialog.getByLabel('Session-only GitHub token').fill('github_pat_test_only');
    await expect(pushButton).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Export to GitHub' }).click();
    dialog = page.getByRole('dialog', { name: 'Export to GitHub' });
    await expect(dialog.getByLabel('Session-only GitHub token')).toHaveValue('');
    await page.mouse.click(2, 2);
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'v0.1.2' }).click();
    dialog = page.getByRole('dialog', { name: 'CHANGELOG' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'v0.1.2' }).click();
    dialog = page.getByRole('dialog', { name: 'CHANGELOG' });
    await page.mouse.click(2, 2);
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Projects' }).click();
    dialog = page.getByRole('dialog', { name: 'Project Manager' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Projects' }).click();
    dialog = page.getByRole('dialog', { name: 'Project Manager' });
    await page.mouse.click(2, 2);
    await expect(dialog).toBeHidden();

    expectCleanDiagnostics(diagnostics);
  });
});
