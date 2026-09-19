/*
 * coach-alpha-browser.test.mjs — athlete side of coach programs, end to end.
 * The alpha app runs in a headless browser; API calls are answered in-process by the
 * real Worker code over an in-memory KV, so link → send → accept → sync is exercised
 * without touching production.
 * Run: node --test tools/coach-alpha-browser.test.mjs
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
const worker = await import('../worker/src/index.js');

const TEAM = 'team.cloudflareaccess.com';
const AUD = 'aud-123';
const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => String(url) === `https://${TEAM}/cdn-cgi/access/certs`
  ? new Response(JSON.stringify({ keys: [jwk] })) : realFetch(url, init);
const b64u = v => Buffer.from(v).toString('base64url');
async function accessJwt() {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
  const p = b64u(JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, exp: Math.floor(Date.now() / 1000) + 600, email: 'coach@example.com' }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(h + '.' + p));
  return `${h}.${p}.${b64u(sig)}`;
}

function loadPlaywright() {
  for (const mod of [process.env.PLAYWRIGHT_MODULE, 'playwright',
    'C:\\Users\\henri\\AppData\\Local\\npm-cache\\_npx\\e41f203b7505f1fb\\node_modules\\playwright'].filter(Boolean)) {
    try { return require(mod); } catch (e) { /* try next */ }
  }
  return null;
}

test('athlete links with an invite code, accepts a coach program, keeps own days, syncs', async t => {
  const playwright = loadPlaywright();
  if (!playwright) { t.skip('Playwright not installed'); return; }
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const executablePath = process.env.CHROMIUM_EXECUTABLE || (existsSync(edge) ? edge : undefined);

  const map = new Map([['coach:coach@example.com', JSON.stringify({ name: 'Aino' })]]);
  const env = {
    GYMTRACK_WRITE_SECRET: 'test-secret', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD,
    GYMTRACK_DATA: { get: async k => (map.has(k) ? map.get(k) : null), put: async (k, v) => { map.set(k, v); }, delete: async k => { map.delete(k); } },
  };
  const api = async (method, p, body, headers = {}) => {
    const res = await worker.default.fetch(new Request('https://api.gymtrack.hithitpull.fi' + p, {
      method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
    }), env);
    return res.json();
  };

  const files = ['index.html', 'app-config.js', 'app.js', 'workout-model.js', 'exercise-library.js', 'styles.css',
    'i18n.js', 'exercises.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png', 'locales/catalog.js'];
  const server = createServer(async (req, res) => {
    const file = new URL(req.url, 'http://x').pathname.slice(1) || 'index.html';
    if (!files.includes(file)) { res.writeHead(404); res.end(); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(await readFile(path.join(root, file)));
  });
  // Any free port: every localhost port except 8765 runs the alpha track.
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await context.route('https://api.gymtrack.hithitpull.fi/**', async route => {
      const req = route.request();
      const res = await worker.default.fetch(new Request(req.url(), {
        method: req.method(), headers: req.headers(), ...(req.postData() ? { body: req.postData() } : {}),
      }), env);
      route.fulfill({ status: res.status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: await res.text() });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/');
    await page.waitForLoadState('networkidle');
    assert.equal(await page.evaluate(() => APP_CONFIG.isAlpha), true);
    assert.equal(await page.evaluate(() => I18n.locale()), 'fi', 'alpha defaults to Finnish');
    const closeModal = async () => {
      const btn = page.locator('#modal-root [data-action="modal-btn"]').first();
      if (await btn.isVisible().catch(() => false)) await btn.click();
    };
    await closeModal();

    // The athlete adds a day of their own on top of the starter plan.
    await page.evaluate(() => { plan.days.push({ id: 'own', name: 'My extra', warmup: [], exercises: [{ id: 'x', name: 'Row', sets: 3, reps: '8', weight: 50, equipment: 'cable', alternates: [] }] }); savePlan(); });

    // Link: the invite code issues the write token.
    const { code } = await api('POST', '/coach/invite', null, { 'Cf-Access-Jwt-Assertion': await accessJwt() });
    await page.evaluate(() => { tab = 'settings'; render(); });
    await page.fill('#coach-code', code.toLowerCase());
    await page.fill('#coach-name', 'Henri');
    await page.click('[data-action="coach-link"]');
    await page.waitForFunction(() => !!writeToken && coachLink && coachLink.name === 'Aino');
    const uuid = await page.evaluate(() => gymUUID);
    assert.equal(await page.evaluate(k => localStorage.getItem(k), 'gymtrack_alpha_write_token'), await worker.deriveWriteToken('test-secret', uuid));

    // The coach sends a program; the banner appears on the start screen.
    const program = { type: 'workout-plan', version: 1, name: 'Joukkueen jakso', days: [
      { name: 'Team A', exercises: [{ name: 'Back Squat', sets: 3, reps: '5', weight: 100, equipment: 'barbell' }] },
      { name: 'Team B', exercises: [{ name: 'Bench Press', sets: 3, reps: '5', weight: 70, equipment: 'barbell' }] },
    ] };
    const sent = await api('POST', '/coach/assign', { plan: program, athletes: [uuid], note: 'Viikko 1' }, { 'Cf-Access-Jwt-Assertion': await accessJwt() });
    assert.equal(sent.results[uuid], 'sent');
    await page.evaluate(async () => { tab = 'workout'; await refreshCoachInbox(true); render(); });
    await page.waitForSelector('[data-action="coach-inbox-open"]');

    // Preview shows the diff; accept applies it.
    await page.click('[data-action="coach-inbox-open"]');
    const preview = await page.locator('#modal-root').innerText();
    assert.match(preview, /Team A, Team B/);
    assert.match(preview, /My extra/);
    assert.match(preview, /Viikko 1/);
    await page.locator('#modal-root [data-action="modal-btn"]').first().click();
    await page.waitForFunction(() => plan.days.some(d => d.name === 'Team A'));
    const days = await page.evaluate(() => plan.days.map(d => [d.name, d.source ? (d.source.coachId || 'starter') : null]));
    assert.deepEqual(days, [['Team A', 'coach@example.com'], ['Team B', 'coach@example.com'], ['My extra', null]], 'starter days dropped, own day kept');
    assert.equal(await page.locator('[data-action="coach-inbox-open"]').count(), 0, 'banner gone');

    // Acked on the server, and the plan reaches the athlete's own cloud record.
    const status = await api('GET', '/coach/assignments', null, { 'Cf-Access-Jwt-Assertion': await accessJwt() });
    assert.equal(status.assignments[0].athletes[uuid], 'accepted');
    await page.evaluate(() => workerPush({ silent: true }));
    const coachView = await api('GET', '/coach/athlete/' + uuid, null, { 'Cf-Access-Jwt-Assertion': await accessJwt() });
    assert.deepEqual(coachView.plan.days.map(d => d.name), ['Team A', 'Team B', 'My extra']);

    // Plan tab labels coach days; survives reload.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await closeModal();
    await page.evaluate(() => { tab = 'plan'; render(); });
    assert.match(await page.locator('#app').innerText(), /Valmentajalta Aino/);

    // Unlink from settings.
    await page.evaluate(() => { tab = 'settings'; render(); });
    await page.click('[data-action="coach-unlink"]');
    await page.locator('#modal-root [data-action="modal-btn"]').first().click();
    await page.waitForFunction(() => coachLink === null);
    const roster = await api('GET', '/coach/roster', null, { 'Cf-Access-Jwt-Assertion': await accessJwt() });
    assert.equal(roster.athletes.length, 0);
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    if (browser) await browser.close();
    await new Promise(r => server.close(r));
  }
});
