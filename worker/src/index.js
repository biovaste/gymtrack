export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

    const parts = url.pathname.split('/').filter(Boolean);

    if (parts[0] !== 'data' || !parts[1]) {
      return json({ error: 'Not found' }, 404);
    }

    const uuid = parts[1];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
      return json({ error: 'Invalid UUID' }, 400);
    }

    // GET /data/:uuid — read
    if (method === 'GET' && parts.length === 2) {
      const val = await env.GYMTRACK_DATA.get(uuid);
      if (val === null) return json({ error: 'Not found' }, 404);
      return new Response(val, { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // POST /data/:uuid — full backup write
    if (method === 'POST' && parts.length === 2) {
      const body = await request.text();
      if (body.length > 2 * 1024 * 1024) return json({ error: 'Payload too large' }, 413);
      await env.GYMTRACK_DATA.put(uuid, body);
      return json({ ok: true });
    }

    // POST /data/:uuid/plan — plan-only update (preserves sessions + bodyWeight)
    if (method === 'POST' && parts.length === 3 && parts[2] === 'plan') {
      const body = await request.text();
      if (body.length > 2 * 1024 * 1024) return json({ error: 'Payload too large' }, 413);
      let newPlan;
      try { newPlan = JSON.parse(body); } catch { return json({ error: 'Invalid JSON' }, 400); }

      const existing = await env.GYMTRACK_DATA.get(uuid);
      if (!existing) return json({ error: 'No existing backup for this UUID — push a full backup first.' }, 404);
      let backup;
      try { backup = JSON.parse(existing); } catch { return json({ error: 'Corrupt backup in storage' }, 500); }
      if (backup.type !== 'gymtrack-backup') return json({ error: 'Stored data is not a GymTrack backup' }, 400);

      backup.plan = newPlan;
      backup.updatedAt = Date.now();
      backup.exportedAt = new Date().toISOString();
      await env.GYMTRACK_DATA.put(uuid, JSON.stringify(backup, null, 2));
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  },
};
