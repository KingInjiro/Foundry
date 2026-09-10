import { test, expect } from '@playwright/test';
import { installMockUser } from './qa-helpers.js';

test('Editor exit opens Developer Dashboard and retains the local code draft', async ({ page, context }) => {
  await installMockUser(context, 'editor-exit-owner');
  await page.goto('/editor');
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });
  const input = page.locator('.monaco-editor textarea');
  await input.focus();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.insertText('// navigation draft regression\n');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('foundry_files'))).toContain('// navigation draft regression');
  const savedDraft = await page.evaluate(() => localStorage.getItem('foundry_files'));

  const exit = page.getByRole('link', { name: 'Back to Developer Dashboard', exact: true });
  await expect(exit).toBeVisible();
  await expect(exit).toHaveAttribute('href', '/developer');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(exit).toBeInViewport();
  await exit.click();
  await expect(page).toHaveURL(/\/developer$/);
  await expect(page.getByText('Developer Dashboard', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('foundry_files'))).toBe(savedDraft);

  await page.goto('/editor');
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('// navigation draft regression');
});

test('anonymous Editor exit goes to public Platform without requiring authentication', async ({ page, context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('v154_force_clear_cuberunner', 'true');
    localStorage.setItem('foundry_welcome_seen', 'true');
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/editor');
  const exit = page.getByRole('link', { name: 'Back to Platform', exact: true });
  await expect(exit).toBeInViewport();
  await expect(exit).toHaveAttribute('href', '/');
  await exit.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Foundry', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
});

for (const { protectedPath, label, destination } of [
  { protectedPath: '/developer/project/navigation-private', label: 'Back to Home', destination: '/' },
  { protectedPath: '/moderation', label: 'Browse Catalog', destination: '/player' }
]) {
  test(`protected ${protectedPath} offers ${label} without authentication`, async ({ page }) => {
    await page.goto(protectedPath);
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    const exit = page.getByRole('link', { name: label, exact: true });
    await expect(exit).toHaveAttribute('href', destination);
    await exit.click();
    expect(new URL(page.url()).pathname).toBe(destination);
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
  });
}
