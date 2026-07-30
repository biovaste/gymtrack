# GymTrack Equipment Ladder, Supersets & Jump Logging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GymTrack's weight stepping match the gym's actual loadable weights, add supersets and jump-height logging, show equipment throughout the UI, and fix the rest-timer cue that never fires.

**Architecture:** A single pure weight-ladder module (duplicated by necessity into the Node validator, with a test asserting the copies agree) underpins every weight the app writes. Supersets are an adjacency-tagged grouping over the existing flat `days[].exercises` array, so no index path changes shape. Jump logging is a `metric` field that switches an exercise's set grid and its three downstream stats paths. The audio fix moves the rest cue from a `setInterval` callback onto the Web Audio clock, scheduled at rest start.

**Tech Stack:** Plain ES2020 browser JS (no build step, no framework, classic `<script>`), Node ESM for `tools/`, Cloudflare Pages for hosting. No dependencies anywhere.

**Spec:** [`docs/superpowers/specs/2026-07-30-equipment-supersets-jumps-design.md`](../specs/2026-07-30-equipment-supersets-jumps-design.md)

## Global Constraints

- **No build step.** `app.js` is loaded as a classic script (`<script src="app.js">`) and cannot use `import`/`export`. `tools/*.mjs` are Node ESM. There is no bundler to share code between them.
- **No dependencies.** Not in the app, not in `tools/`. The test runner is `node` itself.
- **Bump `CACHE` in `sw.js`** (`gymtrack-vN` → `vN+1`) in the same commit as any change to `app.js`, `styles.css`, or `index.html`. Current value at plan time: `gymtrack-v11`. Without the bump no service worker installs, no update banner appears, and the phone keeps serving the old cache — the change looks deployed but never reaches the device.
- **Exercise names must be unique across the whole plan.** History, "last time" lookups and the `aliases` map are keyed on name globally, not per day.
- **The weight ladder is kg-only.** In `lb` mode, fall back to a flat 2.5 step and do not validate loadability.
- **Backward compatibility:** every new schema field is optional. A plan written before this work must load and behave identically. `equipment` omitted = `barbell`; `metric` omitted = `load`; `superset` omitted = not grouped; alternate `equipment` omitted = inherit the parent's.
- **Do not run a dev server with the Bash tool.** Use the browser-preview tooling.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `app.js` | All app logic. The ladder lives in a marker-delimited block near the existing equipment config (~line 111) so the test can extract it. | 1–5 |
| `styles.css` | Superset card, equipment chip, jump set-grid variant | 2, 4, 5 |
| `sw.js` | `CACHE` version bump only | 1–5 |
| `tools/push-plan.mjs` | Plan validation before push. Gets its own ladder copy. | 1, 4, 5 |
| `tools/weights.test.mjs` | **New.** Ladder unit tests + asserts the two ladder copies agree. | 1 |
| `sports/CLAUDE.md` | Ladder table, plan JSON schema, superset + metric rules | 1, 4, 5 |
| `Tracking app/README.md` | Same schema additions | 5 |
| `.claude/skills/**` | Coaching skill inputs | 6 |

`index.html` is not modified — no new top-level shell elements are needed.

---

## Task 1: Equipment-aware weight ladder

**Files:**
- Create: `tools/weights.test.mjs`
- Modify: `app.js` — insert ladder block after `resolvedBarWeight()` (currently ends line 120); replace `stepperStep()` (line 1370-1373); replace the stepper-bar `pointerdown` handler (lines 1402-1411); replace `showStepper()` (lines 1381-1393); add a loadability guard + hint to `exEditModal` (lines 1204-1240)
- Modify: `tools/push-plan.mjs` — replace `weightProblem()` (lines 54-70)
- Modify: `sw.js` — `CACHE` → `gymtrack-v12`
- Modify: `sports/CLAUDE.md` — ladder table

**Interfaces:**
- Produces, inside the marker block in `app.js` and mirrored in `tools/push-plan.mjs`:
  - `WEIGHT_LADDER` — `{ [equipment: string]: Array<[upperBound: number, step: number]> }`
  - `ladderFor(equipment: string) → Array<[number,number]> | null` (`null` for `bodyweight`)
  - `ladderBase(equipment: string, barWeight: number|null) → number`
  - `ladderRungs(segs: Array<[number,number]>, maxLoad: number) → number[]`
  - `nextWeight(equipment: string, barWeight: number|null, current: number, dir: 1|-1) → number`
  - `isLoadable(equipment: string, barWeight: number|null, weight: number) → boolean`
  - `nearestRungs(equipment: string, barWeight: number|null, weight: number) → { lo: number|null, hi: number|null }`
- Consumes: `BAR_WEIGHT_DEFAULTS`, `resolvedBarWeight(e)` — already in `app.js` at lines 116-120. The ladder block itself must **not** reference them, so it stays extractable; callers resolve the bar weight and pass a number.

---

- [ ] **Step 1: Write the failing test**

Create `tools/weights.test.mjs`:

```js
/*
 * Tests the loadable-weight ladder — and asserts that the copy in app.js and the
 * copy in push-plan.mjs agree. They must be duplicated: app.js is a classic
 * browser script (no exports) and push-plan.mjs is Node ESM, with no build step
 * to share a module through.
 *
 * app.js is not importable, so its ladder is extracted from the file text
 * between the LADDER-START / LADDER-END markers and evaluated in a vm sandbox.
 * If that extraction ever breaks, this test fails loudly rather than skipping.
 *
 * Run: node tools/weights.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) { failures++; console.error(`FAIL  ${label}\n        expected ${expected}, got ${actual}`); }
  else console.log(`ok    ${label}`);
}

/* ---- load the app.js ladder out of the file text ---- */
function loadAppLadder() {
  const src = readFileSync(join(root, 'app.js'), 'utf8');
  const start = src.indexOf('/* LADDER-START */');
  const end = src.indexOf('/* LADDER-END */');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Could not find LADDER-START / LADDER-END markers in app.js — ' +
      'the ladder moved or the markers were removed. Fix the markers, do not delete this test.');
  }
  const block = src.slice(start, end);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(block + '\n;({ nextWeight, isLoadable, nearestRungs, ladderRungs, ladderFor, ladderBase });', ctx);
  return vm.runInContext('({ nextWeight, isLoadable, nearestRungs, ladderRungs, ladderFor, ladderBase })', ctx);
}

const app = loadAppLadder();
const { nextWeight, isLoadable, nearestRungs } = app;

/* ---- boundary behaviour required by the spec ---- */
check('DB 10 up   → 12',   nextWeight('dumbbell', null, 10, 1), 12);
check('DB 10 down → 9',    nextWeight('dumbbell', null, 10, -1), 9);
check('DB 9 up    → 10',   nextWeight('dumbbell', null, 9, 1), 10);
check('DB 12 down → 10',   nextWeight('dumbbell', null, 12, -1), 10);
check('cable 25 up   → 30',   nextWeight('cable', null, 25, 1), 30);
check('cable 25 down → 22.5', nextWeight('cable', null, 25, -1), 22.5);
check('cable 22.5 up → 25',   nextWeight('cable', null, 22.5, 1), 25);
check('cable 30 down → 25',   nextWeight('cable', null, 30, -1), 25);
check('machine follows cable', nextWeight('machine', null, 25, 1), 30);
check('trap bar 83 up → 85.5', nextWeight('trap-bar', 23, 83, 1), 85.5);
check('bench 77.5 up → 80',    nextWeight('barbell', 20, 77.5, 1), 80);
check('landmine 20 up → 21.25', nextWeight('landmine', null, 20, 1), 21.25);

/* off-ladder values snap onto the ladder rather than drifting */
check('cable 23 up   → 25',   nextWeight('cable', null, 23, 1), 25);
check('cable 23 down → 22.5', nextWeight('cable', null, 23, -1), 22.5);

/* floors */
check('DB 1 down  → 0',  nextWeight('dumbbell', null, 1, -1), 0);
check('barbell at bar down → bar', nextWeight('barbell', 20, 20, -1), 20);
check('bodyweight never steps',    nextWeight('bodyweight', null, 0, 1), 0);

/* ---- weights actually logged in the app must be loadable ---- */
for (const [eq, bar, w] of [
  ['barbell', 20, 77.5], ['trap-bar', 23, 83], ['trap-bar', 23, 88],
  ['dumbbell', null, 22], ['cable', null, 22.5], ['cable', null, 50],
  ['barbell', 20, 20], ['bodyweight', null, 0], ['landmine', null, 21.25],
]) check(`loadable: ${eq} ${w}`, isLoadable(eq, bar, w), true);

/* ---- weights that have shipped broken must be rejected ---- */
for (const [eq, bar, w] of [
  ['dumbbell', null, 22.5], ['trap-bar', 23, 85], ['cable', null, 27.5],
  ['dumbbell', null, 11], ['bodyweight', null, 20], ['barbell', 20, 19],
]) check(`rejected: ${eq} ${w}`, isLoadable(eq, bar, w), false);

/* 'other' is unclassified equipment — never enforce a ladder on it */
check("'other' always loadable", isLoadable('other', null, 33.3), true);

/* ---- nearest-rung messaging ---- */
const nr = nearestRungs('trap-bar', 23, 85);
check('trap bar 85 nearest lo', nr.lo, 83);
check('trap bar 85 nearest hi', nr.hi, 85.5);

/* ---- the two ladder copies must agree ---- */
const validator = await import('./push-plan.mjs');
if (typeof validator.isLoadable !== 'function') {
  failures++;
  console.error('FAIL  push-plan.mjs does not export isLoadable — export it so this test can compare the copies.');
} else {
  let mismatches = 0;
  for (const [eq, bar] of [['barbell', 20], ['trap-bar', 23], ['training-bar', 10],
                           ['dumbbell', null], ['cable', null], ['machine', null],
                           ['landmine', null], ['bodyweight', null]]) {
    for (let w = 0; w <= 200; w += 0.25) {
      const a = isLoadable(eq, bar, Math.round(w * 100) / 100);
      const b = validator.isLoadable(eq, bar, Math.round(w * 100) / 100);
      if (a !== b) { mismatches++; if (mismatches < 5) console.error(`  drift: ${eq} ${w} app=${a} validator=${b}`); }
    }
  }
  check('app.js and push-plan.mjs ladders agree', mismatches, 0);
}

console.log(failures ? `\n${failures} failing check(s)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node "tools/weights.test.mjs"
```

Expected: throws `Could not find LADDER-START / LADDER-END markers in app.js`. That is the correct first failure — nothing is implemented yet.

- [ ] **Step 3: Add the ladder block to `app.js`**

Insert immediately after `resolvedBarWeight()` (after line 120, before the `/* ===== default starter plan ===== */` comment). The markers are load-bearing — `tools/weights.test.mjs` extracts everything between them.

```js
/* ================= loadable-weight ladder ================= */
/*
 * The gym's real weight increments, derived from what has actually been logged.
 * Mirrored in tools/push-plan.mjs — app.js is a classic script with no exports and
 * push-plan.mjs is Node ESM, and there is no build step to share a module through.
 * tools/weights.test.mjs asserts the two copies agree; run it after touching either.
 *
 * Everything between the markers must stay self-contained (no unit(), no
 * BAR_WEIGHT_DEFAULTS) so the test can extract and evaluate it in isolation.
 * Callers resolve the bar weight and pass it in as a number.
 */
