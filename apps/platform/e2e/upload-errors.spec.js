import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Upload Errors', () => {
  test.beforeEach(async ({ request, page, context }) => {
    await request.post('/api/test-db/reset');
    await context.addInitScript(() => {
      window.localStorage.setItem('E2E_MOCK_USER_ID', 'dev-user-a');
      window.localStorage.setItem('E2E_MOCK_USER', JSON.stringify({ uid: 'dev-user-a', email: 'dev@foundry.test' }));
    });
    await page.goto('/developer');
    await page.click('text=Upload Game Package');
  });

  test('missing manifest is rejected', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.resolve(__dirname, 'fixtures/missing-manifest-game.zip'));
    await expect(page.getByText('Package needs attention')).toBeVisible();
    await expect(page.getByText('manifest.json does not exist in the root of the package.')).toBeVisible();
  });

  test('invalid capability is rejected', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.resolve(__dirname, 'fixtures/invalid-capability-game.zip'));
    await expect(page.getByText('Package needs attention')).toBeVisible();
    await expect(page.getByText('Unknown or unsupported capability: hax')).toBeVisible();
  });

  test('unsafe path is rejected', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.resolve(__dirname, 'fixtures/unsafe-path-game.zip'));
    await expect(page.getByText('Package needs attention')).toBeVisible();
    await expect(page.getByText(/unsafe file path/i)).toBeVisible();
  });
});
