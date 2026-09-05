import { test, expect } from '@playwright/test';
import {
  createPublishedGame,
  installMockUser
} from './qa-helpers.js';

test.describe('Deep-link and refresh identity', () => {
  test.beforeEach(async ({ request }) => {
    const reset = await request.post('/api/test-db/reset');
    expect(reset.ok()).toBeTruthy();
  });

  test('catalog normalizes invalid sort while preserving encoded query and tag state', async ({ page }) => {
    const query = '<script> & spaces/ü';
    const tag = 'action & 3d';
    await page.goto(`/player?q=${encodeURIComponent(query)}&tag=${encodeURIComponent(tag)}&sort=not-a-sort`);
    await expect(page.getByLabel('Search games')).toHaveValue(query);
    await expect(page.getByLabel('Sort games')).toHaveValue('featured');
    expect(new URL(page.url()).searchParams.get('q')).toBe(query);
    expect(new URL(page.url()).searchParams.get('tag')).toBe(tag);
    expect(new URL(page.url()).searchParams.has('sort')).toBeFalsy();

    await page.getByLabel('Search games').fill('A&B / next');
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('A&B / next');
    await page.getByLabel('Sort games').selectOption('newest');
    expect(new URL(page.url()).searchParams.get('sort')).toBe('newest');
    await page.reload();
    await expect(page.getByLabel('Search games')).toHaveValue('A&B / next');
    await expect(page.getByLabel('Sort games')).toHaveValue('newest');
  });

  test('public details and play routes retain the same game through reload and direct navigation', async ({ page, context }) => {
    await installMockUser(context, 'refresh-owner');
    const gameId = await createPublishedGame(page);

    await page.goto(`/player/game/${gameId}`);
    await expect(page.getByRole('heading', { name: 'Generic E2E', level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Generic E2E', level: 1 })).toBeVisible();

    await page.goto(`/player/game/${gameId}/play`);
    const frame = page.frameLocator('iframe[title^="Game "]').frameLocator('iframe[title="Published web game"]');
    await expect(frame.getByTestId('generic-game-ready')).toHaveText('GENERIC E2E GAME READY');
    await page.reload();
    await expect(frame.getByTestId('generic-game-ready')).toHaveText('GENERIC E2E GAME READY');
    await expect(page).toHaveURL(new RegExp(`/player/game/${gameId}/play$`));
  });

  test('editor id query loads the requested cloud project and preserves it through refresh', async ({ page, context, request }) => {
    await installMockUser(context, 'editor-deep-link');
    const create = await request.post('/api/editor-projects', {
      headers: { 'x-dev-uid': 'editor-deep-link' },
      data: {
        title: 'Editor Deep Link Project',
        files: [{ id: 'qa-main', name: 'qa-main.js', code: '// QA_EDITOR_DEEP_LINK\nexport const loaded = true;' }]
      }
    });
    expect(create.ok()).toBeTruthy();
    const project = (await create.json()).data;

    await page.goto(`/editor?id=${encodeURIComponent(project.id)}`);
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.view-lines')).toContainText('QA_EDITOR_DEEP_LINK');
    expect(await page.locator('input').evaluateAll(nodes => nodes.some(node => node.value === 'qa-main.js' && node.getClientRects().length > 0))).toBeTruthy();
    expect(await page.evaluate(() => localStorage.getItem('foundry_editor_project_id'))).toBe(project.id);

    await page.reload();
    await expect(page.locator('.view-lines')).toContainText('QA_EDITOR_DEEP_LINK');
    expect(new URL(page.url()).pathname).toBe('/editor');
    expect(new URL(page.url()).searchParams.get('id')).toBe(project.id);
  });

  test('anonymous moderation deep link remains intact through sign-in before role denial', async ({ page }) => {
    await page.goto('/moderation');
    await expect(page).toHaveURL(/\/moderation$/);
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    await page.evaluate(() => {
      localStorage.setItem('E2E_MOCK_USER_ID', 'non-moderator');
      localStorage.setItem('E2E_MOCK_USER', JSON.stringify({ uid: 'non-moderator', email: 'normal@foundry.test' }));
    });
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/moderation$/);
    await expect(page.getByRole('heading', { name: 'Moderator access required' })).toBeVisible();
  });
});
