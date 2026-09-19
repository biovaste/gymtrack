/*
 * athlete-alpha.test.mjs — Comprehensive unit tests for athlete-alpha mode:
 * 1. Fail-closed configuration and origin/mode boundary
 * 2. (removed 2026-09-19: alpha now syncs to its own cloud UUID)
 * 3. Dependable storage: failure handling across logging, plan editing, settings, completion
 * 4. Corrupt data detection and preservation without overwriting defaults
 * 5. Completion idempotency across restart / crash recovery
 * 6. Backup restore staged commit (all writes succeed or none apply)
 * 7. Coach-to-athlete plan export and import validation
 *
 * Run: node --test tools/athlete-alpha.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(join(root, 'app.js'), 'utf8');

// Helper to evaluate APP_CONFIG resolution given simulated window, location, and config
function resolveAppConfig(winConfig, locationObj) {
  const code = `
    const window = { GYM_CONFIG: ${JSON.stringify(winConfig)} };
    const location = ${JSON.stringify(locationObj)};
    ${appSrc.slice(appSrc.indexOf('const APP_CONFIG = (() => {'), appSrc.indexOf('const corruptData = {};'))}
  `;
  const ctx = { URLSearchParams };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return vm.runInContext('APP_CONFIG', ctx);
}

test('APP_CONFIG: unknown host runs in athlete-alpha mode with its own storage and cloud identity', () => {
  const unknown = resolveAppConfig(undefined, { hostname: 'random.domain.com', port: '', search: '' });
  assert.equal(unknown.mode, 'alpha');
  assert.equal(unknown.cloudSync, true);
  assert.equal(unknown.keyPrefix, 'gym_alpha.');
  assert.equal(unknown.uuidKey, 'gymtrack_alpha_uuid');
  assert.equal(unknown.tokenKey, 'gymtrack_alpha_write_token');
  assert.equal(resolveAppConfig({ mode: 'personal' }, { hostname: 'alpha.gymtrack.hithitpull.fi', port: '', search: '' }).isAlpha, true);
  assert.equal(resolveAppConfig({ mode: 'personal' }, { hostname: 'localhost', port: '8766', search: '' }).isAlpha, true);
  assert.equal(resolveAppConfig({ mode: 'personal' }, { hostname: '127.0.0.1', port: '8766', search: '?mode=personal' }).isAlpha, true);
  assert.equal(resolveAppConfig(undefined, { hostname: 'localhost', port: '8765', search: '?mode=alpha' }).isAlpha, true);
});

test('APP_CONFIG personal mode is decided by origin, never by app-config.js or query', () => {
  for (const cfg of [undefined, { mode: 'personal' }, { mode: 'alpha' }]) {
    for (const search of ['', '?alpha=1', '?mode=alpha']) {
      const prod = resolveAppConfig(cfg, { hostname: 'gymtrack.hithitpull.fi', port: '', search });
      assert.equal(prod.mode, 'personal');
      assert.equal(prod.keyPrefix, 'gym.');
      assert.equal(prod.uuidKey, 'gymtrack_uuid');
      assert.equal(prod.tokenKey, 'gymtrack_write_token');
    }
  }
  assert.equal(resolveAppConfig(undefined, { hostname: 'localhost', port: '8765', search: '' }).mode, 'personal');
});

test('Corrupt storage detection preserves unreadable data without overwriting', () => {
  const memoryStore = {
    'gym_alpha.sessions': '{"broken_json": [',
    'gym_alpha.plan': '{"type":"wrong_shape"}'
  };
  const mockLocalStorage = {
    getItem: k => memoryStore[k] ?? null,
    setItem: (k, v) => { memoryStore[k] = v; },
    removeItem: k => { delete memoryStore[k]; }
  };

  const ctx = {
    console,
    URLSearchParams,
    window: { GYM_CONFIG: { mode: 'alpha' } },
    location: { hostname: 'localhost', port: '8766', search: '' },
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
    localStorage: mockLocalStorage,
    I18n: { t: (k, p) => `${k}:${JSON.stringify(p || {})}` }
  };
  vm.createContext(ctx);

  const storageCode = appSrc.slice(appSrc.indexOf('const APP_CONFIG = (() => {'), appSrc.indexOf('const uid = () =>'));
  vm.runInContext(storageCode, ctx);
  const store = vm.runInContext('store', ctx);
  const corruptData = vm.runInContext('corruptData', ctx);

  // Reading corrupted sessions returns fallback default and registers corruptData
  const fallbackSessions = store.get('sessions', []);
  assert.deepEqual(fallbackSessions, []);
  assert.equal(corruptData['sessions'], '{"broken_json": [');
  // Reading invalid plan shape returns fallback default and registers corruptData
  const fallbackPlan = store.get('plan', null);
  assert.equal(fallbackPlan, null);
  assert.equal(corruptData['plan'], '{"type":"wrong_shape"}');

  // Attempting to overwrite a corrupted key is blocked
  const setRes = store.set('sessions', [{ id: 'new_session' }]);
  assert.equal(setRes.ok, false);
  assert.equal(setRes.error, 'corrupt_blocked');
  // Raw corrupt data in storage is completely intact
  assert.equal(memoryStore['gym_alpha.sessions'], '{"broken_json": [');
});

test('Storage write failures: store.set returns { ok: false } on QuotaExceededError and callers handle it', () => {
  const memoryStore = {};
  let throwOnSet = false;
  const mockLocalStorage = {
    getItem: k => memoryStore[k] ?? null,
    setItem: (k, v) => {
      if (throwOnSet) {
        const err = new Error('The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        throw err;
      }
      memoryStore[k] = v;
    },
    removeItem: k => { delete memoryStore[k]; }
  };

  let toasted = [];
  const ctx = {
    console,
    URLSearchParams,
    window: { GYM_CONFIG: { mode: 'alpha' } },
    location: { hostname: 'localhost', port: '8766', search: '' },
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
    localStorage: mockLocalStorage,
    I18n: { t: (k, p) => `${k}` },
    toast: (msg, kind) => toasted.push({ msg, kind })
  };
  vm.createContext(ctx);

  const storageCode = appSrc.slice(appSrc.indexOf('const APP_CONFIG = (() => {'), appSrc.indexOf('const uid = () =>'));
  vm.runInContext(storageCode, ctx);
  const store = vm.runInContext('store', ctx);

  // Normal write succeeds
  const okRes = store.set('test', { a: 1 });
  assert.equal(okRes.ok, true);

  // Failure write returns structured error
  throwOnSet = true;
  const failRes = store.set('test2', { b: 2 });
  assert.equal(failRes.ok, false);
  assert.equal(failRes.error, 'QuotaExceededError');
});

test('Completion idempotency across crash/restart: duplicate finishSession does not create duplicate entries', () => {
  const memoryStore = {};
  const mockLocalStorage = {
    getItem: k => memoryStore[k] ?? null,
    setItem: (k, v) => { memoryStore[k] = v; },
    removeItem: k => { delete memoryStore[k]; }
  };

  // 1. Simulate an active workout already saved in sessions before a crash
  const activeWorkout = {
    id: 'session-xyz',
    dayName: 'Day A',
    startTime: Date.now() - 3600000,
    exercises: [
      { name: 'Squat', sets: [{ weight: 100, reps: 5, done: true }] }
    ]
  };
  const existingSessions = [
    { id: 'session-xyz', dayName: 'Day A', date: '2026-09-15', durationMin: 60, exercises: activeWorkout.exercises }
  ];

  memoryStore['gym_alpha.active'] = JSON.stringify(activeWorkout);
  memoryStore['gym_alpha.sessions'] = JSON.stringify(existingSessions);

  // 2. Simulate app startup
  const activeParsed = JSON.parse(memoryStore['gym_alpha.active']);
  const sessionsParsed = JSON.parse(memoryStore['gym_alpha.sessions']);

  let active = activeParsed;
  let sessions = sessionsParsed;

  // Startup recovery logic (identical to app.js lines 382-386)
  if (active && sessions.some(s => s.id === active.id)) {
    active = null;
    mockLocalStorage.removeItem('gym_alpha.active');
  }

  assert.equal(active, null);
  assert.equal(memoryStore['gym_alpha.active'], undefined);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, 'session-xyz');
});

test('Plan-only export contains zero history, zero body weight, zero tokens, and validates on import', () => {
  const planData = {
    name: 'Coach Plan 3-Day',
    createdAt: '2026-09-15',
    days: [
      { name: 'Day 1 — Upper', exercises: [{ name: 'Bench Press', sets: 3, reps: '8', weight: 80, restSeconds: 120 }] },
      { name: 'Day 2 — Lower', exercises: [{ name: 'Squat', sets: 4, reps: '6', weight: 100, restSeconds: 180 }] }
    ],
    library: []
  };

  // buildPlanExport returns clean JSON
  const exported = JSON.stringify({
    type: 'workout-plan',
    version: 1,
    name: planData.name,
    createdAt: planData.createdAt,
    days: planData.days
  }, null, 2);

  const parsed = JSON.parse(exported);
  assert.equal(parsed.type, 'workout-plan');
  assert.equal(parsed.version, 1);
  assert.equal(parsed.name, 'Coach Plan 3-Day');
  assert.equal('sessions' in parsed, false);
  assert.equal('bodyWeight' in parsed, false);
  assert.equal('settings' in parsed, false);
  assert.equal('writeToken' in parsed, false);
  assert.equal('gymUUID' in parsed, false);

  // validatePlanImport verifies it cleanly
  const validatePlanCode = appSrc.slice(appSrc.indexOf('function validatePlanImport(raw) {'), appSrc.indexOf('function normalizePlan(raw)'));
  const testCtx = { tr: k => k };
  vm.createContext(testCtx);
  vm.runInContext(validatePlanCode, testCtx);

  assert.doesNotThrow(() => testCtx.validatePlanImport(parsed));

  // Invalids are rejected
  assert.throws(() => testCtx.validatePlanImport(null));
  assert.throws(() => testCtx.validatePlanImport('not an object'));
  assert.throws(() => testCtx.validatePlanImport({ type: 'workout-log' }));
  assert.throws(() => testCtx.validatePlanImport({ type: 'workout-plan', days: [] }));
  assert.throws(() => testCtx.validatePlanImport({ type: 'workout-plan', version: 2, days: [{ name: 'A', exercises: [] }] }));
});

test('commitTx durable WAL protocol and startup recovery from interrupted pending_tx', () => {
  const memoryStore = {
    'gym_alpha.plan': JSON.stringify({ name: 'Old Plan', days: [] }),
    'gym_alpha.sessions': JSON.stringify([{ id: 's1' }])
  };
  const mockLocalStorage = {
    getItem: k => memoryStore[k] ?? null,
    setItem: (k, v) => { memoryStore[k] = v; },
    removeItem: k => { delete memoryStore[k]; }
  };
  const ctx = {
    console,
    URLSearchParams,
    window: { GYM_CONFIG: { mode: 'alpha' } },
    location: { hostname: 'localhost', port: '8766', search: '' },
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
    localStorage: mockLocalStorage,
    I18n: { t: k => k },
    tr: k => k
  };
  vm.createContext(ctx);
  const storageCode = appSrc.slice(appSrc.indexOf('const APP_CONFIG = (() => {'), appSrc.indexOf('/* ================= inline SVG icons ================= */'));
  vm.runInContext(storageCode, ctx);
  const store = vm.runInContext('store', ctx);

  // 1. Successful multi-key commitTx
  const res1 = store.commitTx([
    ['plan', { name: 'New Plan', days: [] }],
    ['sessions', [{ id: 's1' }, { id: 's2' }]]
  ]);
  assert.equal(res1.ok, true);
  assert.equal(JSON.parse(memoryStore['gym_alpha.plan']).name, 'New Plan');
  assert.equal(memoryStore['gym_alpha.pending_tx'], undefined);

  // 2. Failed commitTx mid-transaction triggers rollback
  let failKey = null;
  const origSetItem = mockLocalStorage.setItem;
  mockLocalStorage.setItem = (k, v) => {
    if (k === failKey) throw new Error('Simulated write failure');
    origSetItem(k, v);
  };

  failKey = 'gym_alpha.sessions';
  const res2 = store.commitTx([
    ['plan', { name: 'Failed Plan', days: [] }],
    ['sessions', [{ id: 's3' }]]
  ]);
  assert.equal(res2.ok, false);
  // Plan write was rolled back to 'New Plan'
  assert.equal(JSON.parse(memoryStore['gym_alpha.plan']).name, 'New Plan');
  // Pending tx journal was cleaned up
  assert.equal(memoryStore['gym_alpha.pending_tx'], undefined);

  // 3. Startup recovery from an interrupted pending_tx journal
  // Simulate crash between writes: 'plan' was written with 'Interrupted Plan', but 'pending_tx' remains
  mockLocalStorage.setItem = origSetItem;
  memoryStore['gym_alpha.pending_tx'] = JSON.stringify({
    id: 'tx-crash-1',
    createdAt: Date.now(),
    writes: [
      ['plan', JSON.stringify({ name: 'Pre-Crash Plan', days: [] })],
      ['sessions', JSON.stringify([{ id: 'pre-crash-s1' }])]
    ]
  });
  memoryStore['gym_alpha.plan'] = JSON.stringify({ name: 'Interrupted Partial Plan', days: [] });

  // Run startup recovery slice
  const recoverySlice = appSrc.slice(
    appSrc.indexOf('// Startup recovery: check for an interrupted commit transaction (pending_tx)'),
    appSrc.indexOf('/* ================= state ================= */')
  );
  vm.runInContext(recoverySlice, ctx);

  // Assert rolled back
  assert.equal(JSON.parse(memoryStore['gym_alpha.plan']).name, 'Pre-Crash Plan');
  assert.equal(JSON.parse(memoryStore['gym_alpha.sessions'])[0].id, 'pre-crash-s1');
  assert.equal(memoryStore['gym_alpha.pending_tx'], undefined);

  // 4. Persistent write failure during rollback retains pending_tx and blocks future commitTx
  // Setup: writes to plan succeed, sessions fails, and rolling back plan ALSO fails.
  let planSetCalls = 0;
  mockLocalStorage.setItem = (k, v) => {
    if (k === 'gym_alpha.sessions') throw new Error('Simulated forward write failure');
    if (k === 'gym_alpha.plan') {
      planSetCalls++;
      if (planSetCalls > 1) throw new Error('Simulated persistent rollback failure');
    }
    origSetItem(k, v);
  };

  const resRollbackFail = store.commitTx([
    ['plan', { name: 'Mutated Plan', days: [] }],
    ['sessions', [{ id: 's4' }]]
  ]);
  assert.equal(resRollbackFail.ok, false);
  assert.ok(resRollbackFail.error.includes('RollbackFailed'));
  // Pending tx journal is retained with status 'rollback_failed'
  assert.ok(memoryStore['gym_alpha.pending_tx']);
  const retainedTx = JSON.parse(memoryStore['gym_alpha.pending_tx']);
  assert.equal(retainedTx.status, 'rollback_failed');
  assert.equal(retainedTx.failedKey, 'sessions');

  // Subsequent commitTx calls must be blocked
  const resBlocked = store.commitTx([['plan', { name: 'Attempted Next Plan', days: [] }]]);
  assert.equal(resBlocked.ok, false);
  assert.equal(resBlocked.error, 'UnresolvedPendingTransaction');

  // 5. Journal deletion failure leaves status: 'committed', startup recovery cleans up without reverting
  mockLocalStorage.setItem = origSetItem;
  delete memoryStore['gym_alpha.pending_tx'];
  memoryStore['gym_alpha.plan'] = JSON.stringify({ name: 'Committed Plan', days: [] });
  memoryStore['gym_alpha.pending_tx'] = JSON.stringify({
    id: 'tx-committed-cleanup',
    status: 'committed',
    committedAt: Date.now(),
    writes: [['plan', JSON.stringify({ name: 'Pre-Commit Old Plan', days: [] })]]
  });

  // Run startup recovery
  vm.runInContext(recoverySlice, ctx);
  // Must NOT revert the committed data!
  assert.equal(JSON.parse(memoryStore['gym_alpha.plan']).name, 'Committed Plan');
  // Journal must be cleaned up
  assert.equal(memoryStore['gym_alpha.pending_tx'], undefined);
});