/* LADDER-START */
// [upperBound, stepBelowThatBound] — walked from 0 upward.
const WEIGHT_LADDER = {
  dumbbell: [[10, 1], [Infinity, 2]],       // 1 kg steps to 10, then 2 kg: no 11, no 22.5
  cable:    [[25, 2.5], [Infinity, 5]],     // 2.5 kg steps to 25, then 5 kg: no 27.5
  machine:  [[25, 2.5], [Infinity, 5]],
  landmine: [[Infinity, 1.25]],             // plate load on the single end
  other:    [[Infinity, 2.5]],              // a usable stepper default; NOT enforced by isLoadable
};
const LADDER_PLATE = [[Infinity, 2.5]];               // 1.25 kg plate pairs exist
const LADDER_BAR_TYPES = ['barbell', 'trap-bar', 'training-bar'];
const ladderRound = v => Math.round(v * 100) / 100;

function ladderFor(equipment) {
  if (equipment === 'bodyweight') return null;
  return WEIGHT_LADDER[equipment] || LADDER_PLATE;
}
function ladderBase(equipment, barWeight) {
  return LADDER_BAR_TYPES.indexOf(equipment) !== -1 ? (barWeight || 0) : 0;
}
// Every loadable load-above-base up to maxLoad, ascending, starting at 0.
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
// The next loadable weight above (dir 1) or below (dir -1) `current`.
// An off-ladder `current` snaps onto the ladder in that direction.
function nextWeight(equipment, barWeight, current, dir) {
  const segs = ladderFor(equipment);
  if (!segs) return 0;                                    // bodyweight never steps
  const base = ladderBase(equipment, barWeight);
  const load = Math.max(0, ladderRound((current || 0) - base));
  const rungs = ladderRungs(segs, load + 20);             // +20 clears the largest step
  if (dir > 0) {
    for (let i = 0; i < rungs.length; i++) if (rungs[i] > load + 1e-9) return ladderRound(base + rungs[i]);
    return ladderRound(base + load);
  }
  for (let i = rungs.length - 1; i >= 0; i--) if (rungs[i] < load - 1e-9) return ladderRound(base + rungs[i]);
  return ladderRound(base);
}
function isLoadable(equipment, barWeight, weight) {
  if (equipment === 'bodyweight') return (weight || 0) === 0;
  if (equipment === 'other') return true;                 // unclassified — never enforce
  const segs = ladderFor(equipment);
  const base = ladderBase(equipment, barWeight);
  const load = ladderRound((weight || 0) - base);
  if (load < -1e-9) return false;                         // below the empty bar
  const rungs = ladderRungs(segs, load);
  for (let i = 0; i < rungs.length; i++) if (Math.abs(rungs[i] - load) < 1e-9) return true;
  return false;
}
// The loadable weights either side of an unloadable one, for error messages.
function nearestRungs(equipment, barWeight, weight) {
  if (equipment === 'bodyweight' || equipment === 'other') return { lo: null, hi: null };
  return { lo: nextWeight(equipment, barWeight, weight, -1), hi: nextWeight(equipment, barWeight, weight, 1) };
}
/* LADDER-END */
```

- [ ] **Step 4: Run the test — the app.js half must now pass**

```bash
node "tools/weights.test.mjs"
```

Expected: every `nextWeight` / `isLoadable` / `nearestRungs` check prints `ok`, then one `FAIL  push-plan.mjs does not export isLoadable`. Exit code 1. If any ladder check fails, fix the ladder before continuing — the validator copy must be written against a correct original.

- [ ] **Step 5: Mirror the ladder into `tools/push-plan.mjs`**

Replace lines 41-70 (the ladder comment block, `BAR_DEFAULTS`, `isStep`, and `weightProblem`) with the code below. Keep `guessAlternateEquipment` (lines 72-85) exactly as it is — Task 2 revisits it.

```js
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

function weightProblem(equipment, weight, barWeight) {
  const eq = equipment || 'barbell';
  if (eq === 'bodyweight') return (weight || 0) === 0 ? null : 'bodyweight moves must have weight 0';
  if (eq === 'other' || !weight) return null;
  if (isLoadable(eq, barWeight, weight)) return null;
  const base = ladderBase(eq, barWeight);
  if (ladderRound(weight - base) < -1e-9) {
    return `below the empty ${eq} (${base} kg) — is the equipment type wrong?`;
  }
  const lo = nextWeight(eq, barWeight, weight, -1), hi = nextWeight(eq, barWeight, weight, 1);
  const why = LADDER_DESC[eq] || `a ${base} kg bar loads in 2.5 kg steps with 1.25 kg plate pairs`;
  return `not loadable — ${why}; nearest are ${lo} and ${hi} kg`;
}
```

`push-plan.mjs` would push as a side effect of being imported by the test, so guard its entry point. It is already structured around an `async function main()`; replace only its final line —

```js
main().catch(e => { console.error('✗ ' + e.message); process.exit(1); });
```

— with:

```js
// Only push when invoked directly. tools/weights.test.mjs imports this module to
// compare its ladder against app.js, and must not trigger a network write.
import { realpathSync } from 'node:fs';
const invokedDirectly = process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch(e => { console.error('✗ ' + e.message); process.exit(1); });
}
```

`realpathSync` on both sides makes the comparison robust to Windows path separators and casing, which a raw `file://` string comparison is not. Add `fileURLToPath` to the file's existing `node:url` import, or add `import { fileURLToPath } from 'node:url';` if there isn't one.

- [ ] **Step 6: Run the test — everything must pass**

```bash
node "tools/weights.test.mjs"
```

Expected: all checks `ok`, final line `All checks passed`, exit code 0. In particular `app.js and push-plan.mjs ladders agree` must pass — if it prints `drift:` lines, the two copies diverge and the reported weights show where.

- [ ] **Step 7: Make the session stepper equipment-aware**

Replace `stepperStep()` (lines 1370-1373) with:

```js
/*
 * What the stepper bar should do for the focused input. Weight steps follow the
 * gym's ladder, so the two buttons are often asymmetric (at a 10 kg dumbbell it
 * is −1 / +2). Returns null when the field should get no stepper at all.
 */
function stepperInfo(el) {
  if (!el || !el.dataset || el.dataset.bind !== 'set') return null;
  const f = el.dataset.f;
  if (f === 'reps') return { kind: 'reps', label: 'reps', down: 1, up: 1 };
  if (f !== 'weight') return null;
  const ex = active && active.exercises[+el.dataset.ei];
  if (!ex || ex.equipment === 'bodyweight') return null;   // nothing to load
  if (unit() !== 'kg') return { kind: 'weight', label: unit(), down: 2.5, up: 2.5 };
  const cur = parseFloat(el.value) || 0;
  const bar = resolvedBarWeight(ex);
  return {
    kind: 'weight', label: unit(),
    down: ladderRound(cur - nextWeight(ex.equipment, bar, cur, -1)),
    up: ladderRound(nextWeight(ex.equipment, bar, cur, 1) - cur)
  };
}
```

Replace `showStepper()` (lines 1381-1393) with:

```js
function showStepper(el) {
  const info = stepperInfo(el);
  if (!info) return;
  clearTimeout(stepperHideTimer);
  stepperTarget = el;
  const bar = document.getElementById('stepper-bar');
  bar.innerHTML = `
    <button data-step="-1">−${info.down}</button>
    <span class="muted small">${info.label}</span>
    <button data-step="1">+${info.up}</button>`;
  bar.classList.remove('hidden');
  positionStepper();
}
```

Replace the `pointerdown` handler (lines 1402-1411) with:

```js
document.getElementById('stepper-bar').addEventListener('pointerdown', e => {
  const btn = e.target.closest('[data-step]');
  if (!btn || !stepperTarget) return;
  e.preventDefault(); // keep the input focused (no blur, keyboard stays up)
  const info = stepperInfo(stepperTarget);
  if (!info) return;
  const dir = parseInt(btn.dataset.step, 10);
  const cur = parseFloat(stepperTarget.value);
  const curN = isNaN(cur) ? 0 : cur;
  let next;
  if (info.kind === 'weight' && unit() === 'kg') {
    const ex = active.exercises[+stepperTarget.dataset.ei];
    next = nextWeight(ex.equipment, resolvedBarWeight(ex), curN, dir);
  } else {
    next = curN + dir * (dir > 0 ? info.up : info.down);
  }
  stepperTarget.value = Math.max(0, ladderRound(next));
  stepperTarget.dispatchEvent(new Event('input', { bubbles: true })); // reuse the data-bind update path
  showStepper(stepperTarget); // the next step size may have changed (9→10 turns +1 into +2)
});
```

- [ ] **Step 8: Reject unloadable weights in the plan editor**

The spec called for a `step` attribute on the weight input. Use a **hint line plus a save-time guard** instead: `step` only drives native spinners, which mobile Safari does not render, so it would change nothing on the target device — while a save-time check actually stops an unloadable weight entering the plan.

In `exEditModal`, replace the weight field row (line 1211) with:

```js
      <label class="field grow"><span>Weight (${unit()})</span><input id="f-weight" type="number" inputmode="decimal" step="0.5" value="${e.weight}">
        <span class="field-hint" id="f-weight-hint">${esc(ladderHint(equipment))}</span></label>
```

Add next to the other ladder callers in `app.js` (outside the marker block — it uses `unit()`):

```js
// Human-readable increment rule for the plan editor's weight field.
function ladderHint(equipment) {
  if (unit() !== 'kg') return '';
  if (equipment === 'bodyweight') return 'bodyweight — leave at 0';
  if (equipment === 'other') return 'increments not checked';
  if (equipment === 'dumbbell') return '1 kg steps to 10 kg, then 2 kg';
  if (equipment === 'cable' || equipment === 'machine') return '2.5 kg steps to 25 kg, then 5 kg';
  if (equipment === 'landmine') return '1.25 kg steps (load on the end)';
  return `2.5 kg steps from the ${resolvedBarWeight({ equipment, barWeight: null })} kg bar`;
}
```

In the Save handler (line 1229), after `const barWeightRaw = mval('f-barweight');` add:

```js
          const eqVal = document.getElementById('f-equipment').value;
          const barVal = barWeightRaw ? parseFloat(barWeightRaw) : null;
          const wVal = mnum('f-weight');
          if (unit() === 'kg' && !isLoadable(eqVal, barVal != null ? barVal : resolvedBarWeight({ equipment: eqVal, barWeight: null }), wVal)) {
            const n = nearestRungs(eqVal, barVal != null ? barVal : resolvedBarWeight({ equipment: eqVal, barWeight: null }), wVal);
            toast(`${wVal}${unit()} is not loadable on a ${EQUIPMENT_LABELS[eqVal].toLowerCase()} — try ${n.lo} or ${n.hi}`, 'err');
            return;
          }
```

Extend the existing `edit-equipment` change handler (lines 2158-2165) to refresh the hint, adding inside the `if (bind === 'edit-equipment') {` block:

```js
    const hint = document.getElementById('f-weight-hint');
    if (hint) hint.textContent = ladderHint(e.target.value);
```

Add to `styles.css`:

```css
.field-hint { display: block; font-size: 12px; color: var(--muted); margin-top: 4px; }
```

- [ ] **Step 9: Update `sports/CLAUDE.md`**

Replace the "Every weight must be loadable at the gym" ladder table rows for `dumbbell` and `cable`/`machine`, and add the breakpoint note:

