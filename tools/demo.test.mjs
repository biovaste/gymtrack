/*
 * demo.test.mjs — the demo layer's guarantees.
 *
 * The one that matters: demo mode cannot reach the sync Worker, and cannot
 * touch the real app's localStorage keys. Both are asserted two ways — against
 * the shipped source text (so a future call site added outside syncFetch fails
 * here) and against the layer actually running.
 *
 * Following tools/pure.test.mjs: app.js is a classic browser script with no
 * build step, so the parts under test are sliced out of the file text by name.
 *
 * Run: node --test tools/demo.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

import { validatePlan, isLoadable } from './push-plan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const appSrc = read('app.js');
const demoSrc = read('demo.js');
const dataSrc = read('demo-data.js');
const require = createRequire(import.meta.url);
const demoData = require(join(root, 'demo-data.js'));

/** Slice a top-level declaration out of a source file by its opening text. */
function slice(src, openingLine, endMarker) {
  const start = src.indexOf(openingLine);
  assert.notEqual(start, -1,
    `Could not find "${openingLine}" — it was renamed or moved. Update this test to match; do not delete it.`);
  const end = src.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Could not find the end of "${openingLine}".`);
  return src.slice(start, end + endMarker.length);
}

/* ---------- a localStorage whose data keys are its own enumerable props ---------- */
class FakeStorage {
  getItem(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : null; }
  setItem(k, v) { this[k] = String(v); }
  removeItem(k) { delete this[k]; }
}

/** Evaluate demo-data.js + demo.js in a fresh context against `storage`. */
function loadDemoLayer({ storage = new FakeStorage(), search = '?demo=1', hostname = 'localhost', fetchSpy } = {}) {
  const ctx = {
    localStorage: storage,
    location: { search, hostname },
    document: {
      createElement: () => ({ set textContent(_) {} }),
      head: { appendChild() {} },
      addEventListener() {}
    },
    console,
    fetch: fetchSpy
  };
  vm.createContext(ctx);
  vm.runInContext(dataSrc, ctx);
  vm.runInContext(demoSrc, ctx);
  return { ctx, storage };
}

/* ================= requirement 3: zero Worker traffic ================= */

test('syncFetch refuses to run in demo mode, and it is the only door to the Worker', () => {
  const fn = slice(appSrc, 'async function syncFetch(url, options = {}) {', '\n}');
  assert.match(fn, /if \(DEMO\) throw/,
    'syncFetch must short-circuit under DEMO — it is the single choke point every Worker request passes through.');

  // Any fetch() reaching WORKER_URL must go through syncFetch. A bare
  // fetch(`${WORKER_URL}…`) anywhere would bypass the guard above.
  const bypass = appSrc.match(/(?<!sync)\bfetch\(\s*`?\$\{WORKER_URL\}/g);
  assert.equal(bypass, null,
    'Every request to WORKER_URL must go through syncFetch(), which is what makes the demo unable to reach the sync API.');

  // And nothing else may name the host directly.
  const host = appSrc.match(/api\.gymtrack\.hithitpull\.fi/g) || [];
  assert.equal(host.length, 1, 'The sync host should appear exactly once, in the WORKER_URL constant.');
});

test('demo mode forces auto-sync off, and nothing can turn it back on', () => {
  assert.match(appSrc, /if \(DEMO\) settings\.autoSync = false;/,
    'autoSync must be forced off at boot: it is what stops scheduleSync() and autoSyncOnLoad() from ever firing.');
  assert.match(appSrc, /autoSync: !DEMO \};/,
    'reset-all rebuilds settings from scratch and must not re-arm sync in the demo.');
  assert.doesNotMatch(appSrc, /case 'toggle-autosync': settings\.autoSync = !settings\.autoSync;[\s\S]{0,40}\n\s*case 'share-ai'/,
    'sanity: the sync actions are still distinct cases guarded by DEMO_BLOCKED_ACTIONS.');
  for (const action of ['toggle-autosync', 'share-ai', 'restore-uuid', 'save-write-token', 'sync-retry']) {
    assert.ok(appSrc.includes(`'${action}'`), `${action} should still exist as an action`);
  }
  const blocked = slice(appSrc, 'const DEMO_BLOCKED_ACTIONS', ');');
  for (const action of ['toggle-autosync', 'share-ai', 'restore-uuid', 'save-write-token', 'sync-retry']) {
    assert.ok(blocked.includes(`'${action}'`), `${action} must be blocked in demo mode`);
  }
});

