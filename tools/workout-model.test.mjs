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