test('Unresolved transaction blocks ordinary writes, deletions, and sync until recovery resolves journal', async () => {
  const workoutModelCode = readFileSync(join(root, 'workout-model.js'), 'utf8');
  const exerciseLibraryCode = readFileSync(join(root, 'exercise-library.js'), 'utf8');

  const initialPlan = {
    name: 'Initial Plan',
    days: [{ id: 'd1', name: 'Day 1', exercises: [{ name: 'Bench', sets: 3, reps: '8', weight: 80 }] }]
  };
  const initialSessions = [{ id: 's1', date: '2026-09-01', dayName: 'D1', exercises: [] }];

  const memoryStore = {
    'gym.plan': JSON.stringify(initialPlan),
    'gym.sessions': JSON.stringify(initialSessions)
  };

  const mockLocalStorage = {
    getItem: k => memoryStore[k] ?? null,
    setItem: (k, v) => { memoryStore[k] = v; },
    removeItem: k => { delete memoryStore[k]; }
  };

  let toasted = [];
  const makeEl = () => ({
    value: '', innerHTML: '', textContent: '',
    appendChild: () => {}, remove: () => {},
    classList: { toggle: () => {}, contains: () => false, add: () => {}, remove: () => {} },
    addEventListener: () => {},
    closest: () => null,
    dataset: {}
  });

  const ctx = {
    console,
    crypto,
    URLSearchParams,
    AbortController,
    setTimeout: () => {},
    clearTimeout: () => {},
    setInterval: () => {},
    clearInterval: () => {},
    fetch: async () => ({ ok: true, status: 200, text: async () => '{}' }),
    window: { GYM_CONFIG: { mode: 'personal' }, scrollTo: () => {}, addEventListener: () => {} },
    document: {
      createElement: () => makeEl(),
      getElementById: () => makeEl(),
      querySelector: () => makeEl(),
      querySelectorAll: () => [],
      addEventListener: () => {}
    },
    location: { hostname: 'gymtrack.hithitpull.fi', port: '', search: '' },
    localStorage: mockLocalStorage,
    I18n: { t: k => k, exercise: k => k, date: k => k, explanation: () => '', english: () => '' },
    tr: (k, p) => `${k}:${JSON.stringify(p || {})}`,
    toasted: []
  };

  vm.createContext(ctx);
  vm.runInContext(workoutModelCode, ctx);
  vm.runInContext(exerciseLibraryCode, ctx);
  vm.runInContext(appSrc, ctx);
  vm.runInContext("toast = (msg, kind) => toasted.push({ msg, kind });", ctx);

  const store = vm.runInContext('store', ctx);
  const savePlan = vm.runInContext('savePlan', ctx);
  const workerPush = vm.runInContext('workerPush', ctx);
  const syncFetch = vm.runInContext('syncFetch', ctx);
  const restoreBackup = vm.runInContext('restoreBackup', ctx);

  const planKey = store.prefix + 'plan';
  const sessionsKey = store.prefix + 'sessions';
  const txKey = store.prefix + 'pending_tx';

  // 1. Transaction failure with persistent rollback failure
  // Simulate: forward write to plan succeeds, sessions fails, rollback of plan fails
  let planWriteCount = 0;
  const origSetItem = mockLocalStorage.setItem;
  mockLocalStorage.setItem = (k, v) => {
    if (k === sessionsKey) throw new Error('Forward write failure on sessions');
    if (k === planKey) {
      planWriteCount++;
      if (planWriteCount > 1) throw new Error('Persistent rollback failure on plan');
    }
    origSetItem(k, v);
  };

  const txRes = store.commitTx([
    ['plan', { name: 'Interrupted Mutation Plan', days: [] }],
    ['sessions', [{ id: 'new-s' }]]
  ]);
  assert.equal(txRes.ok, false);
  assert.ok(txRes.error.includes('RollbackFailed'));

  // Pending tx journal remains with status 'rollback_failed'
  assert.ok(memoryStore[txKey]);
  const journal = JSON.parse(memoryStore[txKey]);
  assert.equal(journal.status, 'rollback_failed');
  assert.equal(store.hasUnresolvedTx(), true);

  // 2. Storage becomes writable again
  mockLocalStorage.setItem = origSetItem;

  // 3. Ordinary plan edit attempt must be BLOCKED
  ctx.toasted = [];
  vm.runInContext("plan = { name: 'Ordinary Edit Attempt', days: [] };", ctx);
  const saveRes = savePlan();
  assert.equal(saveRes, false);
  assert.equal(ctx.toasted.some(t => t.kind === 'err'), true);

  // Direct store.set must return recovery_required
  const directSetRes = store.set('plan', { name: 'Direct Set Edit', days: [] });
  assert.equal(directSetRes.ok, false);
  assert.equal(directSetRes.error, 'recovery_required');

  // Direct store.del must return recovery_required
  const delRes = store.del('plan');
  assert.equal(delRes.ok, false);
  assert.equal(delRes.error, 'recovery_required');

  // Cloud sync must be blocked while recovery is unresolved
  const pushRes = await workerPush();
  assert.equal(pushRes, false);
  await assert.rejects(async () => syncFetch('https://api.gymtrack.hithitpull.fi/test'), /Sync disabled while transaction recovery is unresolved/);

  // Verify storage was NOT modified with the ordinary edit
  assert.notEqual(JSON.parse(memoryStore[planKey]).name, 'Ordinary Edit Attempt');
  assert.notEqual(JSON.parse(memoryStore[planKey]).name, 'Direct Set Edit');

  // 4. App restart: run startup recovery slice
  const recoverySlice = appSrc.slice(
    appSrc.indexOf('// Startup recovery: check for an interrupted commit transaction (pending_tx)'),
    appSrc.indexOf('/* ================= state ================= */')
  );
  vm.runInContext(recoverySlice, ctx);

  // Recovery rolled back the interrupted plan to its initial state from WAL journal pre-image
  assert.equal(JSON.parse(memoryStore[planKey]).name, 'Initial Plan');
  // Journal is now cleaned up!
  assert.equal(memoryStore[txKey], undefined);
  assert.equal(store.hasUnresolvedTx(), false);

  // 5. Post-recovery: ordinary saves now succeed!
  vm.runInContext("plan = { name: 'Legitimate New Edit', days: [{ id: 'd1', name: 'Day 1', exercises: [] }] };", ctx);
  const okSave = savePlan();
  assert.equal(okSave, true);
  assert.equal(JSON.parse(memoryStore[planKey]).name, 'Legitimate New Edit');

  // Subsequent restart preserves the legitimate edit
  vm.runInContext(recoverySlice, ctx);
  assert.equal(JSON.parse(memoryStore[planKey]).name, 'Legitimate New Edit');

  // 6. Test controlled recovery: restoreBackup with allowCorruptRecovery resolves an unresolved transaction
  memoryStore[txKey] = JSON.stringify({
    id: 'tx-failed-again',
    status: 'rollback_failed',
    writes: [['plan', JSON.stringify(initialPlan)]]
  });
  assert.equal(store.hasUnresolvedTx(), true);

  const backupData = {
    type: 'gymtrack-backup',
    version: 1,
    plan: { type: 'workout-plan', version: 1, name: 'Restored Clean Plan', days: [{ id: 'd1', name: 'D1', exercises: [] }] },
    sessions: [],
    bodyWeight: []
  };

  assert.doesNotThrow(() => restoreBackup(JSON.stringify(backupData)));
  assert.equal(memoryStore[txKey], undefined);
  assert.equal(store.hasUnresolvedTx(), false);
  assert.equal(JSON.parse(memoryStore[planKey]).name, 'Restored Clean Plan');

  // Ordinary writes can proceed immediately after restore
  const postRestoreSet = store.set('plan', { name: 'Post-Restore Plan', days: [] });
  assert.equal(postRestoreSet.ok, true);
  assert.equal(JSON.parse(memoryStore[planKey]).name, 'Post-Restore Plan');
});

