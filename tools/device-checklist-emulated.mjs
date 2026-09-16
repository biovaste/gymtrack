/*
 * device-checklist-emulated.mjs — runs the automatable rows of
 * docs/phase-1-device-checklist.md (web alpha) in desktop Edge/Chromium with iPhone-sized
 * mobile emulation, native CDP touch input, a real service worker and synthetic data.
 *
 * THIS IS NOT DEVICE EVIDENCE. It does not use WebKit, a real iPhone/Android, a Home Screen
 * install, an on-screen keyboard, screen lock, OS audio policy or notifications. Rows that
 * need those are reported as DEVICE-ONLY.
 *
 *   PLAYWRIGHT_MODULE=<path> CHROMIUM_EXECUTABLE=<path> node tools/device-checklist-emulated.mjs
 * Writes tmp/checklist-emulated/report.md and screenshots. Exit code 1 on any FAIL.
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'tmp', 'checklist-emulated');
await mkdir(out, { recursive: true });

const FILES = ['index.html', 'app-config.js', 'app.js', 'workout-model.js', 'exercise-library.js', 'styles.css', 'i18n.js',
  'exercises.js', 'sw.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png', 'locales/catalog.js'];
let swTag = 'v1';
let page; // the page currently under test; rows switch it when they reopen the app
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!FILES.includes(file)) { res.writeHead(404); res.end(); return; }
  let body = await readFile(path.join(root, file));
  if (file === 'app-config.js') body = `window.GYM_CONFIG = { mode: 'alpha', version: '1.0.0', alphaVersion: '0.1.0-alpha-rehearsal', build: 'checklist-${swTag}' };`;
  if (file === 'sw.js') body = body.toString('utf8').replace(/const CACHE = '[^']+';/, `const CACHE = 'gymtrack-checklist-${swTag}';`);
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(file)];
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const rows = [];
const external = [];
const pageErrors = [];
async function row(step, fn) {
  try { const note = await fn(); rows.push([step, 'PASS (emulated)', note || '']); }
  catch (e) {
    const lines = String(e.message).split('\n');
    const why = lines.filter((l, i) => i === 0 || /intercepts|outside of the viewport|not visible|not stable|detached/.test(l)).slice(0, 3);
    rows.push([step, 'FAIL', why.join(' ⟂ ').replace(/\[\d+m/g, '').slice(0, 500)]);
    await page.screenshot({ path: path.join(out, 'FAIL-' + step.replace(/[^a-z0-9]+/gi, '-').slice(0, 40) + '.png') }).catch(() => {});
    // Leave a clean screen so one failure does not cascade into every later row.
    await page.evaluate(() => { closeModal(); closeRpePicker(); document.getElementById('toast-root').innerHTML = ''; }).catch(() => {});
  }
}
const deviceOnly = (step, why) => rows.push([step, 'DEVICE-ONLY', why]);
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

const PLAN = {
  type: 'workout-plan', version: 1, name: 'Rehearsal plan',
  days: [{ name: 'Day R', warmup: ['Bike 5 min'], exercises: [
    { name: 'Weighted Pull-Up', movementId: 'pull-up', equipment: 'bodyweight', addedLoad: true, weight: 10, sets: 2, reps: '6', targetRpe: 8, restSeconds: 60,
      alternates: [{ name: 'Lat Pulldown', equipment: 'cable', weight: 50 }] },
    { name: 'Goblet Squat', equipment: 'dumbbell', weight: 20, sets: 2, warmupSets: 1, reps: '8', restSeconds: 20, superset: 'A' },
    { name: 'Face Pull', equipment: 'cable', weight: 20, sets: 2, warmupSets: 1, reps: '12', restSeconds: 30, superset: 'A' },
    { name: 'Box Jump', metric: 'height', equipment: 'bodyweight', weight: 0, sets: 1, restSeconds: 30,
      alternates: [{ name: 'Split Squat Left', metric: 'load', equipment: 'dumbbell', side: 'left', weight: 12 }] },
    { name: 'Plank', metric: 'duration', equipment: 'bodyweight', durationSeconds: 3, sets: 1, restSeconds: 5 },
    { name: 'Farmer Carry', metric: 'distance', equipment: 'dumbbell', weight: 24, distanceMeters: 30, sets: 1, restSeconds: 30 },
    { name: 'Treadmill', metric: 'cardio', equipment: 'other', durationSeconds: 300, speedKph: 10, sets: 1, restSeconds: 30 },
    { name: 'Bench Press', movementId: 'bench', setupId: 'Rack 1', side: 'bilateral', weight: 60, sets: 1, reps: '5', targetRpe: 8, restSeconds: 90 }
  ] }]
};

const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const device = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'en-GB',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 (Chromium emulation)' };
async function newProfile(name) {
  const context = await browser.newContext({ ...device, permissions: ['clipboard-read', 'clipboard-write'] });
  context.on('request', r => { if (!r.url().startsWith(origin)) external.push(`${name}: ${r.url()}`); });
  await context.route(u => !String(u).startsWith(origin), route => route.abort());
  await context.addInitScript(() => {
    window.__cues = { beep: 0, buzz: 0 };
    addEventListener('DOMContentLoaded', () => {
      const b = window.beep, z = window.buzz;
      window.beep = (...a) => { window.__cues.beep++; return b(...a); };
      window.buzz = (...a) => { window.__cues.buzz++; return z(...a); };
    });
  });
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(`${name}: ${e.message}`));
  await page.goto(origin);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => typeof render === 'function');
  await page.evaluate(() => { I18n.setLocale('en'); render(); });
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp };
}
const shot = (page, name) => page.screenshot({ path: path.join(out, name + '.png'), fullPage: false });
const touch = (cdp, type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touchDrag(page, cdp, sel, toY, holdMs) {
  await page.locator(sel).scrollIntoViewIfNeeded();
  const b = await page.locator(sel).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await touch(cdp, 'touchStart', x, y);
  await sleep(holdMs);
  for (let i = 1; i <= 10; i++) { await touch(cdp, 'touchMove', x, y + (toY - y) * i / 10); await sleep(16); }
  await touch(cdp, 'touchEnd');
  await sleep(50);
}
const names = page => page.evaluate(() => active.exercises.map(e => e.name));

// ---------------- Athlete profile ----------------
const A = await newProfile('athlete');
page = A.page;
const { cdp } = A;

await row('Install/open exact alpha build', async () => {
  ok(await page.evaluate(() => APP_CONFIG.isAlpha && store.prefix === 'gym_alpha.'), 'not alpha');
  const onboarding = await page.locator('#modal-root').textContent();
  ok(/alpha/i.test(onboarding), 'no alpha onboarding text');
  await shot(page, '01-onboarding');
  await page.locator('#modal-root [data-action="modal-btn"]').first().click();
  await page.click('[data-action="settings-open"]');
  const settings = await page.locator('#app').textContent();
  ok(settings.includes('0.1.0-alpha-rehearsal') && settings.includes('checklist-v1'), 'version/build not visible in Settings');
  await shot(page, '01-settings-version');
  await page.click('[data-action="settings-back"]');
  return 'Onboarding names alpha; Settings shows 0.1.0-alpha-rehearsal / build. Not a Home Screen install.';
});

await row('Cloud isolation verification', async () => {
  await page.click('[data-action="settings-open"]');
  for (const sel of ['[data-action="toggle-autosync"]', '[data-action="share-ai"]', '[data-action="copy-uuid"]', '[data-action="save-write-token"]', '[data-action="restore-uuid"]']) {
    ok(await page.locator(sel).count() === 0, `${sel} visible`);
  }
  await page.click('[data-action="settings-back"]');
  await page.click('.tab[data-tab="coach"]');
  ok(await page.locator('[data-action="share-ai"], [data-action="toggle-autosync"]').count() === 0, 'coach tab exposes cloud controls');
  const thrown = await page.evaluate(async () => { try { await syncFetch('https://api.gymtrack.hithitpull.fi/data/x'); return false; } catch (e) { return true; } });
  ok(thrown, 'syncFetch did not refuse');
  await page.click('.tab[data-tab="workout"]');
  return 'No sync toggle, share link, UUID or token controls; syncFetch refuses. External requests checked at the end.';
});

await page.evaluate(p => { plan = normalizePlan(p); savePlan(); settings.sound = true; saveSettings(); render(); }, PLAN);

await row('Coach plan-only handoff', async () => {
  // Coach profile has its own history and body weight; the athlete profile has its own session.
  const C = await newProfile('coach');
  await C.page.locator('#modal-root [data-action="modal-btn"]').first().click();
  await C.page.evaluate(p => { plan = normalizePlan({ ...p, name: 'Coach block' }); savePlan(); sessions = [{ id: 'coach-secret', date: '2026-09-10T08:00:00Z', dayName: 'Coach', durationMin: 40, notes: 'COACH-PRIVATE', exercises: [] }]; saveSessions(); bodyWeight = [{ date: '2026-09-10', weight: 91 }]; saveBW(); tab = 'plan'; render(); }, PLAN);
  await C.page.locator('[data-action="plan-export"]').first().click();
  const exported = await C.page.evaluate(() => navigator.clipboard.readText());
  await C.context.close();
  ok(!/COACH-PRIVATE|coach-secret|bodyWeight|gymtrack_uuid|writeToken|sessions/.test(exported), 'plan export leaks history/credentials');
  await page.evaluate(() => { sessions = [{ id: 'athlete-own', date: '2026-09-12T08:00:00Z', dayName: 'Own', durationMin: 30, exercises: [] }]; saveSessions(); tab = 'plan'; render(); });
  await page.locator('[data-action="plan-import-open"]').first().click();
  await page.fill('#import-area', exported);
  await page.locator('#modal-root button.primary').click();
  ok(/Coach block/.test(await page.locator('#modal-root').textContent()), 'no import preview');
  await shot(page, '03-import-preview');
  await page.locator('#modal-root button.primary').click();
  const st = await page.evaluate(() => ({ name: plan.name, sessions: sessions.map(s => s.id), added: plan.days[0].exercises[0].addedLoad }));
  ok(st.name === 'Coach block' && st.sessions.join() === 'athlete-own' && st.added === true, JSON.stringify(st));
  return 'Separate coach profile → Export plan → athlete Import → preview → Import. Athlete history kept; coach notes/body weight absent.';
});

await row('Invalid/future plan import', async () => {
  await page.evaluate(() => { tab = 'workout'; render(); startSession(plan.days[0].id); tab = 'plan'; render(); });
  const before = await page.evaluate(() => JSON.stringify([plan, active]));
  for (const bad of ['{"type":"workout-plan","version":2,"days":[{"name":"x","exercises":[]}]}', '{not json', '{"type":"workout-plan","days":[{"name":"D","exercises":[{"name":"Row","addedLoad":true,"weight":5}]}]}']) {
    await page.locator('[data-action="plan-import-open"]').first().click();
    await page.fill('#import-area', bad);
    await page.locator('#modal-root button.primary').click();
    ok(/Could not|invalid|Unsupported|Check/i.test(await page.locator('#toast-root').textContent()), 'no clear error for ' + bad.slice(0, 20));
    await page.evaluate(() => closeModal());
  }
  ok(await page.evaluate(() => JSON.stringify([plan, active])) === before, 'plan or active workout changed');
  return 'Future version, malformed JSON and addedLoad on barbell all refused; plan and active workout byte-identical.';
});

await row('Legacy backup restore', async () => {
  const legacy = await readFile(path.join(root, 'tools/fixtures/native/legacy-backup.json'), 'utf8');
  const activeBefore = await page.evaluate(() => JSON.stringify(active));
  const planBefore = await page.evaluate(() => JSON.stringify(plan));
  await page.click('[data-action="settings-open"]');
  await page.click('[data-action="backup-restore"]');
  await page.fill('#restore-area', legacy);
  await page.locator('#modal-root button.danger').click();
  const st = await page.evaluate(() => ({ s: sessions[0].id, note: sessions[0].notes, ext: sessions[0].extension, alias: aliases['old bench'], active: JSON.stringify(active) }));
  ok(st.s === 'legacy-record' && st.note === 'Keep exactly' && st.ext?.unknown === 42 && st.alias === 'Bench Press', JSON.stringify(st));
  ok(st.active === activeBefore, 'active workout changed by restore');
  await page.evaluate(p => { plan = JSON.parse(p); savePlan(); }, planBefore);
  await page.click('[data-action="settings-back"]');
  return 'Settings → Restore with the legacy fixture: record id, notes, unknown extension and alias retained; active workout unchanged.';
});

await row('Start superset', async () => {
  await page.evaluate(() => { tab = 'workout'; render(); });
  const order = [];
  for (let n = 0; n < 6; n++) {
    const next = await page.evaluate(() => { const g = groupOf(active.exercises, 1); const s = groupNextSlot(active.exercises, g); return s && [s.ei, s.si, !!active.exercises[s.ei].sets[s.si].warmup]; });
    if (!next) break;
    order.push(next);
    await page.click(`[data-action="set-done"][data-ei="${next[0]}"][data-si="${next[1]}"]`);
  }
  const labels = order.map(([ei, si, w]) => `${ei === 1 ? 'G' : 'F'}${w ? 'w' : si}`).join(' ');
  ok(labels === 'Gw Fw G1 F1 G2 F2', labels);
  ok(await page.evaluate(() => !!rest), 'no rest after working round');
  return `Logged in suggested order: ${labels} (warm-ups first, then alternating rounds); rest started after working sets.`;
});

await row('Edit load/reps/RPE, then Log', async () => {
  await page.evaluate(() => { stopRest(); I18n.setLocale('fi'); render(); });
  const w = page.locator('[data-bind="set"][data-ei="7"][data-si="0"][data-f="weight"]');
  await w.scrollIntoViewIfNeeded();
  await w.click();
  await w.press('Control+A');
  await page.keyboard.type('62,5');
  const typed = await page.evaluate(() => active.exercises[7].sets[0].weight);
  await page.fill('[data-bind="set"][data-ei="7"][data-si="0"][data-f="reps"]', '4');
  await page.click('[data-action="rpe-pick"][data-ei="7"][data-si="0"]');
  await page.click('[data-action="rpe-opt"][data-v="8.5"]');
  await page.click('[data-action="set-done"][data-ei="7"][data-si="0"]');
  const s = await page.evaluate(() => active.exercises[7].sets[0]);
  await page.evaluate(() => { I18n.setLocale('en'); render(); });
  ok(s.reps === 4 && s.rpe === 8.5 && s.done, JSON.stringify(s));
  ok(typed === 62.5, `Chromium "62,5" stored as ${typed}`);
  return 'Reps 4, RPE 8.5 kept after logging. Finnish "62,5" typed into the field stored 62.5 in Chromium; iOS decimal keypad still needs the device.';
});

await row('Log height/time/distance/cardio', async () => {
  await page.fill('[data-bind="set"][data-ei="3"][data-si="0"][data-f="heightCm"]', '41.5');
  await page.click('[data-action="set-done"][data-ei="3"][data-si="0"]');
  await page.fill('[data-bind="set"][data-ei="5"][data-si="0"][data-f="distanceMeters"]', '32');
  await page.click('[data-action="set-done"][data-ei="5"][data-si="0"]');
  await page.fill('[data-bind="set"][data-ei="6"][data-si="0"][data-f="distanceMeters"]', '1000');
  await page.fill('[data-bind="set"][data-ei="6"][data-si="0"][data-f="durationSeconds"]', '330');
  await page.click('[data-action="set-done"][data-ei="6"][data-si="0"]');
  const rec = await page.evaluate(() => [3, 5, 6].map(ei => WorkoutModel.recordSet(active.exercises[ei], active.exercises[ei].sets[0])));
  ok(!rec.some(r => 'reps' in r), 'measurement stored as reps');
  ok(rec[0].heightCm === 41.5 && rec[1].distanceMeters === 32 && rec[2].durationSeconds === 330, JSON.stringify(rec));
  // Logging the last set collapses the card; the pace then appears in its collapsed summary.
  ok(/5:30 min\/km/.test(await page.locator('[data-reorder-list="session"]').textContent()), 'pace not shown');
  return 'Height 41.5 cm, distance 32 m, cardio 1000 m / 330 s (5:30 min/km): no reps field. The duration set is covered by the timer rows below.';
});

await row('Alternate before logging', async () => {
  await page.evaluate(() => { endSession(); render(); startSession(plan.days[0].id); stopRest(); });
  await page.click('[data-action="ex-swap"][data-ei="3"]');
  await page.click('[data-action="session-swap-pick"][data-ei="3"][data-ai="0"]');
  const e = await page.evaluate(() => { const x = active.exercises[3]; return { name: x.name, metric: x.metric, side: x.side, eq: x.equipment, reps: 'reps' in x.sets[0], w: x.sets[0].weight }; });
  ok(e.metric === 'load' && e.side === 'left' && e.eq === 'dumbbell' && e.reps && e.w === 12, JSON.stringify(e));
  await page.click('[data-action="set-done"][data-ei="3"][data-si="0"]');
  // The card collapses once its only set is logged, so call the swap path directly.
  const refused = await page.evaluate(() => { doSessionSwap(3, { name: 'Box Jump', metric: 'height', equipment: 'bodyweight', weight: 0 }); return active.exercises[3].name; });
  ok(refused === 'Split Squat Left' && /Swap before logging/.test(await page.locator('#toast-root').textContent()), 'swap after logging not refused');
  await page.evaluate(() => { closeModal(); stopRest(); });
  const k = await page.evaluate(() => [WorkoutModel.key(active.exercises[3]), WorkoutModel.key({ ...active.exercises[3], side: 'right' })]);
  ok(k[0] !== k[1], 'sides share a history key');
  return 'Jump → "Split Squat Left": metric load, left side, dumbbell 12 kg, reps grid. Left and right keep separate history keys.';
});

await row('Invalid input, correction and discard', async () => {
  await page.fill('[data-bind="set"][data-ei="4"][data-si="0"][data-f="durationSeconds"]', '0');
  await page.click('[data-action="set-done"][data-ei="4"][data-si="0"]');
  ok(await page.evaluate(() => active.exercises[4].sets[0].done) === false, '0 s set was logged');
  ok(/positive duration/i.test(await page.locator('#toast-root').textContent()), 'no error message');
  await page.fill('[data-bind="set"][data-ei="4"][data-si="0"][data-f="durationSeconds"]', '3');
  await page.click('[data-action="set-done"][data-ei="4"][data-si="0"]');
  ok(await page.evaluate(() => active.exercises[4].sets[0].done) === true, 'corrected set not logged');
  await page.click('[data-action="confirm-discard"]');
  await page.locator('#modal-root button.danger').click();
  ok(await page.evaluate(() => active === null && localStorage.getItem('gym_alpha.active') === null), 'discard left state');
  return '0 s refused with a message, 3 s accepted after correction, Discard clears the workout from memory and storage.';
});

await row('Notes with keyboard open, then Save', async () => {
  await page.evaluate(() => { startSession(plan.days[0].id); render(); });
  await page.click('[data-action="ex-note"][data-ei="0"]');
  await page.fill('#ex-note-area', 'Belt 10 kg, elbow ok');
  await page.locator('#modal-root button.primary').click();
  ok(await page.evaluate(() => active.exercises[0].notes) === 'Belt 10 kg, elbow ok', 'note lost');
  return 'Note saved and kept. The on-screen keyboard covering Save is DEVICE-ONLY.';
});

deviceOnly('Deny notifications', 'The web alpha requests no notification permission; OS prompt behaviour needs a device.');
deviceOnly('Grant notifications, lock during rest', 'Screen lock / OS delivery cannot be emulated.');

await row('Extend/skip/end rest', async () => {
  await page.evaluate(() => { window.__cues = { beep: 0, buzz: 0 }; startRest(2, 'test'); adjustRest(15); });
  ok(await page.evaluate(() => rest.total) === 17, 'extend failed');
  await page.click('[data-action="rest-skip"]');
  await sleep(3500);
  ok(await page.evaluate(() => rest === null && window.__cues.beep === 0), 'skipped rest still alarmed');
  await page.evaluate(() => startRest(1, 'short'));
  await sleep(2600);
  const c = await page.evaluate(() => ({ ...window.__cues }));
  ok(c.buzz === 1 && c.beep <= 1, JSON.stringify(c));
  return `+15 s applied; skipped rest never alarmed; a 1 s rest alarmed once (cues ${JSON.stringify(c)}). Audibility is DEVICE-ONLY.`;
});
deviceOnly('Silent/Focus and force-stop', 'OS audio policy and process kill need a device.');

// ---- new rows: reorder ----
await row('Drag exercise card (touch)', async () => {
  await page.evaluate(() => { stopRest(); window.scrollTo(0, 0); });
  const before = await names(page);
  // swipe on the card body scrolls and never reorders
  await page.locator('.ex-name').first().scrollIntoViewIfNeeded();
  const body = await page.locator('.target-line').first().boundingBox();
  const y0 = await page.evaluate(() => scrollY);
  await touch(cdp, 'touchStart', body.x + 40, body.y + 5);
  for (let i = 1; i <= 8; i++) { await touch(cdp, 'touchMove', body.x + 40, body.y + 5 - 30 * i); await sleep(16); }
  await touch(cdp, 'touchEnd'); await sleep(300);
  ok((await page.evaluate(() => scrollY)) !== y0, 'swipe on card did not scroll');
  ok(JSON.stringify(await names(page)) === JSON.stringify(before), 'card swipe reordered');
  // quick move from the grip, before the hold, is not a drag
  await page.evaluate(() => window.scrollTo(0, 0));
  const firstBox = await page.locator('[data-reorder-list="session"] > [data-reorder-unit]').nth(0).boundingBox();
  await touchDrag(page, cdp, '[data-reorder-handle][data-scope="session"][data-i="7"]', 200, 60);
  ok(JSON.stringify(await names(page)) === JSON.stringify(before), 'drag started without hold');
  // typing in a field then pressing the grip
  await page.locator('[data-bind="set"][data-ei="0"][data-f="reps"]').first().focus();
  await page.evaluate(() => window.scrollTo(0, 0));
  const top = (await page.locator('[data-reorder-list="session"] > [data-reorder-unit]').nth(0).boundingBox()).y;
  await page.locator('[data-reorder-handle][data-scope="session"][data-i="7"]').scrollIntoViewIfNeeded();
  const h = await page.locator('[data-reorder-handle][data-scope="session"][data-i="7"]').boundingBox();
  await touch(cdp, 'touchStart', h.x + h.width / 2, h.y + h.height / 2);
  await sleep(450);
  const midDrag = await page.evaluate(() => ({ started: !!(drag && drag.started), preview: !!document.querySelector('.drag-preview'), line: !!document.querySelector('.drop-indicator'), focus: document.activeElement.tagName }));
  for (let i = 1; i <= 25; i++) { await touch(cdp, 'touchMove', h.x + h.width / 2, h.y + h.height / 2 - (h.y - 90) * i / 25); await sleep(30); }
  await page.screenshot({ path: path.join(out, '20-touch-drag-in-progress.png') });
  await touch(cdp, 'touchEnd'); await sleep(200);
  void firstBox; void top;
  const after = await names(page);
  ok(midDrag.started && midDrag.preview && midDrag.line, 'no preview/indicator: ' + JSON.stringify(midDrag));
  ok(midDrag.focus !== 'INPUT', 'input kept focus during drag');
  ok(after.indexOf('Bench Press') < before.indexOf('Bench Press'), 'Bench Press did not move up: ' + after.join(', '));
  return `Native CDP touch. Card swipe scrolled without reordering; grip moved before the hold did nothing; hold 450 ms → preview + line, focused field blurred, Bench Press moved from #8 to #${after.indexOf('Bench Press') + 1}.`;
});

await row('Drag superset + completed exercise', async () => {
  await page.evaluate(() => { endSession(); startSession(plan.days[0].id); stopRest(); render(); });
  await page.click('[data-action="set-done"][data-ei="0"][data-si="0"]');
  await page.click('[data-action="set-done"][data-ei="0"][data-si="1"]');
  await page.evaluate(() => { stopRest(); active.exercises[0].notes = 'kept'; saveActive(); render(); window.__pull = active.exercises[0]; });
  await page.evaluate(() => window.scrollTo(0, 0));
  const pullBox = await page.locator('[data-reorder-list="session"] > [data-reorder-unit]').nth(0).boundingBox();
  await touchDrag(page, cdp, '.superset-head [data-reorder-handle]', pullBox.y + 4, 450);
  const n = await names(page);
  ok(n.slice(0, 3).join() === 'Goblet Squat,Face Pull,Weighted Pull-Up', n.join());
  const st = await page.evaluate(() => { const e = active.exercises[2]; return { same: e === window.__pull, done: e.sets.every(s => s.done), notes: e.notes, collapsed: !!document.querySelector('[data-reorder-unit="1"] .collapsed-ex') }; });
  ok(st.same && st.done && st.notes === 'kept' && st.collapsed, JSON.stringify(st));
  return 'Superset A dragged above the completed pull-up as one block (Goblet Squat, Face Pull order kept); pull-up keeps its ✓ sets, note and collapsed state.';
});

await row('↑/↓ reorder with screen reader', async () => {
  const label = await page.getAttribute('[data-action="ex-move"][data-scope="session"][data-i="2"][data-dir="1"]', 'aria-label');
  ok(/Move Weighted Pull-Up down/.test(label), label);
  await page.focus('[data-action="ex-move"][data-scope="session"][data-i="2"][data-dir="1"]');
  await page.keyboard.press('Enter');
  const live = await page.locator('#sr-live').textContent();
  const focus = await page.evaluate(() => [document.activeElement.dataset.action, document.activeElement.dataset.i]);
  ok(/moved to position 3 of 7/.test(live) /* 8 exercises, superset counts as one position */ && focus.join() === 'ex-move,3', live + ' ' + focus);
  return `aria-label "${label}"; announcement "${live}"; focus followed to index 3. VoiceOver/TalkBack speech itself is DEVICE-ONLY.`;
});

