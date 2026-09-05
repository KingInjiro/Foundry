import { test, expect } from '@playwright/test';
import {
  collectRuntimeDiagnostics,
  createDraftProject,
  createPublishedGame,
  expectCleanDiagnostics,
  installMockUser
} from './qa-helpers.js';

test.describe('Navigation correctness', () => {
  test.beforeEach(async ({ request }) => {
    const reset = await request.post('/api/test-db/reset');
    expect(reset.ok()).toBeTruthy();
  });

  test('nested unknown routes resolve to their route-family landing instead of a blank shell', async ({ page, context }) => {
    await installMockUser(context, 'route-owner');
    const diagnostics = collectRuntimeDiagnostics(page);

    await page.goto('/player/invalid');
    await expect(page).toHaveURL(/\/player$/);
    await expect(page.getByText('PLAYABLE DISCOVERY')).toBeVisible();

    await page.goto('/developer/invalid');
    await expect(page).toHaveURL(/\/developer$/);
    await expect(page.getByText('Developer Dashboard', { exact: true })).toBeVisible();

    await page.goto('/editor/invalid');
    await expect(page).toHaveURL(/\/editor$/);
    await expect(page.getByRole('button', { name: 'Code', exact: true })).toBeVisible();

    await page.goto('/moderation/invalid');
    await expect(page).toHaveURL(/\/moderation$/);
    await expect(page.getByRole('heading', { name: 'Moderator access required' })).toBeVisible();

    expectCleanDiagnostics(diagnostics, {
      allowHttpError: ({ url, status }) => status === 403 && url.endsWith('/api/moderation/reports?status=OPEN&limit=100')
    });
  });

  test('anonymous protected project deep link is preserved through sign-in and renders the URL entity', async ({ page, request }) => {
    const project = await createDraftProject(request, { uid: 'deep-link-owner', title: 'Deep Link Identity' });
    const requestedApis = [];
    page.on('request', requestEvent => {
      if (requestEvent.url().includes('/api/games/')) requestedApis.push(new URL(requestEvent.url()).pathname);
    });

    await page.goto(`/developer/project/${project.id}`);
    await expect(page).toHaveURL(new RegExp(`/developer/project/${project.id}$`));
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();

    await page.evaluate(({ uid, email }) => {
      localStorage.setItem('E2E_MOCK_USER_ID', uid);
      localStorage.setItem('E2E_MOCK_USER', JSON.stringify({ uid, email }));
    }, { uid: 'deep-link-owner', email: 'deep-link@foundry.test' });
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page).toHaveURL(new RegExp(`/developer/project/${project.id}$`));
    await expect(page.getByRole('heading', { name: 'Deep Link Identity' })).toBeVisible();
    await expect(page.getByText(project.id, { exact: true })).toBeVisible();
    expect(requestedApis.some(pathname => pathname === `/api/games/${project.id}`)).toBeTruthy();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Deep Link Identity' })).toBeVisible({ timeout: 20_000 });
  });

  test('catalog query state and application Back preserve the logical history chain', async ({ page, context }) => {
    await installMockUser(context, 'history-owner');
    const gameId = await createPublishedGame(page);

    await page.goto('/player?q=Generic%20E2E&sort=name');
    await expect(page.getByLabel('Search games')).toHaveValue('Generic E2E');
    await expect(page.getByLabel('Sort games')).toHaveValue('name');
    await page.locator('#all-games').getByRole('heading', { name: 'Generic E2E' }).click();
    await expect(page).toHaveURL(new RegExp(`/player/game/${gameId}$`));

    await page.getByRole('button', { name: 'Play Now' }).click();
    await expect(page).toHaveURL(new RegExp(`/player/game/${gameId}/play$`));
    await page.getByRole('button', { name: 'Game Details' }).click();
    await expect(page).toHaveURL(new RegExp(`/player/game/${gameId}$`));

    await page.goBack();
    await expect(page).toHaveURL(/\/player\?q=Generic%20E2E&sort=name$/);
    await expect(page.getByLabel('Search games')).toHaveValue('Generic E2E');
    await expect(page.getByLabel('Sort games')).toHaveValue('name');
  });

  test('a direct play deep link still opens the matching details entity', async ({ page, context }) => {
    await installMockUser(context, 'direct-play-owner');
    const gameId = await createPublishedGame(page);
    await page.goto(`/player/game/${gameId}/play`);
    await page.getByRole('button', { name: 'Game Details' }).click();
    await expect(page).toHaveURL(new RegExp(`/player/game/${gameId}$`));
    await expect(page.getByRole('heading', { name: 'Generic E2E', level: 1 })).toBeVisible();
  });
});
