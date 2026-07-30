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

const WORKER_URL = 'https://api.gymtrack.hithitpull.fi';

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

/*
 * Loadable-weight ladder for Henri's gym, derived from what has actually been
 * logged (see "Loadable weights" in sports/CLAUDE.md):
 *   plate-loaded  — 1.25 kg plates exist, so (weight − barWeight) steps by 2.5
 *   dumbbell      — even kg only (…12, 20, 22, 24…); 22.5 does not exist
 *   cable/machine — 5 kg stack steps
 *   bodyweight    — must be 0, or the app's grayed weight field logs nonsense
 * Two real bugs this catches: a planned 22.5 kg dumbbell row, and a planned
 * 85 kg trap bar RDL (23 + 62 is unreachable — it's 83 or 88).
 */
const BAR_DEFAULTS = { barbell: 20, 'trap-bar': 23, 'training-bar': 10 };
const isStep = (v, step) => Math.abs(v / step - Math.round(v / step)) < 1e-9;

function weightProblem(equipment, weight, barWeight) {
  const eq = equipment || 'barbell';
  if (eq === 'other' || !weight) return eq === 'bodyweight' && weight ? 'bodyweight moves must have weight 0' : null;
  if (eq === 'bodyweight') return 'bodyweight moves must have weight 0';
  if (eq === 'dumbbell') return isStep(weight, 2) ? null : 'dumbbells go in 2 kg steps (even kg only)';
  if (eq === 'cable' || eq === 'machine') return isStep(weight, 5) ? null : 'cable/machine stacks go in 5 kg steps';
  if (eq === 'landmine') return isStep(weight, 1.25) ? null : 'landmine plate load must be a multiple of 1.25 kg';
  const bar = barWeight != null ? barWeight : BAR_DEFAULTS[eq];
  if (bar == null) return null;
  const load = weight - bar;
  if (load < 0) return `below the empty ${eq} (${bar} kg) — is the equipment type wrong?`;
  if (!isStep(load, 2.5)) {
    const lo = bar + Math.floor(load / 2.5) * 2.5, hi = lo + 2.5;
    return `not loadable on a ${bar} kg bar with 1.25 kg plates — nearest are ${lo} and ${hi} kg`;
  }
  return null;
}

/*
 * Alternates have no `equipment` field of their own — the app strips unknown keys
 * and a swap keeps the parent's equipment — so guess from the name and only fall
 * back to the parent's. Without this, a dumbbell alternate under a barbell parent
 * gets judged against the barbell ladder and warns for no reason.
 */
function guessAlternateEquipment(name, parentEquipment) {
  const n = String(name || '');
  if (/\bDB\b|dumbbell|hammer curl/i.test(n)) return 'dumbbell';
  if (/cable|pulldown|pallof|rope/i.test(n)) return 'cable';
  if (/trap bar/i.test(n)) return 'trap-bar';
  if (/calf raise|machine/i.test(n)) return 'machine';
  return parentEquipment;
}

/*
 * Two failure modes that have shipped to the phone before, so they are checked
 * here rather than trusted to whoever wrote the plan:
 *   1. Duplicate exercise names. History, PR tracking and the aliases map are all
 *      keyed on name globally, not per day — so "Cable Triceps Extension" on both
 *      Day A (single-arm) and Day B (two-arm) silently merged two different
 *      movements' loads into one progression history.
 *   2. Weights that cannot be loaded on the actual equipment.
 */
function validatePlan(plan, { unit = 'kg' } = {}) {
  const errors = [], warnings = [];

  const seen = new Map();
  for (const day of plan.days) {
    for (const e of day.exercises || []) {
      const key = String(e.name || '').trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) {
        errors.push(
          `Duplicate exercise name "${e.name}" (${seen.get(key)} and ${day.name}). ` +
          'Exercise history is keyed on name across the whole plan, so two different ' +
          'movements sharing a name merge into one progression history. Give each a ' +
          'distinct name (e.g. "… — Single-Arm" / "… — Two-Arm").'
        );
      } else {
        seen.set(key, day.name);
      }
    }
  }

  if (unit !== 'kg') {
    warnings.push(`Unit is "${unit}" — the loadable-weight ladder is kg-only, so weights were not checked.`);
  } else {
    for (const day of plan.days) {
      for (const e of day.exercises || []) {
        const p = weightProblem(e.equipment, e.weight, e.barWeight);
        if (p) errors.push(`${day.name} → ${e.name}: ${e.weight} kg ${p}`);
        // Alternate equipment is inferred, so these are warnings rather than errors.
        for (const a of e.alternates || []) {
          if (!a.weight) continue; // 0 = bodyweight/interval alternate
          const aEq = guessAlternateEquipment(a.name, e.equipment);
          const ap = weightProblem(aEq, a.weight, aEq === e.equipment ? e.barWeight : null);
          if (ap) warnings.push(`${day.name} → ${e.name} → alternate "${a.name}": ${a.weight} kg ${ap} (equipment inferred as "${aEq || 'barbell'}")`);
        }
      }
    }
  }
  return { errors, warnings };
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

  const { errors, warnings } = validatePlan(newPlan, { unit: backup.settings?.unit || 'kg' });
  for (const w of warnings) console.warn('⚠ ' + w);
  if (errors.length) {
    console.error(`✗ Plan not pushed — ${errors.length} problem(s):`);
    for (const e of errors) console.error('  • ' + e);
    if (!process.argv.includes('--force')) {
      console.error('  Fix these, or re-run with --force if the plan is genuinely right.');
      process.exitCode = 1;
      return;
    }
    console.warn('  --force given — pushing anyway.');
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
