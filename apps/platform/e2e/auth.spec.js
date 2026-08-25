import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/test-db/reset');
  });

  test('Anonymous user can open Landing Page but not Dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
    
    // Developer dashboard should redirect or show unauthorized
    await page.goto('/developer');
    await expect(page).toHaveURL(/.*(\/|\/login)$/);
  });

  test('Authenticated developer can access Developer Dashboard', async ({ page, context }) => {
    await context.addInitScript(() => { window.localStorage.setItem('E2E_MOCK_USER_ID', 'dev-user-a'); });
    await page.goto('/');
    await page.click('text=Sign In'); 
    await page.goto('/developer');
    await expect(page.locator('text=Developer Dashboard')).toBeVisible();
  });

  test('Logout removes developer access', async ({ page, context }) => {
    await context.addInitScript(() => { window.localStorage.setItem('E2E_MOCK_USER_ID', 'dev-user-a'); });
    await page.goto('/');
    await page.click('text=Sign In');
    await page.goto('/developer');
    await expect(page.locator('text=Developer Dashboard')).toBeVisible();
    
    // Find logout button from landing page, or Dashboard header
    await page.goto('/');
    await page.click('button:has-text("Sign Out")');
    
    await page.goto('/developer');
    await expect(page).toHaveURL(/.*(\/|\/login)$/);
  });
});
