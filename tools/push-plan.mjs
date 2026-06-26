#!/usr/bin/env node
/*
 * push-plan.mjs — push a workout plan from this desktop to the GymTrack Worker,
 * so the mobile app loads it automatically on next launch.
 *
 * It does a safe read-modify-write: only the `plan` is replaced; your logged
 * sessions and body-weight history are preserved. The sync timestamp is bumped
 * so the app knows the cloud copy is newer and pulls it.
 *
 * How to find your UUID:
 *   - From the app: Claude tab → copy the "Your backup code" value
 *   - Or: localStorage.getItem('gymtrack_uuid') in browser devtools on the installed app
 *
 * UUID resolution order:
 *   1. GYMTRACK_UUID environment variable
 *   2. --uuid <value> CLI argument
 *   3. .gymtrack-uuid file in the project root
 *
 * Usage:
 *   node tools/push-plan.mjs path/to/plan.json          # plan from a file
 *   node tools/push-plan.mjs --uuid <uuid> plan.json    # explicit UUID
 *   echo '<workout-plan json>' | node tools/push-plan.mjs   # or via stdin
 */
import { readFileSync } from 'node:fs';

const WORKER_URL = 'https://gymtrack.henri-haukkovaara.workers.dev';

function resolveUUID() {
  if (process.env.GYMTRACK_UUID) return process.env.GYMTRACK_UUID.trim();
  const uuidArg = process.argv.indexOf('--uuid');
  if (uuidArg !== -1 && process.argv[uuidArg + 1]) return process.argv[uuidArg + 1].trim();
  try { return readFileSync('.gymtrack-uuid', 'utf8').trim(); } catch {}
  console.error(
    '✗ UUID not found.\n' +
    '  From the app: Claude tab → copy "Your backup code".\n' +
    '  Then: set GYMTRACK_UUID=<uuid>, pass --uuid <uuid>, or save it in .gymtrack-uuid'
  );
  process.exit(1);
}

function readNewPlan() {
  // Skip --uuid <val> pair; the first remaining arg is the plan file (or read stdin).
  let fileArg = null;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--uuid') { i++; continue; }
    fileArg = process.argv[i]; break;
  }
  let raw = fileArg ? readFileSync(fileArg, 'utf8') : readFileSync(0, 'utf8');
  raw = raw.replace(/^﻿/, '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const plan = JSON.parse(raw);
  if (plan.type && plan.type !== 'workout-plan') throw new Error('Plan JSON "type" must be "workout-plan".');
  if (!Array.isArray(plan.days) || !plan.days.length) throw new Error('Plan needs a non-empty "days" array.');
  return plan;
}

async function main() {
  const uuid = resolveUUID();
  const newPlan = readNewPlan();

  // Fetch current backup
  const getRes = await fetch(`${WORKER_URL}/data/${uuid}`);
  if (!getRes.ok && getRes.status !== 404) {
    throw new Error(`Failed to fetch current data: HTTP ${getRes.status}`);
  }

  let backup = null;
  if (getRes.ok) {
    try { backup = JSON.parse(await getRes.text()); } catch {}
  }
  if (!backup || backup.type !== 'gymtrack-backup') {
    throw new Error('No existing backup found. Open the app on your phone and let it sync first.');
  }

  const keptSessions = (backup.sessions || []).length;
  const keptBw = (backup.bodyWeight || []).length;
  const oldPlan = backup.plan && backup.plan.name;

  backup.plan = newPlan;
  backup.updatedAt = Date.now();
  backup.exportedAt = new Date().toISOString();

  const postRes = await fetch(`${WORKER_URL}/data/${uuid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(backup, null, 2),
  });
  if (!postRes.ok) throw new Error(`Failed to push: HTTP ${postRes.status}`);

  console.log(`✓ Pushed plan "${newPlan.name || '(unnamed)'}" — ${newPlan.days.length} day(s).`);
  console.log(`  Kept ${keptSessions} session(s) and ${keptBw} body-weight entr${keptBw === 1 ? 'y' : 'ies'}; replaced previous plan "${oldPlan || '—'}".`);
  console.log('  Open the GymTrack app on your phone — it loads the new plan on launch.');
}

main().catch(e => { console.error('✗ ' + e.message); process.exit(1); });
