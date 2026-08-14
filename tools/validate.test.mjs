/*
 * Tests for validatePlan() in push-plan.mjs — the checks that stand between a
 * written plan and the phone.
 *
 * Every case here is a failure mode that has actually shipped, or that the app
 * would render wrong: a duplicate name merging two movements' histories, a
 * superset run split across the day, a weight the gym cannot load, a jump
 * exercise carrying a load. The weight LADDER itself is covered by
 * weights.test.mjs; this file covers the rules built on top of it.
 *
 * Run: node tools/validate.test.mjs
 */
import { validatePlan } from './push-plan.mjs';

let failures = 0;
function check(label, ok, detail) {
  if (ok) { console.log(`ok    ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
}
// Asserts the plan produces exactly one error, matching `re`. Matching on the
// message keeps a test from passing because some *other* rule happened to fire.
function expectError(label, plan, re) {
  const { errors } = validatePlan(plan);
  const hit = errors.filter(e => re.test(e));
  check(label, hit.length === 1, `expected 1 error matching ${re}, got ${errors.length} error(s): ${JSON.stringify(errors)}`);
}
function expectClean(label, plan) {
  const { errors } = validatePlan(plan);
  check(label, errors.length === 0, `expected no errors, got: ${JSON.stringify(errors)}`);
}
function expectWarning(label, plan, re) {
  const { warnings } = validatePlan(plan);
  check(label, warnings.some(w => re.test(w)), `expected a warning matching ${re}, got: ${JSON.stringify(warnings)}`);
}

// Minimal valid exercise; override what a case is about.
const ex = (over = {}) => Object.assign({
  name: 'Bench Press', sets: 3, reps: '6-8', weight: 60,
  restSeconds: 120, equipment: 'barbell', metric: 'load'
}, over);
const day = (name, exercises, over = {}) => Object.assign({ name, exercises }, over);
const planOf = (...days) => ({ type: 'workout-plan', version: 1, name: 'Test', days });

/* ---- baseline ---- */
expectClean('a plain valid plan passes', planOf(day('Day A', [ex()])));

/* ---- 1. duplicate names ---- */
expectError('duplicate name across two days is an error',
  planOf(day('Day A', [ex({ name: 'Cable Triceps Extension', equipment: 'cable', weight: 20 })]),
         day('Day B', [ex({ name: 'Cable Triceps Extension', equipment: 'cable', weight: 40 })])),
  /Duplicate exercise name/);
expectError('duplicate name within ONE day is an error too',
  planOf(day('Day A', [ex({ name: 'Row' }), ex({ name: 'Row' })])),
  /Duplicate exercise name/);
expectError('duplicate detection is case-insensitive',
  planOf(day('Day A', [ex({ name: 'Bench Press' })]), day('Day B', [ex({ name: 'bench press' })])),
  /Duplicate exercise name/);

/* ---- 2. superset adjacency ---- */
expectClean('an adjacent superset run passes',
  planOf(day('Day A', [ex({ name: 'A1', superset: 'A' }), ex({ name: 'A2', superset: 'A' })])));
expectError('a superset tag split into two runs is an error',
  planOf(day('Day A', [ex({ name: 'A1', superset: 'A' }), ex({ name: 'Filler' }), ex({ name: 'A2', superset: 'A' })])),
  /superset "A" appears in 2 separate non-adjacent runs/);
// Tags are uppercased and truncated to 2 chars on import; the validator must
// normalize identically or a plan passes here and still splits in the app.
expectClean('tags differing only by case group together, not split',
  planOf(day('Day A', [ex({ name: 'A1', superset: 'a' }), ex({ name: 'A2', superset: 'A ' })])));
expectError('tags that collide only after the 2-char truncation are caught',
  planOf(day('Day A', [ex({ name: 'A1', superset: 'AB1' }), ex({ name: 'Filler' }), ex({ name: 'A2', superset: 'AB2' })])),
  /superset "AB" appears in 2 separate non-adjacent runs/);

/* ---- 3. loadable weights, per equipment ---- */
expectError('22.5 kg is not a dumbbell',
  planOf(day('Day A', [ex({ equipment: 'dumbbell', weight: 22.5 })])), /not loadable/);
expectClean('22 kg is a dumbbell', planOf(day('Day A', [ex({ equipment: 'dumbbell', weight: 22 })])));
expectError('27.5 kg is not a cable stack',
  planOf(day('Day A', [ex({ equipment: 'cable', weight: 27.5 })])), /not loadable/);
expectClean('22.5 kg IS a cable stack (below the 25 kg breakpoint)',
  planOf(day('Day A', [ex({ equipment: 'cable', weight: 22.5 })])));
expectError('85 kg is not loadable on a 23 kg trap bar',
  planOf(day('Day A', [ex({ equipment: 'trap-bar', weight: 85 })])), /not loadable/);
expectClean('83 and 88 kg are', planOf(day('Day A', [ex({ name: 'A', equipment: 'trap-bar', weight: 83 }),
                                                     ex({ name: 'B', equipment: 'trap-bar', weight: 88 })])));
expectError('a weight below the empty bar names the equipment as the suspect',
  planOf(day('Day A', [ex({ equipment: 'barbell', weight: 12 })])), /below the empty barbell/);
expectError('a bodyweight move carrying load is an error',
  planOf(day('Day A', [ex({ equipment: 'bodyweight', weight: 20 })])), /weight 0/);
expectClean('"other" equipment is not ladder-checked',
  planOf(day('Day A', [ex({ equipment: 'other', weight: 33.7 })])));

/* ---- 4. metric ---- */
expectError('a height exercise carrying weight is an error',
  planOf(day('Day A', [ex({ name: 'Box Jump', metric: 'height', equipment: 'bodyweight', weight: 40 })])),
  /must have weight 0/);
expectError('an unknown metric is an error',
  planOf(day('Day A', [ex({ metric: 'distance' })])), /is not one of/);
// Regression: `continue`-ing the whole exercise for a height metric used to skip
// its alternates too, so a loaded alternate under a jump passed silently. An
// alternate inherits `metric`, so this one is a height alternate carrying weight.
expectError('a loaded alternate under a HEIGHT exercise is caught',
  planOf(day('Day A', [ex({ name: 'Box Jump', metric: 'height', equipment: 'bodyweight', weight: 0,
    alternates: [{ name: 'DB Step-Up', weight: 22.5, equipment: 'dumbbell' }] })])),
  /alternate "DB Step-Up": 22\.5 kg on a height-metric alternate/);
// …and declaring metric: "load" on it makes it a lift, so the ladder applies.
expectError('an alternate declaring metric "load" under a jump is ladder-checked',
  planOf(day('Day A', [ex({ name: 'Box Jump', metric: 'height', equipment: 'bodyweight', weight: 0,
    alternates: [{ name: 'DB Step-Up', weight: 22.5, equipment: 'dumbbell', metric: 'load' }] })])),
  /alternate "DB Step-Up": 22\.5 kg not loadable/);
expectClean('a loadable alternate declaring metric "load" under a jump passes',
  planOf(day('Day A', [ex({ name: 'Box Jump', metric: 'height', equipment: 'bodyweight', weight: 0,
    alternates: [{ name: 'DB Step-Up', weight: 22, equipment: 'dumbbell', metric: 'load' }] })])));
expectError('an unknown metric on an alternate is an error',
  planOf(day('Day A', [ex({ alternates: [{ name: 'Alt', weight: 20, metric: 'distance' }] })])),
  /alternate "Alt": metric "distance" is not one of/);
expectWarning('an alternate with no declared equipment warns rather than errors',
  planOf(day('Day A', [ex({ alternates: [{ name: 'DB Bench', weight: 22.5 }] })])),
  /equipment inferred as "dumbbell"/);

/* ---- 5. warm-ups ---- */
expectClean('warmupSets on a load exercise is fine',
  planOf(day('Day A', [ex({ warmupSets: 3 })])));
expectClean('warmupSets: 0 is fine', planOf(day('Day A', [ex({ warmupSets: 0 })])));
expectError('a fractional warmupSets is an error',
  planOf(day('Day A', [ex({ warmupSets: 2.5 })])), /non-negative integer/);
expectError('a negative warmupSets is an error',
  planOf(day('Day A', [ex({ warmupSets: -1 })])), /non-negative integer/);
expectError('warmupSets on a height exercise is an error — there is no load to ramp',
  planOf(day('Day A', [ex({ name: 'Box Jump', metric: 'height', equipment: 'bodyweight', weight: 0, warmupSets: 2 })])),
  /can't prescribe warmupSets/);
expectWarning('an implausible warm-up count warns', planOf(day('Day A', [ex({ warmupSets: 9 })])), /is a lot/);

expectClean('a day warm-up block of strings is fine',
  planOf(day('Day A', [ex()], { warmup: ['Bike 5 min', 'Band pull-apart'] })));
expectClean('a day warm-up block of objects is fine',
  planOf(day('Day A', [ex()], { warmup: [{ name: 'Bike', detail: '5 min easy' }] })));
expectError('a nameless warm-up item is an error — import would drop it silently',
  planOf(day('Day A', [ex()], { warmup: [{ detail: '5 min easy' }] })), /has no name/);
expectError('a non-array warm-up block is an error',
  planOf(day('Day A', [ex()], { warmup: 'Bike 5 min' })), /must be an array/);

/* ---- 6. unit gate ---- */
{
  const { errors, warnings } = validatePlan(planOf(day('Day A', [ex({ equipment: 'dumbbell', weight: 22.5 })])), { unit: 'lb' });
  check('lb plans skip the kg-only ladder', errors.length === 0 && warnings.some(w => /kg-only/.test(w)),
    `errors=${JSON.stringify(errors)} warnings=${JSON.stringify(warnings)}`);
  // …but metric correctness has nothing to do with units and must still fire.
  const r = validatePlan(planOf(day('Day A', [ex({ metric: 'height', weight: 40 })])), { unit: 'lb' });
  check('metric checks still run in lb mode', r.errors.some(e => /must have weight 0/.test(e)),
    JSON.stringify(r.errors));
}

console.log(failures ? `\n${failures} failing check(s)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
