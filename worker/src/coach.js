/* Coach routes for the athlete alpha. See docs/plans/2026-09-19-coach-interface.md.
 *
 * Auth model:
 * - Coaches are signed in by Cloudflare Access. The Worker verifies the Access JWT
 *   (signature, audience, issuer, expiry) and takes the coach's identity from its
 *   email claim. A verified email is only a coach if `coach:<email>` exists in KV.
 * - Athletes authenticate with their existing write token (HMAC of their UUID).
 * - Everything here fails closed: without ACCESS_TEAM_DOMAIN, ACCESS_AUD and
 *   GYMTRACK_WRITE_SECRET every route refuses. Unlike /data, there is no inert
 *   deploy window.
 * - A coach never writes an athlete's backup. Programs go to the athlete's inbox and
 *   the athlete's own app applies them.
 */
import WorkoutModel from '../../workout-model.js';

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
const INBOX_CAP = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVITE_RE = /^[A-HJ-NP-Z2-9]{8}$/; // no 0/O/1/I: the athlete types it

/* ---------------- Cloudflare Access JWT ---------------- */
const b64urlBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const b64urlJson = s => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

let certCache = { domain: '', keys: null, at: 0 };
export function _resetAccessCertCache() { certCache = { domain: '', keys: null, at: 0 }; }

async function accessKeys(domain) {
  if (certCache.domain === domain && certCache.keys && Date.now() - certCache.at < 3600 * 1000) return certCache.keys;
  const res = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('certs unavailable');
  const { keys } = await res.json();
  certCache = { domain, keys: keys || [], at: Date.now() };
  return certCache.keys;
}

/** Returns the verified payload, or null. Never throws on a bad token. */
export async function verifyAccessJwt(token, env) {
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const header = b64urlJson(h), payload = b64urlJson(p);
    if (header.alg !== 'RS256') return null;
    const jwk = (await accessKeys(env.ACCESS_TEAM_DOMAIN)).find(k => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(s), new TextEncoder().encode(h + '.' + p));
    if (!ok) return null;
    const now = Date.now() / 1000;
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.ACCESS_AUD)) return null;
    if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    if (typeof payload.exp !== 'number' || payload.exp < now) return null;
    if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return null;
    if (typeof payload.email !== 'string' || !payload.email) return null;
    return payload;
  } catch { return null; }
}

/* ---------------- helpers ---------------- */
async function getJson(kv, key, fallback = null) {
  const raw = await kv.get(key);
  if (raw === null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
const putJson = (kv, key, value) => kv.put(key, JSON.stringify(value));

function newInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}
const newId = () => crypto.randomUUID();

function planErrors(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.days) || !plan.days.length) return ['plan must have days'];
  const errs = plan.library == null ? [] : WorkoutModel.libraryListErrors(plan.library);
  for (const day of plan.days) {
    if (!day || typeof day.name !== 'string' || !Array.isArray(day.exercises)) { errs.push('each day needs a name and exercises'); continue; }
    for (const e of day.exercises) for (const x of [e, ...(e.alternates || [])]) errs.push(...WorkoutModel.errors(x));
  }
  return errs;
}

/* ---------------- router ---------------- */
/**
 * Handles /coach/*, /link and /inbox/*. Returns null for any other path so the
 * caller falls through to the /data routes.
 * `ctx` supplies { json, checkAthlete(request, uuid) -> bool, deriveWriteToken }.
 */