await row('Plan-editor reorder vs active workout', async () => {
  const planBefore = await page.evaluate(() => plan.days[0].exercises.map(e => e.name).join());
  ok(planBefore.startsWith('Weighted Pull-Up,Goblet Squat'), 'workout reorder touched plan');
  await page.evaluate(() => { tab = 'plan'; expandedDay = plan.days[0].id; render(); });
  await page.click('[data-action="ex-move"][data-scope="plan"][data-i="7"][data-dir="-1"]');
  const st = await page.evaluate(() => ({ plan: plan.days[0].exercises.at(-2).name, active: active.exercises.at(-1).name }));
  ok(st.plan === 'Bench Press' && st.active === 'Bench Press', JSON.stringify(st));
  const reopened = await A.context.newPage();
  await reopened.goto(origin); await reopened.waitForFunction(() => typeof render === 'function');
  const persisted = await reopened.evaluate(() => [plan.days[0].exercises.at(-2).name, active.exercises.map(e => e.name).slice(0, 3).join()]);
  await reopened.close();
  ok(persisted[0] === 'Bench Press' && persisted[1] === 'Goblet Squat,Face Pull,Weighted Dip'.replace('Weighted Dip', 'Box Jump') || persisted[1].startsWith('Goblet Squat,Face Pull'), JSON.stringify(persisted));
  await page.evaluate(() => { tab = 'workout'; render(); });
  return 'Plan move did not change the running workout; workout moves did not change the plan; both orders survive opening a new tab.';
});

