/*
 * pure.test.mjs — unit tests for the pure logic inside app.js and the Worker.
 *
 * app.js is a classic browser script with no build step, so there is nothing to
 * import. Following tools/weights.test.mjs, the functions under test are sliced
 * out of the file text by name and evaluated in a vm context. That keeps the
 * tests honest — they run the shipped source, not a copy that can drift.
 *
 * Run: node --test tools/pure.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
// Loose deepEqual for values produced inside a vm context: those objects come
// from another realm, so deepStrictEqual rejects them on prototype identity
// alone even when the contents match.
import { deepEqual as deepEqualLoose } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(join(root, 'app.js'), 'utf8');

/** Slice a top-level declaration out of app.js by its exact opening text. */
function slice(openingLine, endMarker) {
  const start = appSrc.indexOf(openingLine);
  assert.notEqual(start, -1,
    'Could not find "' + openingLine + '" in app.js — it was renamed or moved. ' +
    'Update this test to match; do not delete it.');
  const end = appSrc.indexOf(endMarker, start);
  assert.notEqual(end, -1, 'Could not find the end of "' + openingLine + '" in app.js.');
  return appSrc.slice(start, end + endMarker.length);
}

function evaluate(code, exportExpr) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(code + '\n;' + exportExpr, ctx);
  return vm.runInContext(exportExpr, ctx);
}

/* ---------- est1RM ---------- */
const est1RM = evaluate(slice('const est1RM = (w, reps) =>', ';'), '(est1RM)');

test('est1RM applies Epley and rounds to one decimal', () => {
  assert.equal(est1RM(100, 1), 103.3);
  assert.equal(est1RM(100, 5), 116.7);
  assert.equal(est1RM(60, 10), 80);
});

test('est1RM returns the weight unchanged when reps is 0 or negative', () => {
  // Guards the unlogged-set case: no reps means there is no estimate to make,
  // and the raw weight must pass through rather than being scaled by 1.
  assert.equal(est1RM(100, 0), 100);
  assert.equal(est1RM(100, -3), 100);
});

/* ---------- computeJumpHeightCm ---------- */
const computeJumpHeightCm = evaluate(
  slice('const G_MS2', ';') + '\n' + slice('const computeJumpHeightCm = flightTimeSec =>', ';'),
  '(computeJumpHeightCm)'
);

test('computeJumpHeightCm follows h = g*t^2/8', () => {
  // g is 9.81 in app.js, so a 500 ms flight is 30.66 cm, not the 30.65 that
  // 9.80665 would give. Pinned to the shipped constant, not to physics.
  assert.ok(Math.abs(computeJumpHeightCm(0.5) - 30.656) < 0.01);
  assert.ok(Math.abs(computeJumpHeightCm(0.54) - 35.767) < 0.01);
});

test('computeJumpHeightCm of zero flight time is zero', () => {
  assert.equal(computeJumpHeightCm(0), 0);
});

/* ---------- mergeByKey ---------- */
const mergeByKey = evaluate(
  slice('function mergeByKey(remoteArr, localArr, keyFn) {', '\n}'),
  '(mergeByKey)'
);

test('mergeByKey lets remote win on a key collision', () => {
  const out = mergeByKey(
    [{ id: 'a', v: 'remote' }],
    [{ id: 'a', v: 'local' }],
    x => x.id
  );
  deepEqualLoose(out, [{ id: 'a', v: 'remote' }]);
});

test('mergeByKey keeps local-only records a pull would otherwise drop', () => {
  // This is the whole point of the merge: a session logged offline on this
  // device must survive a pull of a newer remote backup that never saw it.
  const out = mergeByKey(
    [{ id: 'a', v: 'remote' }],
    [{ id: 'a', v: 'local' }, { id: 'b', v: 'offline' }],
    x => x.id
  );
  assert.equal(out.length, 2);
  deepEqualLoose(out.find(x => x.id === 'b'), { id: 'b', v: 'offline' });
  deepEqualLoose(out.find(x => x.id === 'a'), { id: 'a', v: 'remote' });
});

