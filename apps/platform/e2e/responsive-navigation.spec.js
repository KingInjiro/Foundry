import { test, expect } from '@playwright/test';
import {
  collectRuntimeDiagnostics,
  expectCleanDiagnostics,
  installMockUser
} from './qa-helpers.js';

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
}

test.describe('Responsive navigation surfaces', () => {
  test.beforeEach(async ({ request }) => {
    const reset = await request.post('/api/test-db/reset');
    expect(reset.ok()).toBeTruthy();
  });

  test('Player navigation remains reachable at 375, 768, and 1440 pixels', async ({ page }) => {
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/player');
      await expect(page.getByRole('link', { name: 'Discover' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Play Something Now' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });

  test('Editor loads Monaco locally and exposes critical mobile/desktop controls', async ({ page, context }) => {
    await installMockUser(context, 'responsive-editor');
    const diagnostics = collectRuntimeDiagnostics(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/editor');
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Files', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'RUN', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole('button', { name: 'Files', exact: true })).toBeVisible();
    const runBox = await page.getByRole('button', { name: 'RUN', exact: true }).boundingBox();
    expect(runBox).not.toBeNull();
    expect(runBox.x + runBox.width).toBeLessThanOrEqual(375);
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Send to Platform' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: 'Send to Platform' }).click();
    let dialog = page.getByRole('dialog', { name: 'Send to Platform' });
    await expect(dialog.getByText(/Package is valid and ready/)).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Send to Platform' }).click();
    dialog = page.getByRole('dialog', { name: 'Send to Platform' });
    await expect(dialog.getByText(/Package is valid and ready/)).toBeVisible({ timeout: 20_000 });
    await page.mouse.click(2, 2);
    await expect(dialog).toBeHidden();

    await page.setViewportSize({ width: 768, height: 900 });
    await expect(page.getByRole('button', { name: 'Files', exact: true })).toBeHidden();
    await expectNoHorizontalOverflow(page);

    expectCleanDiagnostics(diagnostics);
  });
});