```markdown
| Equipment | Increment | Notes |
|---|---|---|
| `barbell`, `trap-bar`, `training-bar` | `weight − barWeight` in 2.5 kg steps | 1.25 kg plate pairs exist (bench 77.5 is real). Trap bar = 23 kg, so its rungs are odd: 83, 85.5, 88 — **not** 85 |
| `dumbbell` | 1 kg to 10 kg, then 2 kg | 1…10, 12, 14, 16 … **11 and 22.5 do not exist** |
| `cable`, `machine` | 2.5 kg to 25 kg, then 5 kg | 2.5…25 by 2.5, then 30, 35 … **27.5 does not exist** |
| `landmine` | 1.25 kg | Weight = actual plate load on the loaded end, no bar subtraction |
| `bodyweight` | must be `0` | Jumps, runs, core. Box height goes in `description`/notes, never in the weight field |
| `other` | not checked | Unclassified equipment — the validator does not enforce a ladder |

**The ladder has breakpoints** — "round to the nearest 2.5" is wrong for dumbbells under 10 kg and stacks under 25 kg. `tools/weights.test.mjs` is the executable version of this table; run `node tools/weights.test.mjs` after changing it.
```

- [ ] **Step 10: Bump the cache and verify in the browser**

In `sw.js` line 5: `const CACHE = 'gymtrack-v12';`

Start the preview (browser tooling, **not** Bash) and confirm on the Workout tab with a session started:
- Focus a barbell exercise's weight field → stepper reads `−2.5` / `+2.5`.
- Set a dumbbell exercise's weight to 10 → stepper reads `−1` / `+2`; tap `+` → 12; tap `−` twice → 10, then 9, and the label flips to `−1` / `+1`.
- Focus a bodyweight exercise's weight field → no stepper appears.
- Plan tab → edit an exercise → set equipment to Dumbbell, weight 22.5, Save → refused with a toast naming 22 and 24.

- [ ] **Step 11: Commit**

```bash
git add app.js styles.css sw.js tools/push-plan.mjs tools/weights.test.mjs ../CLAUDE.md
git commit -m "$(cat <<'EOF'
Equipment-aware weight ladder with breakpoints

Dumbbells step 1 kg to 10 then 2 kg; cable and machine stacks 2.5 kg to 25
then 5 kg. Replaces the hardcoded 2.5 step, which produced 22.5 kg dumbbells
and 27.5 kg stacks that the gym cannot make.

The ladder is duplicated in app.js and tools/push-plan.mjs — a classic script
and a Node ESM module with no build step between them. tools/weights.test.mjs
sweeps both copies and fails on any disagreement.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Equipment in the UI, and on alternates

**Files:**
- Modify: `app.js` — import sanitiser (line 348-350); `equipChip` helper (new, near `resolvedBarWeight`); `exerciseCard` header (lines 846-858); `viewPlan` exercise rows (lines 898-905); `exSwapPlanModal` (1242-1248); `doPlanSwap` (1250-1260); `sessionSwapModal` (1263-1279); `doSessionSwap` (1280-1289); `finishSession` record (lines 409-414)
- Modify: `styles.css` — `.equip-chip`
- Modify: `tools/push-plan.mjs` — alternate equipment handling in `validatePlan` (lines 124-130)
- Modify: `sw.js` — `CACHE` → `gymtrack-v13`

**Interfaces:**
- Consumes: `resolvedBarWeight(e)`, `EQUIPMENT_LABELS`, `BAR_WEIGHT_EQUIPMENT`, `isLoadable` (Task 1)
- Produces:
  - `equipChip(e: {equipment?, barWeight?}) → string` — HTML for one chip, `''` when equipment is absent
  - Alternate object shape gains optional `equipment: string` and `barWeight: number|null`
  - Session records gain `equipment` and `barWeight` per exercise (relied on by Task 6)

---

- [ ] **Step 1: Keep alternate equipment through import**

In the sanitiser at lines 348-350, replace the `alternates` mapper:

```js
            alternates: Array.isArray(e.alternates) ? e.alternates.filter(a => a && a.name).map(a => ({
              name: String(a.name), weight: parseFloat(a.weight) || 0, description: String(a.description || ''),
              // Omitted equipment means "same as the parent" — keep it absent rather than
              // defaulting to barbell, so a swap inherits instead of silently relabelling.
              equipment: EQUIPMENT_TYPES.includes(a.equipment) ? a.equipment : null,
              barWeight: a.barWeight != null && a.barWeight !== '' ? parseFloat(a.barWeight) : null
            })) : []
```

- [ ] **Step 2: Add the chip helper and its style**

In `app.js`, after `resolvedBarWeight()` (before the ladder block):

```js
// Compact equipment label for exercise cards, plan rows and swap sheets.
// Bar weight is shown only when it is meaningful and non-default.
function equipChip(e) {
  const eq = e.equipment;
  if (!eq) return '';
  let label = EQUIPMENT_LABELS[eq] || eq;
  if (BAR_WEIGHT_EQUIPMENT.has(eq) && e.barWeight != null) label += ` · ${e.barWeight}${unit()}`;
  return `<span class="equip-chip">${esc(label)}</span>`;
}
```

In `styles.css`, next to `.day-pill` (line 262):

```css
.equip-chip { display: inline-block; background: var(--bg2); border: 1px solid var(--border); border-radius: 6px;
  padding: 2px 7px; font-size: 11px; color: var(--muted); vertical-align: middle; }
```

- [ ] **Step 3: Show the chip in all three places**

In `exerciseCard`, change the `target-line` div (line 851) to append the chip:

```js
        <div class="target-line">Plan: ${e.plannedSets}×${esc(e.plannedReps)} @ ${e.plannedWeight}${unit()}${e.targetRpe ? ' · RPE ' + e.targetRpe : ''} · rest ${fmtClock(e.restSeconds)} ${equipChip(e)}</div>
```

In `viewPlan`, change the exercise row's muted line (line 902):

```js
                <div class="muted small">${e.sets}×${esc(e.reps)} @ ${e.weight}${unit()}${e.targetRpe ? ' · RPE ' + e.targetRpe : ''} · rest ${fmtClock(e.restSeconds)}${e.alternates.length ? ' · ' + e.alternates.length + ' alt' : ''} ${equipChip(e)}</div>
```

In `exSwapPlanModal` (line 1246), show each alternate's own equipment, falling back to the parent's:

```js
  showModal('Swap ' + e.name, e.alternates.map((a, ai) => `
    <button class="wide mt8" data-action="plan-swap-pick" data-day="${dayId}" data-i="${i}" data-ai="${ai}">
      ${esc(a.name)}${a.weight ? ` · ${a.weight}${unit()}` : ''} ${equipChip({ equipment: a.equipment || e.equipment, barWeight: a.equipment ? a.barWeight : e.barWeight })}</button>`).join(''),
    [{ label: 'Cancel' }]);
```

In `sessionSwapModal` (line 1268), the same treatment:

```js
      <button class="wide mt8" data-action="session-swap-pick" data-ei="${ei}" data-ai="${ai}">
        ${esc(a.name)}${a.weight ? ` · ${a.weight}${unit()}` : ''} ${equipChip({ equipment: a.equipment || e.equipment, barWeight: a.equipment ? a.barWeight : e.barWeight })}</button>`).join('')
```

- [ ] **Step 4: Carry equipment across both swap paths**

`doPlanSwap` (lines 1250-1260) — the demoted main must take its own equipment down with it, or swapping twice silently relabels the movement:

```js
function doPlanSwap(dayId, i, ai) {
  const day = plan.days.find(d => d.id === dayId);
  const e = day.exercises[i];
  const a = e.alternates[ai];
  // The current main exercise becomes an alternate, the chosen alternate becomes main.
  // Equipment travels with each — without that, swap-then-swap-back changes the
  // equipment type, which then changes the ladder the weight is checked against.
  const newAlts = e.alternates.filter((_, x) => x !== ai);
  newAlts.unshift({ name: e.name, weight: e.weight, description: e.description,
    equipment: e.equipment, barWeight: e.barWeight });
  Object.assign(e, {
    name: a.name, weight: a.weight || e.weight, description: a.description || '',
    equipment: a.equipment || e.equipment,
    barWeight: a.equipment ? a.barWeight : e.barWeight,
    alternates: newAlts
  });
  savePlan(); closeModal(); render();
  toast('Swapped to ' + a.name);
}
```

`doSessionSwap` (lines 1280-1289) — add equipment to the live exercise:

```js
function doSessionSwap(ei, alt) {
  const e = active.exercises[ei];
  const original = e.swappedFrom || e.name;
  e.swappedFrom = original === alt.name ? null : original;
  e.name = alt.name;
  if (alt.equipment) { e.equipment = alt.equipment; e.barWeight = alt.barWeight != null ? alt.barWeight : null; }
  if (alt.weight) e.sets.forEach(s => { if (!s.done) s.weight = alt.weight; });
  if (alt.description) e.description = alt.description;
  saveActive(); closeModal(); render();
  toast('Swapped to ' + alt.name);
}
```

- [ ] **Step 5: Let the custom swap pick its equipment**

In `sessionSwapModal`, replace the custom-exercise field (line 1271) with a name input plus an equipment select defaulting to the parent's:

```js
    <label class="field"><span>…or type any exercise</span><input id="swap-custom" placeholder="e.g. Machine Chest Press"></label>
    <label class="field"><span>Equipment for the typed exercise</span>
      <select id="swap-custom-equip">${EQUIPMENT_TYPES.map(t => `<option value="${t}" ${t === (e.equipment || 'barbell') ? 'selected' : ''}>${EQUIPMENT_LABELS[t]}</option>`).join('')}</select>
    </label>`,
```

And in that modal's "Use typed exercise" handler (lines 1273-1276):

```js
      { label: 'Use typed exercise', cls: 'primary', fn: () => {
          const name = mval('swap-custom'); if (!name) { toast('Type a name first', 'err'); return; }
          const eq = document.getElementById('swap-custom-equip').value;
          doSessionSwap(ei, { name, weight: e.sets[0] ? e.sets[0].weight : e.plannedWeight,
            description: '', equipment: eq, barWeight: eq === e.equipment ? e.barWeight : null });
        } },
```

- [ ] **Step 6: Persist equipment into the session record**

`finishSession` currently drops it. In the `.map()` at lines 410-413, add the two fields:

```js
      .map(e => ({ name: e.name, plannedSets: e.plannedSets, plannedReps: e.plannedReps,
        plannedWeight: e.plannedWeight, targetRpe: e.targetRpe,
        equipment: e.equipment, barWeight: e.barWeight,
        swappedFrom: e.swappedFrom, notes: e.notes,
        sets: e.sets.filter(s => s.done).map(s => ({ weight: s.weight, reps: s.reps, rpe: s.rpe })) }))
```

- [ ] **Step 7: Trust declared alternate equipment in the validator**

In `tools/push-plan.mjs` `validatePlan`, replace the alternate loop (lines 124-130):

```js
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
```

- [ ] **Step 8: Verify**

```bash
node "tools/weights.test.mjs"
```

Expected: still all passing (this task does not touch the ladder).

Then in the browser preview: chips appear on session cards, Plan rows, and both swap sheets. Swap a barbell exercise to a dumbbell alternate → the chip changes and the weight stepper switches to the dumbbell ladder. Swap back → the original equipment returns.

Finish a session, then confirm the record persisted the equipment. `store` prefixes every key with `gym.`, so evaluate in the preview's JS console:

```js
JSON.parse(localStorage.getItem('gym.sessions')).slice(-1)[0].exercises[0]
```

Expected: the object includes `equipment` and `barWeight`. Before this task it had neither.

- [ ] **Step 9: Bump the cache and commit**

`sw.js`: `const CACHE = 'gymtrack-v13';`

```bash
git add app.js styles.css sw.js tools/push-plan.mjs
git commit -m "$(cat <<'EOF'
Show equipment in the UI; give alternates their own equipment