/* ---------- Worker: write token + stale guard ---------- */
const worker = await import('../worker/src/index.js');
const UUID = '248ba466-4743-4d02-a02f-f6abb6c595a8';
const SECRET = 'test-secret';

/** Minimal KV stub — get/put over a Map is all these routes touch. */
function kv(initial) {
  const m = new Map(initial ? [[UUID, initial]] : []);
  return {
    get: async k => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => { m.set(k, v); },
    _m: m,
  };
}
const post = (body, opts = {}) => new Request(
  'https://api.example/data/' + UUID + (opts.force ? '?force=1' : ''),
  {
    method: 'POST',
    headers: opts.token ? { 'X-GymTrack-Write': opts.token } : {},
    body: JSON.stringify(body),
  }
);
const backup = updatedAt => JSON.stringify({ type: 'gymtrack-backup', updatedAt, sessions: [] });
const storedAt = env => JSON.parse(env.GYMTRACK_DATA._m.get(UUID)).updatedAt;

test('deriveWriteToken matches the Node HMAC used by tools/write-token.mjs', async () => {
  // If these two ever disagree, the token pasted into the app is rejected by
  // the Worker and sync dies. Pin the two implementations together.
  const fromWorker = await worker.deriveWriteToken(SECRET, UUID);
  const fromCli = createHmac('sha256', SECRET).update(UUID).digest('hex');
  assert.equal(fromWorker, fromCli);
  assert.match(fromWorker, /^[0-9a-f]{64}$/);
});

test('deriveWriteToken is case-insensitive on the UUID', async () => {
  assert.equal(
    await worker.deriveWriteToken(SECRET, UUID.toUpperCase()),
    await worker.deriveWriteToken(SECRET, UUID)
  );
});

test('safeEqual rejects mismatched and unequal-length input', () => {
  assert.equal(worker.safeEqual('abc', 'abc'), true);
  assert.equal(worker.safeEqual('abc', 'abd'), false);
  assert.equal(worker.safeEqual('abc', 'abcd'), false);
  assert.equal(worker.safeEqual('abc', undefined), false);
});

test('GET stays open — the share link needs no token', async () => {
  const env = { GYMTRACK_DATA: kv(backup(5)), GYMTRACK_WRITE_SECRET: SECRET };
  const res = await worker.default.fetch(new Request('https://api.example/data/' + UUID), env);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(await res.text()).updatedAt, 5);
});

test('POST without a token is rejected and leaves the data untouched', async () => {
  const env = { GYMTRACK_DATA: kv(backup(5)), GYMTRACK_WRITE_SECRET: SECRET };
  const res = await worker.default.fetch(post({ type: 'gymtrack-backup', updatedAt: 9 }), env);
  assert.equal(res.status, 401);
  assert.equal(storedAt(env), 5);
});

test('POST with a wrong token is rejected', async () => {
  const env = { GYMTRACK_DATA: kv(backup(5)), GYMTRACK_WRITE_SECRET: SECRET };
  const res = await worker.default.fetch(
    post({ type: 'gymtrack-backup', updatedAt: 9 }, { token: 'f'.repeat(64) }), env);
  assert.equal(res.status, 401);
  assert.equal(storedAt(env), 5);
});

test('POST with no secret configured is allowed — the rollout window', async () => {
  const env = { GYMTRACK_DATA: kv(backup(5)) };
  const res = await worker.default.fetch(post({ type: 'gymtrack-backup', updatedAt: 9 }), env);
  assert.equal(res.status, 200);
});

test('a newer POST with a valid token writes', async () => {
  const env = { GYMTRACK_DATA: kv(backup(5)), GYMTRACK_WRITE_SECRET: SECRET };
  const token = await worker.deriveWriteToken(SECRET, UUID);
  const res = await worker.default.fetch(
    post({ type: 'gymtrack-backup', updatedAt: 9 }, { token }), env);
  assert.equal(res.status, 200);
  assert.equal(storedAt(env), 9);
});