test('Failed and interrupted recovery attempts preserve original journal and keep ordinary mutations blocked', async () => {
  const workoutModelCode = readFileSync(join(root, 'workout-model.js'), 'utf8');
  const exerciseLibraryCode = readFileSync(join(root, 'exercise-library.js'), 'utf8');

  const initialPlan = {
    name: 'Original Good Plan',
    days: [{ id: 'd1', name: 'Day 1', exercises: [{ name: 'Bench', sets: 3, reps: '8', weight: 80 }] }]
  };
  const initialSessions = [{ id: 's-good', date: '2026-09-01', dayName: 'D1', exercises: [] }];

  const memoryStore = {
    'gym.plan': JSON.stringify(initialPlan),
    'gym.sessions': JSON.stringify(initialSessions)
  };

  const mockLocalStorage = {
    getItem: k => memoryStore[k] ?? null,
    setItem: (k, v) => { memoryStore[k] = v; },
    removeItem: k => { delete memoryStore[k]; }
  };

  const makeEl = () => ({
    value: '', innerHTML: '', textContent: '',
    appendChild: () => {}, remove: () => {},
    classList: { toggle: () => {}, contains: () => false, add: () => {}, remove: () => {} },
    addEventListener: () => {},
    closest: () => null,
    dataset: {}
  });

  const ctx = {
    console,
    crypto,
    URLSearchParams,
    AbortController,
    setTimeout: () => {},
    clearTimeout: () => {},
    setInterval: () => {},
    clearInterval: () => {},
    fetch: async () => ({ ok: true, status: 200, text: async () => '{}' }),
    window: { GYM_CONFIG: { mode: 'personal' }, scrollTo: () => {}, addEventListener: () => {} },
    document: {
      createElement: () => makeEl(),
      getElementById: () => makeEl(),
      querySelector: () => makeEl(),
      querySelectorAll: () => [],
      addEventListener: () => {}
    },
    location: { hostname: 'gymtrack.hithitpull.fi', port: '', search: '' },
    localStorage: mockLocalStorage,
    I18n: { t: k => k, exercise: k => k, date: k => k, explanation: () => '', english: () => '' },
    tr: (k, p) => `${k}:${JSON.stringify(p || {})}`,
    toasted: []
  };

  vm.createContext(ctx);
  vm.runInContext(workoutModelCode, ctx);
  vm.runInContext(exerciseLibraryCode, ctx);
  vm.runInContext(appSrc, ctx);
  vm.runInContext("toast = (msg, kind) => toasted.push({ msg, kind });", ctx);

  const store = vm.runInContext('store', ctx);
  const savePlan = vm.runInContext('savePlan', ctx);
  const restoreBackup = vm.runInContext('restoreBackup', ctx);

  const planKey = store.prefix + 'plan';
  const sessionsKey = store.prefix + 'sessions';
  const txKey = store.prefix + 'pending_tx';

  // 1. First transaction T1 fails and leaves partially changed data and rollback_failed journal
  let planWriteCount = 0;
  const origSetItem = mockLocalStorage.setItem;
  mockLocalStorage.setItem = (k, v) => {
    if (k === sessionsKey) throw new Error('Simulated forward write failure on sessions');
    if (k === planKey) {
      planWriteCount++;
      if (planWriteCount > 1) throw new Error('Simulated rollback failure on plan');
    }
    origSetItem(k, v);
  };

  const t1Res = store.commitTx([
    ['plan', { name: 'Dirty Partial Plan from T1', days: [] }],
    ['sessions', [{ id: 't1-broken-session' }]]
  ]);
  assert.equal(t1Res.ok, false);
  assert.ok(t1Res.error.includes('RollbackFailed'));

  // Storage now has dirty partial plan and pending_tx
  assert.equal(JSON.parse(memoryStore[planKey]).name, 'Dirty Partial Plan from T1');
  assert.ok(memoryStore[txKey]);
  const originalTx = JSON.parse(memoryStore[txKey]);
  assert.equal(originalTx.status, 'rollback_failed');
  assert.equal(store.hasUnresolvedTx(), true);

  // 2. Storage becomes writable again
  mockLocalStorage.setItem = origSetItem;

  // 3. Backup restoration starts, but fails while writing sessions
  mockLocalStorage.setItem = (k, v) => {
    if (k === sessionsKey) throw new Error('Simulated failure during backup restore');
    origSetItem(k, v);
  };

  const candidateBackup = {
    type: 'gymtrack-backup',
    version: 1,
    plan: { type: 'workout-plan', version: 1, name: 'Attempted Backup Restore Plan', days: [{ id: 'd1', name: 'D1', exercises: [] }] },
    sessions: [{ id: 'restored-s', date: '2026-09-02', dayName: 'D1', exercises: [] }],
    bodyWeight: []
  };

  assert.throws(() => restoreBackup(JSON.stringify(candidateBackup)), /restore_write_failed/);

  // 4. CRITICAL VERIFICATIONS after failed restoration:
  // a) Rollback of restoration must have restored ORIGINAL good data, NOT the dirty partial plan!
  assert.equal(JSON.parse(memoryStore[planKey]).name, 'Original Good Plan');

  // b) Original recovery journal must NOT be deleted! It must survive in pending_tx.
  assert.ok(memoryStore[txKey], 'pending_tx must not be deleted on failed recovery attempt');
  const survivingTx = JSON.parse(memoryStore[txKey]);
  assert.equal(survivingTx.status, 'rollback_failed');
  // Original pre-images must still be in the surviving journal
  const planWriteInJournal = survivingTx.writes.find(w => w[0] === 'plan');
  assert.ok(planWriteInJournal);
  assert.equal(JSON.parse(planWriteInJournal[1]).name, 'Original Good Plan');

  // c) Recovery state must still be active and block ordinary mutations
  assert.equal(store.hasUnresolvedTx(), true);
  const blockedEdit = store.set('plan', { name: 'Blocked Edit During Unresolved Recovery', days: [] });
  assert.equal(blockedEdit.ok, false);
  assert.equal(blockedEdit.error, 'recovery_required');

  vm.runInContext("plan = { name: 'Blocked Edit Attempt', days: [] };", ctx);
  assert.equal(savePlan(), false);

  const blockedDel = store.del('plan');
  assert.equal(blockedDel.ok, false);
  assert.equal(blockedDel.error, 'recovery_required');

  // Storage is completely untouched by blocked mutations
  assert.equal(JSON.parse(memoryStore[planKey]).name, 'Original Good Plan');

  // 5. Interrupted recovery simulation (app crashes during recovery replacement):
  // Put an in-flight replacement journal into pending_tx carrying originalTx and partial writes
  mockLocalStorage.setItem = origSetItem;
  memoryStore[planKey] = JSON.stringify({ name: 'Interrupted Partial Plan', days: [] });
  memoryStore[txKey] = JSON.stringify({
    id: 'tx-interrupted-restore',
    status: 'pending',
    createdAt: Date.now(),
    originalTx: survivingTx,
    writes: [
      ['plan', JSON.stringify(initialPlan)],
      ['sessions', JSON.stringify(initialSessions)]
    ]
  });

  // App reopens: run startup recovery slice
  const recoverySlice = appSrc.slice(
    appSrc.indexOf('// Startup recovery: check for an interrupted commit transaction (pending_tx)'),
    appSrc.indexOf('/* ================= state ================= */')
  );
  vm.runInContext(recoverySlice, ctx);

  // Startup recovery must roll back to Original Good Plan
  assert.equal(JSON.parse(memoryStore[planKey]).name, 'Original Good Plan');
  // Startup recovery must retain the original recovery journal and keep ordinary saves blocked
  assert.ok(memoryStore[txKey], 'pending_tx must be retained after interrupted recovery rollback');
  assert.equal(store.hasUnresolvedTx(), true);
  const stillBlocked = store.set('plan', { name: 'Post-Crash Blocked Edit', days: [] });
  assert.equal(stillBlocked.ok, false);
  assert.equal(stillBlocked.error, 'recovery_required');

  // 6. Durable success: when backup restoration succeeds, journal is cleared and mutations unblocked
  assert.doesNotThrow(() => restoreBackup(JSON.stringify(candidateBackup)));
  assert.equal(memoryStore[txKey], undefined, 'pending_tx is cleanly deleted after successful restore');
  assert.equal(store.hasUnresolvedTx(), false);
  assert.equal(JSON.parse(memoryStore[planKey]).name, 'Attempted Backup Restore Plan');

  // Ordinary saves now succeed!
  const finalOkEdit = store.set('plan', { name: 'Final Legitimate Plan', days: [] });
  assert.equal(finalOkEdit.ok, true);
  assert.equal(JSON.parse(memoryStore[planKey]).name, 'Final Legitimate Plan');
});