test('the demo layer itself never calls fetch while seeding', () => {
  let calls = 0;
  loadDemoLayer({ fetchSpy: (...args) => { calls++; throw new Error('unexpected fetch: ' + args[0]); } });
  assert.equal(calls, 0);
});

test('the demo files name no sync endpoint and no real identity', () => {
  for (const [name, src] of [['demo.js', demoSrc], ['demo-data.js', dataSrc]]) {
    assert.doesNotMatch(src, /api\.gymtrack/, `${name} must not reference the sync API`);
    assert.doesNotMatch(src, /gymtrack_write_token|GYMTRACK_WRITE/, `${name} must not reference the write token`);
    const uuids = src.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
    assert.equal(uuids.length, 0, `${name} must contain no UUID`);
  }
  // app.js holds one, and it is the obviously-fake placeholder.
  const uuids = appSrc.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
  assert.deepEqual(uuids, ['00000000-0000-4000-8000-000000000000']);
});

/* ================= storage isolation ================= */

test('demo mode is on for ?demo=1 and for a demo.* host, off otherwise', () => {
  assert.equal(loadDemoLayer({ search: '?demo=1', hostname: 'gymtrack.hithitpull.fi' }).ctx.GymDemo.active, true);
  assert.equal(loadDemoLayer({ search: '', hostname: 'demo.gymtrack.hithitpull.fi' }).ctx.GymDemo.active, true);
  assert.equal(loadDemoLayer({ search: '', hostname: 'gymtrack.hithitpull.fi' }).ctx.GymDemo.active, false);
  assert.equal(loadDemoLayer({ search: '?demo=0', hostname: 'localhost' }).ctx.GymDemo.active, false);
});

test('seeding writes only the demo namespace and leaves real data byte-identical', () => {
  const storage = new FakeStorage();
  // Stand in for a real user's data on the production origin, where ?demo=1
  // shares localStorage with the live app.
  storage.setItem('gym.sessions', '[{"id":"real"}]');
  storage.setItem('gym.plan', '{"name":"real plan"}');
  storage.setItem('gym.updatedAt', '1750000000000');
  storage.setItem('gymtrack_uuid', 'real-uuid');
  const before = { ...storage };

  loadDemoLayer({ storage, hostname: 'gymtrack.hithitpull.fi' });

  for (const [k, v] of Object.entries(before)) {
    assert.equal(storage.getItem(k), v, `${k} must be untouched by the demo`);
  }
  const written = Object.keys(storage).filter(k => !(k in before));
  assert.ok(written.length > 0, 'the demo should have seeded something');
  for (const k of written) assert.ok(k.startsWith('gymdemo.'), `${k} escaped the demo namespace`);
});

test('app.js reads and writes through the demo-aware key prefix', () => {
  const store = slice(appSrc, 'const store = {', '\n};');
  assert.equal((store.match(/KEY_PREFIX \+ k/g) || []).length, 3,
    'get/set/del must all use the prefix, or the demo writes into the real namespace');
  assert.doesNotMatch(store, /'gym\.'/, "the literal 'gym.' prefix must not survive inside store");
  assert.match(appSrc, /const KEY_PREFIX = DEMO \? GymDemo\.prefix : 'gym\.';/);
});

test('a reload resets state that the visitor changed', () => {
  const storage = new FakeStorage();
  loadDemoLayer({ storage });
  const seeded = storage.getItem('gymdemo.sessions');

  // The visitor logs something; writes persist normally within the visit.
  storage.setItem('gymdemo.sessions', '[]');
  storage.setItem('gymdemo.stray', '"left over"');
  assert.equal(storage.getItem('gymdemo.sessions'), '[]');

  loadDemoLayer({ storage }); // reload
  assert.equal(storage.getItem('gymdemo.sessions'), seeded, 'a reload must restore the seed');
  assert.equal(storage.getItem('gymdemo.stray'), null, 'a reload must clear demo keys the app added');
});

test('the demo never seeds an in-progress session', () => {
  const { storage } = loadDemoLayer({});
  assert.equal(storage.getItem('gymdemo.active'), null,
    'the demo should open on "Start a workout", not mid-session');
  assert.equal(JSON.parse(storage.getItem('gymdemo.settings')).autoSync, false);
  assert.equal(JSON.parse(storage.getItem('gymdemo.onboarded')), 1);
});

/* ================= the service worker ================= */

