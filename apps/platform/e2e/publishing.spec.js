import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Publishing Flow', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/test-db/reset');
  });

  test('developer can create, upload, publish and play a generic web game', async ({ page, context }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('E2E_MOCK_USER_ID', 'dev-user-a');
      window.localStorage.setItem('E2E_MOCK_USER', JSON.stringify({ uid: 'dev-user-a', email: 'dev@foundry.test' }));
    });
    
    // 1. Open platform & Authenticate
    await page.goto('/developer');
    await expect(page.locator('text=Developer Dashboard')).toBeVisible();

    // 2. Upload Game
    await page.click('text=Upload Game Package');
    const fileInput = page.locator('input[type="file"]');
    
    await fileInput.setInputFiles(path.resolve(__dirname, 'fixtures/generic-valid-game.zip'));
    
    await expect(page.getByText('Package is ready')).toBeVisible();
    await page.getByRole('button', { name: 'Upload Version' }).click();
    await expect(page.getByText('Version uploaded')).toBeVisible();
    await page.getByRole('button', { name: 'Manage & Publish' }).click();

    // 3. Publishing stays a separate, explicit action.
    await expect(page.locator('text=Ready')).toBeVisible();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Active')).toBeVisible();

    // 4. Player Catalog
    await context.addInitScript(() => {
      window.localStorage.setItem('E2E_MOCK_USER_ID', 'player-user');
      window.localStorage.setItem('E2E_MOCK_USER', JSON.stringify({ uid: 'player-user', email: 'player@foundry.test' }));
    });
    
    await page.goto('/player');
    await expect(page.getByText('PLAYABLE DISCOVERY')).toBeVisible();
    await expect(page.locator('h3', { hasText: 'Generic E2E' })).toBeVisible();

    // 5. Open game
    await page.getByRole('button', { name: 'Play Generic E2E' }).click();
    
    // The player iframe should render
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('[data-testid="generic-game-ready"]')).toHaveText('GENERIC E2E GAME READY');
  });
});