Adds an equipment chip to session cards, plan rows and both swap sheets, and
lets a typed custom swap pick its equipment. Alternates now carry optional
equipment/barWeight (omitted = inherit the parent), so a swap no longer
silently relabels the movement and the validator can check an alternate's
weight instead of guessing its equipment from the name.

Also persists equipment/barWeight into the session record — finishSession
was dropping both, so history never knew what a weight was loaded on.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Fix the rest-timer cue

**Files:**
- Modify: `app.js` — `unlockAudio` (lines 201-206); `beep` (207-223); new `scheduleCue`/`cancelCue`/`startKeepAlive`/`stopKeepAlive`; `startRest`/`adjustRest`/`stopRest` (248-255); the `setInterval` fire path (275-281); `visibilitychange` (238-243); `syncWakeLock` call sites for keep-alive; Settings vibration row (1141-1144) and `test-sound` action (line 2101)
- Modify: `sw.js` — `CACHE` → `gymtrack-v14`

**Interfaces:**
- Produces: `scheduleCue(seconds) → void`, `cancelCue() → void`, `audioState() → string`
- `rest` object gains `cueFired: boolean` and a non-persisted `cueNodes` array. `saveRest()` must not write `cueNodes` to localStorage (AudioNodes are not serialisable).

---

- [ ] **Step 1: Resume the context from any dead state**

Replace `unlockAudio` (lines 201-206):

```js
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // WebKit uses a non-standard 'interrupted' state after a screen lock, an incoming
    // call, or another app taking audio — and stays there. Checking only for
    // 'suspended' left the context dead, so the timer cue silently produced nothing
    // while the Test button still worked (a user gesture makes WebKit auto-resume).
    if (audioCtx.state !== 'running') audioCtx.resume();
  } catch (e) {}
}
function audioState() { return audioCtx ? audioCtx.state : 'none'; }
```

- [ ] **Step 2: Keep the context alive during a session**

Add after `buzz()` (line 226):

```js
/*
 * A near-silent looping source. Without it an idle context gets suspended, which
 * freezes currentTime and strands any pre-scheduled cue. Runs only while a
 * session is active, so it costs nothing the rest of the time.
 */
let keepAlive = null;
function startKeepAlive() {
  unlockAudio();
  if (!audioCtx || keepAlive) return;
  try {
    const buf = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    const src = audioCtx.createBufferSource(), g = audioCtx.createGain();
    src.buffer = buf; src.loop = true;
    g.gain.value = 0.0001;
    src.connect(g); g.connect(audioCtx.destination);
    src.start();
    keepAlive = src;
  } catch (e) {}
}
function stopKeepAlive() {
  if (!keepAlive) return;
  try { keepAlive.stop(); } catch (e) {}
  keepAlive = null;
}
```

- [ ] **Step 3: Schedule the cue on the audio clock**

Add directly after `stopKeepAlive`:

```js
/*
 * Schedule the rest cue `seconds` from now on the audio clock rather than firing
 * it from setInterval. startRest() is always reached from a tap, so the context
 * is live at scheduling time; the audio thread then delivers on time regardless
 * of main-thread throttling. The interval keeps a late fallback for the case
 * where the context dies before the scheduled time arrives.
 */
function scheduleCue(seconds) {
  cancelCue();
  if (!settings.sound) return;
  unlockAudio();
  if (!audioCtx || !rest) return;
  try {
    const nodes = [];
    const t0 = audioCtx.currentTime + seconds;
    for (let i = 0; i < 3; i++) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      o.connect(g); g.connect(audioCtx.destination);
      const t = t0 + i * 0.38;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.start(t); o.stop(t + 0.32);
      if (i === 0) o.onended = () => { if (rest) { rest.cueFired = true; saveRest(); } };
      nodes.push(o);
    }
    rest.cueNodes = nodes;
  } catch (e) {}
}
function cancelCue() {
  if (!rest || !rest.cueNodes) return;
  for (const o of rest.cueNodes) { try { o.onended = null; o.stop(); } catch (e) {} }
  rest.cueNodes = null;
}
```

- [ ] **Step 4: Wire scheduling into the rest lifecycle**

Replace lines 246-255:

```js
let rest = store.get('rest', null); // { endsAt, total, label, fired, cueFired } — persisted so a reload mid-rest doesn't lose the countdown
// cueNodes holds live AudioNodes and must never be persisted.
const saveRest = () => {
  if (!rest) { store.del('rest'); return; }
  const { cueNodes, ...persistable } = rest;
  store.set('rest', persistable);
};
function startRest(seconds, label) {
  if (!seconds || seconds <= 0) return;
  unlockAudio();
  rest = { endsAt: Date.now() + seconds * 1000, total: seconds, label: label || 'Rest', fired: false, cueFired: false, cueNodes: null };
  scheduleCue(seconds);
  saveRest(); renderRest();
}
function adjustRest(delta) {
  if (!rest) return;
  rest.endsAt += delta * 1000;
  rest.total = Math.max(rest.total + delta, 1);
  const remain = (rest.endsAt - Date.now()) / 1000;
  if (remain > 0) { rest.fired = false; rest.cueFired = false; scheduleCue(remain); }
  saveRest(); renderRest();
}
function stopRest() { cancelCue(); rest = null; saveRest(); renderRest(); }
```

- [ ] **Step 5: Demote the interval beep to a fallback**

Replace line 278 inside the `setInterval`:

```js
    // Fallback only: the cue is normally delivered by scheduleCue() on the audio
    // clock. Beep here only if that never landed, so a dead context still gets a
    // late cue and a delivered one never doubles up.
    if (remain <= 0 && !rest.fired) {
      rest.fired = true;
      if (!rest.cueFired) { beep(3); buzz(); } else buzz();
      saveRest();
    }
```

Also change line 279 so the auto-dismiss cancels any stragglers:

```js
    if (remain <= -30) { cancelCue(); rest = null; saveRest(); }  // auto-dismiss 30s after firing
```

A reload mid-rest restores `rest` from localStorage without `cueNodes`, so the scheduled cue is gone; the fallback covers it. Add the re-schedule to the boot sequence, immediately after the existing `renderRest();` at line 2173:

```js
// A reload loses the scheduled cue (AudioNodes can't be persisted). Re-arm it —
// scheduleCue is a no-op until a gesture unlocks the context, and the interval
// fallback covers the gap until then.
if (rest && !rest.fired) scheduleCue(Math.max(0, (rest.endsAt - Date.now()) / 1000));
```

- [ ] **Step 6: Resume on refocus, and start/stop the keep-alive with the session**

In the `visibilitychange` handler (line 239), add `unlockAudio()`:

```js
  if (document.visibilityState === 'visible') { unlockAudio(); syncWakeLock(); }
```

In `syncWakeLock()` (lines 230-237), attach the keep-alive to the same active/inactive transition — add as the first two lines of the function body:

```js
  if (active) startKeepAlive(); else stopKeepAlive();
```

- [ ] **Step 7: Make Settings tell the truth**

Replace the Vibration row (lines 1141-1144):

```js
      <div class="row between" style="padding:6px 0">
        <span>Vibration</span>
        ${navigator.vibrate
          ? `<button class="icon-btn ${settings.vibrate ? 'success' : ''}" data-action="toggle-vibrate">${settings.vibrate ? 'On' : 'Off'}</button>`
          : `<span class="muted small">Not supported on this device</span>`}
      </div>
```

Replace the `test-sound` action (line 2101) so a silent timer says why:

```js
    case 'test-sound': {
      beep(3); buzz();
      const st = audioState();
      toast(st === 'running' ? "That's the rest-timer cue"
        : `Audio context is "${st}" — sound may not fire. Tap anywhere and retry.`, st === 'running' ? 'ok' : 'err');
      break;
    }
```

- [ ] **Step 8: Verify in the browser**

There is no automated test for this — Web Audio needs a real audio thread and a real user gesture. Verify by hand in the preview:

