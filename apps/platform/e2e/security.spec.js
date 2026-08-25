import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Sandbox Security', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/test-db/reset');
  });

  test('game runs inside iframe with restricted sandbox', async ({ page, context }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('E2E_MOCK_USER_ID', 'dev-user-a');
      window.localStorage.setItem('E2E_MOCK_USER', JSON.stringify({ uid: 'dev-user-a', email: 'dev@foundry.test' }));
    });
    
    // Upload and publish generic game
    await page.goto('/developer');
    await page.click('text=Upload Game Package');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.resolve(__dirname, 'fixtures/generic-valid-game.zip'));
    await expect(page.getByText('Package is ready')).toBeVisible();
    await page.getByRole('button', { name: 'Upload Version' }).click();
    await expect(page.getByText('Version uploaded')).toBeVisible();
    await page.getByRole('button', { name: 'Manage & Publish' }).click();
    await expect(page.locator('text=Ready')).toBeVisible();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Active')).toBeVisible();

    // Play the game
    await page.goto('/player');
    await page.getByRole('button', { name: 'Play Generic E2E' }).click();

    // Verify iframe sandbox attributes
    const iframe = page.locator('iframe');
    const sandboxAttr = await iframe.getAttribute('sandbox');
    expect(sandboxAttr).toContain('allow-scripts');
    expect(sandboxAttr).not.toContain('allow-same-origin');

    // Verify it rendered
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('[data-testid="generic-game-ready"]')).toHaveText('GENERIC E2E GAME READY');
  });
});
