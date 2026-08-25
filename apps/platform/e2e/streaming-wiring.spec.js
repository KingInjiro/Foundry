import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Streaming Wiring E2E', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/test-db/reset');
  });

  test('streaming game initializes streaming stack and fetches asset via streaming', async ({ page, context, browser }) => {
    // 1. Setup Mock User
    await context.addInitScript(() => {
      window.localStorage.setItem('E2E_MOCK_USER_ID', 'dev-user-a');
      window.localStorage.setItem('E2E_MOCK_USER', JSON.stringify({ uid: 'dev-user-a', email: 'dev@foundry.test' }));
    });
    
    // Track requests to verify streaming
    let cdnRequestFound = false;
    page.on('request', request => {
      // The game runs from a storage URL, the streaming manifest says "test-asset.json"
      const url = request.url();
      if (url.includes('test-asset.json')) {
        cdnRequestFound = true;
      }
    });

    let streamingSuccessLogFound = false;
    let streamingBridgeConnectedFound = false;
    
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[Game] Streaming integration successful')) {
        streamingSuccessLogFound = true;
      }
      if (text.includes('StreamingEngineBridge connected to AssetManager')) {
        streamingBridgeConnectedFound = true;
      }
    });

    // 2. Upload Game
    await page.goto('/developer');
    await expect(page.locator('text=Developer Dashboard')).toBeVisible();
    await page.click('text=Upload Game Package');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.resolve(__dirname, 'fixtures/streaming-game.zip'));
    
    await expect(page.getByText('Package is ready')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Upload Version' }).click();
    await expect(page.getByText('Version uploaded')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Manage & Publish' }).click();
    await expect(page.locator('text=Ready')).toBeVisible();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Active')).toBeVisible();

    // 3. Play Game
    await page.goto('/player');
    await page.click('h3:has-text("Streaming Test Game")');
    
    await page.getByRole('button', { name: 'Play Now' }).click();

    const runtimeFrame = page.frameLocator('iframe');
    await expect(runtimeFrame.locator('html[data-runtime-status="ready"]')).toBeAttached({ timeout: 15000 });
    await expect(page.getByTestId('game-launch-status')).toBeHidden();
    
    // Wait for the streaming success log
    await expect.poll(() => streamingSuccessLogFound, { timeout: 15000 }).toBeTruthy();
    await expect.poll(() => streamingBridgeConnectedFound, { timeout: 15000 }).toBeTruthy();
    expect(cdnRequestFound).toBeTruthy();

    // 4. Test Fresh Session (Phase 3X verification)
    let freshSessionCdnRequestFound = false;

    // Capture browser storage including IndexedDB, then restore it into a genuinely new context.
    const persistedState = await context.storageState({ indexedDB: true });
    const foundryOrigin = persistedState.origins.find(origin => origin.origin === 'http://localhost:3001');
    expect(foundryOrigin?.indexedDB?.some(db => db.name === 'FoundryStreamingCache')).toBeTruthy();
    const freshContext = await browser.newContext({ storageState: persistedState });
    await freshContext.addInitScript(() => {
      window.localStorage.setItem('E2E_MOCK_USER_ID', 'dev-user-a');
      window.localStorage.setItem('E2E_MOCK_USER', JSON.stringify({ uid: 'dev-user-a', email: 'dev@foundry.test' }));
    });
    const freshPage = await freshContext.newPage();
    
    freshPage.on('request', request => {
      const url = request.url();
      if (url.includes('test-asset.json')) {
        freshSessionCdnRequestFound = true;
      }
    });

    let freshStreamingSuccessLogFound = false;
    let freshStreamingBridgeConnectedFound = false;
    freshPage.on('console', msg => {
      const text = msg.text();
      if (text.includes('[Game] Streaming integration successful')) {
        freshStreamingSuccessLogFound = true;
      }
      if (text.includes('StreamingEngineBridge connected to AssetManager')) {
        freshStreamingBridgeConnectedFound = true;
      }
    });

    await freshPage.goto('/player');
    await freshPage.click('h3:has-text("Streaming Test Game")');
    await freshPage.getByRole('button', { name: 'Play Now' }).click();

    const freshRuntimeFrame = freshPage.frameLocator('iframe');
    await expect(freshRuntimeFrame.locator('html[data-runtime-status="ready"]')).toBeAttached({ timeout: 15000 });

    await expect.poll(() => freshStreamingSuccessLogFound, { timeout: 15000 }).toBeTruthy();
    await expect.poll(() => freshStreamingBridgeConnectedFound, { timeout: 15000 }).toBeTruthy();
    expect(freshSessionCdnRequestFound).toBeFalsy(); // Restored IDB cache should avoid a transport fetch.
    
    await freshContext.close();
  });
});
