import assert from 'node:assert/strict';

// Uses the smoke test's isolated profile and locally intercepted sync API.
export async function checkWorkoutModel(page, context) {
  await page.evaluate(() => {
    endSession(); closeModal(); I18n.setLocale('en'); sessions = [];
    const press = { name: 'Press A', movementId: 'seated-press', side: 'left', setupId: 'Stack 1', equipment: 'machine',
      loadProfile: { unit: 'kg', offset: 0, increment: 7 }, sets: 1, reps: '8', weight: 28, targetRpe: 8 };
    plan = normalizePlan({ days: [{ name: 'A', exercises: [press,
      { name: 'Plank', metric: 'duration', equipment: 'bodyweight', sets: 1, weight: 10, durationSeconds: 30 },
      { name: 'Treadmill', metric: 'cardio', equipment: 'other', sets: 1, durationSeconds: 300, speedKph: 12 },
      { name: 'Carry', metric: 'distance', equipment: 'dumbbell', sets: 1, weight: 20, distanceMeters: 30 }] },
      { name: 'C', exercises: [{ ...press, name: 'Press C' }, { ...press, name: 'Press right', side: 'right' }] }] });
    savePlan(); tab = 'workout'; render(); startSession(plan.days[0].id);
  });
  assert.equal(await page.locator('[data-f="reps"]').count(), 1);
  assert.match(await page.locator('[data-measurement-summary="1-0"]').textContent(), /10kg.*30 s/);
  assert.match(await page.locator('[data-measurement-summary="2-0"]').textContent(), /5:00 min\/km/);
  await page.fill('[data-ei="2"][data-f="distanceMeters"]', '1000');
  await page.fill('[data-ei="2"][data-f="durationSeconds"]', '360');
  assert.match(await page.locator('[data-measurement-summary="2-0"]').textContent(), /6:00 min\/km/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Measurement controls fit mobile width');
  await page.screenshot({ path: 'tmp/workout-measurements.png', fullPage: true });
  await page.evaluate(() => { const e = active.exercises[0]; const input = document.querySelector('[data-ei="0"][data-f="weight"]'); if (stepperInfo(input).up !== 7) throw Error('Custom stack stepper'); });
  const beforeReload = await page.evaluate(() => localStorage.getItem('gym.active'));
  await context.setOffline(true); await page.reload();
  assert.equal(await page.evaluate(() => localStorage.getItem('gym.active')), beforeReload);
  await context.setOffline(false);
  for (let ei = 0; ei < 4; ei++) await page.click(`[data-action="set-done"][data-ei="${ei}"]`);
  let responseStatus = 200;
  await page.route('https://api.gymtrack.hithitpull.fi/**', route => route.fulfill({ status: responseStatus, contentType: 'application/json', body: '{}' }));
  await page.evaluate(() => { settings.autoSync = true; finishSession(); });
  await page.waitForFunction(() => syncState === 'ok');
  assert.match(await page.locator('#completion-sync-status').textContent(), /Synced/i);
  const record = await page.evaluate(() => sessions.at(-1));
  assert.equal(record.exercises[0].movementId, 'seated-press');
  assert.equal(record.exercises[0].loadProfile.increment, 7);
  for (const e of record.exercises.slice(1)) assert.equal('reps' in e.sets[0], false);
  assert.equal(record.exercises[2].sets[0].durationSeconds, 360);
  assert.equal(record.exercises[2].sets[0].distanceMeters, 1000);
  assert.equal(await page.evaluate(() => sessionLoad(sessions.at(-1)).rpe), 8);
  await page.evaluate(() => {
    closeModal(); settings.autoSync = false;
    const saved = buildBackup(); restoreBackup(saved);
    if (buildExport().includes('"distanceMeters": 1000') === false) throw Error('Export lost distance');
    const left = plan.days[1].exercises[0], right = plan.days[1].exercises[1];
    if (!lastPerformance(left) || lastPerformance(right)) throw Error('Side history leakage');
    if (exerciseHistory(WorkoutModel.key(left, canonicalName)).length !== 1) throw Error('Cross-day history lost');
    if (weeklyStats().at(-1).volume !== 224) throw Error('Timed/distance volume leakage');
    tab = 'history'; render();
  });
  const cardioKey = await page.evaluate(() => WorkoutModel.key(sessions[0].exercises[2], canonicalName));
  await page.selectOption('[data-bind="history-ex"]', cardioKey);
  assert.match(await page.locator('#app').textContent(), /1000 m.*10 km\/h.*6:00 min\/km/);
  assert.doesNotMatch(await page.locator('#app').textContent(), /NaN|undefined/);
  // Exercise editor keeps custom identity/profile, and converts pace to speed.
  await page.evaluate(() => exEditModal(plan.days[0].id, 2));
  await page.fill('#f-pace', '4:00'); await page.locator('#f-pace').blur();
  assert.equal(await page.inputValue('#f-speedKph'), '15');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal(await page.evaluate(() => plan.days[0].exercises[2].speedKph), 15);
  // A failed push updates the same completion sheet and can be retried.
  responseStatus = 401;
  await page.evaluate(() => { tab = 'workout'; startSession(plan.days[1].id); active.exercises[0].sets[0].done = true; settings.autoSync = true; finishSession(); });
  await page.waitForFunction(() => syncState === 'error');
  assert.match(await page.locator('#completion-sync-status').textContent(), /token/i);
  assert.equal(await page.evaluate(() => sessions.length), 2);
  responseStatus = 200;
  await page.click('[data-action="sync-retry"]');
  await page.waitForFunction(() => syncState === 'ok');
  assert.match(await page.locator('#completion-sync-status').textContent(), /Synced/i);
  await page.evaluate(() => { settings.autoSync = false; closeModal(); I18n.setLocale('fi'); exEditModal(plan.days[0].id, 0); });
  assert.deepEqual(await page.evaluate(() => I18n.missingKeys()), []);
  await page.evaluate(() => closeModal());
  console.log('Workout browser checks passed: identity, side isolation, custom stacks, timed/distance logging, pace, save/export/restore, offline reload, sync success/failure/retry.');
}