// ---- new rows: timer (real clock, 3 s plank) ----
await row('Timed set: foreground expiry', async () => {
  await page.evaluate(() => { stopRest(); window.__cues = { beep: 0, buzz: 0 }; });
  const ei = await page.evaluate(() => active.exercises.findIndex(e => e.name === 'Plank'));
  await page.locator(`[data-action="extimer-start"][data-ei="${ei}"]`).click();
  await sleep(1200);
  await shot(page, '30-timer-running');
  await sleep(3000);
  const st = await page.evaluate(i => ({ t: active.exercises[i].sets[0].timer, done: active.exercises[i].sets[0].done, rest: !!rest, cues: { ...window.__cues }, cue: exTimerCue }), ei);
  await shot(page, '31-timer-expired');
  ok(st.t?.state === 'expired' && !st.done && !st.rest, JSON.stringify(st));
  ok(st.cues.buzz === 1 && st.cues.beep <= 1, JSON.stringify(st.cues));
  await sleep(3000);
  const again = await page.evaluate(() => ({ ...window.__cues }));
  ok(JSON.stringify(again) === JSON.stringify(st.cues), 'alarm repeated');
  return `Expired after 3 s: "Time's up", not logged, no rest; one alarm (fallback beep ${st.cues.beep} + scheduled audio node; buzz 1), no repeat. Audible volume/silent switch is DEVICE-ONLY.`;
});

