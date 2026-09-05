import { test, expect } from '@playwright/test';
import {
  createPublishedGame,
  installMockUser,
  provisionOperator
} from './qa-helpers.js';

test.describe('Moderation navigation and audit interaction', () => {
  test.beforeEach(async ({ request }) => {
    const reset = await request.post('/api/test-db/reset');
    expect(reset.ok()).toBeTruthy();
  });

  test('normal developer is denied operator controls without leaving the moderation route', async ({ page, context }) => {
    await installMockUser(context, 'ordinary-developer');
    await page.goto('/moderation');
    await expect(page).toHaveURL(/\/moderation$/);
    await expect(page.getByRole('heading', { name: 'Moderator access required' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resolve + quarantine' })).toHaveCount(0);
  });

  test('moderator sees conflict feedback and refreshed audit history after a state mutation', async ({ page, context, request, browser }) => {
    await installMockUser(context, 'moderation-owner');
    const gameId = await createPublishedGame(page);
    const report = await request.post(`/api/games/${gameId}/reports`, {
      headers: { 'x-dev-uid': 'reporter-user' },
      data: { category: 'OTHER', reason: 'QA report with enough context for moderation.' }
    });
    expect(report.status()).toBe(201);

    await provisionOperator(request, 'qa-moderator', 'MODERATOR');
    const operatorContext = await browser.newContext();
    await installMockUser(operatorContext, 'qa-moderator');
    const operatorPage = await operatorContext.newPage();
    await operatorPage.goto('/moderation');
    await expect(operatorPage.getByText(gameId, { exact: false })).toBeVisible();

    let conflict = true;
    await operatorPage.route('**/api/moderation/reports/*', async route => {
      if (route.request().method() !== 'PATCH' || !conflict) return route.continue();
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'REPORT_ALREADY_RESOLVED', message: 'Synthetic concurrent resolution.' } })
      });
    });
    await operatorPage.getByLabel('Operator reason').fill('A sufficiently detailed operator decision.');
    await operatorPage.getByRole('button', { name: 'Resolve + quarantine' }).click();
    await expect(operatorPage.getByRole('alert')).toContainText('Synthetic concurrent resolution.');
    await expect(operatorPage).toHaveURL(/\/moderation$/);

    conflict = false;
    await operatorPage.getByRole('button', { name: 'Resolve + quarantine' }).click();
    await expect(operatorPage.getByText('Report resolved; game is quarantined.', { exact: true })).toBeVisible();
    await operatorPage.getByRole('button', { name: 'ALL', exact: true }).click();
    await expect(operatorPage.getByText(gameId, { exact: false })).toBeVisible();

    await operatorPage.getByLabel('Operator reason').fill('Restore after completing the QA verification.');
    await operatorPage.getByRole('button', { name: 'Restore active' }).click();
    await expect(operatorPage.getByText('Game moderation state changed to ACTIVE.', { exact: true })).toBeVisible();
    await expect(operatorPage.getByText('SET_GAME_STATE', { exact: true }).first()).toBeVisible();
    await expect(operatorPage.getByText('Restore after completing the QA verification.')).toBeVisible();

    const publicDetails = await request.get(`/api/catalog/games/${gameId}`);
    expect(publicDetails.ok()).toBeTruthy();
    await operatorContext.close();
  });

  test('admin can open the protected operator surface', async ({ page, context, request }) => {
    await provisionOperator(request, 'qa-admin', 'ADMIN');
    await installMockUser(context, 'qa-admin');
    await page.goto('/moderation');
    await expect(page.getByRole('heading', { name: 'Moderation operations' })).toBeVisible();
    await expect(page.getByText('No reports in this view.')).toBeVisible();
  });
});
