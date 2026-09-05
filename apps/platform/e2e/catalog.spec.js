import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Catalog Visibility', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/test-db/reset');
  });

  test('unpublished games are invisible to players', async ({ page, context }) => {
    // 1. Dev uploads game but doesn't publish
    await context.addInitScript(() => {
      window.localStorage.setItem('E2E_MOCK_USER_ID', 'dev-user-a');
      window.localStorage.setItem('E2E_MOCK_USER', JSON.stringify({ uid: 'dev-user-a', email: 'dev@foundry.test' }));
    });
    
    await page.goto('/developer');
    await page.click('text=Upload Game Package');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.resolve(__dirname, 'fixtures/generic-valid-game.zip'));
    await expect(page.getByText('Package is ready')).toBeVisible();
    await page.getByRole('button', { name: 'Upload Version' }).click();
    await expect(page.getByText('Version uploaded')).toBeVisible();
    await page.getByRole('button', { name: 'Manage & Publish' }).click();
    await expect(page.getByText('READY', { exact: true })).toBeVisible(); // Not active yet
    
    const url = page.url();
    const projectId = url.split('/').pop();

    // 2. Switch to Player
    await context.addInitScript(() => {
        window.localStorage.setItem('E2E_MOCK_USER_ID', 'player-user');
        window.localStorage.setItem('E2E_MOCK_USER', JSON.stringify({ uid: 'player-user', email: 'player@foundry.test' }));
    });
    
    // 3. Check Catalog
    await page.goto('/player');
    await expect(page.getByText('PLAYABLE DISCOVERY')).toBeVisible();
    await expect(page.locator('text=Generic E2E')).not.toBeVisible();

    // 4. Try direct access
    await page.goto(`/player/game/${projectId}`);
    await expect(page.getByText('Game is not published', { exact: true })).toBeVisible();
  });
});