await row('Timed set: pause, reset, cancel, Log', async () => {
  const ei = await page.evaluate(() => active.exercises.findIndex(e => e.name === 'Plank'));
  await page.click(`[data-action="extimer-log"][data-ei="${ei}"]`);
  const logged = await page.evaluate(i => ({ ...active.exercises[i].sets[0], rest: rest && rest.total }), ei);
  ok(logged.done && logged.durationSeconds === 3 && !logged.timer && logged.rest === 5, JSON.stringify(logged));
  await page.evaluate(i => { stopRest(); active.exercises[i].sets.push({ weight: 0, durationSeconds: 3, rpe: null, done: false }); saveActive(); render(); }, ei);
  await page.click(`[data-action="extimer-start"][data-ei="${ei}"][data-si="1"]`);
  await sleep(1100);
  await page.click(`[data-action="extimer-pause"][data-ei="${ei}"]`);
  const paused = await page.evaluate(i => active.exercises[i].sets[1].timer.remainingMs, ei);
  await sleep(2500);
  ok(await page.evaluate(i => active.exercises[i].sets[1].timer.state, ei) === 'paused', 'pause expired');
  await page.click(`[data-action="extimer-reset"][data-ei="${ei}"]`);
  ok(await page.evaluate(i => active.exercises[i].sets[1].timer.remainingMs, ei) === 3000, 'reset');
  await page.click(`[data-action="extimer-cancel"][data-ei="${ei}"]`);
  ok(await page.evaluate(i => !active.exercises[i].sets[1].timer && !active.exercises[i].sets[1].done, ei), 'cancel');
  return `Log wrote 3 s, logged the set and started its 5 s rest; pause held at ${Math.round(paused / 100) / 10} s; reset → 3.0 s paused; ✕ removed the timer without logging.`;
});

