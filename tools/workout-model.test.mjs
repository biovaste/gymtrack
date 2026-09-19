import test from 'node:test';
import assert from 'node:assert/strict';
import Model from '../workout-model.js';
import { validatePlan } from './push-plan.mjs';

test('identity shares days/display names, isolates side/setup/metric and legacy history', () => {
  const e = { movementId: 'seated-press', name: 'A press', side: 'left', setupId: 'DB rack' };
  assert.equal(Model.key(e), Model.key({ ...e, name: 'C press' }));
  for (const change of [{ side: 'right' }, { setupId: 'machine' }, { metric: 'duration' }, { movementId: undefined }]) {
    assert.notEqual(Model.key(e), Model.key({ ...e, ...change }));
  }
  assert.equal(Model.key({ name: 'Bench' }), Model.key({ name: 'bench', metric: 'load' }));
});
test('7 kg stack and 53 kg carriage support stepping and validation', () => {
  const stack = { unit: 'kg', offset: 0, increment: 7 };
  const carriage = { unit: 'kg', offset: 53, increment: 10 };
  assert.equal(Model.nextLoad(stack, 28, 1), 35);
  assert.equal(Model.nextLoad(carriage, 73, -1), 63);
  assert.equal(Model.loadable(carriage, 73), true);
  assert.equal(Model.loadable(carriage, 70), false);
  assert.equal(Model.nextLoad({ unit: 'kg', offset: 0, loads: [0, 7, 21] }, 21, 1), 21);
  for (const loadProfile of [{ ...stack, increment: 0 }, { ...stack, loads: [] }, { ...stack, loads: [7, 7] }, { ...carriage, loads: [10, 60] }]) {
    assert.ok(Model.errors({ loadProfile }).includes('loadProfile'));
  }
});
test('timed/distance records never store repetitions and pace uses actual distance and time', () => {
  for (const metric of ['duration', 'distance', 'cardio']) {
    const e = { metric, weight: 10, durationSeconds: 30, distanceMeters: 30 };
    const row = Model.row(e);
    assert.equal('reps' in row, false);
    assert.equal('reps' in Model.recordSet(e, { ...row, reps: 30 }), false);
  }
  assert.equal(Model.speed({ durationSeconds: 300, distanceMeters: 1000, speedKph: 9 }), 12);
  assert.equal(Model.speed({ speedKph: 12 }), 12);
  assert.equal(Model.speed({ durationSeconds: 300 }), null);
});
test('validator accepts repeated explicit movements, custom stacks and weighted planks', () => {
  const press = { name: 'Press', movementId: 'press', side: 'left', equipment: 'machine', weight: 28, loadProfile: { unit: 'kg', offset: 0, increment: 7 } };
  const days = [{ name: 'A', exercises: [press] }, { name: 'C', exercises: [{ ...press }, { name: 'Plank', equipment: 'bodyweight', metric: 'duration', weight: 10, durationSeconds: 30 }] }];
  assert.deepEqual(validatePlan({ days }).errors, []);
  days[0].exercises[0] = { ...press, weight: 30 };
  assert.ok(validatePlan({ days }).errors.some(e => e.includes('loadProfile')));
});
test('group moves keep superset runs intact, reuse the same objects and refuse no-ops', () => {
  const list = [
    { name: 'a' }, { name: 'b', superset: 'A' }, { name: 'c', superset: 'A' }, { name: 'd', sets: [{ done: true }], notes: 'kept' }
  ];
  const names = xs => xs && xs.map(x => x.name).join('');
  assert.deepEqual(Model.groupRuns(list).map(g => g.idx), [[0], [1, 2], [3]]);
  assert.equal(names(Model.moveGroupBy(list, 0, 1)), 'bcad');
  assert.equal(names(Model.moveGroupBy(list, 2, -1)), 'bcad', 'a member moves its whole group');
  assert.equal(names(Model.moveGroupBy(list, 3, -1)), 'adbc');
  assert.equal(Model.moveGroupBy(list, 0, -1), null);
  assert.equal(Model.moveGroupBy(list, 3, 1), null);
  assert.equal(names(Model.moveGroupToGap(list, 0, 3)), 'bcda');
  assert.equal(names(Model.moveGroupToGap(list, 3, 0)), 'dabc');
  assert.equal(Model.moveGroupToGap(list, 1, 1), null, 'dropping a group at its own position is a no-op');
  assert.equal(Model.moveGroupToGap(list, 1, 2), null);
  assert.equal(Model.moveGroupToGap(list, 0, 9), null);
  const moved = Model.moveGroupToGap(list, 3, 0);
  assert.equal(moved[0], list[3], 'the same exercise object is moved, not recreated');
  assert.equal(moved[0].notes, 'kept');
  assert.equal(list.map(x => x.name).join(''), 'abcd', 'the input array is not mutated');
  // A move can never split or merge a superset: every tag still forms exactly one run.
  for (let i = 0; i < list.length; i++) for (let gap = 0; gap <= 3; gap++) {
    const next = Model.moveGroupToGap(list, i, gap);
    if (!next) continue;
    assert.deepEqual(Model.groupRuns(next).filter(g => g.tag).map(g => g.idx.map(k => next[k].name).join('')), ['bc']);
  }
});
test('added load is an explicit bodyweight convention with its own history key', () => {
  const pullUp = { name: 'Pull-Up', equipment: 'bodyweight', metric: 'load' };
  assert.equal(Model.isAddedLoad(pullUp), false, 'legacy bodyweight records are never reinterpreted');
  assert.equal(Model.isAddedLoad({ ...pullUp, addedLoad: true }), true);
  assert.equal(Model.isAddedLoad({ ...pullUp, addedLoad: true, equipment: 'barbell' }), false);
  assert.equal(Model.isAddedLoad({ ...pullUp, addedLoad: true, metric: 'duration' }), false);
  assert.equal(Model.key(pullUp), JSON.stringify(['name', 'pull-up', 'unspecified', '', 'load']), 'existing keys are unchanged');
  assert.notEqual(Model.key({ ...pullUp, addedLoad: true }), Model.key(pullUp));
  const withId = { ...pullUp, movementId: 'pull-up', addedLoad: true };
  assert.equal(Model.key(withId), Model.key({ ...withId, name: 'Weighted pull-up' }));
  assert.deepEqual(Model.metadata(withId), { movementId: 'pull-up', addedLoad: true });
  assert.deepEqual(Model.errors({ addedLoad: 'yes' }), ['addedLoad']);
  assert.deepEqual(Model.errors({ addedLoad: true, equipment: 'cable' }), ['addedLoad / equipment']);
  assert.deepEqual(Model.errors({ addedLoad: true }), [], 'alternates may inherit equipment and metric');
  assert.deepEqual(Model.recordSet({ ...pullUp, addedLoad: true }, { weight: 10, reps: 5, rpe: 8, done: true, timer: { state: 'expired' } }), { weight: 10, reps: 5, rpe: 8 });
});

