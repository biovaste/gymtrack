/*
 * alpha-rescue-browser.test.mjs — one-time rescue of workouts logged under gym_alpha.
 * on the personal host (2026-09-19 track mix-up). The personal app must merge them into
 * its own history, keep the cloud's newer plan, and push the union back up.
 * Run: node --test tools/alpha-rescue-browser.test.mjs
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
function loadPlaywright() {
  for (const mod of [process.env.PLAYWRIGHT_MODULE, 'playwright',
    'C:\\Users\\henri\\AppData\\Local\\npm-cache\\_npx\\e41f203b7505f1fb\\node_modules\\playwright'].filter(Boolean)) {
    try { return require(mod); } catch (e) { /* try next */ }
  }
  return null;
}

const UUID = '33333333-3333-4333-8333-333333333333';
const sess = (id, date) => ({ id, date, dayName: 'Day', exercises: [] });
const PLAN = name => ({ type: 'workout-plan', version: 1, name, days: [{ id: 'd1', name: 'Day', exercises: [{ id: 'e1', name: 'Bench Press', sets: 3, reps: '5', weight: 60 }] }] });

test('personal host rescues alpha-stored workouts without clobbering the cloud', async t => {
  const playwright = loadPlaywright();
  if (!playwright) { t.skip('Playwright not installed'); return; }
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const executablePath = process.env.CHROMIUM_EXECUTABLE || (existsSync(edge) ? edge : undefined);

  const files = ['index.html', 'app-config.js', 'app.js', 'workout-model.js', 'exercise-library.js', 'styles.css',
    'i18n.js', 'exercises.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png', 'locales/catalog.js'];
  const server = createServer(async (req, res) => {
    const file = new URL(req.url, 'http://x').pathname.slice(1) || 'index.html';
    if (!files.includes(file)) { res.writeHead(404); res.end(); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(await readFile(path.join(root, file)));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;

  // Cloud: newer, has the current plan and sessions 1–2.
  let cloud = { type: 'gymtrack-backup', version: 1, updatedAt: 2000, plan: PLAN('Cloud plan'),
    sessions: [sess('s1', '2026-09-10T08:00:00Z'), sess('s2', '2026-09-16T08:00:00Z')], bodyWeight: [], aliases: {}, settings: {} };
  const pushes = [];

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('https://api.gymtrack.hithitpull.fi/**', async route => {
      const req = route.request();
      if (req.method() === 'POST') { const b = JSON.parse(req.postData()); pushes.push(b); cloud = b; }
      route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: req.method() === 'POST' ? '{"ok":true}' : JSON.stringify(cloud) });
    });
    // Phone state: personal storage is stale (s1 only, older stamp); alpha storage has
    // s2 (duplicate) and s3 (logged only in alpha mode).
    await context.addInitScript(({ uuid, plan, s }) => {
      if (localStorage.getItem('seeded')) return;
      localStorage.setItem('seeded', '1');
      localStorage.setItem('gymtrack_uuid', uuid);
      localStorage.setItem('gym.onboarded', '1');
      localStorage.setItem('gym.updatedAt', '1000');
      localStorage.setItem('gym.plan', JSON.stringify(plan));
      localStorage.setItem('gym.sessions', JSON.stringify([s[0]]));
      localStorage.setItem('gym_alpha.sessions', JSON.stringify([s[1], s[2]]));
      localStorage.setItem('gym_alpha.bw', JSON.stringify([{ date: '2026-09-18', weight: 80.2 }]));
    }, { uuid: UUID, plan: PLAN('Old local plan'), s: [sess('s1', '2026-09-10T08:00:00Z'), sess('s2', '2026-09-16T08:00:00Z'), sess('s3', '2026-09-18T08:00:00Z')] });

    const page = await context.newPage();
    await page.goto(origin + '/?mode=personal');
    await page.waitForFunction(() => syncReady && syncState === 'ok', null, { timeout: 10000 });
    await page.waitForTimeout(300);

    const state = await page.evaluate(() => ({ mode: APP_CONFIG.mode, ids: sessions.map(s => s.id), bw: bodyWeight.length, plan: plan.name, alphaKept: !!localStorage.getItem('gym_alpha.sessions') }));
    assert.equal(state.mode, 'personal');
    assert.deepEqual(state.ids, ['s1', 's2', 's3'], 'alpha-only workout rescued, duplicates merged');
    assert.equal(state.bw, 1);
    assert.equal(state.plan, 'Cloud plan', 'newer cloud plan wins over the stale local one');
    assert.ok(state.alphaKept, 'alpha keys left as a backup');
    assert.ok(pushes.length >= 1, 'union pushed to the cloud');
    assert.deepEqual(cloud.sessions.map(s => s.id).sort(), ['s1', 's2', 's3']);
    assert.equal(cloud.plan.name, 'Cloud plan');

    // Runs once: a reload does not re-import (e.g. after the athlete deletes a session).
    await page.evaluate(() => { sessions = sessions.filter(s => s.id !== 's3'); store.set('sessions', sessions); });
    await page.reload();
    await page.waitForFunction(() => syncReady);
    assert.equal(await page.evaluate(() => sessions.some(s => s.id === 's3') && localStorage.getItem('gym.alphaRescued') !== null ? 'reimported' : 'ok'), 'ok');
  } finally {
    if (browser) await browser.close();
    await new Promise(r => server.close(r));
  }
});