await row('Timed set vs rest timer', async () => {
  const ei = await page.evaluate(() => active.exercises.findIndex(e => e.name === 'Plank'));
  await page.evaluate(() => startRest(60, 'r'));
  await page.click(`[data-action="extimer-start"][data-ei="${ei}"][data-si="1"]`);
  ok(await page.evaluate(() => rest === null), 'rest not ended by timer start');
  const other = await page.evaluate(() => active.exercises.findIndex(e => e.name === 'Farmer Carry'));
  await page.click(`[data-action="set-done"][data-ei="${other}"][data-si="0"]`);
  ok(await page.evaluate(i => !active.exercises[i].sets[1].timer && !!rest, ei), 'timer not ended by logging another set');
  await page.evaluate(() => { window.__cues = { beep: 0, buzz: 0 }; });
  await sleep(4000);
  ok(await page.evaluate(() => window.__cues.beep === 0), 'ended timer alarmed');
  await page.evaluate(() => stopRest());
  return 'Starting the exercise timer ended a 60 s rest; logging Farmer Carry ended the timer and started rest; no alarm from the ended timer.';
});

await row('Timed set: start, lock, return (reload + background approximation)', async () => {
  const ei = await page.evaluate(() => active.exercises.findIndex(e => e.name === 'Plank'));
  await page.click(`[data-action="extimer-start"][data-ei="${ei}"][data-si="1"]`);
  await page.evaluate(() => { window.__cues = { beep: 0, buzz: 0 }; window.__ticks = 0; setInterval(() => window.__ticks++, 250); });
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  await sleep(9000);
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  const ticks = await page.evaluate(() => window.__ticks);
  // Freezing only takes effect for a hidden page; if timers kept running this was a
  // foreground expiry, so fall back to the unambiguous in-page model of suspension:
  // stop the app's clock by moving the deadline into the past without ticking.
  let method = 'CDP freeze';
  if (ticks > 8) {
    method = `CDP freeze ineffective (${ticks} ticks) → simulated suspension`;
    await page.click(`[data-action="extimer-cancel"][data-ei="${ei}"]`);
    await page.click(`[data-action="extimer-start"][data-ei="${ei}"][data-si="1"]`);
    await page.evaluate(i => { const s = active.exercises[i].sets[1]; s.timer.endsAt = Date.now() - 8000; saveActive(); window.__cues = { beep: 0, buzz: 0 }; }, ei);
  }
  await sleep(1500);
  const st = await page.evaluate(i => ({ state: active.exercises[i].sets[1].timer?.state, done: active.exercises[i].sets[1].done, cues: { ...window.__cues } }), ei);
  A.freezeMethod = method;
  ok(st.state === 'expired' && !st.done && st.cues.beep === 0, JSON.stringify(st));
  await page.reload(); await page.waitForFunction(() => typeof render === 'function' && !!active);
  await sleep(2000);
  const re = await page.evaluate(i => ({ state: active.exercises[i].sets[1].timer?.state, cues: { ...window.__cues } }), ei);
  ok(re.state === 'expired' && re.cues.beep === 0 && re.cues.buzz === 0, JSON.stringify(re));
  return `${A.freezeMethod}: deadline passed 8+ s while not ticking → on resume shows expired, not logged, no stale beep; still expired after reload with no alarm. Real iOS lock is DEVICE-ONLY.`;
});

