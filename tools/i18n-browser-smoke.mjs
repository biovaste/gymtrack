// Optional browser integration check. Set PLAYWRIGHT_MODULE / CHROMIUM_EXECUTABLE
// when using an existing external browser installation. No production data used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, cp, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { start } from './i18n/server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, 'tmp');
await mkdir(tmp, { recursive: true });
const fixture = await mkdtemp(path.join(tmp, 'i18n-browser-'));
await cp(path.join(root, 'locales'), path.join(fixture, 'locales'), {
  recursive: true, filter: src => !src.endsWith('.review.lock')
});
const files = ['index.html', 'app.js', 'styles.css', 'i18n.js', 'exercises.js', 'sw.js',
  'manifest.webmanifest', 'icon-180.png', 'icon-512.png', 'locales/catalog.js'];
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!files.includes(file)) { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(path.join(root, file));
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[ext], 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (e) { res.writeHead(500); res.end(e.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, reviewer;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
  await context.route('https://**', route => route.abort());
  await context.addInitScript(() => {
    localStorage.setItem('gym.onboarded', 'true');
    if (!localStorage.getItem('gym.settings')) localStorage.setItem('gym.settings', JSON.stringify({ unit: 'kg', sound: false, vibrate: false, autoSync: false }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForSelector('[data-action="start-session"]');
  for (const language of ['en', 'fi']) {
    await page.click('[data-action="settings-open"]');
    await page.selectOption('[data-bind="set-language"]', language);
    assert.equal(await page.getAttribute('html', 'lang'), language);
    assert.equal(await page.locator('[data-i18n="navigation.workout"]').textContent(), await page.evaluate(() => I18n.t('navigation.workout')));
    for (const tab of ['plan', 'history', 'coach', 'workout']) {
      await page.click(`[data-tab="${tab}"]`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow on ${language} ${tab}`);
    }
  }
  await page.locator('[data-action="start-session"]').first().click();
  const weight = page.locator('input[data-bind="set"][data-f="weight"]').first();
  await weight.fill('42.5'); await weight.blur();
  await page.locator('[data-action="set-done"]').first().click();
  const saved = await page.evaluate(() => ({ active: localStorage.getItem('gym.active'), rest: localStorage.getItem('gym.rest') }));
  assert.ok(saved.active.includes('42.5'));
  // Exercise dialogs and the video tool have their own translation contexts.
  for (const action of ['ex-info', 'ex-note', 'ex-swap', 'plate-calc']) {
    await page.locator(`[data-action="${action}"]`).first().click();
    await page.waitForSelector('#modal-root .sheet');
    assert.deepEqual(await page.evaluate(() => I18n.missingKeys()), [], action);
    await page.evaluate(() => closeModal());
  }
  await page.evaluate(() => { cmjVideoModal(); });
  assert.deepEqual(await page.evaluate(() => I18n.missingKeys()), [], 'video measurement');
  await page.evaluate(() => cmjCancel());
  await page.evaluate(() => { showRpePicker(8, () => {}); });
  assert.deepEqual(await page.evaluate(() => I18n.missingKeys()), [], 'RPE picker');
  await page.evaluate(() => closeRpePicker());
  await page.evaluate(() => exEditModal(plan.days[0].id, 0));
  assert.deepEqual(await page.evaluate(() => I18n.missingKeys()), [], 'plan exercise editor');
  await page.evaluate(() => closeModal());
  await page.screenshot({ path: path.join(tmp, 'finnish-workout.png'), fullPage: true });
  await page.click('[data-action="settings-open"]');
  await page.selectOption('[data-bind="set-language"]', 'en');
  await page.selectOption('[data-bind="set-language"]', 'fi');
  assert.deepEqual(await page.evaluate(() => ({ active: localStorage.getItem('gym.active'), rest: localStorage.getItem('gym.rest') })), saved);
  await page.click('[data-action="settings-back"]');
  assert.deepEqual(await page.evaluate(() => I18n.missingKeys()), []);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  assert.equal(await page.getAttribute('html', 'lang'), 'fi');
  assert.deepEqual(await page.evaluate(() => I18n.missingKeys()), []);
  assert.deepEqual(errors, []);
  await context.setOffline(false);

  reviewer = await start(fixture, { port: 0, quiet: true });
  const reviewPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  reviewPage.on('pageerror', error => errors.push(error.message));
  await reviewPage.goto(reviewer.url);
  await reviewPage.waitForSelector('#editor:not([hidden])');
  await reviewPage.selectOption('#status', 'all');
  await reviewPage.fill('#search', 'navigation.workout');
  await reviewPage.locator('#list button').first().click();
  await reviewPage.fill('#finnish', 'Treeni (testi)');
  await Promise.all([reviewPage.waitForResponse(response => response.url().endsWith('/api/save') && response.status() === 200), reviewPage.click('#save')]);
  await reviewPage.waitForFunction(() => document.getElementById('saveState').textContent === 'Saved');
  await reviewPage.reload();
  await reviewPage.waitForSelector('#editor:not([hidden])');
  await reviewPage.selectOption('#status', 'all');
  await reviewPage.fill('#search', 'navigation.workout');
  await reviewPage.locator('#list button').first().click();
  assert.equal(await reviewPage.inputValue('#finnish'), 'Treeni (testi)');
  await Promise.all([reviewPage.waitForResponse(response => response.url().endsWith('/api/save') && response.status() === 200), reviewPage.click('#approve')]);
  await reviewPage.waitForFunction(() => document.getElementById('saveState').textContent === 'Saved');
  const review = JSON.parse(await readFile(path.join(fixture, 'locales/fi.review.json'), 'utf8'));
  assert.equal(review.entries['navigation.workout'].status, 'approved');
  await reviewPage.fill('#search', '');
  await reviewPage.locator('#list button').first().click();
  await reviewPage.screenshot({ path: path.join(tmp, 'finnish-review.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: Finnish screens, language persistence, exercise display, active workout/rest preservation, offline reload, durable reviewer edits and approval.');
  console.log('Screenshots: tmp/finnish-workout.png, tmp/finnish-review.png');
} finally {
  if (browser) await browser.close();
  if (reviewer) await new Promise(resolve => reviewer.server.close(resolve));
  await new Promise(resolve => server.close(resolve));
}