1. Start a session, complete a set with a short rest (edit an exercise's rest to 10 s first). The three beeps must fire at 0:00.
2. During a rest, switch to another browser tab and back. The cue must still fire exactly once, at the right time.
3. Tap `+15s` mid-rest → the cue moves and still fires once.
4. Tap `Skip` mid-rest → no beep at all.
5. Reload the page mid-rest → the countdown survives and the cue still fires.
6. Settings → Test the rest-timer sound → toast confirms, and reports the state if the context is not running.
7. Confirm `localStorage` `rest` contains no `cueNodes` key.

- [ ] **Step 9: Bump the cache and commit**

`sw.js`: `const CACHE = 'gymtrack-v14';`

```bash
git add app.js sw.js
git commit -m "$(cat <<'EOF'
Fix the rest-timer cue never firing

Two causes. unlockAudio() only resumed a 'suspended' context, but WebKit uses
a non-standard 'interrupted' state after a screen lock or an audio interruption
and stays there — so beep() built oscillators on a dead context and produced
nothing, while the Test button still worked because a gesture makes WebKit
auto-resume. And the cue was only ever triggered from setInterval, so nothing
was scheduled on the audio clock and any throttling lost it outright.

Now: resume from any non-running state, keep a near-silent source alive during
a session, and pre-schedule the beeps at rest start. The interval keeps a
guarded late fallback so a dead context still cues and a delivered one never
doubles. Settings reports the context state, and the Vibration toggle is
labelled unsupported where navigator.vibrate is absent (all iOS Safari).

Locked-screen audio is still out of scope — iOS suspends Web Audio there.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Jump height logging

**Files:**
- Modify: `app.js` — `EXERCISE_METRICS` constant (new, near `EQUIPMENT_TYPES`); import sanitiser (line 336-351); `defaultPlan`'s `ex()` helper (124-125); `startSession` set construction (386-393); `exerciseCard` set grid (859-873); `stepperInfo` (Task 1); `set` input bind (2133-2137); `finishSession` (409-414); `detectPRs` (432-444); `weeklyStats` (963-975); `exerciseHistory` (918-927); `viewHistory` chart block (1023-1039); `exEditModal` (1204-1240); `cmjAccept` (1880-1905)
- Modify: `styles.css` — `.set-grid.jump`
- Modify: `tools/push-plan.mjs` — metric validation in `validatePlan`
- Modify: `sports/CLAUDE.md` — schema
- Modify: `sw.js` — `CACHE` → `gymtrack-v15`

**Interfaces:**
- Produces:
  - `EXERCISE_METRICS = ['load', 'height']`
  - `isJump(e) → boolean` — `e.metric === 'height'`
  - Height set shape: `{ heightCm: number|null, done: boolean }` — `weight`/`reps`/`rpe` absent, not zero
  - `bestHeight(sets) → number` — max `heightCm` among sets, `0` when none
- Consumes: `est1RM`, `canonicalName`, `sameExercise`, `chartSvg` (existing)

---

- [ ] **Step 1: Add the metric constant and predicate**

In `app.js`, after `EQUIPMENT_LABELS` (line 113):

```js
/*
 * What an exercise's sets measure. 'load' is the default (weight × reps × RPE);
 * 'height' logs one jump attempt per row in cm and carries no weight, reps or
 * RPE at all — absent rather than zero, so nothing downstream mistakes a jump
 * for a 0 kg lift.
 */
const EXERCISE_METRICS = ['load', 'height'];
const isJump = e => e.metric === 'height';
const bestHeight = sets => sets.reduce((m, s) => (s.heightCm != null && s.heightCm > m ? s.heightCm : m), 0);
```

- [ ] **Step 2: Accept `metric` through import and the default-plan helper**

In the sanitiser, add after the `barWeight` line (line 345):

```js
            metric: EXERCISE_METRICS.includes(e.metric) ? e.metric : 'load',
```

In `defaultPlan`'s `ex()` helper (line 125), add `metric: 'load'` to the returned object so every code path has the field:

```js
    ({ id: uid(), name, sets, reps, weight, targetRpe: rpe, restSeconds: rest, restSecondsNext: null, equipment: equipment || 'barbell', barWeight: null, metric: 'load', description: '', notes: '', alternates });
```

In `exEditModal`'s blank-exercise default (line 1202), add `metric: 'load',` after `barWeight: null,`.

- [ ] **Step 3: Build height sets when a session starts**

In `startSession` (lines 386-393), replace the exercise mapper's tail:

```js
    exercises: day.exercises.map(e => ({
      name: e.name, planId: e.id, swappedFrom: null,
      plannedSets: e.sets, plannedReps: e.reps, plannedWeight: e.weight,
      targetRpe: e.targetRpe, restSeconds: e.restSeconds, restSecondsNext: e.restSecondsNext,
      equipment: e.equipment || 'barbell', barWeight: e.barWeight,
      metric: e.metric === 'height' ? 'height' : 'load',
      description: e.description, alternates: e.alternates, notes: '',
      sets: e.metric === 'height'
        ? Array.from({ length: e.sets }, () => ({ heightCm: null, done: false }))
        : Array.from({ length: e.sets }, () => ({ weight: e.weight, reps: parseRepsLow(e.reps), rpe: e.targetRpe, done: false }))
    }))
```

`set-add` must push the shape the exercise actually uses. Replace the handler at lines 2002-2007:

```js
    case 'set-add': {
      const ex = active.exercises[+el.dataset.ei];
      const lastSet = ex.sets[ex.sets.length - 1];
      ex.sets.push(isJump(ex)
        ? { heightCm: null, done: false }
        : { weight: lastSet ? lastSet.weight : ex.plannedWeight, reps: lastSet ? lastSet.reps : parseRepsLow(ex.plannedReps), rpe: ex.targetRpe, done: false });
      saveActive(); render(); break;
    }
```

`set-remove` (lines 2008-2011) only pops, so it needs no change.

- [ ] **Step 4: Render the height set grid**

In `exerciseCard`, replace the `set-grid` block (lines 859-867) with a branch:

```js
    ${isJump(e) ? `
    <div class="set-grid jump">
      <div class="head">#</div><div class="head">cm</div><div class="head">✓</div>
      ${e.sets.map((s, si) => `
        <div class="set-no">${si + 1}</div>
        <input class="${s.done ? 'set-row-done-i' : ''}" type="number" inputmode="decimal" step="0.5" value="${s.heightCm != null ? s.heightCm : ''}" data-bind="set" data-ei="${ei}" data-si="${si}" data-f="heightCm" ${s.done ? 'style="border-color:var(--green)"' : ''}>
        <button class="set-done-btn ${s.done ? 'success' : ''}" data-action="set-done" data-ei="${ei}" data-si="${si}">${s.done ? '✓' : '○'}</button>`).join('')}
    </div>` : `
    <div class="set-grid">
      <div class="head">#</div><div class="head">${unit()}</div><div class="head">Reps</div><div class="head">RPE</div><div class="head">✓</div>
      ${e.sets.map((s, si) => `
        <div class="set-no">${si + 1}</div>
        <input class="${s.done ? 'set-row-done-i' : ''}${e.equipment === 'bodyweight' ? ' bw-weight-i' : ''}" type="number" inputmode="decimal" step="0.5" value="${s.weight != null ? s.weight : ''}" data-bind="set" data-ei="${ei}" data-si="${si}" data-f="weight" ${s.done ? 'style="border-color:var(--green)"' : ''}>
        <input type="number" inputmode="numeric" value="${s.reps != null ? s.reps : ''}" data-bind="set" data-ei="${ei}" data-si="${si}" data-f="reps" ${s.done ? 'style="border-color:var(--green)"' : ''}>
        <button class="rpe-btn ${s.rpe != null ? '' : 'muted'}" data-action="rpe-pick" data-ei="${ei}" data-si="${si}" ${s.done ? 'style="border-color:var(--green)"' : ''}>${s.rpe != null ? s.rpe : '—'}</button>
        <button class="set-done-btn ${s.done ? 'success' : ''}" data-action="set-done" data-ei="${ei}" data-si="${si}">${s.done ? '✓' : '○'}</button>`).join('')}
    </div>`}
```

Also fix the collapsed-card summary, which calls `est1RM(undefined, undefined)` for a jump and would render `NaN`. Replace the whole block at lines 833-843:

```js
  if (allDone && !exExpanded.has(ei)) {
    let summary;
    if (isJump(e)) {
      summary = `${e.sets.length} attempt${e.sets.length === 1 ? '' : 's'} · best ${bestHeight(e.sets)} cm`;
    } else {
      const best = e.sets.reduce((a, b) => est1RM(b.weight, b.reps) > est1RM(a.weight, a.reps) ? b : a);
      summary = `${e.sets.length} sets · best ${best.weight}×${best.reps}`;
    }
    return `
    <div class="card collapsed-ex tappable" data-action="ex-expand" data-ei="${ei}">
      <div class="row between">
        <div class="grow"><span class="green bold">✓</span> <span class="bold">${esc(e.name)}</span>
          <span class="muted small">· ${esc(summary)}</span></div>
        <span class="chev">${icon('chevDown', 18)}</span>
      </div>
    </div>`;
  }
```

Hide the plate-calculator and `Last:` lines for jumps — in the header, guard line 856 and line 852:

```js
      ${!isJump(e) && PLATE_EQUIPMENT.has(e.equipment || 'barbell') ? `<button class="icon-btn" data-action="plate-calc" data-ei="${ei}" title="Plate calculator">${icon('plate', 18)}</button>` : ''}
```

and replace the `target-line`/`last-line` pair for jumps:

```js
        <div class="target-line">${isJump(e)
          ? `Plan: ${e.plannedSets} attempt${e.plannedSets === 1 ? '' : 's'} · rest ${fmtClock(e.restSeconds)} ${equipChip(e)}`
          : `Plan: ${e.plannedSets}×${esc(e.plannedReps)} @ ${e.plannedWeight}${unit()}${e.targetRpe ? ' · RPE ' + e.targetRpe : ''} · rest ${fmtClock(e.restSeconds)} ${equipChip(e)}`}</div>
        ${lastP ? `<div class="last-line">Last: ${isJump(e) ? `best ${bestHeight(lastP.sets)} cm` : lastP.sets.map(s => `${s.weight}×${s.reps}`).join(' · ') + (lastRpe ? ` @RPE ${lastRpe}` : '')} — ${fmtDate(lastP.date)}</div>` : ''}
```

Add a **Measure via video** button to jump cards, in the button row at line 868-872:

```js
      ${isJump(e) ? `<button class="ghost icon-btn" data-action="cmj-open" data-ei="${ei}">${icon('video', 15)} Measure</button>` : ''}
```

Add to `styles.css`:

```css
.set-grid.jump { grid-template-columns: 30px 1fr 46px; }
```

- [ ] **Step 5: Let the stepper handle cm**

In `stepperInfo` (Task 1, Step 7), add before the `if (f !== 'weight') return null;` line:

```js
  if (f === 'heightCm') return { kind: 'height', label: 'cm', down: 0.5, up: 0.5 };
```

The `set` input bind (lines 2133-2137) already writes `s[el.dataset.f]` from a `parseFloat`, so `heightCm` needs no change there.

- [ ] **Step 6: Persist height sets**

In `finishSession` (lines 409-414), branch the set mapper:

```js
      .map(e => ({ name: e.name, plannedSets: e.plannedSets, plannedReps: e.plannedReps,
        plannedWeight: e.plannedWeight, targetRpe: e.targetRpe,
        equipment: e.equipment, barWeight: e.barWeight, metric: e.metric === 'height' ? 'height' : 'load',
        swappedFrom: e.swappedFrom, notes: e.notes,
        sets: e.sets.filter(s => s.done).map(s => e.metric === 'height'
          ? ({ heightCm: s.heightCm })
          : ({ weight: s.weight, reps: s.reps, rpe: s.rpe })) }))
```

- [ ] **Step 7: Teach the three stats paths about the metric**

`detectPRs` (lines 432-444) — `est1RM(undefined, undefined)` is `NaN`, and `NaN > 0` is false, so today a jump would never PR *and* would poison the loop. Replace:

```js
function detectPRs(record) {
  const prs = [];
  for (const e of record.exercises) {
    const jump = e.metric === 'height';
    const score = ex => jump ? bestHeight(ex.sets) : Math.max(...ex.sets.map(s => est1RM(s.weight, s.reps)));
    const newBest = score(e);
    let oldBest = 0;
    for (const s of sessions) for (const ex of s.exercises) {
      // Compare like with like: a height PR must not be measured against loads.
      if (sameExercise(ex.name, e.name) && (ex.metric === 'height') === jump) {
        oldBest = Math.max(oldBest, score(ex));
      }
    }
    if (newBest > oldBest && oldBest > 0) prs.push(canonicalName(e.name));
  }
  return prs;
}
```

`weeklyStats` (lines 963-975) — replace the inner accumulation:

```js
        for (const e of s.exercises) {
          wk.sets += e.sets.length;
          // Height sets have no kg × reps to contribute; they still count as sets.
          if (e.metric === 'height') continue;
          for (const st of e.sets) wk.volume += (st.weight || 0) * (st.reps || 0);
        }
```

`exerciseHistory` (lines 918-927) — return a height-aware row:

```js
function exerciseHistory(name) {
  const rows = [];
  for (const s of sessions) for (const e of s.exercises) {
    if (sameExercise(e.name, name) && e.sets.length) {
      if (e.metric === 'height') {
        rows.push({ date: s.date, jump: true, heightCm: bestHeight(e.sets), sets: e.sets });
      } else {
        const best = e.sets.reduce((a, b) => est1RM(b.weight, b.reps) > est1RM(a.weight, a.reps) ? b : a);
        rows.push({ date: s.date, jump: false, best, e1rm: est1RM(best.weight, best.reps), sets: e.sets });
      }
    }
  }
  return rows;
}
```

`viewHistory`'s Exercise-progress block (lines 1027-1036) — plot cm for jumps. Replace `const prBest = …` (line 1004 area, `const prBest = hist.length ? Math.max(...hist.map(r => r.e1rm)) : 0;`) and the chart block:

```js
  const histJump = hist.length ? hist[hist.length - 1].jump : false;
  const prBest = hist.length ? Math.max(...hist.map(r => histJump ? r.heightCm : r.e1rm)) : 0;
```

```js
        ${hist.length ? `
          ${chartSvg(hist.slice(-12).map(r => ({ v: histJump ? r.heightCm : r.e1rm, d: r.date })))}
          <div class="muted small mt8">${histJump ? `Best jump: <b class="amber">${prBest} cm</b>` : `Best est. 1RM: <b class="amber">${prBest} ${unit()}</b>`}</div>
          <div class="divider"></div>
          ${hist.slice(-8).reverse().map(r => `
            <div class="row between" style="padding:5px 0">
              <span class="muted small">${fmtDate(r.date)}</span>
              <span class="small">${histJump ? r.sets.map(s => `${s.heightCm}cm`).join(' · ') : r.sets.map(s => `${s.weight}×${s.reps}`).join(' · ')}</span>
              <span class="small bold ${(histJump ? r.heightCm : r.e1rm) >= prBest ? 'amber' : ''}">${(histJump ? r.heightCm : r.e1rm) >= prBest ? '🏆 ' : ''}${histJump ? `${r.heightCm} cm` : `e1RM ${r.e1rm}`}</span>
            </div>`).join('')}` : '<p class="muted mt8">No logged sets for this exercise yet.</p>'}
```

- [ ] **Step 8: Add the metric selector to the plan editor**

In `exEditModal`, after the Equipment field (line 1218-1220):

```js
    <label class="field"><span>What the sets measure</span>
      <select id="f-metric">
        <option value="load" ${e.metric !== 'height' ? 'selected' : ''}>Weight × reps (normal lift)</option>
        <option value="height" ${e.metric === 'height' ? 'selected' : ''}>Jump height in cm (one attempt per set)</option>
      </select>
    </label>
```

In the Save handler's `upd` object, add `metric: document.getElementById('f-metric').value,`.

The loadability guard added in Task 1 Step 8 must not run for a jump — a height exercise's weight is 0, which is loadable for `bodyweight` but not for `barbell`, so a mislabelled jump would be refused for the wrong reason. Replace that guard in full:

```js
          const eqVal = document.getElementById('f-equipment').value;
          const metricVal = document.getElementById('f-metric').value;
          const barVal = barWeightRaw ? parseFloat(barWeightRaw) : null;
          const wVal = mnum('f-weight');
          const barResolved = barVal != null ? barVal : resolvedBarWeight({ equipment: eqVal, barWeight: null });
          if (metricVal === 'height' && wVal) {
            toast('A jump-height exercise carries no weight — set it to 0 (box height goes in the description)', 'err');
            return;
          }
          if (metricVal !== 'height' && unit() === 'kg' && !isLoadable(eqVal, barResolved, wVal)) {
            const n = nearestRungs(eqVal, barResolved, wVal);
            toast(`${wVal}${unit()} is not loadable on a ${EQUIPMENT_LABELS[eqVal].toLowerCase()} — try ${n.lo} or ${n.hi}`, 'err');
            return;
          }
```

- [ ] **Step 9: Route the CMJ video tool to a jump exercise**

`cmjAccept` currently only writes `active.readiness`. Add an optional target. Change the `cmj-open` action to stash the exercise index when one is given, then in `cmjAccept` (lines 1894-1904):

```js
  const targetEi = cmjState.targetEi;
  const targetEx = targetEi != null && active ? active.exercises[targetEi] : null;
  if (targetEx && isJump(targetEx)) {
    // Fill the next empty attempt, or append one if every row is used.
    let slot = targetEx.sets.find(s => s.heightCm == null);
    if (!slot) { slot = { heightCm: null, done: false }; targetEx.sets.push(slot); }
    slot.heightCm = heightCm;
    slot.done = true;
    saveActive();
    toast(`${heightCm} cm logged to ${targetEx.name} ✓`);
  } else if (active) {
    active.readiness.cmjCm = heightCm;
    active.readiness.flightTimeMs = best.flightTimeMs;
    active.readiness.method = 'video';
    active.readiness.cmjAttempts = list;
    saveActive();
    toast(list.length > 1 ? `CMJ ${heightCm} cm — best of ${list.length} ✓` : 'CMJ height set from video ✓');
  } else {
    // Nothing to attach to: say so loudly rather than silently dropping a full test set.
    toast(`Best ${heightCm} cm of ${list.length} — not saved, start a session first`, 'err');
  }
```

In `cmjVideoModal` (line 1423), accept and store the index — change its signature to `cmjVideoModal(targetEi)` and add `targetEi: targetEi != null ? targetEi : null,` to the `cmjState` object. In the `cmj-open` action handler, pass it through:

```js
    case 'cmj-open': cmjVideoModal(el.dataset.ei != null ? +el.dataset.ei : null); break;
```

- [ ] **Step 10: Validate the metric in `push-plan.mjs`**

In `validatePlan`'s exercise loop, before the `weightProblem` call:

```js
        if (e.metric != null && e.metric !== 'load' && e.metric !== 'height') {
          errors.push(`${day.name} → ${e.name}: metric "${e.metric}" is not one of "load", "height".`);
        }
        if (e.metric === 'height') {
          if (e.weight) errors.push(`${day.name} → ${e.name}: a height-metric exercise must have weight 0 — box height goes in "description".`);
          continue; // the weight ladder does not apply
        }
```

- [ ] **Step 11: Document the schema**

In `sports/CLAUDE.md`, add to the "New optional fields" list:

```markdown
- `metric` — `load` (default, omittable) or `height`. A `height` exercise logs **one jump attempt per set row** in cm; its sets carry `heightCm` and no weight/reps/RPE. Use `equipment: "bodyweight"` and `weight: 0` with it. Feeds history and PR detection on best cm. The pre-session readiness CMJ field is separate and unchanged — that measures readiness under a standardised protocol, this measures training output.
```

Also add `metric` to the JSON example's exercise object and to the Claude prompt's field list in `app.js` (the `equipment` line around line 494-506 and 515).

- [ ] **Step 12: Verify**

```bash
node "tools/weights.test.mjs"
```

Expected: still all passing.

Then in the preview: add a `Box Jump` exercise with metric `height`, equipment `bodyweight`, 3 sets. Start a session:
- The card shows `# | cm | ✓`, no RPE column, no plate icon, and `Plan: 3 attempts`.
- The stepper on a cm field reads `−0.5` / `+0.5`.
- Log three attempts, finish the session → the completion modal must not show `NaN`.
- History → select `Box Jump` → chart plots cm, the summary reads `Best jump: N cm`, and the per-session line lists `Ncm · Ncm · Ncm`.
- Weekly training's `kg lifted` figure must be unchanged by the jump session.
- Log a second, higher jump session → a PR is reported.

- [ ] **Step 13: Bump the cache and commit**

`sw.js`: `const CACHE = 'gymtrack-v15';`

```bash
git add app.js styles.css sw.js tools/push-plan.mjs ../CLAUDE.md
git commit -m "$(cat <<'EOF'
Log jump height as an exercise metric

An exercise can set metric: "height" to log one jump attempt per set row in
cm, with no weight, reps or RPE. Feeds history and PR detection on best cm,
and the CMJ video tool can drop a measurement straight into an attempt.

Teaches the three stats paths the metric, without which jumps corrupt existing
numbers: detectPRs would compare NaN e1RMs, weeklyStats would add 0 kg volume
rows, and the history chart would plot NaN. The pre-session readiness CMJ
field is unchanged and stays the standardised fatigue signal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Supersets

**Files:**
- Modify: `app.js` — import sanitiser; `defaultPlan` `ex()` helper; `startSession`; new grouping helpers; `viewActiveSession` exercise loop (line 822); `exerciseCard` → `supersetCard`; `set-done` rest logic (1956-1972); `exEditModal`; `viewPlan` rows (move up/down); new `ex-move` action; `finishSession`
- Modify: `styles.css` — `.superset-card`, `.superset-head`, `.superset-member`, `.ss-next`
- Modify: `tools/push-plan.mjs` — adjacency validation
- Modify: `sports/CLAUDE.md`, `README.md` — schema
- Modify: `sw.js` — `CACHE` → `gymtrack-v16`

**Interfaces:**
- Produces:
  - `supersetGroups(list) → Array<{ tag: string|null, idx: number[] }>` — maximal adjacent runs over an exercise array; ungrouped exercises come back as single-element runs with `tag: null`
  - `groupOf(list, ei) → { tag, idx } | null` — the group containing index `ei`, `null` when ungrouped
  - `nextInRound(list, group, ei, si) → number|null` — the next member index owing set `si`
  - `groupComplete(list, group) → boolean`
  - `groupNextSlot(list, group) → { ei: number, si: number } | null` — the single set to log next, in round-robin order
  - `supersetCard(group) → string` — HTML for one grouped card
  - `exerciseCard(e, ei, opts?)` — gains a third parameter `{ inGroup: boolean }`
  - Exercise field `superset: string|null`
  - `exExpanded` now holds numeric exercise indices **and** string group keys (`'ss:A'`)

---

- [ ] **Step 1: Accept the tag through import and defaults**

Sanitiser, after the `metric` line:

```js
            // Adjacent exercises sharing a tag form one superset. Uppercased and
            // trimmed so "a" and "A " group together rather than silently splitting.
            superset: e.superset ? String(e.superset).trim().toUpperCase().slice(0, 2) : null,
```

Add `superset: null,` to `defaultPlan`'s `ex()` return object and to `exEditModal`'s blank-exercise default.

Add `superset: e.superset || null,` to `startSession`'s exercise mapper and to `finishSession`'s record mapper (so a coach can see the structure that produced the fatigue).

- [ ] **Step 2: Write the grouping helpers**

Add near `startSession` in `app.js`:

```js
/* ================= supersets ================= */
/*
 * A superset is a maximal run of ADJACENT exercises sharing a `superset` tag.
 * Adjacency is the whole contract: it keeps days[].exercises a flat array, so
 * every existing index path (history, swap, stepper, set-done) is untouched.
 * A tag that appears in two non-adjacent runs renders as two cards — visibly
 * wrong, and tools/push-plan.mjs rejects it before it can be pushed.
 */
function supersetGroups(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const tag = list[i].superset || null;
    if (!tag) { out.push({ tag: null, idx: [i] }); continue; }
    const idx = [i];
    while (i + 1 < list.length && (list[i + 1].superset || null) === tag) { idx.push(++i); }
    out.push({ tag, idx });
  }
  return out;
}
function groupOf(list, ei) {
  const g = supersetGroups(list).find(x => x.idx.includes(ei));
  return g && g.tag ? g : null;
}
// The next member owing set `si`, scanning after `ei` then wrapping to the start.
// Unequal set counts just skip members that have no set at that round.
function nextInRound(list, group, ei, si) {
  const pos = group.idx.indexOf(ei);
  const order = group.idx.slice(pos + 1).concat(group.idx.slice(0, pos));
  for (const j of order) {
    const s = list[j].sets[si];
    if (s && !s.done) return j;
  }
  return null;
}
function groupComplete(list, group) {
  return group.idx.every(j => list[j].sets.every(s => s.done));
}
// Round-robin: the single set the athlete should log next, or null when done.
function groupNextSlot(list, group) {
  const rounds = Math.max(...group.idx.map(j => list[j].sets.length));
  for (let si = 0; si < rounds; si++) {
    for (const j of group.idx) {
      const s = list[j].sets[si];
      if (s && !s.done) return { ei: j, si };
    }
  }
  return null;
}
```

- [ ] **Step 3: Render grouped exercises in one card**

In `viewActiveSession`, replace line 822:

```js
    ${supersetGroups(active.exercises).map(g => g.tag
      ? supersetCard(g)
      : exerciseCard(active.exercises[g.idx[0]], g.idx[0])).join('')}