test('a Bearer header is accepted as well as X-GymTrack-Write', async () => {
  const env = { GYMTRACK_DATA: kv(backup(5)), GYMTRACK_WRITE_SECRET: SECRET };
  const token = await worker.deriveWriteToken(SECRET, UUID);
  const req = new Request('https://api.example/data/' + UUID, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({ type: 'gymtrack-backup', updatedAt: 9 }),
  });
  assert.equal((await worker.default.fetch(req, env)).status, 200);
});

test('a stale POST is refused with 409 and the stored timestamp', async () => {
  const env = { GYMTRACK_DATA: kv(backup(500)), GYMTRACK_WRITE_SECRET: SECRET };
  const token = await worker.deriveWriteToken(SECRET, UUID);
  const res = await worker.default.fetch(
    post({ type: 'gymtrack-backup', updatedAt: 100 }, { token }), env);
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'stale', updatedAt: 500 });
  assert.equal(storedAt(env), 500);
});

test('an equal timestamp is not stale — a re-push of the same state must land', async () => {
  const env = { GYMTRACK_DATA: kv(backup(500)), GYMTRACK_WRITE_SECRET: SECRET };
  const token = await worker.deriveWriteToken(SECRET, UUID);
  const res = await worker.default.fetch(
    post({ type: 'gymtrack-backup', updatedAt: 500 }, { token }), env);
  assert.equal(res.status, 200);
});

test('force=1 overrides the stale guard', async () => {
  const env = { GYMTRACK_DATA: kv(backup(500)), GYMTRACK_WRITE_SECRET: SECRET };
  const token = await worker.deriveWriteToken(SECRET, UUID);
  const res = await worker.default.fetch(
    post({ type: 'gymtrack-backup', updatedAt: 100 }, { token, force: true }), env);
  assert.equal(res.status, 200);
  assert.equal(storedAt(env), 100);
});

test('a body with no updatedAt expresses no opinion and is allowed through', async () => {
  const env = { GYMTRACK_DATA: kv(backup(500)), GYMTRACK_WRITE_SECRET: SECRET };
  const token = await worker.deriveWriteToken(SECRET, UUID);
  const res = await worker.default.fetch(
    post({ type: 'gymtrack-backup' }, { token }), env);
  assert.equal(res.status, 200);
});

test('a first write to an empty key is never stale', async () => {
  const env = { GYMTRACK_DATA: kv(null), GYMTRACK_WRITE_SECRET: SECRET };
  const token = await worker.deriveWriteToken(SECRET, UUID);
  const res = await worker.default.fetch(
    post({ type: 'gymtrack-backup', updatedAt: 1 }, { token }), env);
  assert.equal(res.status, 200);
});

test('the plan route is gated on the same token', async () => {
  const env = { GYMTRACK_DATA: kv(backup(5)), GYMTRACK_WRITE_SECRET: SECRET };
  const req = new Request('https://api.example/data/' + UUID + '/plan', {
    method: 'POST', body: JSON.stringify({ type: 'workout-plan', days: [] }),
  });
  assert.equal((await worker.default.fetch(req, env)).status, 401);
  assert.equal(storedAt(env), 5);
});

test('the plan route writes with a valid token and stamps updatedAt', async () => {
  const env = { GYMTRACK_DATA: kv(backup(5)), GYMTRACK_WRITE_SECRET: SECRET };
  const token = await worker.deriveWriteToken(SECRET, UUID);
  const req = new Request('https://api.example/data/' + UUID + '/plan', {
    method: 'POST',
    headers: { 'X-GymTrack-Write': token },
    body: JSON.stringify({ type: 'workout-plan', name: 'Block C', days: [] }),
  });
  assert.equal((await worker.default.fetch(req, env)).status, 200);
  const stored = JSON.parse(env.GYMTRACK_DATA._m.get(UUID));
  assert.equal(stored.plan.name, 'Block C');
  assert.ok(stored.updatedAt > 5);
});