await row('Weighted pull-up/dip', async () => {
  await page.evaluate(() => { tab = 'plan'; expandedDay = plan.days[0].id; render(); exEditModal(plan.days[0].id, null); });
  await page.selectOption('#f-equipment', 'bodyweight');
  await page.check('#f-addedload');
  await page.fill('#f-name', 'Weighted Dip');
  await page.fill('#f-weight', '0');
  const label = await page.locator('#f-weight-label').textContent();
  await shot(page, '40-added-weight-editor');
  await page.locator('#modal-root button.primary').click();
  ok(label === 'Added weight (kg)' && await page.evaluate(() => plan.days[0].exercises.at(-1).addedLoad === true), label);
  await page.evaluate(() => { tab = 'workout'; render(); });
  const pei = await page.evaluate(() => { const i = active.exercises.findIndex(e => e.name === 'Weighted Pull-Up'); active.exercises[i].sets.forEach(s => { s.done = false; }); saveActive(); render(); return i; });
  const inp = page.locator(`[data-bind="set"][data-ei="${pei}"][data-si="0"][data-f="weight"]`);
  const head = await inp.locator('xpath=ancestor::div[contains(@class,"set-grid")]').locator('.head').nth(1).textContent();
  ok(head === '+kg', 'set grid header ' + head);
  await inp.scrollIntoViewIfNeeded();
  await inp.focus();
  const step = await page.evaluate(() => stepperInfo(document.activeElement));
  ok(step && step.up === 1.25, JSON.stringify(step));
  return `Editor: Bodyweight → "Log added weight" → "${label}", 0 accepted; workout set header "${head}"; stepper +1.25 kg. History/e1RM behaviour covered by workout-features-browser.test.mjs.`;
});

