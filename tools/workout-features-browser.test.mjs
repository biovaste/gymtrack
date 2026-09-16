/*
 * workout-features-browser.test.mjs — browser checks for exercise reordering, the
 * exercise timer for time-prescribed sets and bodyweight exercises with added load.
 *
 * Runs the shipped app in an isolated headless profile with synthetic data, a fake
 * clock, service workers blocked and every non-local request recorded (and aborted).
 * Covers athlete-alpha (default, fail-closed) and personal mode.
 *
 *   PLAYWRIGHT_MODULE=<path> CHROMIUM_EXECUTABLE=<path> node --test tools/workout-features-browser.test.mjs
 *
 * Skips when Playwright is unavailable. Desktop Chromium emulation does not replace
 * physical iPhone/Android checks (docs/phase-1-device-checklist.md).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const shots = path.join(root, 'tmp', 'workout-features');

function loadPlaywright() {
  for (const mod of [process.env.PLAYWRIGHT_MODULE, 'playwright'].filter(Boolean)) {
    try { return require(mod); } catch (e) {}
  }
  return null;
}

const FILES = ['index.html', 'app-config.js', 'app.js', 'workout-model.js', 'exercise-library.js', 'styles.css', 'i18n.js',
  'exercises.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png', 'locales/catalog.js'];

function serve(mode) {
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!FILES.includes(file)) { res.writeHead(404); res.end(); return; }
    let body = await readFile(path.join(root, file));
    if (file === 'app-config.js') body = `window.GYM_CONFIG = { mode: '${mode}', version: 'test', alphaVersion: '0.1.0-alpha-test', build: 'test' };`;
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(file)];
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Synthetic plan: a superset in the middle, a timed plank, an added-load pull-up.
const PLAN = {
  type: 'workout-plan', version: 1, name: 'Synthetic block',
  days: [{ name: 'Day X', exercises: [
    { name: 'Weighted Pull-Up', movementId: 'pull-up', equipment: 'bodyweight', addedLoad: true, weight: 10, sets: 2, reps: '6', restSeconds: 90,
      alternates: [{ name: 'Lat Pulldown', equipment: 'cable', weight: 50 }, { name: 'Weighted Chin-Up', addedLoad: true, weight: 7.5 }] },
    { name: 'Ring Dip', equipment: 'bodyweight', weight: 0, sets: 1, reps: '8', restSeconds: 30, superset: 'A' },
    { name: 'Face Pull', equipment: 'cable', weight: 20, sets: 1, reps: '12', restSeconds: 45, superset: 'A', side: 'bilateral', setupId: 'Cable 2' },
    { name: 'Plank', metric: 'duration', equipment: 'bodyweight', durationSeconds: 20, sets: 2, restSeconds: 40 },
    { name: 'Bench Press', weight: 60, sets: 1, reps: '5', restSeconds: 120 }
  ] }]
};

async function openApp(browser, mode) {
  const server = await serve(mode);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'en-GB', hasTouch: true });
  const external = [];
  context.on('request', r => { if (!r.url().startsWith(origin)) external.push(r.url()); });
  await context.route(url => !String(url).startsWith(origin), route => route.abort());
  await context.addInitScript(prefix => {
    localStorage.setItem(prefix + 'onboarded', 'true');
    if (!localStorage.getItem(prefix + 'settings')) localStorage.setItem(prefix + 'settings', JSON.stringify({ unit: 'kg', sound: true, vibrate: true, autoSync: false }));
    // No real audio in CI: the timer must fall back to its tick cue, which is counted below.
    window.AudioContext = undefined; window.webkitAudioContext = undefined;
    window.__cues = { beep: 0, buzz: 0 };
    addEventListener('DOMContentLoaded', () => {
      const origBeep = window.beep, origBuzz = window.buzz;
      window.beep = (...a) => { window.__cues.beep++; return origBeep(...a); };
      window.buzz = (...a) => { window.__cues.buzz++; return origBuzz(...a); };
    });
  }, mode === 'alpha' ? 'gym_alpha.' : 'gym.');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-09-16T08:00:00Z') });
  await page.goto(mode === 'personal' ? `${origin}/?mode=personal` : origin);
  await page.waitForFunction(() => typeof render === 'function' && document.querySelector('#app').innerHTML.length > 0);
  await page.evaluate(p => { I18n.setLocale('en'); plan = normalizePlan(p); savePlan(); tab = 'workout'; render(); }, PLAN);
  return { server, context, page, external, errors, origin };
}
const reorderUnits = (page, list) => page.$$eval(`[data-reorder-list="${list}"] > [data-reorder-unit]`, us => us.map(u => u.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)));
const names = (page, expr) => page.evaluate(`(${expr}).map(e => e.name).join(' | ')`);
async function failWrites(page, suffix) {
  await page.evaluate(sfx => {
    window.__setItem = window.__setItem || localStorage.setItem.bind(localStorage);
    Storage.prototype.setItem = function (k, v) { if (k.endsWith(sfx)) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } return window.__setItem(k, v); };
  }, suffix);
}
async function restoreWrites(page) {
  await page.evaluate(() => { Storage.prototype.setItem = function (k, v) { return window.__setItem(k, v); }; });
}
async function mouseDrag(page, fromSel, toY) {
  const box = await page.locator(fromSel).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + (toY - box.y - box.height / 2) * i / 8);
  await page.mouse.up();
}
// Synthetic touch pointer sequence (pointerType 'touch') against the real handlers.
async function touchDrag(page, sel, toY, { holdMs, moveEarly = false } = {}) {
  const box = await page.locator(sel).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const fire = (type, cy) => page.evaluate(([s, type, x, cy]) => {
    const target = type === 'pointerdown' ? document.querySelector(s) : document;
    target.dispatchEvent(new PointerEvent(type, { pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: x, clientY: cy, bubbles: true, cancelable: true, button: 0 }));
  }, [sel, type, x, cy]);
  await fire('pointerdown', y);
  if (moveEarly) await fire('pointermove', y + 40);
  await page.clock.runFor(holdMs);
  for (let i = 1; i <= 6; i++) await fire('pointermove', y + (toY - y) * i / 6);
  await fire('pointerup', toY);
}

async function reorderScenario(page, mode) {
  const prefix = mode === 'alpha' ? 'gym_alpha.' : 'gym.';
  // ---- plan editor: accessible buttons move whole groups and persist ----
  await page.evaluate(() => { tab = 'plan'; expandedDay = plan.days[0].id; render(); });
  assert.deepEqual((await reorderUnits(page, 'plan')).length, 4, 'superset renders as one reorder unit');
  const dayId = await page.evaluate(() => plan.days[0].id);
  await page.click(`[data-action="ex-move"][data-scope="plan"][data-i="1"][data-dir="1"]`); // Ring Dip (superset A) down
  assert.equal(await names(page, 'plan.days[0].exercises'), 'Weighted Pull-Up | Plank | Ring Dip | Face Pull | Bench Press');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.i), '2', 'focus follows the moved control');
  const stored = await page.evaluate(k => JSON.parse(localStorage.getItem(k)).days[0].exercises.map(e => e.name).join(' | '), prefix + 'plan');
  assert.equal(stored, 'Weighted Pull-Up | Plank | Ring Dip | Face Pull | Bench Press', 'plan order persisted');
  // keyboard on the handle
  await page.focus(`[data-reorder-handle][data-scope="plan"][data-i="4"]`);
  await page.keyboard.press('ArrowUp');
  assert.equal(await names(page, 'plan.days[0].exercises'), 'Weighted Pull-Up | Plank | Bench Press | Ring Dip | Face Pull');
  // mouse drag Bench Press (index 2) above the first unit
  const firstTop = (await page.locator('[data-reorder-list="plan"] > [data-reorder-unit]').first().boundingBox()).y;
  await mouseDrag(page, `[data-reorder-handle][data-scope="plan"][data-i="2"]`, firstTop + 4);
  assert.equal(await names(page, 'plan.days[0].exercises'), 'Bench Press | Weighted Pull-Up | Plank | Ring Dip | Face Pull');
  assert.equal(await page.locator('.drag-preview, .drop-indicator').count(), 0, 'preview and indicator are cleaned up');
  // failed save restores the prior order and says so
  await failWrites(page, '.plan');
  await page.click(`[data-action="ex-move"][data-scope="plan"][data-i="0"][data-dir="1"]`);
  await restoreWrites(page);
  assert.equal(await names(page, 'plan.days[0].exercises'), 'Bench Press | Weighted Pull-Up | Plank | Ring Dip | Face Pull', 'failed plan save restores order');
  assert.match(await page.locator('#toast-root').textContent(), /Order not saved/);
  assert.equal(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).days[0].exercises[0].name, prefix + 'plan'), 'Bench Press');
  await page.clock.runFor(3000);
  // put the plan back in authoring order for the session checks
  await page.evaluate(([p]) => { plan = normalizePlan(p); savePlan(); }, [PLAN]);

  // ---- active workout: identity, completed sets, expanded state and plan isolation ----
  await page.evaluate(() => { tab = 'workout'; render(); startSession(plan.days[0].id); });
  await page.click('[data-action="set-done"][data-ei="0"][data-si="0"]');
  await page.click('[data-action="set-done"][data-ei="0"][data-si="1"]');
  await page.evaluate(() => { stopRest(); active.exercises[0].notes = 'belt 10'; saveActive(); window.__pullUp = active.exercises[0]; });
  await page.evaluate(() => { exExpanded.add(active.exercises[0]); render(); }); // re-expanded completed card
  await page.click('[data-action="ex-move"][data-scope="session"][data-i="0"][data-dir="1"]');
  assert.equal(await names(page, 'active.exercises'), 'Ring Dip | Face Pull | Weighted Pull-Up | Plank | Bench Press', 'moves past the whole superset');
  const identity = await page.evaluate(() => ({ same: active.exercises[2] === window.__pullUp, done: active.exercises[2].sets.every(s => s.done), notes: active.exercises[2].notes,
    movementId: active.exercises[2].movementId, addedLoad: active.exercises[2].addedLoad, expanded: exExpanded.has(active.exercises[2]) }));
  assert.deepEqual(identity, { same: true, done: true, notes: 'belt 10', movementId: 'pull-up', addedLoad: true, expanded: true });
  assert.equal(await page.locator('[data-action="set-done"][data-ei="2"]').count(), 2, 'expanded card now renders at its new index');
  assert.equal(await names(page, 'plan.days[0].exercises'), 'Weighted Pull-Up | Ring Dip | Face Pull | Plank | Bench Press', 'workout reorder leaves the plan alone');
  // superset dragged by mouse to the end; internal order kept
  const lastBottom = (await page.locator('[data-reorder-list="session"] > [data-reorder-unit]').last().boundingBox());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('[data-reorder-list="session"] > [data-reorder-unit]').last().scrollIntoViewIfNeeded();
  const lb = await page.locator('[data-reorder-list="session"] > [data-reorder-unit]').last().boundingBox();
  await page.locator('.superset-head [data-reorder-handle]').scrollIntoViewIfNeeded();
  const lb2 = await page.locator('[data-reorder-list="session"] > [data-reorder-unit]').last().boundingBox();
  if (lb2.y + lb2.height - 2 < 844 - 150) await mouseDrag(page, '.superset-head [data-reorder-handle]', lb2.y + lb2.height - 2);
  else {
    // The drop zone is inside the autoscroll band on this viewport: use the keyboard path instead.
    for (let i = 0; i < 3; i++) { await page.focus(`[data-reorder-handle][data-scope="session"][data-i="${await page.evaluate(() => active.exercises.findIndex(e => e.name === 'Ring Dip'))}"]`); await page.keyboard.press('ArrowDown'); }
  }
  assert.equal(await names(page, 'active.exercises'), 'Weighted Pull-Up | Plank | Bench Press | Ring Dip | Face Pull');
  void lastBottom; void lb;
  // touch: hold then move reorders; moving before the hold does not
  await page.evaluate(() => window.scrollTo(0, 0));
  const top0 = (await page.locator('[data-reorder-list="session"] > [data-reorder-unit]').first().boundingBox()).y;
  await touchDrag(page, `[data-reorder-handle][data-scope="session"][data-i="1"]`, top0 + 4, { holdMs: 150, moveEarly: true });
  assert.equal(await names(page, 'active.exercises'), 'Weighted Pull-Up | Plank | Bench Press | Ring Dip | Face Pull', 'moving before the hold is a scroll, not a drag');
  await touchDrag(page, `[data-reorder-handle][data-scope="session"][data-i="1"]`, top0 + 4, { holdMs: 400 });
  assert.equal(await names(page, 'active.exercises'), 'Plank | Weighted Pull-Up | Bench Press | Ring Dip | Face Pull', 'press-and-hold drag reorders');
  // pressing inside an input never starts a drag
  await page.locator('[data-bind="set"]').first().dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 5 });
  assert.equal(await page.evaluate(() => drag), null);
  // failed save during a workout reorder
  await failWrites(page, '.active');
  await page.click('[data-action="ex-move"][data-scope="session"][data-i="0"][data-dir="1"]');
  await restoreWrites(page);
  assert.equal(await names(page, 'active.exercises'), 'Plank | Weighted Pull-Up | Bench Press | Ring Dip | Face Pull', 'failed workout save restores order');
  assert.equal(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).exercises.map(e => e.name).join(' | '), prefix + 'active'),
    'Plank | Weighted Pull-Up | Bench Press | Ring Dip | Face Pull');
  // order survives reload
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function' && !!active);
  assert.equal(await names(page, 'active.exercises'), 'Plank | Weighted Pull-Up | Bench Press | Ring Dip | Face Pull');
  await page.screenshot({ path: path.join(shots, `${mode}-reordered-workout.png`), fullPage: true });
  await page.evaluate(() => { endSession(); render(); });
}

async function timerScenario(page, mode) {
  const prefix = mode === 'alpha' ? 'gym_alpha.' : 'gym.';
  await page.evaluate(() => { tab = 'workout'; render(); startSession(plan.days[0].id); });
  const plankEi = await page.evaluate(() => active.exercises.findIndex(e => e.name === 'Plank'));
  const benchEi = await page.evaluate(() => active.exercises.findIndex(e => e.name === 'Bench Press'));
  const cues = () => page.evaluate(() => ({ ...window.__cues }));
  const timer = si => page.evaluate(([ei, si]) => active.exercises[ei].sets[si].timer || null, [plankEi, si]);
  // untimed logging still starts rest exactly as before; the exercise timer then supersedes that rest
  await page.click(`[data-action="set-done"][data-ei="${benchEi}"][data-si="0"]`);
  assert.equal(await page.evaluate(() => !!rest), true);
  assert.equal(await page.locator('[data-action="extimer-start"]').count(), 2, 'one start action per timed set, none on load sets');
  await page.click(`[data-action="extimer-start"][data-ei="${plankEi}"][data-si="0"]`);
  assert.equal(await page.evaluate(() => rest), null, 'starting the exercise timer ends the running rest');
  assert.equal((await timer(0)).state, 'running');
  await page.clock.runFor(6000);
  // The display ticks on the app's 1 s interval, which is not phase-aligned to the start.
  assert.match(await page.locator(`[data-extimer-clock="${plankEi}-0"]`).textContent(), /^0:1[45]$/);
  await page.click(`[data-action="extimer-pause"][data-ei="${plankEi}"]`);
  await page.clock.runFor(30000);
  assert.equal((await timer(0)).state, 'paused', 'a pause does not expire');
  assert.equal(Math.round((await timer(0)).remainingMs / 1000), 14);
  await page.click(`[data-action="extimer-reset"][data-ei="${plankEi}"]`);
  assert.equal((await timer(0)).remainingMs, 20000, 'reset returns to the full target without starting');
  await page.click(`[data-action="extimer-resume"][data-ei="${plankEi}"]`);
  await page.clock.runFor(5000);
  // reload mid-countdown: the persisted deadline neither resets nor stretches
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function' && !!active);
  await page.clock.runFor(1000);
  assert.equal((await timer(0)).state, 'running');
  assert.match(await page.locator(`[data-extimer-clock="${plankEi}-0"]`).textContent(), /^0:1[45]$/);
  assert.equal(await page.locator('[data-extimer-clock]').count(), 1);
  // expiry while typing elsewhere: focus (and the phone keyboard) must survive
  await page.focus('[data-bind="session-notes"]');
  const focusedBefore = await page.evaluate(() => document.activeElement && document.activeElement.outerHTML.slice(0, 80));
  // expiry: one audible cue and vibration, visible finish, nothing logged, no rest
  await page.clock.runFor(15000);
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.outerHTML.slice(0, 80)), focusedBefore, 'expiry does not steal focus');
  const t = await timer(0);
  assert.equal(t.state, 'expired');
  assert.deepEqual(await cues(), { beep: 1, buzz: 1 }, 'exactly one alarm');
  assert.equal(await page.evaluate(ei => active.exercises[ei].sets[0].done, plankEi), false, 'expiry never completes the set');
  assert.equal(await page.evaluate(ei => active.exercises[ei].sets[0].durationSeconds, plankEi), 20, 'expiry never invents a measurement');
  assert.equal(await page.evaluate(() => rest), null, 'expiry does not start rest');
  assert.match(await page.locator('.ex-timer.expired').textContent(), /Time's up/);
  await page.screenshot({ path: path.join(shots, `${mode}-timer-expired.png`) });
  await page.clock.runFor(120000);
  await page.reload();
  await page.waitForFunction(() => typeof render === 'function' && !!active);
  await page.clock.runFor(3000);
  assert.deepEqual(await cues(), { beep: 0, buzz: 0 }, 'no stale alarm after returning');
  assert.equal((await timer(0)).state, 'expired', 'finished state is shown after reload');
  // edit before logging is still possible; Log writes the elapsed time and starts rest
  await page.click(`[data-action="extimer-log"][data-ei="${plankEi}"]`);
  const logged = await page.evaluate(ei => ({ ...active.exercises[ei].sets[0] }), plankEi);
  assert.deepEqual({ done: logged.done, d: logged.durationSeconds, timer: logged.timer }, { done: true, d: 20, timer: undefined });
  assert.equal(await page.evaluate(() => !!rest && rest.total), 40, 'rest starts only when the set is logged');
  // backgrounded past the deadline: shown as finished without sounding a stale alarm
  await page.click(`[data-action="extimer-start"][data-ei="${plankEi}"][data-si="1"]`);
  assert.equal(await page.evaluate(() => rest), null);
  await page.clock.setSystemTime(Date.parse('2026-09-16T09:30:00Z'));
  await page.clock.runFor(1000);
  assert.equal((await timer(1)).state, 'expired');
  assert.deepEqual(await cues(), { beep: 0, buzz: 1 }, 'late discovery is visual only (the buzz is the earlier set-log haptic)');
  // cancel removes it without logging; a later deadline never sounds
  await page.click(`[data-action="extimer-cancel"][data-ei="${plankEi}"][data-si="1"]`);
  assert.equal(await timer(1), null);
  await page.click(`[data-action="extimer-start"][data-ei="${plankEi}"][data-si="1"]`);
  await page.clock.runFor(4000);
  // logging a different set ends the exercise timer before its rest starts
  await page.click(`[data-action="ex-toggle"][data-ei="${benchEi}"]`); // completed card: expand it (by object) first
  await page.click(`[data-action="set-add"][data-ei="${benchEi}"]`);
  await page.click(`[data-action="set-done"][data-ei="${benchEi}"][data-si="1"]`);
  assert.equal(await timer(1), null, 'logging any set ends the exercise timer');
  assert.equal(await page.evaluate(() => !!rest), true);
  await page.clock.runFor(30000);
  assert.deepEqual(await cues(), { beep: 0, buzz: 2 }, 'only the two set-log haptics; the ended timer never alarms');
  // Log with nothing elapsed is refused rather than writing 0
  await page.click(`[data-action="extimer-start"][data-ei="${plankEi}"][data-si="1"]`);
  await page.click(`[data-action="extimer-log"][data-ei="${plankEi}"]`);
  assert.equal(await page.evaluate(ei => active.exercises[ei].sets[1].done, plankEi), false);
  // failed save when starting leaves no timer behind
  await page.click(`[data-action="extimer-cancel"][data-ei="${plankEi}"]`);
  await failWrites(page, '.active');
  await page.click(`[data-action="extimer-start"][data-ei="${plankEi}"][data-si="1"]`);
  await restoreWrites(page);
  assert.equal(await timer(1), null, 'failed start is rolled back');
  assert.equal(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).exercises.some(e => e.sets.some(s => s.timer)), prefix + 'active'), false);
  // reorder and discard with a running timer
  await page.click(`[data-action="extimer-start"][data-ei="${plankEi}"][data-si="1"]`);
  await page.click(`[data-action="ex-move"][data-scope="session"][data-i="${plankEi}"][data-dir="1"]`);
  const moved = await page.evaluate(() => { const f = findExerciseTimer(); return f && [f.e.name, f.si, f.t.state]; });
  assert.deepEqual(moved, ['Plank', 1, 'running'], 'the timer moves with its exercise');
  await page.evaluate(() => { finishSession(); });
  const record = await page.evaluate(() => sessions.at(-1));
  assert.equal(JSON.stringify(record).includes('timer'), false, 'no timer state in the session record');
  assert.deepEqual(record.exercises.find(e => e.name === 'Plank').sets, [{ weight: 0, durationSeconds: 20, rpe: null }]);
  await page.evaluate(() => closeModal());
  await page.clock.runFor(60000);
  assert.deepEqual(await cues(), { beep: 1, buzz: 2 }, 'finish cue only; the unlogged timer is gone with the workout');
}

async function addedLoadScenario(page, mode) {
  // ---- plan editor: option only for bodyweight load exercises; labels and validation ----
  await page.evaluate(() => { tab = 'plan'; expandedDay = plan.days[0].id; render(); exEditModal(plan.days[0].id, null); });
  assert.equal(await page.locator('#f-addedload-row').isHidden(), true, 'hidden for barbell');
  await page.selectOption('#f-equipment', 'bodyweight');
  assert.equal(await page.locator('#f-addedload-row').isVisible(), true);
  await page.check('#f-addedload');
  assert.match(await page.locator('#f-weight-label').textContent(), /Added weight \(kg\)/);
  await page.fill('#f-name', 'Weighted Dip');
  await page.fill('#f-weight', '-5');
  await page.click('.sheet .actions button.primary');
  assert.match(await page.locator('#toast-root').textContent(), /cannot be negative/);
  await page.fill('#f-weight', '11.25');
  await page.click('.sheet .actions button.primary');
  const dip = await page.evaluate(() => plan.days[0].exercises.at(-1));
  assert.deepEqual([dip.name, dip.equipment, dip.addedLoad, dip.weight], ['Weighted Dip', 'bodyweight', true, 11.25], 'off the barbell ladder is fine for added load');
  await page.evaluate(() => { const i = plan.days[0].exercises.length - 1; exEditModal(plan.days[0].id, i); });
  await page.uncheck('#f-addedload');
  await page.fill('#f-weight', '0');
  await page.click('.sheet .actions button.primary');
  assert.equal('addedLoad' in (await page.evaluate(() => plan.days[0].exercises.at(-1))), false, 'unchecking removes the flag');
  // plain bodyweight still refuses load
  await page.evaluate(() => { const i = plan.days[0].exercises.length - 1; exEditModal(plan.days[0].id, i); });
  await page.fill('#f-weight', '10');
  await page.click('.sheet .actions button.primary');
  assert.match(await page.locator('#toast-root').textContent(), /must be 0|0/);
  await page.evaluate(() => { closeModal(); plan.days[0].exercises.pop(); savePlan(); render(); });
  await page.clock.runFor(3000);

  // ---- legacy bodyweight history is never merged or reinterpreted ----
  await page.evaluate(() => {
    sessions = [{ id: 'legacy-bw', date: '2026-09-01T08:00:00.000Z', dayName: 'Old', durationMin: 30, exercises: [
      { name: 'Weighted Pull-Up', movementId: 'pull-up', equipment: 'bodyweight', metric: 'load', sets: [{ weight: 0, reps: 12, rpe: 8 }] }] }];
    saveSessions();
  });
  // ---- session: +kg column, 1.25 kg stepper, logging and metrics ----
  await page.evaluate(() => { tab = 'workout'; render(); startSession(plan.days[0].id); });
  assert.equal(await page.locator('.set-grid .head').nth(1).textContent(), '+kg');
  await page.focus('[data-bind="set"][data-ei="0"][data-si="0"][data-f="weight"]');
  const step = await page.evaluate(() => stepperInfo(document.activeElement));
  assert.deepEqual([step.up, step.down], [1.25, 1.25]);
  await page.locator('#stepper-bar [data-step="1"]').dispatchEvent('pointerdown');
  assert.equal(await page.evaluate(() => active.exercises[0].sets[0].weight), 11.25);
  await page.fill('[data-bind="set"][data-ei="0"][data-si="1"][data-f="weight"]', '0');
  for (const si of [0, 1]) await page.click(`[data-action="set-done"][data-ei="0"][data-si="${si}"]`);
  await page.click('[data-action="set-done"][data-ei="4"][data-si="0"]');
  await page.evaluate(() => finishSession());
  await page.evaluate(() => closeModal());
  const rec = await page.evaluate(() => sessions.at(-1).exercises[0]);
  assert.deepEqual([rec.addedLoad, rec.movementId, rec.sets.map(s => s.weight)], [true, 'pull-up', [11.25, 0]], 'bodyweight-only set stays 0; body weight not added');
  const metrics = await page.evaluate(() => {
    const key = WorkoutModel.key(sessions.at(-1).exercises[0], canonicalName);
    const legacyKey = WorkoutModel.key(sessions[0].exercises[0], canonicalName);
    return { distinct: key !== legacyKey, rows: exerciseHistory(key).length, best: exerciseHistory(key)[0].e1rm, legacyRows: exerciseHistory(legacyKey).length,
      volume: weeklyStats(1)[0].volume };
  });
  assert.deepEqual(metrics, { distinct: true, rows: 1, best: 11.25, legacyRows: 1, volume: 300 }, 'history split by convention; tonnage counts only the bench');
  // a heavier added load is a PR against the same convention; first session never is
  const pr = await page.evaluate(() => detectPRs({ exercises: [{ ...sessions.at(-1).exercises[0], sets: [{ weight: 15, reps: 3 }] }] }));
  assert.deepEqual(pr, ['Weighted Pull-Up']);
  await page.evaluate(() => { tab = 'history'; historyExercise = WorkoutModel.key(sessions.at(-1).exercises[0], canonicalName); render(); });
  const historyText = await page.locator('#app').textContent();
  assert.match(historyText, /Heaviest added weight/);
  assert.match(historyText, /\+11\.25×6/);
  assert.doesNotMatch(historyText, /e1RM 11/);
  await page.screenshot({ path: path.join(shots, `${mode}-added-load-history.png`), fullPage: true });

  // ---- swaps: an alternate without the flag drops it; one declaring it keeps it ----
  await page.evaluate(() => { tab = 'workout'; render(); startSession(plan.days[0].id); });
  await page.evaluate(() => doSessionSwap(0, active.exercises[0].alternates[1]));
  assert.deepEqual(await page.evaluate(() => [active.exercises[0].name, active.exercises[0].addedLoad, active.exercises[0].sets[0].weight]), ['Weighted Chin-Up', true, 7.5]);
  await page.evaluate(() => doSessionSwap(0, active.exercises[0].alternates[0]));
  assert.deepEqual(await page.evaluate(() => [active.exercises[0].name, active.exercises[0].equipment, 'addedLoad' in active.exercises[0]]), ['Lat Pulldown', 'cable', false]);
  await page.evaluate(() => { endSession(); closeModal(); render(); });

  // ---- export, plan-only export and backup round trip keep identities and measurements ----
  const exported = await page.evaluate(() => JSON.parse(buildExport()));
  assert.match(exported.measurementNotes, /addedLoad: true/);
  const planOnly = await page.evaluate(() => JSON.parse(buildPlanExport()));
  assert.equal(planOnly.days[0].exercises[0].addedLoad, true);
  assert.equal(await page.evaluate(p => normalizePlan(p).days[0].exercises[0].addedLoad, planOnly), true);
  const backup = await page.evaluate(() => buildBackup());
  const legacy = await readFile(path.join(root, 'tools', 'fixtures', 'native', 'legacy-backup.json'), 'utf8');
  const restored = await page.evaluate(([b, legacyRaw]) => {
    restoreBackup(legacyRaw);
    const legacyShape = { planHasFlag: JSON.stringify(plan).includes('addedLoad'), sessionNote: sessions[0].notes, extension: sessions[0].extension };
    restoreBackup(b);
    const pull = plan.days[0].exercises.find(e => e.name === 'Weighted Pull-Up');
    const face = plan.days[0].exercises.find(e => e.name === 'Face Pull');
    const plank = plan.days[0].exercises.find(e => e.name === 'Plank');
    return { legacyShape, pull: [pull.addedLoad, pull.movementId, pull.alternates[1].addedLoad], face: [face.side, face.setupId, face.superset],
      plank: plank.durationSeconds, sessionAdded: sessions.at(-1).exercises[0].addedLoad, legacySession: sessions[0].exercises[0].addedLoad };
  }, [backup, legacy]);
  assert.deepEqual(restored, {
    legacyShape: { planHasFlag: false, sessionNote: 'Keep exactly', extension: { unknown: 42 } },
    pull: [true, 'pull-up', true], face: ['bilateral', 'Cable 2', 'A'], plank: 20, sessionAdded: true, legacySession: undefined
  });
  // invalid combination is refused on import rather than silently relabelled
  const refused = await page.evaluate(() => { try { normalizePlan({ days: [{ name: 'D', exercises: [{ name: 'Row', addedLoad: true, weight: 10 }] }] }); return null; } catch (e) { return e.message; } });
  assert.match(refused, /addedLoad/);
}

test('reorder, exercise timer and added load in athlete-alpha and personal modes', { timeout: 240000 }, async t => {
  const playwright = loadPlaywright();
  if (!playwright) { t.skip('Playwright not available'); return; }
  await mkdir(shots, { recursive: true });
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const executablePath = process.env.CHROMIUM_EXECUTABLE || (existsSync(edge) ? edge : undefined);
  const browser = await playwright.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    for (const mode of ['alpha', 'personal']) {
      await t.test(`${mode} mode`, async () => {
        const app = await openApp(browser, mode);
        try {
          const cfg = await app.page.evaluate(() => ({ mode: APP_CONFIG.mode, prefix: store.prefix, cloud: APP_CONFIG.cloudSync }));
          assert.equal(cfg.mode, mode);
          assert.equal(cfg.prefix, mode === 'alpha' ? 'gym_alpha.' : 'gym.');
          await reorderScenario(app.page, mode);
          await timerScenario(app.page, mode);
          await addedLoadScenario(app.page, mode);
          // Known pre-existing keys outside the data prefix: the UI language preference (i18n.js,
          // shared by both modes) and personal mode's sync UUID. Anything else is a leak.
          const outside = await app.page.evaluate(p => Object.keys(localStorage).filter(k => !k.startsWith(p) && k.startsWith('gym')), cfg.prefix);
          assert.deepEqual(outside.filter(k => k !== 'gym.language' && !(mode === 'personal' && k === 'gymtrack_uuid')), [], 'no workout data outside the mode prefix');
          assert.deepEqual(app.external, [], 'zero cloud or external requests');
          assert.deepEqual(app.errors, [], 'no page errors');
        } finally {
          await app.context.close();
          await new Promise(resolve => app.server.close(resolve));
        }
      });
    }
  } finally {
    await browser.close();
  }
});