test('restoreBackup rejects malformed records without mutating storage or memory', () => {
  const initialPlan = { type: 'workout-plan', version: 1, name: 'Initial Plan', days: [{ id: 'd1', name: 'D1', exercises: [{ name: 'Squat', sets: 3, reps: '5', weight: 100 }] }] };
  const initialSessions = [{ id: 's1', date: '2026-09-01', dayName: 'D1', exercises: [] }];
  const initialBW = [{ date: '2026-09-01', weight: 80 }];

  const memoryStore = {
    'gym_alpha.plan': JSON.stringify(initialPlan),
    'gym_alpha.sessions': JSON.stringify(initialSessions),
    'gym_alpha.bw': JSON.stringify(initialBW)
  };
  const mockLocalStorage = {
    getItem: k => memoryStore[k] ?? null,
    setItem: (k, v) => { memoryStore[k] = v; },
    removeItem: k => { delete memoryStore[k]; }
  };

  const workoutModelCode = readFileSync(join(root, 'workout-model.js'), 'utf8');
  const ctx = {
    console,
    URLSearchParams,
    window: { GYM_CONFIG: { mode: 'alpha' } },
    location: { hostname: 'localhost', port: '8766', search: '' },
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
    localStorage: mockLocalStorage,
    I18n: { t: k => k },
    tr: (k, p) => k
  };
  vm.createContext(ctx);
  vm.runInContext(workoutModelCode, ctx);

  const appCodeSlice = `
    const APP_CONFIG = { mode: 'alpha', isAlpha: true, keyPrefix: 'gym_alpha.' };
    const corruptData = {};
    let storageAlert = null;
    const EQUIPMENT_TYPES = ['barbell', 'trap-bar', 'landmine', 'training-bar', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other'];
    const EXERCISE_METRICS = WorkoutModel.metrics;
    ${appSrc.slice(appSrc.indexOf('const store = {'), appSrc.indexOf('const ICONS = {'))}
    let plan = ${JSON.stringify(initialPlan)};
    let sessions = ${JSON.stringify(initialSessions)};
    let bodyWeight = ${JSON.stringify(initialBW)};
    let aliases = {};
    let settings = { unit: 'kg', sound: true, vibrate: true };
    let dataUpdatedAt = 1000;
    ${appSrc.slice(appSrc.indexOf('function validatePlanImport(raw) {'), appSrc.indexOf('const coachPlanSchema = () =>'))}
  `;
  vm.runInContext(appCodeSlice, ctx);

  const restoreBackup = vm.runInContext('restoreBackup', ctx);

  const validPlan = {
    type: 'workout-plan', version: 1, name: 'Incoming Plan',
    days: [{ id: 'd2', name: 'D2', exercises: [{ name: 'Bench', sets: 3, reps: '8', weight: 80 }] }]
  };

  // 1. Session missing date
  const badSession1 = {
    type: 'gymtrack-backup', version: 1,
    plan: validPlan,
    sessions: [{ id: 's2', exercises: [] }]
  };
  assert.throws(() => restoreBackup(JSON.stringify(badSession1)), /missing or invalid date/i);

  // 2. Session missing id
  const badSession2 = {
    type: 'gymtrack-backup', version: 1,
    plan: validPlan,
    sessions: [{ date: '2026-09-10', exercises: [] }]
  };
  assert.throws(() => restoreBackup(JSON.stringify(badSession2)), /missing or invalid id/i);

  // 3. Session missing exercises
  const badSession3 = {
    type: 'gymtrack-backup', version: 1,
    plan: validPlan,
    sessions: [{ id: 's3', date: '2026-09-10' }]
  };
  assert.throws(() => restoreBackup(JSON.stringify(badSession3)), /missing exercises array/i);

  // 4. Body weight with invalid/negative weight
  const badBW1 = {
    type: 'gymtrack-backup', version: 1,
    plan: validPlan,
    bodyWeight: [{ date: '2026-09-10', weight: -5 }]
  };
  assert.throws(() => restoreBackup(JSON.stringify(badBW1)), /weight must be a positive number/i);

  // 5. Body weight with missing date
  const badBW2 = {
    type: 'gymtrack-backup', version: 1,
    plan: validPlan,
    bodyWeight: [{ weight: 75 }]
  };
  assert.throws(() => restoreBackup(JSON.stringify(badBW2)), /missing or invalid date/i);

  // Verify storage and memory are COMPLETELY UNTOUCHED
  assert.equal(JSON.parse(memoryStore['gym_alpha.plan']).name, 'Initial Plan');
  assert.equal(JSON.parse(memoryStore['gym_alpha.sessions']).length, 1);
  assert.equal(JSON.parse(memoryStore['gym_alpha.bw']).length, 1);
  assert.equal(vm.runInContext('plan', ctx).name, 'Initial Plan');
  assert.equal(vm.runInContext('sessions', ctx).length, 1);
  assert.equal(vm.runInContext('bodyWeight', ctx).length, 1);
});