export async function handleCoachRoutes(request, env, parts, ctx) {
  const { json } = ctx;
  const [root] = parts;
  if (root !== 'coach' && root !== 'link' && root !== 'inbox') return null;
  if (!env.GYMTRACK_WRITE_SECRET) return json({ error: 'Coach features are not configured' }, 503);
  const kv = env.GYMTRACK_DATA;
  const method = request.method;
  const body = async () => { try { return await request.json(); } catch { return null; } };

  /* ---- athlete side ---- */
  if (root === 'link' && method === 'POST' && parts.length === 1) {
    const b = await body();
    const code = String(b?.code || '').trim().toUpperCase();
    const uuid = String(b?.uuid || '').toLowerCase();
    const displayName = String(b?.displayName || '').trim().slice(0, 60);
    if (!INVITE_RE.test(code) || !UUID_RE.test(uuid)) return json({ error: 'Invalid code or UUID' }, 400);
    const invite = await getJson(kv, 'invite:' + code);
    if (!invite || invite.usedAt || invite.expiresAt < Date.now()) return json({ error: 'Invite code is invalid or expired' }, 404);
    const coach = await getJson(kv, 'coach:' + invite.coachId);
    if (!coach) return json({ error: 'Invite code is invalid or expired' }, 404);

    const existingLink = await getJson(kv, 'athlete:' + uuid);
    const hasData = (await kv.get(uuid)) !== null;
    let writeToken = null;
    if (existingLink || hasData) {
      // An existing athlete links by proving they own the UUID. The token is
      // never re-issued: a code must not hand out someone else's credential.
      if (!(await ctx.checkAthlete(request, uuid))) return json({ error: 'This device already has data; send its write token to link it' }, 401);
      if (existingLink && existingLink.coachId !== invite.coachId) return json({ error: 'Already linked to another coach; unlink first' }, 409);
    } else {
      writeToken = await ctx.deriveWriteToken(env.GYMTRACK_WRITE_SECRET, uuid);
    }
    // Consume the code before linking, so a retry after a partial failure can't reuse it.
    await putJson(kv, 'invite:' + code, { ...invite, usedAt: Date.now(), usedBy: uuid });
    const link = { coachId: invite.coachId, coachName: coach.name, displayName, linkedAt: Date.now() };
    await putJson(kv, 'athlete:' + uuid, link);
    const roster = (await getJson(kv, 'roster:' + invite.coachId, [])).filter(a => a.athleteUuid !== uuid);
    roster.push({ athleteUuid: uuid, displayName, linkedAt: link.linkedAt });
    await putJson(kv, 'roster:' + invite.coachId, roster);
    return json({ ok: true, coachName: coach.name, ...(writeToken ? { writeToken } : {}) });
  }

  if (root === 'inbox') {
    const uuid = String(parts[1] || '').toLowerCase();
    if (!UUID_RE.test(uuid)) return json({ error: 'Invalid UUID' }, 400);
    if (!(await ctx.checkAthlete(request, uuid))) return json({ error: 'Write token missing or invalid' }, 401);
    const link = await getJson(kv, 'athlete:' + uuid);

    if (method === 'GET' && parts.length === 2) {
      const inbox = await getJson(kv, 'inbox:' + uuid, []);
      return json({ coach: link ? { id: link.coachId, name: link.coachName } : null, items: inbox.filter(i => i.status === 'sent') });
    }
    if (method === 'POST' && parts.length === 4 && parts[3] === 'ack') {
      const b = await body();
      const status = b?.status;
      if (status !== 'accepted' && status !== 'declined') return json({ error: 'status must be accepted or declined' }, 400);
      const inbox = await getJson(kv, 'inbox:' + uuid, []);
      const item = inbox.find(i => i.id === parts[2]);
      if (!item) return json({ error: 'Not found' }, 404);
      item.status = status; item.ackedAt = Date.now();
      await putJson(kv, 'inbox:' + uuid, inbox);
      const assign = await getJson(kv, `assign:${item.coachId}:${item.id}`);
      if (assign && assign.athletes[uuid]) { assign.athletes[uuid] = status; await putJson(kv, `assign:${item.coachId}:${item.id}`, assign); }
      return json({ ok: true });
    }
    if (method === 'DELETE' && parts.length === 3 && parts[2] === 'coach') {
      if (link) await unlink(kv, link.coachId, uuid);
      return json({ ok: true });
    }
    return json({ error: 'Not found' }, 404);
  }

  /* ---- coach side: Cloudflare Access only ---- */
  const jwt = await verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'), env);
  if (!jwt) return json({ error: 'Coach sign-in required' }, 401);
  const coachId = jwt.email.toLowerCase();
  const coach = await getJson(kv, 'coach:' + coachId);
  if (!coach) return json({ error: 'Not a registered coach' }, 403);
  const roster = await getJson(kv, 'roster:' + coachId, []);
  const onRoster = uuid => roster.some(a => a.athleteUuid === uuid);

  if (method === 'GET' && parts[1] === 'me' && parts.length === 2) return json({ id: coachId, name: coach.name });

  if (method === 'POST' && parts[1] === 'invite' && parts.length === 2) {
    let code;
    do { code = newInviteCode(); } while (await kv.get('invite:' + code));
    const expiresAt = Date.now() + INVITE_TTL_MS;
    await putJson(kv, 'invite:' + code, { coachId, expiresAt });
    return json({ code, expiresAt });
  }

  if (parts[1] === 'roster') {
    if (method === 'GET' && parts.length === 2) return json({ athletes: roster });
    if (method === 'DELETE' && parts.length === 3) {
      const uuid = String(parts[2]).toLowerCase();
      if (!onRoster(uuid)) return json({ error: 'Not on your roster' }, 404);
      await unlink(kv, coachId, uuid);
      return json({ ok: true });
    }
  }

  if (method === 'GET' && parts[1] === 'athlete' && parts.length === 3) {
    const uuid = String(parts[2]).toLowerCase();
    if (!onRoster(uuid)) return json({ error: 'Not on your roster' }, 404);
    const raw = await kv.get(uuid);
    if (raw === null) return json({ sessions: [], bodyWeight: [], plan: null });
    let b; try { b = JSON.parse(raw); } catch { return json({ error: 'Corrupt athlete record' }, 500); }
    // Training data only. Settings and aliases stay private.
    return json({ updatedAt: b.updatedAt || 0, plan: b.plan || null, sessions: b.sessions || [], bodyWeight: b.bodyWeight || [] });
  }

  if (parts[1] === 'assign' && method === 'POST' && parts.length === 2) {
    const b = await body();
    const plan = b?.plan;
    const athletes = Array.isArray(b?.athletes) ? [...new Set(b.athletes.map(a => String(a).toLowerCase()))] : [];
    if (!athletes.length) return json({ error: 'Pick at least one athlete' }, 400);
    const notLinked = athletes.filter(a => !onRoster(a));
    if (notLinked.length) return json({ error: 'Not on your roster', athletes: notLinked }, 403);
    const errs = planErrors(plan);
    if (errs.length) return json({ error: 'Invalid plan: ' + errs.join(', ') }, 400);
    if (JSON.stringify(plan).length > 512 * 1024) return json({ error: 'Plan too large' }, 413);

    const id = newId(), sentAt = Date.now();
    const note = String(b?.note || '').slice(0, 500);
    const results = {};
    for (const uuid of athletes) {
      try {
        const inbox = await getJson(kv, 'inbox:' + uuid, []);
        // A newer program from the same coach supersedes one still pending.
        for (const i of inbox) if (i.coachId === coachId && i.status === 'sent') i.status = 'superseded';
        inbox.push({ id, coachId, coachName: coach.name, plan, note, sentAt, status: 'sent' });
        await putJson(kv, 'inbox:' + uuid, inbox.slice(-INBOX_CAP));
        results[uuid] = 'sent';
      } catch (e) { results[uuid] = 'failed'; }
    }
    await putJson(kv, `assign:${coachId}:${id}`, { id, planName: String(plan.name || ''), note, sentAt, athletes: results });
    const index = await getJson(kv, 'assignments:' + coachId, []);
    index.push(id);
    await putJson(kv, 'assignments:' + coachId, index.slice(-50));
    return json({ id, results });
  }

  if (parts[1] === 'assignments' && method === 'GET' && parts.length === 2) {
    const ids = await getJson(kv, 'assignments:' + coachId, []);
    const list = [];
    for (const id of ids.slice().reverse()) { const a = await getJson(kv, `assign:${coachId}:${id}`); if (a) list.push(a); }
    return json({ assignments: list });
  }

  return json({ error: 'Not found' }, 404);
}

async function unlink(kv, coachId, uuid) {
  const roster = (await getJson(kv, 'roster:' + coachId, [])).filter(a => a.athleteUuid !== uuid);
  await putJson(kv, 'roster:' + coachId, roster);
  const link = await getJson(kv, 'athlete:' + uuid);
  if (link && link.coachId === coachId) await kv.delete('athlete:' + uuid);
  // Pending programs from this coach are withdrawn; accepted ones stay in the athlete's plan.
  const inbox = await getJson(kv, 'inbox:' + uuid, []);
  let changed = false;
  for (const i of inbox) if (i.coachId === coachId && i.status === 'sent') { i.status = 'withdrawn'; changed = true; }
  if (changed) await putJson(kv, 'inbox:' + uuid, inbox);
}