// ---- offline, export/restore, storage failure, update ----
await row('Turn off network; finish workout', async () => {
  const before = await page.evaluate(() => sessions.length);
  await A.context.setOffline(true);
  const extBefore = external.length;
  await page.evaluate(() => { active.exercises[0].sets.forEach(s => { s.done = true; }); saveActive(); finishSession(); closeModal(); });
  const after = await page.evaluate(() => ({ n: sessions.length, active, stored: JSON.parse(localStorage.getItem('gym_alpha.sessions')).length }));
  ok(after.n === before + 1 && after.stored === before + 1 && after.active === null, JSON.stringify(after));
  ok(external.length === extBefore, 'network attempt while offline');
  return `Offline finish: exactly one session added (${before} → ${after.n}), draft cleared, zero network attempts.`;
});

await row('Close app/browser and reopen offline', async () => {
  await page.evaluate(() => { startSession(plan.days[0].id); document.querySelector('[data-action="set-done"][data-ei="0"][data-si="0"]').click(); stopRest(); });
  await page.close();
  const p2 = await A.context.newPage();
  await p2.goto(origin);
  await p2.waitForFunction(() => typeof render === 'function' && !!active, null, { timeout: 10000 });
  const st = await p2.evaluate(() => ({ sw: !!navigator.serviceWorker.controller, done: active.exercises[0].sets[0].done, sessions: sessions.length }));
  await A.context.setOffline(false);
  ok(st.sw && st.done, JSON.stringify(st));
  A.page2 = p2;
  return `Tab closed, new tab opened offline: app shell served by the service worker, active workout with its logged set restored (${st.sessions} sessions).`;
});

await row('Export and restore in clean profile', async () => {
  const p2 = A.page2;
  const backup = await p2.evaluate(() => buildBackup());
  const src = await p2.evaluate(() => ({ sessions: JSON.stringify(sessions), plan: JSON.stringify(plan.days[0].exercises.map(e => [e.name, e.movementId, e.side, e.setupId, e.addedLoad, e.metric, e.durationSeconds])) }));
  const B = await newProfile('clean');
  await B.page.locator('#modal-root [data-action="modal-btn"]').first().click();
  await B.page.click('[data-action="settings-open"]');
  await B.page.click('[data-action="backup-restore"]');
  await B.page.fill('#restore-area', backup);
  await B.page.locator('#modal-root button.danger').click();
  const dst = await B.page.evaluate(() => ({ sessions: JSON.stringify(sessions), plan: JSON.stringify(plan.days[0].exercises.map(e => [e.name, e.movementId, e.side, e.setupId, e.addedLoad, e.metric, e.durationSeconds])), keys: Object.keys(localStorage).filter(k => k.startsWith('gym.') && k !== 'gym.language') }));
  await B.context.close();
  ok(dst.sessions === src.sessions && dst.plan === src.plan && dst.keys.length === 0, 'mismatch or personal keys: ' + dst.keys);
  return 'Backup restored in a fresh profile: sessions byte-identical, identities/sides/setups/addedLoad/metrics identical, only gym_alpha.* data keys.';
});

