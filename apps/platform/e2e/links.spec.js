import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import {
  createPublishedGame,
  installMockUser,
  interactiveInventory
} from './qa-helpers.js';

function expectedIdentity(pathname, gameId) {
  if (pathname === '/') return /Foundry/i;
  if (pathname === '/player') return /PLAYABLE DISCOVERY/i;
  if (pathname === '/player/library') return /My Library/i;
  if (pathname === `/player/game/${gameId}`) return /Generic E2E/i;
  if (pathname === `/developer/project/${gameId}`) return /Generic E2E/i;
  if (pathname === '/developer') return /Developer Dashboard/i;
  if (pathname === '/editor') return /FOUNDRY|Code/i;
  if (pathname === '/moderation') return /Moderator access required|Moderation operations/i;
  return /./;
}

test.describe('Link integrity and safe control inventory', () => {
  test.beforeEach(async ({ request }) => {
    const reset = await request.post('/api/test-db/reset');
    expect(reset.ok()).toBeTruthy();
  });

  test('same-origin anchor crawler reaches the intended page family and records interactive controls', async ({ page, context }, testInfo) => {
    await installMockUser(context, 'crawler-owner');
    const gameId = await createPublishedGame(page);
    const seeds = [
      '/',
      '/player',
      `/player/game/${gameId}`,
      '/player/library',
      '/developer',
      `/developer/project/${gameId}`,
      '/editor',
      '/moderation'
    ];
    const links = new Set(seeds);
    const inventory = [];

    for (const route of seeds) {
      const response = await page.goto(route);
      expect(response?.status() || 200).toBeLessThan(400);
      await expect(page.locator('body')).toContainText(expectedIdentity(new URL(page.url()).pathname, gameId));
      const controls = await interactiveInventory(page);
      inventory.push({ route, actualUrl: page.url(), controls });
      const hrefs = await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => node.href));
      for (const href of hrefs) {
        const url = new URL(href);
        if (url.origin === 'http://localhost:3001' && !url.hash) links.add(`${url.pathname}${url.search}`);
      }
    }

    const followed = [];
    for (const href of links) {
      const expected = new URL(href, 'http://localhost:3001');
      const response = await page.goto(href);
      expect(response?.status() || 200, href).toBeLessThan(400);
      const actual = new URL(page.url());
      expect(actual.pathname, `unexpected redirect for ${href}`).toBe(expected.pathname);
      await expect(page.locator('body'), `blank destination for ${href}`).not.toHaveText('');
      followed.push({ href, actual: `${actual.pathname}${actual.search}`, status: response?.status() || 200 });
    }

    const output = testInfo.outputPath('navigation-inventory.json');
    fs.writeFileSync(output, JSON.stringify({ seeds, links: followed, inventory }, null, 2));
    await testInfo.attach('navigation-inventory', { path: output, contentType: 'application/json' });
    console.log(`QA_CRAWLER routes=${seeds.length} links=${followed.length} controls=${inventory.reduce((sum, entry) => sum + entry.controls.length, 0)}`);
  });

  test('Copy Link reports success only after writing the current entity URL', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:3001' });
    await installMockUser(context, 'copy-owner');
    const gameId = await createPublishedGame(page);
    await page.goto(`/player/game/${gameId}`);
    await page.getByRole('button', { name: 'Copy Link' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`http://localhost:3001/player/game/${gameId}`);
  });
});
