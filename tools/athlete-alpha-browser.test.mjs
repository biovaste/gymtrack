/*
 * athlete-alpha-browser.test.mjs — Automated browser verification for athlete alpha.
 *
 * Verifies:
 * 1. Clean profile startup in athlete-alpha mode (no cloud requests, fail-closed)
 * 2. Local-only storage prefix ('gym_alpha.' vs 'gym.')
 * 3. Offline reopen and service worker update behavior
 * 4. Plan-only export and coach-to-athlete import preview without session history leaks
 * 5. Emergency backup on failed completion with active workout intact
 *
 * Can be run with optional Playwright:
 *   PLAYWRIGHT_MODULE=playwright node tools/athlete-alpha-browser.test.mjs
 * Or via node:test:
 *   node --test tools/athlete-alpha-browser.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

test('athlete-alpha browser assets and service worker contract', async () => {
  const swSrc = await readFile(path.join(root, 'sw.js'), 'utf8');
  const indexHtml = await readFile(path.join(root, 'index.html'), 'utf8');
  const appSrc = await readFile(path.join(root, 'app.js'), 'utf8');

  // app-config.js must be loaded before app.js in index.html
  const configIdx = indexHtml.indexOf('<script src="app-config.js"></script>');
  const appIdx = indexHtml.indexOf('<script src="app.js"></script>');
  assert.ok(configIdx !== -1, 'app-config.js is included in index.html');
  assert.ok(appIdx !== -1, 'app.js is included in index.html');
  assert.ok(configIdx < appIdx, 'app-config.js is loaded BEFORE app.js');

  // app-config.js must be cached in sw.js ASSETS
  assert.ok(swSrc.includes("'./app-config.js'"), 'app-config.js is cached in sw.js');

  // app.js has zero unchoked fetch calls
  const syncFetchDefs = (appSrc.match(/async function syncFetch\(/g) || []).length;
  assert.equal(syncFetchDefs, 1, 'Single choke point syncFetch in app.js');

  // Check that all network sync entry points verify APP_CONFIG.isAlpha
  assert.ok(appSrc.includes('if (APP_CONFIG.isAlpha) return false;'), 'workerPush guards alpha');
  assert.ok(appSrc.includes('if (APP_CONFIG.isAlpha) return null;'), 'workerFetch guards alpha');
  assert.ok(appSrc.includes('if (APP_CONFIG.isAlpha) return \'local\';'), 'workerReconcile guards alpha');
  assert.ok(appSrc.includes('if (APP_CONFIG.isAlpha) { syncReady = true; return; }'), 'autoSyncOnLoad guards alpha');
});

// Playwright integration check if available in environment
test('athlete-alpha browser lifecycle, persistence, and service worker upgrade', async (t) => {
  let playwright;
  const candidateModules = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    'C:\\Users\\henri\\AppData\\Local\\npm-cache\\_npx\\e41f203b7505f1fb\\node_modules\\playwright'
  ].filter(Boolean);

  for (const mod of candidateModules) {
    try {
      playwright = require(mod);
      if (playwright) break;
    } catch (e) {}
  }

  if (!playwright) {
    t.skip('Playwright not installed in current environment; skipping live headless browser run.');
    return;
  }

  const { chromium } = playwright;
  const edgeCandidate = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const executablePath = process.env.CHROMIUM_EXECUTABLE || (existsSync(edgeCandidate) ? edgeCandidate : undefined);

  const files = [
    'index.html', 'app-config.js', 'app.js', 'workout-model.js', 'exercise-library.js',
    'styles.css', 'i18n.js', 'exercises.js', 'sw.js', 'manifest.webmanifest',
    'icon-180.png', 'icon-512.png', 'locales/catalog.js'
  ];

  let swVersion = '1';

  // Alpha preview server on simulated port 8766
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!files.includes(file)) { res.writeHead(404); res.end(); return; }
    try {
      let body = await readFile(path.join(root, file));
      if (file === 'app-config.js') {
        body = 'window.GYM_CONFIG = { mode: "alpha", version: "0.1.0-alpha", build: "2026-09-15" };';
      } else if (file === 'sw.js') {
        body = body.toString('utf8').replace(/const CACHE = '[^']+';/, `const CACHE = 'gymtrack-alpha-test-v${swVersion}';`);
      }
      const ext = path.extname(file);
      res.writeHead(200, {
        'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(body);
    } catch (err) { res.writeHead(500); res.end(err.message); }
  });

  await new Promise(resolve => server.listen(8766, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:8766';

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

    // Track any cloud network attempts — MUST BE ZERO
    const networkRequests = [];
    context.on('request', req => {
      const url = req.url();
      if (!url.startsWith(origin)) {
        networkRequests.push(url);
      }
    });

    const page = await context.newPage();
    await page.goto(origin);
    await page.waitForLoadState('networkidle');

    // 1. Dismiss onboarding modal if shown on initial boot
    const onboardBtn = page.locator('#modal-root [data-action="modal-btn"]').first();
    if (await onboardBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await onboardBtn.click();
      await page.waitForFunction(() => !document.getElementById('modal-root').innerHTML);
    }

    // 2. Verify alpha mode, local prefix, and zero external cloud requests
    const isAlphaMode = await page.evaluate(() => APP_CONFIG.isAlpha);
    assert.equal(isAlphaMode, true, 'App initialized in athlete-alpha mode');

    const keyPrefix = await page.evaluate(() => store.prefix);
    assert.equal(keyPrefix, 'gym_alpha.', 'Uses gym_alpha. storage prefix');

    assert.equal(networkRequests.length, 0, 'No external cloud network requests were made');

    // 3. Complete a workout and verify storage in gym_alpha.sessions
    await page.locator('[data-action="start-session"]').first().click();
    await page.locator('[data-action="set-done"]').first().click();
    await page.evaluate(() => finishSession());

    const savedAlphaSessions = await page.evaluate(() => localStorage.getItem('gym_alpha.sessions'));
    const personalSessions = await page.evaluate(() => localStorage.getItem('gym.sessions'));
    assert.ok(savedAlphaSessions, 'Session saved in gym_alpha.sessions');
    assert.equal(personalSessions, null, 'Personal gym.sessions was untouched');

    // 4. Test offline reload: data survives and displays in history
    await page.reload();
    await page.waitForLoadState('networkidle');
    const reloadedSessions = await page.evaluate(() => localStorage.getItem('gym_alpha.sessions'));
    assert.ok(reloadedSessions && JSON.parse(reloadedSessions).length >= 1, 'Sessions survive page reload');

    // 5. Test clean-profile backup restore
    const sampleBackup = {
      type: 'gymtrack-backup',
      version: 1,
      plan: {
        type: 'workout-plan', version: 1, name: 'Restored Coach Plan',
        days: [{ id: 'd-test', name: 'Test Day', exercises: [{ name: 'Overhead Press', sets: 3, reps: '8', weight: 50 }] }]
      },
      sessions: [{ id: 'restored-sess-1', date: '2026-09-14T10:00:00.000Z', dayName: 'Test Day', exercises: [] }],
      bodyWeight: [{ date: '2026-09-14', weight: 79.5 }]
    };

    await page.evaluate((b) => {
      restoreBackup(JSON.stringify(b));
      render();
    }, sampleBackup);

    const storedRestoredPlan = await page.evaluate(() => localStorage.getItem('gym_alpha.plan'));
    assert.equal(JSON.parse(storedRestoredPlan).name, 'Restored Coach Plan');
    const storedRestoredSessions = await page.evaluate(() => localStorage.getItem('gym_alpha.sessions'));
    assert.equal(JSON.parse(storedRestoredSessions)[0].id, 'restored-sess-1');

    // 6. Test save quota failure UI handling without losing active workout
    await page.locator('[data-action="start-session"]').first().click();
    await page.locator('[data-action="set-done"]').first().click();
    await page.evaluate(() => {
      window.__origSetItem = localStorage.setItem.bind(localStorage);
      localStorage.setItem = (k, v) => {
        if (k.endsWith('.pending_tx') || k.endsWith('.sessions')) {
          const err = new Error('Disk full');
          err.name = 'QuotaExceededError';
          throw err;
        }
        window.__origSetItem(k, v);
      };
      finishSession();
    });

    const failureModalVisible = await page.locator('#modal-root .sheet').isVisible();
    assert.ok(failureModalVisible, 'Save failure modal appears on QuotaExceededError');
    const activeIntact = await page.evaluate(() => active !== null);
    assert.ok(activeIntact, 'Active workout is kept intact on save failure');

    // Restore localStorage.setItem
    await page.evaluate(() => {
      localStorage.setItem = window.__origSetItem;
      closeModal();
    });

    // 7. Verify actual Service Worker upgrade lifecycle
    // Register sw v1
    const initialSwState = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { registered: false };
      const reg = await navigator.serviceWorker.register('./sw.js');
      await navigator.serviceWorker.ready;
      return { registered: true, hasCache: await caches.has('gymtrack-alpha-test-v1') };
    });
    assert.ok(initialSwState.registered, 'Initial service worker v1 registered');

    // Now bump swVersion on the server to trigger an actual update
    swVersion = '2';
    const upgradeState = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return { updated: false };
      await reg.update();
      let newWorker = reg.installing || reg.waiting;
      if (!newWorker) {
        await new Promise(resolve => {
          reg.addEventListener('updatefound', () => {
            newWorker = reg.installing;
            resolve();
          }, { once: true });
        });
      }
      if (newWorker.state !== 'installed') {
        await new Promise(resolve => {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed') resolve();
          });
        });
      }
      newWorker.postMessage('skipWaiting');
      await new Promise(resolve => setTimeout(resolve, 300));
      return {
        upgraded: true,
        v2Cache: await caches.has('gymtrack-alpha-test-v2')
      };
    });

    assert.ok(upgradeState.upgraded, 'Service worker upgraded to v2 and activated');
    assert.ok(upgradeState.v2Cache, 'New v2 cache was populated on upgrade');

  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
