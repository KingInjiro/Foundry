import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Authorization Isolation', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/test-db/reset');
  });

  test('developer B cannot access or publish developer A\'s game', async ({ page, context, request }) => {
    // 1. Dev A uploads a game
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
    await expect(page.getByText('READY', { exact: true })).toBeVisible();
    
    const url = page.url();
    const projectId = url.split('/').pop();

    // 2. Switch to Dev B
    await context.addInitScript(() => {
        window.localStorage.setItem('E2E_MOCK_USER_ID', 'dev-user-b');
        window.localStorage.setItem('E2E_MOCK_USER', JSON.stringify({ uid: 'dev-user-b', email: 'dev-b@foundry.test' }));
    });
    
    // 3. Dev B tries to open Dev A's project UI
    await page.goto(`/developer/project/${projectId}`);
    await expect(page.getByText('Not authorized', { exact: true })).toBeVisible();

    // 4. Dev B tries to access via API
    const response = await request.get(`/api/games/${projectId}`, {
      headers: { 'x-dev-uid': 'dev-user-b' }
    });
    expect(response.status()).toBe(403);
  });
});
