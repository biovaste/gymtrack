/* GymTrack sync API — Cloudflare Worker over KV.
 *
 * Auth model: GET is open. The UUID is a bearer-grade read secret that is
 * deliberately pasted into AI chats via the "Share with AI" link, so read
 * access by URL is the accepted trade-off. WRITE access is not — a POST is
 * gated on a token derived from a Worker-side secret, so a leaked share URL
 * can never overwrite the training history.
 */

import ExerciseLibrary from '../../exercise-library.js';
import WorkoutModel from '../../workout-model.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-GymTrack-Write',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 2 * 1024 * 1024;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});

/** HMAC-SHA256(secret, uuid) as lowercase hex. Derived, never stored per-user. */
export async function deriveWriteToken(secret, uuid) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(uuid.toLowerCase()));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare. Length is not secret here; the bytes are. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Pull the presented token from either header form. */
function presentedToken(request) {
  const direct = request.headers.get('X-GymTrack-Write');
  if (direct) return direct.trim();
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

/**
 * Returns null when the write is allowed, or a Response to return otherwise.
 * With no GYMTRACK_WRITE_SECRET configured the check is inert — this is the
 * deploy window that lets the Worker ship before any client holds a token.
 */
export async function checkWrite(request, env, uuid) {
  const secret = env.GYMTRACK_WRITE_SECRET;
  if (!secret) return null;
  const expected = await deriveWriteToken(secret, uuid);
  if (!safeEqual(presentedToken(request), expected)) {
    return json({ error: 'Write token missing or invalid' }, 401);
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const parts = url.pathname.split('/').filter(Boolean);

    if (parts[0] !== 'data' || !parts[1]) {
      return json({ error: 'Not found' }, 404);
    }

    const uuid = parts[1];
    if (!UUID_RE.test(uuid)) {
      return json({ error: 'Invalid UUID' }, 400);
    }

    // GET /data/:uuid — read. Intentionally unauthenticated beyond the UUID.
    if (method === 'GET' && parts.length === 2) {
      const val = await env.GYMTRACK_DATA.get(uuid);
      if (val === null) return json({ error: 'Not found' }, 404);
      return new Response(val, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // POST /data/:uuid — full backup write
    if (method === 'POST' && parts.length === 2) {
      const denied = await checkWrite(request, env, uuid);
      if (denied) return denied;

      const body = await request.text();
      if (body.length > MAX_BODY) return json({ error: 'Payload too large' }, 413);

      // Stale-write guard: a device sitting on old state must not clobber a
      // newer backup. The client answers a 409 by reconciling and retrying.
      // ?force=1 is the deliberate-overwrite escape hatch for the CLI.
      if (url.searchParams.get('force') !== '1') {
        let incoming = null;
        try { incoming = JSON.parse(body); } catch { return json({ error: 'Invalid JSON' }, 400); }
        const existing = await env.GYMTRACK_DATA.get(uuid);
        if (existing) {
          let stored = null;
          try { stored = JSON.parse(existing); } catch { stored = null; }
          const storedAt = stored && typeof stored.updatedAt === 'number' ? stored.updatedAt : null;
          const incomingAt = incoming && typeof incoming.updatedAt === 'number' ? incoming.updatedAt : null;
          // A missing/non-numeric incoming stamp expresses no opinion — allow it.
          if (storedAt !== null && incomingAt !== null && storedAt > incomingAt) {
            return json({ error: 'stale', updatedAt: storedAt }, 409);
          }
        }
      }

      await env.GYMTRACK_DATA.put(uuid, body);
      return json({ ok: true });
    }

    // POST /data/:uuid/plan — plan-only update (preserves sessions + bodyWeight)
    if (method === 'POST' && parts.length === 3 && parts[2] === 'plan') {
      const denied = await checkWrite(request, env, uuid);
      if (denied) return denied;

      const body = await request.text();
      if (body.length > MAX_BODY) return json({ error: 'Payload too large' }, 413);
      let newPlan;
      try { newPlan = JSON.parse(body); } catch { return json({ error: 'Invalid JSON' }, 400); }

      const existing = await env.GYMTRACK_DATA.get(uuid);
      if (!existing) return json({ error: 'No existing backup for this UUID — push a full backup first.' }, 404);
      let backup;
      try { backup = JSON.parse(existing); } catch { return json({ error: 'Corrupt backup in storage' }, 500); }
      if (backup.type !== 'gymtrack-backup') return json({ error: 'Stored data is not a GymTrack backup' }, 400);

      // No stale guard needed here: this route is read-modify-write on the
      // current record and stamps updatedAt itself.
      // Share the client/desktop rule: plan replacement retains reusable entries.
      try {
        if (!newPlan || typeof newPlan !== 'object' || !Array.isArray(newPlan.days)) return json({ error: 'Invalid plan' }, 400);
        const invalid = newPlan.library == null ? [] : WorkoutModel.libraryListErrors(newPlan.library);
        for (const day of newPlan.days) for (const e of day.exercises || []) {
          for (const x of [e, ...(e.alternates || [])]) if (x.libraryEntry != null) invalid.push(...WorkoutModel.errors(x));
        }
        if (invalid.length) return json({ error: 'Invalid library data' }, 400);
        newPlan.library = ExerciseLibrary.importLibrary(backup.plan || {}, newPlan);
      } catch { return json({ error: 'Invalid library data' }, 400); }
      backup.plan = newPlan;
      backup.updatedAt = Date.now();
      backup.exportedAt = new Date().toISOString();
      await env.GYMTRACK_DATA.put(uuid, JSON.stringify(backup, null, 2));
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  },
};
