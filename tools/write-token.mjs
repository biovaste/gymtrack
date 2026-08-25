#!/usr/bin/env node
/*
 * write-token.mjs — derive the GymTrack write token for a UUID.
 *
 * The Worker gates every POST on HMAC-SHA256(GYMTRACK_WRITE_SECRET, uuid).
 * It never hands the token out over the network — that would make it exactly
 * as guessable as the UUID it protects — so it is derived here and moved
 * out-of-band: pasted into the app's Settings once per device, and set as
 * GYMTRACK_WRITE_TOKEN for tools/push-plan.mjs.
 *
 * Usage:
 *   set GYMTRACK_WRITE_SECRET=<the Worker secret>
 *   node tools/write-token.mjs <uuid>
 *
 * The UUID falls back to the same resolution push-plan.mjs uses.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const secret = process.env.GYMTRACK_WRITE_SECRET;
if (!secret) {
  console.error(
    '✗ GYMTRACK_WRITE_SECRET not set.\n' +
    '  This is the same value given to: wrangler secret put GYMTRACK_WRITE_SECRET'
  );
  process.exit(1);
}

let uuid = process.argv[2] || process.env.GYMTRACK_UUID || '';
if (!uuid) { try { uuid = readFileSync('.gymtrack-uuid', 'utf8').trim(); } catch {} }
uuid = uuid.trim().toLowerCase();

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
  console.error('✗ Pass a valid UUID: node tools/write-token.mjs <uuid>');
  process.exit(1);
}

// Must match deriveWriteToken() in worker/src/index.js byte for byte.
console.log(createHmac('sha256', secret).update(uuid).digest('hex'));