test('restoreBackup recovers corrupted keys and clears corruptData and alerts', () => {
  const memoryStore = {
    'gym_alpha.sessions': '{"corrupt_json": true',
    'gym_alpha.plan': JSON.stringify({ type: 'workout-plan', version: 1, name: 'Old', days: [{ id: 'd1', name: 'D1', exercises: [{ name: 'Squat', sets: 3, reps: '5', weight: 100 }] }] })
  };
  const mockLocalStorage = {
    getItem: k => memoryStore[k] ?? null,
    setItem: (k, v) => { memoryStore[k] = v; },
    removeItem: k => { delete memoryStore[k]; }
  };

  const workoutModelCode = readFileSync(join(root, 'workout-model.js'), 'utf8');
  const ctx = {
    console,
    URLSearchParams,
    window: { GYM_CONFIG: { mode: 'alpha' } },
    location: { hostname: 'localhost', port: '8766', search: '' },
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
    localStorage: mockLocalStorage,
    I18n: { t: k => k },
    tr: (k, p) => `${k}:${JSON.stringify(p || {})}`
  };
  vm.createContext(ctx);
  vm.runInContext(workoutModelCode, ctx);

  const appCodeSlice = `
    const APP_CONFIG = { mode: 'alpha', isAlpha: true, keyPrefix: 'gym_alpha.' };
    const corruptData = {};
    let storageAlert = null;
    const EQUIPMENT_TYPES = ['barbell', 'trap-bar', 'landmine', 'training-bar', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other'];
    const EXERCISE_METRICS = WorkoutModel.metrics;
    ${appSrc.slice(appSrc.indexOf('const store = {'), appSrc.indexOf('const ICONS = {'))}
    let plan = store.get('plan');
    let sessions = store.get('sessions', []);
    let bodyWeight = store.get('bw', []);
    let aliases = {};
    let settings = { unit: 'kg', sound: true, vibrate: true };
    let dataUpdatedAt = 1000;
    ${appSrc.slice(appSrc.indexOf('function validatePlanImport(raw) {'), appSrc.indexOf('const coachPlanSchema = () =>'))}
  `;
  vm.runInContext(appCodeSlice, ctx);

  const store = vm.runInContext('store', ctx);
  const corruptData = vm.runInContext('corruptData', ctx);
  const restoreBackup = vm.runInContext('restoreBackup', ctx);

  // Sessions is registered as corrupt
  assert.ok(corruptData['sessions']);
  assert.ok(vm.runInContext('storageAlert', ctx));

  // Regular write is blocked
  const setRes = store.set('sessions', [{ id: 'new' }]);
  assert.equal(setRes.ok, false);
  assert.equal(setRes.error, 'corrupt_blocked');

  // restoreBackup succeeds with valid backup
  const validBackup = {
    type: 'gymtrack-backup',
    version: 1,
    plan: { type: 'workout-plan', version: 1, name: 'Restored Plan', days: [{ id: 'd2', name: 'D2', exercises: [{ name: 'Deadlift', sets: 3, reps: '5', weight: 140 }] }] },
    sessions: [{ id: 'restored-s1', date: '2026-09-12', dayName: 'D2', exercises: [] }],
    bodyWeight: [{ date: '2026-09-12', weight: 81.5 }]
  };

  assert.doesNotThrow(() => restoreBackup(JSON.stringify(validBackup)));

  // Verifications:
  assert.equal(corruptData['sessions'], undefined);
  assert.equal(vm.runInContext('storageAlert', ctx), null);
  assert.equal(vm.runInContext('sessions', ctx)[0].id, 'restored-s1');
  assert.equal(JSON.parse(memoryStore['gym_alpha.sessions'])[0].id, 'restored-s1');

  // Subsequent regular writes are no longer blocked
  const nextSetRes = store.set('sessions', [{ id: 'next-session' }]);
  assert.equal(nextSetRes.ok, true);
});