test('the demo does not register a service worker, and does not unregister one', () => {
  const fn = slice(appSrc, 'function initServiceWorkerUpdates() {', '\n}');
  assert.match(fn, /if \(DEMO\) return;/);
  assert.ok(fn.indexOf('if (DEMO) return;') < fn.indexOf('navigator.serviceWorker.register'),
    'the DEMO guard must come before registration');
  assert.doesNotMatch(appSrc, /unregister\(/,
    'unregistering would kill the real app’s worker when ?demo=1 is opened on the production origin');
});

/* ================= the seed data ================= */

test('the demo plan passes the real plan validator', () => {
  const { errors } = validatePlan(demoData.plan(), { unit: 'kg' });
  assert.deepEqual(errors, [], 'the demo plan must satisfy the same rules as a plan pushed to the phone');
});

test('every logged weight is loadable on its declared equipment', () => {
  const { sessions } = demoData.build();
  const bad = [];
  for (const s of sessions) {
    for (const e of s.exercises) {
      if (e.equipment === 'other') continue; // unclassified: no ladder to check
      for (const set of e.sets) {
        if (typeof set.weight !== 'number') continue;
        if (!isLoadable(e.equipment, e.barWeight, set.weight)) bad.push(`${e.name} ${set.weight}kg (${e.equipment})`);
      }
    }
  }
  assert.deepEqual([...new Set(bad)], [], 'a weight the gym cannot load makes the demo history a lie');
});

test('the seed is deterministic', () => {
  assert.equal(JSON.stringify(demoData.build()), JSON.stringify(demoData.build()));
});

test('the history has the shape the demo is meant to show', () => {
  const { sessions, bodyWeight } = demoData.build();
  const days = s => Date.parse(s.date) / 86400000;

  assert.ok(sessions.length >= 70 && sessions.length <= 120, `expected 4-6 months of training, got ${sessions.length} sessions`);
  const span = days(sessions.at(-1)) - days(sessions[0]);
  assert.ok(span >= 120 && span <= 190, `expected a 4-6 month span, got ${Math.round(span)} days`);

  // A deload: a week where the top weights drop hard and the RPE drops with them.
  const squat = sessions.flatMap(s => s.exercises.filter(e => e.name === 'Squat').map(e => ({ date: s.date, w: e.plannedWeight })));
  const peak = Math.max(...squat.map(x => x.w));
  assert.ok(squat.some(x => x.w < peak * 0.75), 'expected a deload week in the squat history');

  // Missed weeks: at least two gaps of 10+ days.
  // Training runs Mon/Tue/Thu/Sat, so the widest ordinary gap is 2 days; a
  // skipped week shows up as 9.
  const gaps = sessions.slice(1).map((s, i) => days(s) - days(sessions[i])).filter(g => g >= 8);
  assert.ok(gaps.length >= 2, `expected at least two missed weeks, found ${gaps.length}`);

  // A stall: the same weight for three or more consecutive sessions of a lift.
  const bench = sessions.flatMap(s => s.exercises.filter(e => e.name === 'Bench Press').map(e => e.plannedWeight));
  let run = 1, longest = 1;
  for (let i = 1; i < bench.length; i++) { run = bench[i] === bench[i - 1] ? run + 1 : 1; longest = Math.max(longest, run); }
  assert.ok(longest >= 3, 'expected at least one stall where the bar stops moving');

  // A recent PR, so the PR badges and sparklines are not all ancient history.
  const e1rm = (w, r) => (r > 0 ? w * (1 + r / 30) : w);
  const best = new Map();
  let lastPrAt = 0;
  for (const s of sessions) {
    for (const e of s.exercises) {
      if (e.metric && e.metric !== 'load') continue;
      for (const set of e.sets.filter(x => !x.warmup && x.weight > 0)) {
        const v = e1rm(set.weight, set.reps);
        if (!(best.get(e.name) >= v)) { best.set(e.name, v); lastPrAt = Math.max(lastPrAt, days(s)); }
      }
    }
  }
  assert.ok(days(sessions.at(-1)) - lastPrAt <= 14, 'the most recent PR should be within the last two weeks of the history');

  // Body weight trending gently up, not a straight line.
  assert.ok(bodyWeight.length >= 30);
  const first = bodyWeight[0].kg, last = bodyWeight.at(-1).kg;
  assert.ok(last > first && last - first < 6, `expected a gentle upward trend, got ${first} → ${last}`);
  assert.ok(new Set(bodyWeight.map(b => b.kg)).size > bodyWeight.length / 2, 'body weight should have day-to-day noise');
});
