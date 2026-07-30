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
import { fileURLToPath } from 'node:url';

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
 * logged (see "Loadable weights" in sports/CLAUDE.md).
 *
 * MIRRORS the LADDER-START/LADDER-END block in app.js. app.js is a classic
 * browser script and this is Node ESM, with no build step to share a module
 * through, so the code is duplicated on purpose. tools/weights.test.mjs sweeps
 * both copies and fails on any disagreement — run it after touching either.
 *
 * Real bugs this catches: a planned 22.5 kg dumbbell, a planned 85 kg trap bar
 * RDL (23 + 62 is unreachable — it is 83 or 88), a 27.5 kg cable stack.
 */
const BAR_DEFAULTS = { barbell: 20, 'trap-bar': 23, 'training-bar': 10 };

const WEIGHT_LADDER = {
  dumbbell: [[10, 1], [Infinity, 2]],
  cable:    [[25, 2.5], [Infinity, 5]],
  machine:  [[25, 2.5], [Infinity, 5]],
  landmine: [[Infinity, 1.25]],
  other:    [[Infinity, 2.5]],
};
const LADDER_PLATE = [[Infinity, 2.5]];
const LADDER_BAR_TYPES = ['barbell', 'trap-bar', 'training-bar'];
const ladderRound = v => Math.round(v * 100) / 100;

function ladderFor(equipment) {
  if (equipment === 'bodyweight') return null;
  return WEIGHT_LADDER[equipment] || LADDER_PLATE;
}
function ladderBase(equipment, barWeight) {
  const bar = barWeight != null ? barWeight : BAR_DEFAULTS[equipment];
  return LADDER_BAR_TYPES.indexOf(equipment) !== -1 ? (bar || 0) : 0;
}
function ladderRungs(segs, maxLoad) {
  const out = [0];
  let v = 0;
  for (const seg of segs) {
    const bound = seg[0], step = seg[1];
    while (v + step <= bound + 1e-9 && v <= maxLoad + 1e-9) { v = ladderRound(v + step); out.push(v); }
    if (v > maxLoad + 1e-9) break;
  }
  return out;
}
export function nextWeight(equipment, barWeight, current, dir) {
  const segs = ladderFor(equipment);
  if (!segs) return 0;
  const base = ladderBase(equipment, barWeight);
  const load = Math.max(0, ladderRound((current || 0) - base));
  const rungs = ladderRungs(segs, load + 20);
  if (dir > 0) {
    for (let i = 0; i < rungs.length; i++) if (rungs[i] > load + 1e-9) return ladderRound(base + rungs[i]);
    return ladderRound(base + load);
  }
  for (let i = rungs.length - 1; i >= 0; i--) if (rungs[i] < load - 1e-9) return ladderRound(base + rungs[i]);
  return ladderRound(base);
}
export function isLoadable(equipment, barWeight, weight) {
  if (equipment === 'bodyweight') return (weight || 0) === 0;
  if (equipment === 'other') return true;
  const segs = ladderFor(equipment);
  const base = ladderBase(equipment, barWeight);
  const load = ladderRound((weight || 0) - base);
  if (load < -1e-9) return false;
  const rungs = ladderRungs(segs, load);
  for (let i = 0; i < rungs.length; i++) if (Math.abs(rungs[i] - load) < 1e-9) return true;
  return false;
}

const LADDER_DESC = {
  dumbbell: 'dumbbells go 1 kg to 10, then 2 kg (no 11, no 22.5)',
  cable: 'cable stacks go 2.5 kg to 25, then 5 kg',
  machine: 'machine stacks go 2.5 kg to 25, then 5 kg',
  landmine: 'landmine plate load must be a multiple of 1.25 kg',
};

// MIRRORS the weightIssueKind() in the app.js LADDER-START/LADDER-END block —
// the decision is shared so the UI guard and this validator can't diverge at
// the call site again. tools/weights.test.mjs sweeps both copies.
export function weightIssueKind(equipment, barWeight, weight) {
  if (equipment === 'bodyweight') return (weight || 0) === 0 ? null : 'bodyweight';
  if (equipment === 'other' || !weight) return null;
  if (isLoadable(equipment, barWeight, weight)) return null;
  return ladderRound(weight - ladderBase(equipment, barWeight)) < -1e-9 ? 'below-bar' : 'off-ladder';
}