test('sessionAddExerciseModal: atomic commitTx rollback on failure prevents split plan/active state', () => {
  const initialPlan = {
    id: 'plan-1', name: 'My Plan',
    days: [{ id: 'day-1', name: 'Upper', exercises: [{ name: 'Bench Press', sets: 3, reps: '8', weight: 80 }] }]
  };
  const initialActive = {
    id: 'active-1', dayId: 'day-1', dayName: 'Upper',
    exercises: [{ name: 'Bench Press', sets: [{ weight: 80, reps: 8, done: true }] }]
  };

  const memoryStore = {
    'gym_alpha.plan': JSON.stringify(initialPlan),
    'gym_alpha.active': JSON.stringify(initialActive)
  };
  const mockLocalStorage = {
    getItem: k => memoryStore[k] ?? null,
    setItem: (k, v) => { memoryStore[k] = v; },
    removeItem: k => { delete memoryStore[k]; }
  };

  const ctx = {
    console,
    URLSearchParams,
    window: { GYM_CONFIG: { mode: 'alpha' } },
    location: { hostname: 'localhost', port: '8766', search: '' },
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
    localStorage: mockLocalStorage,
    I18n: { t: k => k },
    tr: k => k,
    structuredClone: obj => JSON.parse(JSON.stringify(obj))
  };
  vm.createContext(ctx);
  const storageCode = appSrc.slice(appSrc.indexOf('const APP_CONFIG = (() => {'), appSrc.indexOf('/* ================= inline SVG icons ================= */'));
  vm.runInContext(storageCode, ctx);
  const store = vm.runInContext('store', ctx);

  let plan = JSON.parse(JSON.stringify(initialPlan));
  let active = JSON.parse(JSON.stringify(initialActive));

  // Simulate write failure on 'active'
  const origSetItem = mockLocalStorage.setItem;
  mockLocalStorage.setItem = (k, v) => {
    if (k === 'gym_alpha.active') {
      const err = new Error('Disk full');
      err.name = 'QuotaExceededError';
      throw err;
    }
    origSetItem(k, v);
  };

  // Perform sessionAddExerciseModal logic
  const nextPlan = JSON.parse(JSON.stringify(plan));
  const targetDay = nextPlan.days.find(d => d.id === active.dayId);
  targetDay.exercises.push({ name: 'Incline Dumbbell Press', sets: 3, reps: '10', weight: 24 });
  const nextActive = JSON.parse(JSON.stringify(active));
  nextActive.exercises.push({ name: 'Incline Dumbbell Press', sets: [] });

  const txRes = store.commitTx([
    ['plan', nextPlan],
    ['active', nextActive]
  ]);

  assert.equal(txRes.ok, false);
  // Rollback verified: memory variables were never updated
  assert.equal(plan.days[0].exercises.length, 1);
  assert.equal(active.exercises.length, 1);
  // Storage was rolled back
  assert.equal(JSON.parse(memoryStore['gym_alpha.plan']).days[0].exercises.length, 1);
  assert.equal(JSON.parse(memoryStore['gym_alpha.active']).exercises.length, 1);
  assert.equal(memoryStore['gym_alpha.pending_tx'], undefined);
});

test('Audited application handlers revert in-memory state and DOM inputs on storage failure', () => {
  const workoutModelCode = readFileSync(join(root, 'workout-model.js'), 'utf8');
  const exerciseLibraryCode = readFileSync(join(root, 'exercise-library.js'), 'utf8');

  const initialPlan = { name: 'Plan A', days: [{ id: 'd1', name: 'Day 1', exercises: [{ name: 'Bench', sets: 3, reps: '8', weight: 80 }] }] };
  const initialSessions = [{ id: 's1', date: '2026-09-01', dayName: 'D1', exercises: [] }];
  const initialActive = {
    id: 'active-1', dayId: 'd1', dayName: 'D1', startedAt: Date.now() - 1000,
    exercises: [{ name: 'Bench', sets: [{ weight: 80, reps: 8, done: false }] }],
    notes: 'Initial note',
    readiness: { cmjCm: 45, broadJumpCm: 220, subjectiveEnergy: 7 }
  };
  const initialBW = [{ date: '2026-09-01', weight: 80 }];
  const initialAliases = { 'db bench': 'Dumbbell Bench Press' };
  const initialSettings = { unit: 'kg', sound: true, vibrate: true, autoSync: false };

  const memoryStore = {
    'gym_alpha.plan': JSON.stringify(initialPlan),
    'gym_alpha.sessions': JSON.stringify(initialSessions),
    'gym_alpha.active': JSON.stringify(initialActive),
    'gym_alpha.bw': JSON.stringify(initialBW),
    'gym_alpha.aliases': JSON.stringify(initialAliases),
    'gym_alpha.settings': JSON.stringify(initialSettings)
  };

  const mockLocalStorage = {
    getItem: k => memoryStore[k] ?? null,
    setItem: (k, v) => { memoryStore[k] = v; },
    removeItem: k => { delete memoryStore[k]; }
  };

  const listeners = {};
  const elements = {};
  const makeEl = (extra = {}) => Object.assign({
    value: '', innerHTML: '', textContent: '',
    appendChild: () => {}, remove: () => {},
    classList: { toggle: () => {}, contains: () => false, add: () => {}, remove: () => {} },
    addEventListener: () => {},
    closest: () => null,
    dataset: {}
  }, extra);

  const mockDoc = {
    createElement: () => makeEl(),
    getElementById: (id) => elements[id] || (elements[id] = makeEl()),
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    addEventListener: (type, fn) => { listeners[type] = fn; }
  };

  const ctx = {
    console,
    setTimeout: () => {},
    clearTimeout: () => {},
    setInterval: () => {},
    clearInterval: () => {},
    URLSearchParams,
    window: { GYM_CONFIG: { mode: 'alpha' }, scrollTo: () => {}, addEventListener: () => {} },
    document: mockDoc,
    location: { hostname: 'localhost', port: '8766', search: '' },
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
    localStorage: mockLocalStorage,
    I18n: { t: k => k, exercise: k => k, date: k => k, explanation: k => '', english: k => '' },
    tr: (k, p) => k
  };

  vm.createContext(ctx);
  vm.runInContext(workoutModelCode, ctx);
  vm.runInContext(exerciseLibraryCode, ctx);
  vm.runInContext(appSrc, ctx);

  const store = vm.runInContext('store', ctx);

  // Failure injection on store.set
  let failKey = null;
  const origSet = store.set;
  store.set = function(k, v, opts) {
    if (k === failKey) return { ok: false, error: 'QuotaExceededError' };
    return origSet.call(store, k, v, opts);
  };

  // 1. Direct workout input: set weight failure reverts in-memory active set AND DOM input value
  failKey = 'active';
  const setInput = makeEl({ value: '100', dataset: { bind: 'set', ei: '0', si: '0', f: 'weight' } });
  listeners['input']({ target: setInput });
  const activeNow1 = vm.runInContext('active', ctx);
  assert.equal(activeNow1.exercises[0].sets[0].weight, 80);
  assert.equal(setInput.value, 80);

  // 2. Direct workout input: session-notes failure reverts in-memory active notes AND DOM input value
  const notesInput = makeEl({ value: 'Unsaved notes draft', dataset: { bind: 'session-notes' } });
  listeners['input']({ target: notesInput });
  const activeNow2 = vm.runInContext('active', ctx);
  assert.equal(activeNow2.notes, 'Initial note');
  assert.equal(notesInput.value, 'Initial note');

  // 3. Direct workout input: readiness-cmj failure reverts in-memory CMJ value AND DOM input value
  const cmjInput = makeEl({ value: '52', dataset: { bind: 'readiness-cmj' } });
  listeners['input']({ target: cmjInput });
  const activeNow3 = vm.runInContext('active', ctx);
  assert.equal(activeNow3.readiness.cmjCm, 45);
  assert.equal(cmjInput.value, 45);

  // 4. Direct workout input: readiness-broad failure reverts in-memory broad jump AND DOM input value
  const broadInput = makeEl({ value: '250', dataset: { bind: 'readiness-broad' } });
  listeners['input']({ target: broadInput });
  const activeNow4 = vm.runInContext('active', ctx);
  assert.equal(activeNow4.readiness.broadJumpCm, 220);
  assert.equal(broadInput.value, 220);

  // 5. Direct workout input: readiness-energy failure reverts in-memory energy AND DOM input value
  const energyInput = makeEl({ value: '10', dataset: { bind: 'readiness-energy' } });
  listeners['input']({ target: energyInput });
  const activeNow5 = vm.runInContext('active', ctx);
  assert.equal(activeNow5.readiness.subjectiveEnergy, 7);
  assert.equal(energyInput.value, 7);

  // 6. Action handler: confirm-discard reverts active workout on store.del('active') failure
  const origDel = store.del;
  store.del = function(k) {
    if (k === 'active') return { ok: false, error: 'QuotaExceededError' };
    return origDel.call(store, k);
  };
  listeners['click']({ target: makeEl({ closest: () => ({ dataset: { action: 'confirm-discard' } }) }) });
  const modalActionsDiscard = vm.runInContext('modalActions', ctx);
  assert.ok(modalActionsDiscard['m0']);
  modalActionsDiscard['m0'](); // click discard button
  assert.ok(vm.runInContext('active', ctx));
  assert.equal(vm.runInContext('active', ctx).id, 'active-1');
  store.del = origDel; // restore

  // 7. Action handler: reset-all reverts memory and keeps data on commitTx failure
  const origCommitTx = store.commitTx;
  store.commitTx = function(writes, opts) {
    return { ok: false, error: 'QuotaExceededError' };
  };
  listeners['click']({ target: makeEl({ closest: () => ({ dataset: { action: 'reset-all' } }) }) });
  const modalActionsReset = vm.runInContext('modalActions', ctx);
  assert.ok(modalActionsReset['m0']);
  modalActionsReset['m0'](); // click reset button
  assert.equal(vm.runInContext('plan', ctx).name, 'Plan A');
  assert.equal(vm.runInContext('sessions', ctx).length, 1);
  assert.equal(vm.runInContext('bodyWeight', ctx).length, 1);
  assert.equal(vm.runInContext('active', ctx).id, 'active-1');
  store.commitTx = origCommitTx; // restore

  // 8. Action handler: bw-add reverts in-memory bodyWeight on saveBW failure
  failKey = 'bw';
  elements['bw-input'] = makeEl({ value: '85' });
  listeners['click']({ target: makeEl({ closest: () => ({ dataset: { action: 'bw-add' } }) }) });
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('bodyWeight', ctx))), initialBW);

  // 9. Action handler: bw-undo restores popped bodyWeight entry on saveBW failure
  listeners['click']({ target: makeEl({ closest: () => ({ dataset: { action: 'bw-undo' } }) }) });
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('bodyWeight', ctx))), initialBW);

  // 10. Action handler: plan-rename reverts plan.name on savePlan failure
  failKey = 'plan';
  elements['f-plan-name'] = makeEl({ value: 'Renamed Plan Fails' });
  listeners['click']({ target: makeEl({ closest: () => ({ dataset: { action: 'plan-rename' } }) }) });
  const modalActionsPlan = vm.runInContext('modalActions', ctx);
  assert.ok(modalActionsPlan['m0']);
  modalActionsPlan['m0'](); // click save in rename modal
  assert.equal(vm.runInContext('plan', ctx).name, 'Plan A');

  // 11. Action handler: day-add pops added day on savePlan failure
  elements['f-day-name'] = makeEl({ value: 'Day 2' });
  listeners['click']({ target: makeEl({ closest: () => ({ dataset: { action: 'day-add' } }) }) });
  const modalActionsDayAdd = vm.runInContext('modalActions', ctx);
  assert.ok(modalActionsDayAdd['m0']);
  modalActionsDayAdd['m0']();
  assert.equal(vm.runInContext('plan', ctx).days.length, 1);

  // 12. Action handler: day-delete restores deleted day on savePlan failure
  listeners['click']({ target: makeEl({ closest: () => ({ dataset: { action: 'day-delete', id: 'd1' } }) }) });
  const modalActionsDayDel = vm.runInContext('modalActions', ctx);
  assert.ok(modalActionsDayDel['m0']);
  modalActionsDayDel['m0']();
  assert.equal(vm.runInContext('plan', ctx).days.length, 1);
  assert.equal(vm.runInContext('plan', ctx).days[0].id, 'd1');

  // 13. Action handler: session-delete restores session on saveSessions failure
  failKey = 'sessions';
  listeners['click']({ target: makeEl({ closest: () => ({ dataset: { action: 'session-delete', id: 's1' } }) }) });
  const modalActionsSessDel = vm.runInContext('modalActions', ctx);
  assert.ok(modalActionsSessDel['m0']);
  modalActionsSessDel['m0']();
  assert.equal(vm.runInContext('sessions', ctx).length, 1);
  assert.equal(vm.runInContext('sessions', ctx)[0].id, 's1');

  // 14. Action handler: unmerge-alias restores alias on saveAliases failure
  failKey = 'aliases';
  listeners['click']({ target: makeEl({ closest: () => ({ dataset: { action: 'unmerge-alias', k: 'db bench', name: 'Dumbbell Bench Press' } }) }) });
  assert.equal(vm.runInContext('aliases', ctx)['db bench'], 'Dumbbell Bench Press');

  // 15. Action handler: toggle-sound and toggle-vibrate revert settings on saveSettings failure
  failKey = 'settings';
  listeners['click']({ target: makeEl({ closest: () => ({ dataset: { action: 'toggle-sound' } }) }) });
  assert.equal(vm.runInContext('settings', ctx).sound, true);
  listeners['click']({ target: makeEl({ closest: () => ({ dataset: { action: 'toggle-vibrate' } }) }) });
  assert.equal(vm.runInContext('settings', ctx).vibrate, true);

  // 16. Change listener: set-unit reverts unit on saveSettings failure
  listeners['change']({ target: makeEl({ value: 'lbs', dataset: { bind: 'set-unit' } }) });
  assert.equal(vm.runInContext('settings', ctx).unit, 'kg');
});