```

Add `supersetCard` next to `exerciseCard`:

```js
function supersetCard(group) {
  const list = active.exercises;
  const rounds = Math.max(...group.idx.map(j => list[j].sets.length));
  const doneRounds = Array.from({ length: rounds }, (_, si) =>
    group.idx.every(j => !list[j].sets[si] || list[j].sets[si].done)).filter(Boolean).length;
  const complete = groupComplete(list, group);
  const key = 'ss:' + group.tag;
  if (complete && !exExpanded.has(key)) {
    return `
    <div class="card collapsed-ex tappable" data-action="ex-expand" data-key="${esc(key)}">
      <div class="row between">
        <div class="grow"><span class="green bold">✓</span> <span class="bold">Superset ${esc(group.tag)}</span>
          <span class="muted small">· ${group.idx.map(j => esc(list[j].name)).join(' + ')}</span></div>
        <span class="chev">${icon('chevDown', 18)}</span>
      </div>
    </div>`;
  }
  const slot = groupNextSlot(list, group);
  return `
  <div class="card superset-card">
    <div class="superset-head row between">
      <span class="bold">Superset ${esc(group.tag)}</span>
      <span class="muted small">${complete ? 'complete' : `round ${Math.min(doneRounds + 1, rounds)} of ${rounds}`}</span>
    </div>
    ${group.idx.map(j => `<div class="superset-member${slot && slot.ei === j ? ' ss-next' : ''}">${exerciseCard(list[j], j, { inGroup: true })}</div>`).join('')}
  </div>`;
}
```

Give `exerciseCard` the third parameter and make it skip its own outer `card` wrapper and its own collapse when inside a group. Change its signature and the two wrapper lines:

```js
function exerciseCard(e, ei, opts) {
  const inGroup = !!(opts && opts.inGroup);
  const doneCount = e.sets.filter(s => s.done).length;
  const allDone = doneCount === e.sets.length && e.sets.length > 0;
  // Inside a superset the whole group collapses as a unit, so a member never
  // collapses on its own — the athlete still needs its rows for the next round.
  if (allDone && !inGroup && !exExpanded.has(ei)) {
```

…and change the returned root element from `<div class="card">` to `<div class="${inGroup ? 'ss-body' : 'card'}">`.

`exExpanded` currently holds numeric indices; `supersetCard` adds string keys. The `ex-expand` handler (line 1973) must accept both:

```js
    case 'ex-expand': exExpanded.add(el.dataset.key != null ? el.dataset.key : +el.dataset.ei); render(); break;
```

Add to `styles.css`:

```css
.superset-card { padding: 12px 14px; }
.superset-head { border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 4px; }
.superset-member { padding: 8px 0; border-bottom: 1px solid var(--border); }
.superset-member:last-child { border-bottom: 0; padding-bottom: 0; }
.superset-member.ss-next { box-shadow: inset 3px 0 0 var(--accent); padding-left: 9px; margin-left: -12px; }
.ss-body { padding: 0; }
```

- [ ] **Step 4: Make rest group-aware**

Replace the `set-done` body (lines 1956-1972):

```js
    case 'set-done': {
      const ei = +el.dataset.ei, si = +el.dataset.si;
      const ex = active.exercises[ei], s = ex.sets[si];
      s.done = !s.done;
      const group = groupOf(active.exercises, ei);
      const exerciseDone = ex.sets.every(y => y.done);
      // Inside a group the whole group collapses together, so don't collapse a member.
      if (s.done && exerciseDone && !group) exExpanded.delete(ei);
      saveActive(); render();
      if (s.done) {
        const remaining = active.exercises.some(x => x.sets.some(y => !y.done));
        if (remaining) {
          if (group) {
            const nextEi = nextInRound(active.exercises, group, ei, si);
            if (nextEi != null) {
              // Mid-round: this exercise's own restSeconds is the short transition.
              startRest(ex.restSeconds, '→ ' + active.exercises[nextEi].name);
            } else if (!groupComplete(active.exercises, group)) {
              const rounds = Math.max(...group.idx.map(j => active.exercises[j].sets.length));
              startRest(ex.restSeconds, `Round ${Math.min(si + 2, rounds)} of ${rounds}`);
            } else {
              // Group finished. The next-movement rest is authored on the group's LAST
              // member in plan order — with unequal set counts the last member to
              // finish need not be that one, so don't read it off `ex`.
              const lastEx = active.exercises[group.idx[group.idx.length - 1]];
              startRest(lastEx.restSecondsNext != null ? lastEx.restSecondsNext : lastEx.restSeconds,
                'Rest — next movement');
            }
          } else {
            const seconds = exerciseDone && ex.restSecondsNext != null ? ex.restSecondsNext : ex.restSeconds;
            startRest(seconds, 'Rest — ' + ex.name);
          }
        }
        buzz([60]);
      }
      break;
    }
```

- [ ] **Step 5: Edit groups in the plan editor**

In `exEditModal`, after the metric field:

```js
    <label class="field"><span>Superset group</span>
      <select id="f-superset">
        <option value="" ${!e.superset ? 'selected' : ''}>None</option>
        ${['A', 'B', 'C', 'D'].map(t => `<option value="${t}" ${e.superset === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <span class="field-hint">Members must sit next to each other in the day — use the ↑↓ buttons on the day list.</span>
    </label>
```

Add `superset: document.getElementById('f-superset').value || null,` to the `upd` object.

- [ ] **Step 6: Add move up/down to plan rows**

Without reordering there is no way to make members adjacent in-app. In `viewPlan`'s exercise row (lines 898-905), replace the row with:

```js
          ${d.exercises.map((e, i) => `
            <div class="row between" style="padding:9px 0">
              <div class="grow tappable" data-action="ex-menu" data-day="${d.id}" data-i="${i}">
                <div class="bold">${esc(e.name)}${e.superset ? ` <span class="day-pill">SS ${esc(e.superset)}</span>` : ''}</div>
                <div class="muted small">${e.sets}×${esc(e.reps)} @ ${e.weight}${unit()}${e.targetRpe ? ' · RPE ' + e.targetRpe : ''} · rest ${fmtClock(e.restSeconds)}${e.alternates.length ? ' · ' + e.alternates.length + ' alt' : ''} ${equipChip(e)}</div>
              </div>
              <button class="icon-btn" data-action="ex-move" data-day="${d.id}" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="icon-btn" data-action="ex-move" data-day="${d.id}" data-i="${i}" data-dir="1" ${i === d.exercises.length - 1 ? 'disabled' : ''}>↓</button>
            </div>`).join('')}
```

Add the action next to `ex-add`:

```js
    case 'ex-move': {
      const day = plan.days.find(d => d.id === el.dataset.day);
      if (!day) break;
      const i = +el.dataset.i, j = i + (+el.dataset.dir);
      if (j < 0 || j >= day.exercises.length) break;
      const ex = day.exercises.splice(i, 1)[0];
      day.exercises.splice(j, 0, ex);
      savePlan(); render();
      break;
    }
```

- [ ] **Step 7: Reject non-adjacent tags in `push-plan.mjs`**

In `validatePlan`, after the duplicate-name loop:

```js
  // A superset tag must form ONE adjacent run. Split runs render as two separate
  // cards in the app with two independent rest cycles — not what was intended.
  for (const day of plan.days) {
    const runs = new Map(); // tag → number of separate adjacent runs
    let prev = null;
    for (const e of day.exercises || []) {
      const tag = e.superset ? String(e.superset).trim().toUpperCase() : null;
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
```

- [ ] **Step 8: Document the schema**

In `sports/CLAUDE.md`'s "New optional fields" list:

```markdown
- `superset` — a short tag (`"A"`, `"B"`, …). **Adjacent** exercises sharing a tag are logged as one alternating superset card, round by round. Rest reuses the existing fields with no additions: each member's own `restSeconds` is the rest taken *after its own set* (so `A1.restSeconds` is the short transition to A2, and `A2.restSeconds` is the rest back to A1), and `restSecondsNext` on the group's **last member in plan order** is the rest after the final round. A tag split across non-adjacent runs is rejected by `tools/push-plan.mjs`.
```

Add `superset` and `metric` to the JSON schema example in `sports/CLAUDE.md`, `Tracking app/README.md`, and the Claude prompt in `app.js`.

- [ ] **Step 9: Verify**

```bash
node "tools/weights.test.mjs"
```

Then build a two-exercise superset in the preview (Plan → set both to group A, use ↑↓ to make them adjacent; set A1 rest 15 s and A2 rest 90 s, and A2's "rest before next movement" to 180 s). Start the session and confirm:
- Both render in one card headed `Superset A · round 1 of N`, with the accent bar on A1.
- Complete A1 set 1 → rest is **15 s** labelled `→ <A2 name>`; the accent bar moves to A2.
- Complete A2 set 1 → rest is **90 s** labelled `Round 2 of N`; the header advances.
- Give A1 four sets and A2 three; on round 4 only A1 is highlighted and A2 is skipped.
- Complete the last set → rest is **180 s** labelled `Rest — next movement`.
- The whole card collapses as one unit and reopens on tap.
- An ungrouped exercise still behaves exactly as before.

Then confirm the validator refuses a split run:

```bash
node "tools/push-plan.mjs" "D:/Temp/claude/E--claude-sports-Tracking-app/ed83665f-45c9-4f52-b11c-0fe59ab0b7f8/scratchpad/split-superset.json"
```

Expected: non-zero exit, listing `superset "A" appears in 2 separate non-adjacent runs`. Write that fixture first, with exercises tagged A, B, A in one day.

- [ ] **Step 10: Bump the cache and commit**

`sw.js`: `const CACHE = 'gymtrack-v16';`

```bash
git add app.js styles.css sw.js tools/push-plan.mjs README.md ../CLAUDE.md
git commit -m "$(cat <<'EOF'
Add supersets as an adjacency-tagged group

Adjacent exercises sharing a `superset` tag log as one alternating card, round
by round, with a round-robin next-up indicator. Keeps days[].exercises a flat
array, so every existing index path is untouched and old plans are unaffected.

Rest needs no new fields: a member's own restSeconds is the rest after its own
set, so A1's becomes the short transition and A2's the round rest. The only
real change is that restSecondsNext now waits for the whole group, and is read
off the group's last member in plan order — with unequal set counts the last
member to finish need not be that one.

Plan rows gain move up/down, without which members cannot be made adjacent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update the coaching skills

**Files:**
- Modify: `.claude/skills/shared/schema-reference.md`
- Modify: `.claude/skills/weekly-review/SKILL.md` — lines 34, 129-131, 137, 139
- Modify: `.claude/skills/weekly-review/schema-supplement.md` — line 52 and the Plan Mutation Contract table
- Modify: `.claude/skills/weekly-review/periodization.md` — §D
- Modify: `.claude/skills/session-feedback/SKILL.md`, `.claude/skills/session-feedback/examples.md`

No `sw.js` bump — no app asset changes.

**Interfaces:**
- Consumes: the finished schema from Tasks 2, 4, 5. Do this task **last**, so the docs describe what shipped.

`C:\Users\henri\.claude\skills\{session-feedback,weekly-review,shared}` are Windows directory junctions to this path — editing here updates both views. Do not create files at the user-level path.

---

- [ ] **Step 1: Update `shared/schema-reference.md`**

In the Session Record example (lines 43-58), add the new exercise fields and a jump exercise:

```json
  "exercises": [
    {
      "name": "Bench Press",
      "plannedSets": 4,
      "plannedReps": "6-8",
      "plannedWeight": 80,
      "targetRpe": 8,
      "equipment": "barbell",
      "barWeight": 20,
      "metric": "load",
      "superset": null,
      "swappedFrom": null,
      "notes": "Slight shoulder discomfort set 3 — manageable",
      "sets": [
        { "weight": 82.5, "reps": 7, "rpe": 7 },
        { "weight": 82.5, "reps": 8, "rpe": 7 }
      ]
    },
    {
      "name": "Box Jump",
      "plannedSets": 3,
      "equipment": "bodyweight",
      "metric": "height",
      "sets": [
        { "heightCm": 31.4 },
        { "heightCm": 30.8 },
        { "heightCm": 29.1 }
      ]
    }
  ]
```

Add to the Field Notes table:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `equipment` | string | No | One of `barbell`, `trap-bar`, `landmine`, `training-bar`, `dumbbell`, `machine`, `cable`, `bodyweight`, `other`. Absent in records logged before 2026-07-30 — treat as unknown, not as `barbell` |
| `barWeight` | number | No | Only meaningful for `barbell`/`trap-bar`/`training-bar`. Absent = the gym default (20 / 23 / 10 kg) |
| `metric` | `"load"` \| `"height"` | No | Absent = `"load"`. A `"height"` exercise's sets carry **only** `heightCm` — no weight, reps or RPE. Never compute volume, e1RM or RPE stats from them |
| `superset` | string \| null | No | Adjacent exercises sharing a tag were performed as an alternating superset. Relevant to fatigue reads: RPE on the second movement is inflated by the first |
| `sets[].heightCm` | number | No | One jump attempt, in cm. `"height"` metric only |

Update the Plan Schema example (lines 100-113) to the full current shape, including `restSecondsNext`, `equipment`, `barWeight`, `metric`, `superset`, and an alternate with its own `equipment`.

Rewrite "Plan Authoring Constraints §2" to state the breakpoint rule, then add two new constraints:

```markdown
### 2. Every weight must be loadable on the actual equipment

Set `equipment` accurately **first** — the weight check depends on it, and it also drives the stepper's increments, whether the plate calculator appears, and whether the weight field is grayed. A cable exercise mislabelled `barbell` defeats all of it.

**The ladder has breakpoints — "round to the nearest 2.5 kg" is wrong.** Dumbbells step 1 kg below 10 kg and 2 kg above it; cable and machine stacks step 2.5 kg below 25 kg and 5 kg above it. So 22.5 kg is a valid cable weight but not a valid dumbbell, and 27.5 kg is neither. The authoritative table is in the project's CLAUDE.md, and `tools/weights.test.mjs` is its executable form.

*Signature of this bug in the data:* a `plannedWeight` the athlete never logs, with a nearby value logged instead — planned 22.5 kg → logged 22 kg, twice. Since 2026-07-30 session records carry `equipment`, so this is now **checkable** rather than inferable: compare the planned weight against that equipment's ladder before reading a planned-vs-actual gap as auto-regulation.

### 3. Superset members must be adjacent

Exercises sharing a `superset` tag must sit next to each other in `days[].exercises`. A tag split across non-adjacent runs renders as two separate cards with independent rest cycles, and `tools/push-plan.mjs` rejects it.

Rest inside a group uses the existing fields, with no additions: each member's own `restSeconds` is the rest taken *after its own set*, and `restSecondsNext` on the group's **last member in plan order** is the rest after the final round. So a 15 s transition and a 90 s round rest on an A1/A2 pair means `A1.restSeconds = 15`, `A2.restSeconds = 90`.

### 4. Alternates carry their own equipment

An `alternate` may set `equipment` and `barWeight`; omitting them means "same as the parent". **Set them whenever the alternate differs from the parent** — a dumbbell alternate under a barbell exercise, say. When absent, `push-plan.mjs` falls back to guessing the equipment from the exercise name and downgrades the weight check to a warning, so an unloadable alternate weight can slip through.
```

Update Derived Metrics: add `Skip height-metric exercises` to the volume note, and add a row:

| Metric | Formula | Notes |
|--------|---------|-------|
| `jumpBest` | `max(sets[].heightCm)` per `"height"` exercise per session | Training output, **not** a readiness signal — see `periodization.md §D` |

- [ ] **Step 2: Fix the hardcoded ±2.5 kg in `weekly-review/SKILL.md`**

Lines 129-131 currently prescribe `+2.5 kg` / `−2.5 kg`, which is unloadable on a dumbbell and on any stack above 25 kg. Replace those table rows:

| Condition | Action |
|---|---|
| Actual RPE < target by ≥ 0.5 | **+1 rung** on that exercise's ladder |
| Actual RPE within 0.5 of target | Hold |
| Actual RPE > target by ≥ 0.5 | Hold, or **−1 rung**; consider −1 set |

And add beneath it:

```markdown
**"One rung" is equipment-dependent, not 2.5 kg.** On a barbell it is 2.5 kg; on a dumbbell it is 1 kg below 10 kg and 2 kg above; on a cable or machine stack it is 2.5 kg below 25 kg and 5 kg above. Read the exercise's `equipment` and step on that ladder. See "Plan Authoring Constraints §2" in `../shared/schema-reference.md`.
```

Update line 139's "Round every result to a loadable rung" paragraph to reference the breakpoints rather than implying a uniform 2.5.

Extend line 137 (never invent a starting load) with the superset case:

```markdown
Splitting an exercise out of a superset also changes the **rest structure**, not just the exercise list: the member's `restSeconds` was a short transition to its partner, and standing alone that becomes its inter-set rest. Re-author both rest values, or the plan silently prescribes 15-second rests on a standalone compound.
```

Add to the Phase 0 context list at line 34:

```markdown
- Whether any exercise uses `metric: "height"` — **jumps do not progress by adding load.** Report the height trend and adjust attempt count or placement; never write a weight onto a height-metric exercise
```

- [ ] **Step 3: Update the Plan Mutation Contract in `weekly-review/schema-supplement.md`**

Replace line 52 and add the new rows:

| Change | Allowed by default | Requires explicit confirmation |
|--------|-------------------|-------------------------------|
| Exercise weights (**± 1 rung on that equipment's ladder**) | ✓ | — |
| Attempt count on a `metric: "height"` exercise | ✓ | — |
| Changing an exercise's `equipment` | — | ✓ must confirm |
| Changing an exercise's `metric` | — | ✓ must confirm |
| Creating or dissolving a superset | — | ✓ must confirm |

And beneath the table:

```markdown
**Why `equipment` needs confirmation:** it silently changes which ladder the weight is checked against, whether the plate calculator appears, and the stepper's increments. Changing it to make a weight "valid" inverts the check — fix the weight instead.

**Why a superset needs confirmation:** it is a restructuring, and it changes the meaning of both members' `restSeconds`.
```

Add to the Weekly Aggregate Fields table:

| Field | Derived From | Formula |
|-------|-------------|---------|
| `jumpBestWeekly` | `heightCm` on `metric: "height"` exercises | `max(heightCm)` across the window, per exercise. Kept **separate** from `cmjWeeklyDelta` — different measurement conditions |

- [ ] **Step 4: Separate the two CMJ sources in `weekly-review/periodization.md`**

Add to §D (Neuromuscular Fatigue — CMJ as Readiness Proxy), after the principle paragraph:

```markdown
**Two sources, one of which is not a readiness signal.** Since 2026-07-30 jump height can arrive two ways:

- `readiness.cmjCm` — measured pre-session under a standardised protocol (hands on hips, no arm swing, 3 attempts, best logged). **This is the fatigue signal.**
- A `metric: "height"` exercise's `sets[].heightCm` — jumps performed *as training*, warm and often already fatigued, with no standardisation.

Never average them together, and never compare one against the other across sessions. A training jump that is 4 cm below a morning readiness CMJ is not evidence of fatigue; it is evidence that the athlete had already been training for 40 minutes. Use `readiness.cmjCm` for the readiness trend and treat training jumps as output — a performance number to progress, like a lift.
```

- [ ] **Step 5: Update `session-feedback/SKILL.md` and `examples.md`**

Add to `SKILL.md`'s analysis inputs, alongside the existing planned-vs-actual guidance:

```markdown
**Check loadability before reading a planned-vs-actual weight gap.** Session records carry `equipment`, so an unloadable planned weight is now checkable rather than a guess. Planned 22.5 kg on a dumbbell with 22 kg logged is not auto-regulation — it is a weight the gym cannot make, and the plan needs fixing rather than the athlete's effort interpreting. See "Plan Authoring Constraints §2" in `../shared/schema-reference.md`.

**Height-metric exercises have no RPE, no volume and no e1RM.** For a `metric: "height"` exercise, comment on the attempt-to-attempt drop within the session (a fall across three attempts is neuromuscular fatigue or a technique breakdown) and on best-vs-history. Do not compute tonnage, and do not compare against `readiness.cmjCm` — different measurement conditions.

**Supersets inflate the second movement's RPE.** When exercises share a `superset` tag, the later member's RPE reflects accumulated fatigue from the earlier one. Do not read it as a load problem, and do not compare it against the same exercise's RPE from a block where it stood alone.
```

Add one worked superset example to `examples.md` in the file's existing format, showing an A1/A2 pair where A2's RPE runs 1 point above target and the correct read is "expected for the second movement in a superset" rather than "reduce the load".

- [ ] **Step 6: Verify the skills still load and are self-consistent**

```bash
grep -rn "2.5 kg\|± 2.5\|+2.5" ".claude/skills/"
```

Expected: every remaining hit is either inside a barbell-specific example or the "on a barbell it is 2.5 kg" explanation. Any bare "+2.5 kg" as a general progression rule is a miss — fix it.

```bash
grep -rn "guessAlternateEquipment\|metric\|superset\|heightCm" ".claude/skills/"
```

Expected: `metric`, `superset` and `heightCm` all appear in `shared/schema-reference.md`; `metric` and `superset` appear in the weekly-review mutation contract.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills
git commit -m "$(cat <<'EOF'
Update coaching skills for equipment, supersets and jump metric

weekly-review prescribed a flat +2.5 kg progression step, which is unloadable
on a dumbbell and on any stack above 25 kg — now "+1 rung on that equipment's
ladder", with the breakpoints spelled out. Adds equipment/metric/superset to
the schema reference, and requires confirmation before changing an exercise's
equipment or metric or restructuring a superset.

periodization.md §D treated CMJ as purely a readiness proxy. Jump height can
now arrive from a standardised pre-session measurement or from training sets
taken warm and fatigued; the two must not be averaged or compared.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] `node "tools/weights.test.mjs"` — all checks pass, exit 0.
- [ ] `node "tools/push-plan.mjs" <fixture>` against a plan with a 22.5 kg dumbbell, a 27.5 kg cable, a split superset run, and a height exercise carrying a weight — refuses, listing all four.
- [ ] `git log --oneline -6` shows six commits, and `grep -n CACHE sw.js` reads `gymtrack-v16`.
- [ ] Preview walkthrough: dumbbell stepper reads `−1`/`+2` at 10 kg; chips render on session cards, plan rows and both swap sheets; a superset alternates with 15 s / 90 s / 180 s rests; a jump exercise logs cm and charts cm; the rest cue fires once after a tab switch.
- [ ] Push a real plan with `tools/push-plan.mjs` and confirm the phone pulls it.

## Deferred (do not build)

- Locked-screen / backgrounded audio — needs notifications or the Phase 3 native wrapper.
- A pound-denominated ladder for `lb` mode.
- A standalone jump-test log separate from sessions.
- Drag-to-reorder, or moving exercises between days.
