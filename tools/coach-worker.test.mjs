/*
 * coach-worker.test.mjs — Worker coach routes (docs/plans/2026-09-19-coach-interface.md).
 * Run: node --test tools/coach-worker.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const worker = await import('../worker/src/index.js');
const coachMod = await import('../worker/src/coach.js');

const SECRET = 'test-secret';
const TEAM = 'team.cloudflareaccess.com';
const AUD = 'aud-123';
const ATHLETE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

/* ---- signing key + stubbed Access certs endpoint ---- */
const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1' };
const realFetch = globalThis.fetch;
globalThis.fetch = async url => {
  if (String(url) === `https://${TEAM}/cdn-cgi/access/certs`) return new Response(JSON.stringify({ keys: [jwk] }));
  return realFetch(url);
};
const b64u = buf => Buffer.from(buf).toString('base64url');
async function jwt(claims = {}, { key = privateKey, kid = 'k1' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', kid }));
  const p = b64u(JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, exp: now + 600, email: 'Coach@Example.com', ...claims }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h + '.' + p));
  return `${h}.${p}.${b64u(sig)}`;
}

function makeEnv(extra = {}) {
  const map = new Map();
  const kv = {
    map,
    get: async k => (map.has(k) ? map.get(k) : null),
    put: async (k, v) => { map.set(k, v); },
    delete: async k => { map.delete(k); },
  };
  kv.map.set('coach:coach@example.com', JSON.stringify({ name: 'Coach Aino' }));
  return { GYMTRACK_DATA: kv, GYMTRACK_WRITE_SECRET: SECRET, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ...extra };
}
async function call(env, method, path, { body, token, access } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-GymTrack-Write'] = token;
  if (access) headers['Cf-Access-Jwt-Assertion'] = access;
  const res = await worker.default.fetch(new Request('https://api.example' + path, {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { status: res.status, body: await res.json().catch(() => null) };
}
const tokenFor = uuid => worker.deriveWriteToken(SECRET, uuid);
const PLAN = { type: 'workout-plan', version: 1, name: 'Team block', days: [
  { name: 'Team A', exercises: [{ name: 'Back Squat', sets: 3, reps: '5', weight: 100, equipment: 'barbell' }] },
] };

async function linkedEnv() {
  const env = makeEnv();
  const access = await jwt();
  const { body: inv } = await call(env, 'POST', '/coach/invite', { access });
  const link = await call(env, 'POST', '/link', { body: { code: inv.code, uuid: ATHLETE, displayName: 'Henri' } });
  return { env, access, link };
}

test('coach routes reject missing, forged, expired and wrong-audience Access tokens', async () => {
  coachMod._resetAccessCertCache();
  const env = makeEnv();
  assert.equal((await call(env, 'GET', '/coach/me')).status, 401);
  const other = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  assert.equal((await call(env, 'GET', '/coach/me', { access: await jwt({}, { key: other.privateKey }) })).status, 401);
  assert.equal((await call(env, 'GET', '/coach/me', { access: await jwt({ exp: 1 }) })).status, 401);
  assert.equal((await call(env, 'GET', '/coach/me', { access: await jwt({ aud: ['nope'] }) })).status, 401);
  assert.equal((await call(env, 'GET', '/coach/me', { access: await jwt({ iss: 'https://evil.example' }) })).status, 401);
  assert.equal((await call(env, 'GET', '/coach/me', { access: (await jwt()) + 'x' })).status, 401);
  // Valid token, but the email is not a registered coach.
  assert.equal((await call(env, 'GET', '/coach/me', { access: await jwt({ email: 'rando@example.com' }) })).status, 403);
  const ok = await call(env, 'GET', '/coach/me', { access: await jwt() });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.name, 'Coach Aino');
});

test('everything fails closed without Access or write-secret configuration', async () => {
  const access = await jwt();
  assert.equal((await call(makeEnv({ GYMTRACK_WRITE_SECRET: '' }), 'GET', '/coach/me', { access })).status, 503);
  assert.equal((await call(makeEnv({ ACCESS_AUD: '' }), 'GET', '/coach/me', { access })).status, 401);
  assert.equal((await call(makeEnv({ GYMTRACK_WRITE_SECRET: '' }), 'GET', '/inbox/' + ATHLETE)).status, 503);
});

test('invite code issues a write token for a new athlete, once', async () => {
  const { env, access, link } = await linkedEnv();
  assert.equal(link.status, 200);
  assert.equal(link.body.writeToken, await tokenFor(ATHLETE));
  assert.equal(link.body.coachName, 'Coach Aino');
  const roster = await call(env, 'GET', '/coach/roster', { access });
  assert.deepEqual(roster.body.athletes.map(a => a.athleteUuid), [ATHLETE]);
  // Reusing the consumed code fails.
  const code = [...env.GYMTRACK_DATA.map.keys()].find(k => k.startsWith('invite:')).slice(7);
  assert.equal((await call(env, 'POST', '/link', { body: { code, uuid: OTHER } })).status, 404);
});

test('an invite code never hands out the token of a UUID that already exists', async () => {
  const env = makeEnv();
  const access = await jwt();
  env.GYMTRACK_DATA.map.set(ATHLETE, JSON.stringify({ type: 'gymtrack-backup', sessions: [] }));
  const { body: inv } = await call(env, 'POST', '/coach/invite', { access });
  const noToken = await call(env, 'POST', '/link', { body: { code: inv.code, uuid: ATHLETE } });
  assert.equal(noToken.status, 401);
  assert.equal(noToken.body.writeToken, undefined);
  // The owner can still link by proving the token; nothing is re-issued.
  const owner = await call(env, 'POST', '/link', { body: { code: inv.code, uuid: ATHLETE }, token: await tokenFor(ATHLETE) });
  assert.equal(owner.status, 200);
  assert.equal(owner.body.writeToken, undefined);
});

test('expired and malformed invite codes are refused', async () => {
  const env = makeEnv();
  env.GYMTRACK_DATA.map.set('invite:ABCDEFGH', JSON.stringify({ coachId: 'coach@example.com', expiresAt: Date.now() - 1 }));
  assert.equal((await call(env, 'POST', '/link', { body: { code: 'ABCDEFGH', uuid: ATHLETE } })).status, 404);
  assert.equal((await call(env, 'POST', '/link', { body: { code: 'bad', uuid: ATHLETE } })).status, 400);
});

test('assign: roster-only, validated before any inbox write, delivered and acked', async () => {
  const { env, access, link } = await linkedEnv();
  const token = link.body.writeToken;
  const off = await call(env, 'POST', '/coach/assign', { access, body: { plan: PLAN, athletes: [ATHLETE, OTHER] } });
  assert.equal(off.status, 403);
  assert.deepEqual(off.body.athletes, [OTHER]);
  const bad = { ...PLAN, days: [{ name: 'X', exercises: [{ name: 'Row', sets: 3, reps: '8', weight: 27.5, equipment: 'cable', metric: 'nonsense' }] }] };
  assert.equal((await call(env, 'POST', '/coach/assign', { access, body: { plan: bad, athletes: [ATHLETE] } })).status, 400);
  assert.equal(env.GYMTRACK_DATA.map.has('inbox:' + ATHLETE), false, 'no inbox write on an invalid plan');

  const sent = await call(env, 'POST', '/coach/assign', { access, body: { plan: PLAN, athletes: [ATHLETE], note: 'Week 1' } });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.results[ATHLETE], 'sent');

  assert.equal((await call(env, 'GET', '/inbox/' + ATHLETE)).status, 401, 'inbox is not readable by UUID alone');
  const inbox = await call(env, 'GET', '/inbox/' + ATHLETE, { token });
  assert.equal(inbox.body.items.length, 1);
  assert.equal(inbox.body.items[0].plan.name, 'Team block');
  assert.equal(inbox.body.coach.name, 'Coach Aino');

  assert.equal((await call(env, 'POST', `/inbox/${ATHLETE}/${sent.body.id}/ack`, { token, body: { status: 'accepted' } })).status, 200);
  assert.equal((await call(env, 'GET', '/inbox/' + ATHLETE, { token })).body.items.length, 0);
  const status = await call(env, 'GET', '/coach/assignments', { access });
  assert.equal(status.body.assignments[0].athletes[ATHLETE], 'accepted');
});

test('a newer program from the same coach supersedes a pending one', async () => {
  const { env, access, link } = await linkedEnv();
  await call(env, 'POST', '/coach/assign', { access, body: { plan: PLAN, athletes: [ATHLETE] } });
  await call(env, 'POST', '/coach/assign', { access, body: { plan: { ...PLAN, name: 'Block 2' }, athletes: [ATHLETE] } });
  const inbox = await call(env, 'GET', '/inbox/' + ATHLETE, { token: link.body.writeToken });
  assert.deepEqual(inbox.body.items.map(i => i.plan.name), ['Block 2']);
});

test('coach reads a linked athlete’s training data only, and loses it on unlink', async () => {
  const { env, access, link } = await linkedEnv();
  env.GYMTRACK_DATA.map.set(ATHLETE, JSON.stringify({ type: 'gymtrack-backup', updatedAt: 5, plan: PLAN, sessions: [{ id: 's1' }], bodyWeight: [], settings: { secret: 1 }, aliases: { a: 'b' } }));
  const read = await call(env, 'GET', '/coach/athlete/' + ATHLETE, { access });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.sessions, [{ id: 's1' }]);
  assert.equal(read.body.settings, undefined);
  assert.equal(read.body.aliases, undefined);
  assert.equal((await call(env, 'GET', '/coach/athlete/' + OTHER, { access })).status, 404);

  // Athlete unlinks themselves: access ends immediately.
  assert.equal((await call(env, 'DELETE', `/inbox/${ATHLETE}/coach`, { token: link.body.writeToken })).status, 200);
  assert.equal((await call(env, 'GET', '/coach/athlete/' + ATHLETE, { access })).status, 404);
  assert.equal((await call(env, 'GET', '/coach/roster', { access })).body.athletes.length, 0);
});

test('coach unlink withdraws pending programs', async () => {
  const { env, access, link } = await linkedEnv();
  await call(env, 'POST', '/coach/assign', { access, body: { plan: PLAN, athletes: [ATHLETE] } });
  assert.equal((await call(env, 'DELETE', '/coach/roster/' + ATHLETE, { access })).status, 200);
  assert.equal((await call(env, 'GET', '/inbox/' + ATHLETE, { token: link.body.writeToken })).body.items.length, 0);
});

test('a coach token cannot write athlete backups; existing /data routes unchanged', async () => {
  const { env, access } = await linkedEnv();
  const res = await worker.default.fetch(new Request('https://api.example/data/' + ATHLETE, {
    method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': access }, body: JSON.stringify({ type: 'gymtrack-backup' }),
  }), env);
  assert.equal(res.status, 401);
});