/* ---- coach programs: mergeCoachPlan ---- */
const coachDay = (name, coachId = 'coach@example.com', ex = 'Back Squat') => {
  const d = { id: name, name, warmup: [], exercises: [{ name: ex, sets: 3, reps: '5', weight: 100 }] };
  d.source = { coachId, coachName: 'Aino', assignmentId: 'a0' };
  d.source.hash = Model.dayHash(d);
  return d;
};
const ownDay = name => ({ id: name, name, warmup: [], exercises: [{ name: 'Row', sets: 3, reps: '8', weight: 50 }] });
const SRC = { coachId: 'coach@example.com', coachName: 'Aino', assignmentId: 'a1' };

test('coach update replaces only that coach\'s days and keeps the athlete\'s own in place', () => {
  const plan = { name: 'Mine', days: [coachDay('Team A'), coachDay('Team B'), ownDay('My extra')] };
  const incoming = { name: 'Block 2', days: [{ id: 'n1', name: 'Team A', exercises: [] }, { id: 'n2', name: 'Team C', exercises: [] }] };
  const r = Model.mergeCoachPlan(plan, incoming, SRC);
  assert.deepEqual(r.days.map(d => d.name), ['Team A', 'Team C', 'My extra']);
  assert.equal(r.days[0].id, 'Team A', 'same-name day keeps its id');
  assert.equal(r.days[0].source.assignmentId, 'a1');
  assert.equal(r.days[2].source, undefined, 'own day untouched');
  assert.deepEqual(r.replaced, ['Team A']);
  assert.deepEqual(r.removed, ['Team B']);
  assert.deepEqual(r.added, ['Team C']);
  assert.deepEqual(r.kept, ['My extra']);
  assert.equal(r.name, 'Mine', 'athlete keeps their plan name while they have own days');
});

test('own days before the coach block stay before it; another coach\'s days are kept', () => {
  const plan = { name: 'Mine', days: [ownDay('Mobility'), coachDay('Team A'), coachDay('Other', 'other@example.com')] };
  const r = Model.mergeCoachPlan(plan, { name: 'B', days: [{ name: 'Team A', exercises: [] }] }, SRC);
  assert.deepEqual(r.days.map(d => d.name), ['Mobility', 'Team A', 'Other']);
});

test('first program goes first, drops untouched starter days, keeps edited ones', () => {
  const starter = n => { const d = ownDay(n); d.source = { starter: true }; d.source.hash = Model.dayHash(d); return d; };
  const editedStarter = starter('Day C'); editedStarter.exercises[0].weight = 60;
  const plan = { name: 'Starter', days: [starter('Day A'), starter('Day B'), editedStarter, ownDay('Mine')] };
  const r = Model.mergeCoachPlan(plan, { name: 'Team block', days: [{ name: 'Team A', exercises: [] }] }, SRC);
  assert.deepEqual(r.days.map(d => d.name), ['Team A', 'Day C', 'Mine']);
  const onlyStarter = Model.mergeCoachPlan({ name: 'Starter', days: [starter('Day A')] }, { name: 'Team block', days: [{ name: 'Team A', exercises: [] }] }, SRC);
  assert.equal(onlyStarter.name, 'Team block', 'a plan made only of coach days takes the program name');
});

test('local edits to a coach day are reported before being overwritten', () => {
  const edited = coachDay('Team A'); edited.exercises[0].weight = 105;
  const r = Model.mergeCoachPlan({ name: 'x', days: [edited, coachDay('Team B')] }, { name: 'B', days: [{ name: 'Team A', exercises: [] }] }, SRC);
  assert.deepEqual(r.overwrittenEdits, ['Team A']);
  assert.equal(r.days[0].source.hash, Model.dayHash(r.days[0]), 'new coach days start unedited');
});