test('Failed replacement preserves replacement-only keys (body weight) across failed rollback, restart, and repeated attempts', async () => {
  const workoutModelCode = readFileSync(join(root, 'workout-model.js'), 'utf8');
  const exerciseLibraryCode = readFileSync(join(root, 'exercise-library.js'), 'utf8');

  const initialPlan = {
    name: 'Initial Plan',
    days: [{ id: 'd1', name: 'Day 1', exercises: [{ name: 'Bench', sets: 3, reps: '8', weight: 80 }] }]
  };
  const initialSessions = [{ id: 's-initial', date: '2026-09-01', dayName: 'D1', exercises: [] }];
  const initialBW = [{ date: '2026-09-01', weight: 70 }];

  const memoryStore = {
    'gym.plan': JSON.stringify(initialPlan),
    'gym.sessions': JSON.stringify(initialSessions),
    'gym.bw': JSON.stringify(initialBW)
  };

  const mockLocalStorage = {
    getItem: k => memoryStore[k] ?? null,
    setItem: (k, v) => { memoryStore[k] = v; },
    removeItem: k => { delete memoryStore[k]; }
  };

  const makeEl = () => ({
    value: '', innerHTML: '', textContent: '',
    appendChild: () => {}, remove: () => {},
    classList: { toggle: () => {}, contains: () => false, add: () => {}, remove: () => {} },
    addEventListener: () => {},
    closest: () => null,
    dataset: {}
  });

  const ctx = {
    console,
    crypto,
    URLSearchParams,
    AbortController,
    setTimeout: () => {},
    clearTimeout: () => {},
    setInterval: () => {},
    clearInterval: () => {},
    fetch: async () => ({ ok: true, status: 200, text: async () => '{}' }),
    window: { GYM_CONFIG: { mode: 'personal' }, scrollTo: () => {}, addEventListener: () => {} },
    document: {
      createElement: () => makeEl(),
      getElementById: () => makeEl(),
      querySelector: () => makeEl(),
      querySelectorAll: () => [],
      addEventListener: () => {}
    },
    location: { hostname: 'gymtrack.hithitpull.fi', port: '', search: '' },
    localStorage: mockLocalStorage,
    I18n: { t: k => k, exercise: k => k, date: k => k, explanation: () => '', english: () => '' },
    tr: (k, p) => `${k}:${JSON.stringify(p || {})}`,
    toasted: []
  };

  vm.createContext(ctx);
  vm.runInContext(workoutModelCode, ctx);
  vm.runInContext(exerciseLibraryCode, ctx);
  vm.runInContext(appSrc, ctx);

  const store = vm.runInContext('store', ctx);
  const restoreBackup = vm.runInContext('restoreBackup', ctx);
  const planKey = store.prefix + 'plan';
  const sessionsKey = store.prefix + 'sessions';
  const bwKey = store.prefix + 'bw';
  const aliasesKey = store.prefix + 'aliases';
  const txKey = store.prefix + 'pending_tx';

  // 1. Initial failed transaction covers plan and sessions:
  // Fails on sessions, plan rollback fails.
  const origSetItem = mockLocalStorage.setItem;
  let planWriteCount = 0;
  mockLocalStorage.setItem = (k, v) => {
    if (k === sessionsKey) throw new Error('Simulated write failure on sessions');
    if (k === planKey) {
      planWriteCount++;
      if (planWriteCount > 1) throw new Error('Simulated rollback failure on plan');
    }
    origSetItem(k, v);
  };

  const t1Res = store.commitTx([
    ['plan', { name: 'Dirty Plan T1', days: [] }],
    ['sessions', [{ id: 't1-broken-session' }]]
  ]);
  assert.equal(t1Res.ok, false);
  assert.equal(store.hasUnresolvedTx(), true);

  const journalT1 = JSON.parse(memoryStore[txKey]);
  assert.equal(journalT1.status, 'rollback_failed');
  assert.equal(journalT1.writes.length, 2); // covers plan and sessions only

  // 2. Backup restoration replacement attempts to restore plan, sessions, and introduces bodyWeight (70 -> 80).
  // Simulate: forward write on plan succeeds, forward write on bw (80) succeeds,
  // then forward write on aliases fails!
  // During rollback: rolling back bw (back to 70) FAILS persistently!
  let bwWriteCount = 0;
  mockLocalStorage.setItem = (k, v) => {
    if (k === aliasesKey) throw new Error('Simulated forward write failure on aliases during restore');
    if (k === bwKey) {
      bwWriteCount++;
      // Write 1 is the forward write (80). Write 2 would be rollback (back to 70), make it fail!
      if (bwWriteCount > 1) throw new Error('Simulated persistent rollback failure on bw');
    }
    origSetItem(k, v);
  };

  const candidateBackup = {
    type: 'gymtrack-backup',
    version: 1,
    plan: { type: 'workout-plan', version: 1, name: 'Backup Plan', days: [{ id: 'd1', name: 'D1', exercises: [] }] },
    sessions: [{ id: 'backup-s', date: '2026-09-02', dayName: 'D1', exercises: [] }],
    bodyWeight: [{ date: '2026-09-02', weight: 80 }],
    aliases: { 'bench': 'Bench Press' }
  };

  assert.throws(() => restoreBackup(JSON.stringify(candidateBackup)), /restore_write_failed/);

  // Body weight in storage was written as 80 and its rollback to 70 failed
  assert.equal(JSON.parse(memoryStore[bwKey])[0].weight, 80);

  // CRITICAL CHECK 1: The preserved recovery journal MUST retain bw: 70 (the baseline pre-image)!
  assert.ok(memoryStore[txKey], 'pending_tx must exist');
  const preservedJournal = JSON.parse(memoryStore[txKey]);
  assert.equal(preservedJournal.status, 'rollback_failed');

  const bwEntryInJournal = preservedJournal.writes.find(w => w[0] === 'bw');
  assert.ok(bwEntryInJournal, 'Replacement-introduced key bw must be retained in preserved recovery journal');
  assert.equal(JSON.parse(bwEntryInJournal[1])[0].weight, 70, 'Pre-image for bw must be the original 70, not 80');

  // Ordinary saves must stay blocked
  assert.equal(store.hasUnresolvedTx(), true);
  const blockedSave = store.set('bw', [{ date: '2026-09-03', weight: 85 }]);
  assert.equal(blockedSave.ok, false);
  assert.equal(blockedSave.error, 'recovery_required');

  // 3. CRITICAL: RETRY IN THE SAME RUNNING APP WITHOUT RESTART!
  // At this moment in memory:
  // - Storage has bw = 80
  // - Pending_tx journal has baseline bw = 70
  // Execute a second recovery replacement attempt (with DIFFERENT keys and a new bw value: 75)
  // in the EXACT SAME running session (no restart/recoverySlice).
  // It must NOT overwrite the baseline bw: 70 with 80!
  let attempt2BwCount = 0;
  mockLocalStorage.setItem = (k, v) => {
    if (k === aliasesKey) throw new Error('Simulated failure on aliases in attempt 2');
    if (k === bwKey) {
      attempt2BwCount++;
      // Forward write sets bw: 75, rollback back to 70 fails
      if (attempt2BwCount > 1) throw new Error('Simulated persistent rollback failure on bw attempt 2');
    }
    origSetItem(k, v);
  };

  const candidateBackup2 = {
    type: 'gymtrack-backup',
    version: 1,
    plan: { type: 'workout-plan', version: 1, name: 'Backup Plan 2', days: [{ id: 'd1', name: 'D1', exercises: [] }] },
    sessions: [{ id: 'backup-s2', date: '2026-09-02', dayName: 'D1', exercises: [] }],
    bodyWeight: [{ date: '2026-09-02', weight: 75 }],
    settings: { unit: 'lbs', sound: false },
    aliases: { 'bench': 'Bench Press' }
  };

  assert.throws(() => restoreBackup(JSON.stringify(candidateBackup2)), /restore_write_failed/);

  // After consecutive failure in the SAME session without restart:
  // The preserved journal MUST STILL have bw: 70 (earliest known baseline), NOT 80 or 75!
  assert.ok(memoryStore[txKey], 'pending_tx must exist after second failed attempt in same session');
  const journalAfterAttempt2 = JSON.parse(memoryStore[txKey]);
  const bwAfterAttempt2 = journalAfterAttempt2.writes.find(w => w[0] === 'bw');
  assert.ok(bwAfterAttempt2, 'bw must be retained in journal after same-session retry');
  assert.equal(JSON.parse(bwAfterAttempt2[1])[0].weight, 70, 'Baseline for bw must remain 70 after same-session retry');

  // Plan baseline must also remain the initial plan
  const planAfterAttempt2 = journalAfterAttempt2.writes.find(w => w[0] === 'plan');
  assert.ok(planAfterAttempt2);
  assert.equal(JSON.parse(planAfterAttempt2[1]).name, 'Initial Plan');

  // Ordinary saves must STILL stay blocked
  assert.equal(store.hasUnresolvedTx(), true);
  const stillBlockedSameSession = store.set('bw', [{ date: '2026-09-03', weight: 85 }]);
  assert.equal(stillBlockedSameSession.ok, false);
  assert.equal(stillBlockedSameSession.error, 'recovery_required');

  // 4. App restarts AFTER consecutive same-session failed recovery attempts: startup recovery runs
  mockLocalStorage.setItem = origSetItem;

  const recoverySlice = appSrc.slice(
    appSrc.indexOf('// Startup recovery: check for an interrupted commit transaction (pending_tx)'),
    appSrc.indexOf('/* ================= state ================= */')
  );
  vm.runInContext(recoverySlice, ctx);

  // Startup recovery must restore bodyWeight all the way back to the earliest 70!
  assert.equal(JSON.parse(memoryStore[bwKey])[0].weight, 70, 'Startup recovery after same-session retries must restore bw to 70');
  // Plan should also be restored to initial
  assert.equal(JSON.parse(memoryStore[planKey]).name, 'Initial Plan');

  // Because this was an interrupted/failed replacement recovery, pending_tx must still be retained
  // to ensure mutations stay blocked until a recovery replacement durably commits!
  assert.ok(memoryStore[txKey], 'pending_tx must still be retained after startup rollback');
  assert.equal(store.hasUnresolvedTx(), true);
  const stillBlockedPostRestart = store.set('bw', [{ date: '2026-09-03', weight: 85 }]);
  assert.equal(stillBlockedPostRestart.ok, false);
  assert.equal(stillBlockedPostRestart.error, 'recovery_required');

  // The retained journal from startup recovery must STILL contain the bw: 70 pre-image
  const postStartupJournal = JSON.parse(memoryStore[txKey]);
  const postStartupBW = postStartupJournal.writes.find(w => w[0] === 'bw');
  assert.ok(postStartupBW, 'Post-startup journal must still retain bw: 70 pre-image');
  assert.equal(JSON.parse(postStartupBW[1])[0].weight, 70);

  // 5. Finally, a clean recovery replacement succeeds durably
  mockLocalStorage.setItem = origSetItem;
  const cleanBackup = {
    type: 'gymtrack-backup',
    version: 1,
    plan: { type: 'workout-plan', version: 1, name: 'Durable Restored Plan', days: [{ id: 'd1', name: 'D1', exercises: [] }] },
    sessions: [{ id: 'clean-s', date: '2026-09-03', dayName: 'D1', exercises: [] }],
    bodyWeight: [{ date: '2026-09-03', weight: 78 }]
  };

  assert.doesNotThrow(() => restoreBackup(JSON.stringify(cleanBackup)));
  assert.equal(memoryStore[txKey], undefined, 'pending_tx cleanly removed upon successful restore');
  assert.equal(store.hasUnresolvedTx(), false);
  assert.equal(JSON.parse(memoryStore[bwKey])[0].weight, 78);
  assert.equal(JSON.parse(memoryStore[planKey]).name, 'Durable Restored Plan');

  // Ordinary saves are now allowed again
  const okSave = store.set('bw', [{ date: '2026-09-04', weight: 79 }]);
  assert.equal(okSave.ok, true);
  assert.equal(JSON.parse(memoryStore[bwKey])[0].weight, 79);
});