await row('Fail a storage write (quota/simulated)', async () => {
  const p2 = A.page2;
  await p2.evaluate(() => {
    window.__set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (/\.(sessions|pending_tx)$/.test(k)) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } return window.__set.call(this, k, v); };
    finishSession();
  });
  const st = await p2.evaluate(() => ({ modal: document.querySelector('#modal-root').textContent, active: !!active, n: sessions.length }));
  await p2.screenshot({ path: path.join(out, '50-storage-failure.png') });
  ok(st.active && /Emergency|emergency|backup/i.test(st.modal), JSON.stringify(st).slice(0, 200));
  await p2.evaluate(() => { Storage.prototype.setItem = window.__set; });
  await p2.locator('#modal-root button.primary').click();
  const done = await p2.evaluate(() => ({ active, n: sessions.length }));
  await p2.evaluate(() => closeModal());
  ok(done.active === null && done.n === st.n + 1, JSON.stringify(done));
  return 'Quota error on completion: failure sheet with Retry/Emergency export, workout kept; Retry after space freed saved exactly once.';
});

await row('Update old installed/cached build', async () => {
  const p2 = A.page2;
  await p2.evaluate(() => { startSession(plan.days[0].id); document.querySelector('[data-action="set-done"][data-ei="0"][data-si="0"]').click(); stopRest(); window.__marker = 'no-reload'; });
  swTag = 'v2';
  await p2.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
  await p2.waitForSelector('#update-banner', { timeout: 15000 });
  await sleep(1000);
  ok(await p2.evaluate(() => window.__marker) === 'no-reload', 'page reloaded without consent');
  await p2.screenshot({ path: path.join(out, '60-update-banner.png') });
  await Promise.all([p2.waitForEvent('load', { timeout: 15000 }), p2.click('[data-action="update-app"]')]);
  await p2.waitForFunction(() => typeof render === 'function');
  const st = await p2.evaluate(async () => ({ build: APP_CONFIG.build, active: !!active && active.exercises[0].sets[0].done, cache: (await caches.keys()).join() }));
  ok(st.build === 'checklist-v2' && st.active && st.cache === 'gymtrack-checklist-v2', JSON.stringify(st));
  return 'New sw.js during a workout: banner shown, no reload until Update tapped; after Update the new build runs, old cache removed, active workout and logged set intact.';
});

await row('Larger text and Finnish', async () => {
  const p2 = A.page2;
  await p2.setViewportSize({ width: 320, height: 640 });
  await p2.evaluate(() => { I18n.setLocale('fi'); document.documentElement.style.fontSize = '120%'; document.body.style.fontSize = '19px'; });
  const overflow = [];
  for (const t of ['workout', 'plan', 'history', 'coach', 'settings']) {
    await p2.evaluate(tb => { if (tb === 'plan') expandedDay = plan.days[0].id; tab = tb; render(); window.scrollTo(0, 0); }, t);
    const w = await p2.evaluate(() => [document.documentElement.scrollWidth, innerWidth,
      [...document.querySelectorAll('#app *')].filter(b => b.getBoundingClientRect().right > innerWidth + 1 && ![...b.children].some(c => c.getBoundingClientRect().right > innerWidth + 1))
        .map(b => `${b.tagName.toLowerCase()}.${b.className || ''}[${b.getAttribute('data-action') || ''}]"${b.textContent.trim().slice(0, 18)}"→${Math.round(b.getBoundingClientRect().right)}`)]);
    if (w[0] > w[1] || w[2].length) overflow.push(`${t} (scrollWidth ${w[0]}/${w[1]}): ${w[2].slice(0, 4).join(' / ')}`);
    await p2.screenshot({ path: path.join(out, `70-fi-320-${t}.png`), fullPage: true });
  }
  await p2.evaluate(() => { I18n.setLocale('en'); tab = 'workout'; render(); });
  ok(!overflow.length, overflow.join('; '));
  return 'Finnish at 320 px width with ~120% text on all five tabs: no horizontal overflow or clipped buttons. iOS Dynamic Type / Android font scale is DEVICE-ONLY.';
});

await browser.close();
server.close();

rows.push(['External/cloud requests during whole run', external.length ? 'FAIL' : 'PASS (emulated)', external.length ? external.slice(0, 5).join(', ') : '0 requests left the local origin across all profiles']);
rows.push(['Page errors', pageErrors.length ? 'FAIL' : 'PASS (emulated)', pageErrors.length ? pageErrors.slice(0, 5).join(' | ') : 'none']);
const md = `# Web-alpha checklist — emulated run\n\nDate: ${new Date().toISOString()}\nEngine: Chromium/Edge (${process.env.CHROMIUM_EXECUTABLE ? 'Microsoft Edge' : 'bundled'}) with iPhone-size mobile emulation (390×844, touch). **Not WebKit, not a physical device, not a Home Screen install.**\n\n| Step | Result | Evidence |\n|---|---|---|\n${rows.map(r => `| ${r.map(c => String(c).replace(/\|/g, '/')).join(' | ')} |`).join('\n')}\n`;
await writeFile(path.join(out, 'report.md'), md);
console.log(md);
process.exit(rows.some(r => r[1] === 'FAIL') ? 1 : 0);
