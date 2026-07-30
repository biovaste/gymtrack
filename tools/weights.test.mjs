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