function weightProblem(equipment, weight, barWeight) {
  const eq = equipment || 'barbell';
  const kind = weightIssueKind(eq, barWeight, weight);
  if (!kind) return null;
  if (kind === 'bodyweight') return 'bodyweight moves must have weight 0';
  const base = ladderBase(eq, barWeight);
  if (kind === 'below-bar') {
    return `below the empty ${eq} (${base} kg) — is the equipment type wrong?`;
  }
  const lo = nextWeight(eq, barWeight, weight, -1), hi = nextWeight(eq, barWeight, weight, 1);
  const why = LADDER_DESC[eq] || `a ${base} kg bar loads in 2.5 kg steps with 1.25 kg plate pairs`;
  return `not loadable — ${why}; nearest are ${lo} and ${hi} kg`;
}

/*
 * Fallback for alternates that omit `equipment` and `barWeight` — when omitted,
 * they inherit the parent's. This guesses equipment from the name, which is why
 * validatePlan reports it as a warning (inference) rather than an error. An
 * alternate that explicitly declares `equipment` is checked as an error instead.
 * Without this fallback, a dumbbell alternate under a barbell parent would be
 * judged against the barbell ladder and warn for no reason.
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

  // A superset tag must form ONE adjacent run. Split runs render as two separate
  // cards in the app with two independent rest cycles — not what was intended.
  // Normalization here must match app.js's import sanitiser exactly (including
  // the slice(0, 2) truncation) — otherwise two tags that are distinct here but
  // collide once the app truncates them would pass this check clean and still
  // split into two cards after import.
  for (const day of plan.days) {
    const runs = new Map(); // tag → number of separate adjacent runs
    let prev = null;
    for (const e of day.exercises || []) {
      const tag = e.superset ? String(e.superset).trim().toUpperCase().slice(0, 2) : null;
      if (tag && tag !== prev) runs.set(tag, (runs.get(tag) || 0) + 1);
      prev = tag;
    }
    for (const [tag, n] of runs) {
      if (n > 1) {
        errors.push(
          `${day.name}: superset "${tag}" appears in ${n} separate non-adjacent runs. ` +
          'Superset members must sit next to each other in the exercise list — ' +
          'otherwise they render as separate cards with independent rest cycles.'
        );
      }
    }
  }

  // Metric correctness has nothing to do with the plan's unit, so these checks
  // run regardless of "kg" vs "lb" — unlike the weight-ladder checks below.
  for (const day of plan.days) {
    for (const e of day.exercises || []) {
      if (e.metric != null && e.metric !== 'load' && e.metric !== 'height') {
        errors.push(`${day.name} → ${e.name}: metric "${e.metric}" is not one of "load", "height".`);
      }
      if (e.metric === 'height' && e.weight) {
        errors.push(`${day.name} → ${e.name}: a height-metric exercise must have weight 0 — box height goes in "description".`);
      }
    }
  }

  if (unit !== 'kg') {
    warnings.push(`Unit is "${unit}" — the loadable-weight ladder is kg-only, so weights were not checked.`);
  } else {
    for (const day of plan.days) {
      for (const e of day.exercises || []) {
        if (e.metric === 'height') continue; // the weight ladder does not apply
        const p = weightProblem(e.equipment, e.weight, e.barWeight);
        if (p) errors.push(`${day.name} → ${e.name}: ${e.weight} kg ${p}`);
        // An alternate that declares its own equipment is checked as an error, the
        // same as a main exercise. Only an alternate that omits it falls back to the
        // name-based guess, which stays a warning because it is inference.
        for (const a of e.alternates || []) {
          if (!a.weight) continue; // 0 = bodyweight/interval alternate
          if (a.equipment) {
            const ap = weightProblem(a.equipment, a.weight, a.barWeight);
            if (ap) errors.push(`${day.name} → ${e.name} → alternate "${a.name}": ${a.weight} kg ${ap}`);
          } else {
            const aEq = guessAlternateEquipment(a.name, e.equipment);
            const ap = weightProblem(aEq, a.weight, aEq === e.equipment ? e.barWeight : null);
            if (ap) warnings.push(`${day.name} → ${e.name} → alternate "${a.name}": ${a.weight} kg ${ap} (equipment inferred as "${aEq || 'barbell'}" — set "equipment" on the alternate to check this properly)`);
          }
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

// Only push when invoked directly. tools/weights.test.mjs imports this module to
// compare its ladder against app.js, and must not trigger a network write.
import { realpathSync } from 'node:fs';
const invokedDirectly = process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch(e => { console.error('✗ ' + e.message); process.exit(1); });
}
