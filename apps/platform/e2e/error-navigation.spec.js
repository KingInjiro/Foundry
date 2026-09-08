import { test, expect } from '@playwright/test';
import {
  collectRuntimeDiagnostics,
  createDraftProject,
  expectCleanDiagnostics,
  installMockUser
} from './qa-helpers.js';

test.describe('Negative and recovery navigation', () => {
  test.beforeEach(async ({ request }) => {
    const reset = await request.post('/api/test-db/reset');
    expect(reset.ok()).toBeTruthy();
  });

  test('search retains focus during loading and pagination failure retains playable results', async ({ page }) => {
    let releaseSearch;
    const searchGate = new Promise(resolve => { releaseSearch = resolve; });
    let failNextPage = true;
    await page.route('**/api/catalog/games?**', async route => {
      const params = new URL(route.request().url()).searchParams;
      if (params.has('cursor') && failNextPage) {
        return route.fulfill({ status: 500, json: { success: false, error: { message: 'Next page unavailable.' } } });
      }
      if (params.get('q') === 'beta') await searchGate;
      const name = params.has('cursor') ? 'Gamma' : params.get('q') === 'beta' ? 'Beta' : 'Alpha';
      await route.fulfill({ json: {
        success: true,
        data: [{ gameId: name.toLowerCase(), name, description: 'Catalog regression fixture' }],
        meta: { nextCursor: params.has('cursor') ? null : 'page-2' }
      } });
    });
    try {
      await page.goto('/player');
      await expect(page.getByRole('heading', { name: 'Alpha', exact: true })).toBeVisible();
      const search = page.getByRole('textbox', { name: 'Search games', exact: true });
      await search.fill('beta');
      await expect(page.getByRole('status', { name: 'Loading games' })).toBeVisible();
      await expect(search).toBeFocused();
      releaseSearch();
      await expect(page.getByRole('heading', { name: 'Beta', exact: true })).toBeVisible();
      await expect(search).toBeFocused();
      await page.getByRole('button', { name: 'Load More', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Next page unavailable.');
      await expect(page.getByRole('button', { name: 'Play Beta', exact: true })).toBeVisible();
      failNextPage = false;
      await page.getByRole('button', { name: 'Retry Load More', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Gamma', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Beta', exact: true })).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
    } finally {
      releaseSearch();
    }
  });

  for (const status of [429, 500]) {
    test(`catalog exposes HTTP ${status} and recovers in place`, async ({ page }) => {
      const diagnostics = collectRuntimeDiagnostics(page);
      let fail = true;
      await page.route('**/api/catalog/games?**', async route => {
        if (!fail) return route.continue();
        await route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: { code: `QA_${status}`, message: `Synthetic ${status} discovery failure.` } })
        });
      });

      await page.goto('/player');
      await expect(page.getByText('Synthetic ' + status + ' discovery failure.')).toBeVisible();
      fail = false;
      await page.getByRole('button', { name: 'Try Again' }).click();
      await expect(page.getByText('No published games yet')).toBeVisible();
      await expect(page).toHaveURL(/\/player$/);

      expectCleanDiagnostics(diagnostics, {
        allowConsole: value => value.includes(`status of ${status}`),
        allowHttpError: entry => entry.status === status && entry.url.includes('/api/catalog/games?')
      });
    });
  }

  test('catalog exposes network failure and retry without redirecting', async ({ page }) => {
    const diagnostics = collectRuntimeDiagnostics(page);
    let fail = true;
    await page.route('**/api/catalog/games?**', async route => {
      if (fail) await route.abort('failed');
      else await route.continue();
    });
    await page.goto('/player');
    await expect(page.getByText('Could not reach the Platform. Check your connection and try again.')).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Try Again' }).click();
    await expect(page.getByText('No published games yet')).toBeVisible();
    await expect(page).toHaveURL(/\/player$/);
    expectCleanDiagnostics(diagnostics, {
      allowConsole: value => value.includes('net::ERR_FAILED'),
      allowRequestFailure: entry => entry.url.includes('/api/catalog/games?') && entry.error.includes('ERR_FAILED')
    });
  });

  test('catalog exposes request timeout and can retry on the same route', async ({ page }) => {
    const diagnostics = collectRuntimeDiagnostics(page);
    let delay = true;
    await page.route('**/api/catalog/games?**', async route => {
      if (!delay) return route.continue();
      const delayedUrl = new URL(route.request().url());
      delayedUrl.pathname = '/api/test-delay';
      delayedUrl.search = '?ms=16000';
      await route.continue({ url: delayedUrl.href });
    });
    await page.goto('/player');
    // Keep this as a real AbortController timeout, but leave scheduling margin
    // for the full Chromium suite after the heavyweight editor scenarios.
    await expect(page.getByText('The Platform request timed out. Try again.')).toBeVisible({ timeout: 25_000 });
    delay = false;
    await page.getByRole('button', { name: 'Try Again' }).click();
    await expect(page.getByText('No published games yet')).toBeVisible();
    expectCleanDiagnostics(diagnostics, {
      allowConsole: value => value.includes('net::ERR_ABORTED') || value.includes('net::ERR_FAILED'),
      allowRequestFailure: entry => entry.url === 'http://localhost:3001/api/test-delay?ms=16000' && entry.error.includes('ERR_ABORTED')
    });
  });

  test('404 detail state offers a working Catalog destination and retry remains on the entity route', async ({ page }) => {
    const missingId = 'missing-qa-game';
    await page.goto(`/player/game/${missingId}`);
    await expect(page.getByText('Game not found', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Try Again' }).click();
    await expect(page).toHaveURL(new RegExp(`/player/game/${missingId}$`));
    await expect(page.getByText('Game not found', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Catalog' }).click();
    await expect(page).toHaveURL(/\/player$/);
    await expect(page.getByText('PLAYABLE DISCOVERY')).toBeVisible();
  });

  test('non-owner 403 stays on the requested project identity with a visible error', async ({ page, context, request }) => {
    const project = await createDraftProject(request, { uid: 'owner-a', title: 'Owner A Project' });
    await installMockUser(context, 'owner-b');
    await page.goto(`/developer/project/${project.id}`);
    await expect(page).toHaveURL(new RegExp(`/developer/project/${project.id}$`));
    await expect(page.getByText('Not authorized', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Try Again' }).click();
    await expect(page.getByText('Not authorized', { exact: true })).toBeVisible();
  });
});
