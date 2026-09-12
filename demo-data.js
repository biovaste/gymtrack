/* GymTrack demo seed — entirely fabricated training data for the public demo.
 *
 * Deterministic by construction: a fixed-seed PRNG, so every page load, test run
 * and `push-plan --check` validation sees byte-identical data. That is what lets
 * tools/demo.test.mjs assert against it.
 *
 * Nothing here is derived from real training records, and no real UUID, write
 * token or sync endpoint is referenced. The generator is deliberately readable
 * rather than a data dump: 6 months of sessions as literal JSON would be ~700 KB
 * that no reviewer can check, where the rules below can be read in a minute.
 *
 * Runs in the browser (window.GymDemoData) and in Node (module.exports) so the
 * plan half can be validated by the existing push-plan validator.
 */
(function (root) {
  'use strict';

  /* ---------- deterministic randomness ---------- */
  // xorshift32. Any seeded generator would do; this one is 4 lines and stable
  // across engines, which matters because the tests assert on the output.
  function makeRng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /* ---------- loadable-weight ladder ----------
   * The same rules as tools/weights.test.mjs and the table in CLAUDE.md, in the
   * one direction the generator needs (round DOWN onto a real rung). Kept local
   * so demo-data.js has no dependencies; tools/demo.test.mjs checks the whole
   * generated plan against the real validator, which is what actually guards it.
   */
  function snap(equipment, weight, barWeight) {
    if (equipment === 'bodyweight') return 0;
    if (equipment === 'other') return Math.round(weight * 10) / 10;
    if (equipment === 'dumbbell') {
      if (weight <= 10) return Math.max(1, Math.floor(weight));
      return Math.max(10, Math.floor(weight / 2) * 2);
    }
    if (equipment === 'cable' || equipment === 'machine') {
      if (weight <= 25) return Math.max(2.5, Math.floor(weight / 2.5) * 2.5);
      return Math.max(25, Math.floor(weight / 5) * 5);
    }
    if (equipment === 'landmine') return Math.max(1.25, Math.floor(weight / 1.25) * 1.25);
    const bar = barWeight || (equipment === 'trap-bar' ? 23 : equipment === 'training-bar' ? 10 : 20);
    return bar + Math.max(0, Math.floor((weight - bar) / 2.5) * 2.5);
  }

  /* ---------- the plan ----------
   * Names come from the curated library in exercise-library.js so the demo's
   * history lines up with what the exercise picker offers. Equipment is set on
   * every entry: the weight ladder is keyed on it, and a mislabelled movement
   * defeats the validation.
   */
  const ex = (o) => Object.assign({
    warmupSets: 0, targetRpe: 8, restSecondsNext: null, equipment: 'barbell',
    barWeight: null, metric: 'load', superset: null, description: '', notes: '', alternates: []
  }, o);

  function planTemplate() {
    return {
      type: 'workout-plan', version: 1,
      name: 'Strength Block — Upper / Lower / Full',
      createdAt: '2026-03-16',
      days: [
        {
          id: 'demo-day-a', name: 'Day A — Upper Strength',
          warmup: [
            { name: 'Bike', detail: '5 min easy' },
            { name: 'Band pull-apart', detail: '2 × 20' },
            'Shoulder dislocates × 10'
          ],
          exercises: [
            ex({ id: 'demo-a1', name: 'Bench Press', sets: 4, warmupSets: 2, reps: '5-6', weight: 85, targetRpe: 8, restSeconds: 180,
              description: 'Shoulder blades pinched, bar to the lower chest, drive the feet into the floor.',
              alternates: [{ name: 'Dumbbell Bench Press', weight: 30, equipment: 'dumbbell', description: 'Same path, deeper stretch at the bottom.' }] }),
            ex({ id: 'demo-a2', name: 'Barbell Row', sets: 4, reps: '6-8', weight: 70, targetRpe: 8, restSeconds: 150,
              description: 'Hinge to about 45°, pull to the lower ribs, no jerking from the hips.',
              alternates: [{ name: 'Cable Row', weight: 65, equipment: 'cable' }] }),
            ex({ id: 'demo-a3', name: 'Overhead Press', sets: 3, warmupSets: 1, reps: '6-8', weight: 47.5, targetRpe: 8, restSeconds: 150,
              description: 'Ribs down, head through at lockout.' }),
            ex({ id: 'demo-a4', name: 'Lat Pulldown', sets: 3, reps: '10-12', weight: 60, targetRpe: 9, restSeconds: 90, equipment: 'cable' }),
            // Adjacent pair sharing a superset tag — logged round by round.
            ex({ id: 'demo-a5', name: 'Lateral Raise', sets: 3, reps: '12-15', weight: 10, targetRpe: 9, restSeconds: 30, superset: 'A', equipment: 'dumbbell' }),
            ex({ id: 'demo-a6', name: 'Triceps Pushdown', sets: 3, reps: '10-12', weight: 30, targetRpe: 9, restSeconds: 75, restSecondsNext: 90, superset: 'A', equipment: 'cable' })
          ]
        },
        {
          id: 'demo-day-b', name: 'Day B — Lower Strength',
          warmup: [
            { name: 'Bike', detail: '5 min easy' },
            { name: 'Hip airplane', detail: '5 per side' },
            'Goblet squat × 10'
          ],
          exercises: [
            ex({ id: 'demo-b1', name: 'Squat', sets: 4, warmupSets: 3, reps: '5', weight: 120, targetRpe: 8, restSeconds: 210,
              description: 'To the 40 cm block, light touch, stay tight — never sit and relax onto it.',
              alternates: [{ name: 'Leg Press', weight: 180, equipment: 'machine' }] }),
            ex({ id: 'demo-b2', name: 'Romanian Deadlift', sets: 3, warmupSets: 1, reps: '6-8', weight: 100, targetRpe: 8, restSeconds: 180,
              description: 'Push the hips back, bar close, stop where the hamstrings run out.' }),
            ex({ id: 'demo-b3', name: 'Bulgarian Split Squat', sets: 3, reps: '8-10', weight: 22, targetRpe: 8, restSeconds: 120, equipment: 'dumbbell' }),
            ex({ id: 'demo-b4', name: 'Leg Curl', sets: 3, reps: '10-12', weight: 45, targetRpe: 9, restSeconds: 90, equipment: 'machine' }),
            ex({ id: 'demo-b5', name: 'Calf Raise', sets: 4, reps: '10-15', weight: 80, targetRpe: 9, restSeconds: 75, equipment: 'machine' }),
            ex({ id: 'demo-b6', name: 'Plank', sets: 3, reps: '', weight: 0, targetRpe: 7, restSeconds: 60,
              metric: 'duration', durationSeconds: 45, equipment: 'bodyweight' })
          ]
        },
        {
          id: 'demo-day-c', name: 'Day C — Full Body',
          warmup: [
            { name: 'Bike', detail: '6 min building' },
            'Cat-camel × 10',
            { name: 'Deadlift bar work', detail: 'Empty bar × 8' }
          ],
          exercises: [
            ex({ id: 'demo-c1', name: 'Deadlift', sets: 3, warmupSets: 3, reps: '3-5', weight: 140, targetRpe: 8, restSeconds: 240,
              description: 'Slack out of the bar before the pull, finish with the glutes, no hitching.' }),
            ex({ id: 'demo-c2', name: 'Incline Bench Press', sets: 3, warmupSets: 1, reps: '8-10', weight: 60, targetRpe: 8, restSeconds: 150 }),
            ex({ id: 'demo-c3', name: 'Pull-Up', sets: 3, reps: '6-8', weight: 0, targetRpe: 9, restSeconds: 120, equipment: 'bodyweight',
              alternates: [{ name: 'Assisted Pull-Up', weight: 25, equipment: 'machine' }] }),
            ex({ id: 'demo-c4', name: 'Face Pull', sets: 3, reps: '12-15', weight: 25, targetRpe: 8, restSeconds: 60, equipment: 'cable' }),
            ex({ id: 'demo-c5', name: 'Farmer Carry', sets: 3, reps: '', weight: 32, targetRpe: 8, restSeconds: 90,
              metric: 'distance', distanceMeters: 30, equipment: 'dumbbell' }),
            ex({ id: 'demo-c6', name: 'Bike', sets: 1, reps: '', weight: 0, targetRpe: 6, restSeconds: 60,
              metric: 'cardio', durationSeconds: 600, distanceMeters: 4200, speedKph: 25.2, equipment: 'other' })
          ]
        }
      ]
    };
  }

  /* ---------- progression model ----------
   * Per-exercise weekly gain, chosen so a 25-week span lands at a believable
   * +10–15%. Rounding onto the ladder produces the plateaus on its own: a lift
   * gaining 0.5 kg/week only actually moves every fifth week.
   */
  const GAIN = {
    'Bench Press': 0.5, 'Barbell Row': 0.45, 'Overhead Press': 0.3, 'Lat Pulldown': 0.45,
    'Lateral Raise': 0.15, 'Triceps Pushdown': 0.3, 'Squat': 0.75, 'Romanian Deadlift': 0.6,
    'Bulgarian Split Squat': 0.22, 'Leg Curl': 0.35, 'Calf Raise': 0.5,
    'Deadlift': 0.85, 'Incline Bench Press': 0.4, 'Pull-Up': 0, 'Face Pull': 0.35,
    'Farmer Carry': 0.3, 'Plank': 0, 'Bike': 0
  };

  const WEEKS = 25;
  const BLOCK = 5;
  const DELOAD_WEEK = 9;          // last week of block 2
  const MISSED_WEEKS = [12, 21];  // travel, then a week off sick
  const MISSED_SESSIONS = [[17, 2], [23, 3]]; // [week, slot] — single skipped days
  // A stall: the bar stops moving for three weeks while the RPE climbs, then
  // breaks through. Without this every lift rises monotonically, which is the
  // tell-tale sign of generated data.
  const STALLS = { 'Bench Press': [14, 16], 'Squat': [19, 21] };

  const SLOT_DAYS = [0, 1, 3, 5];  // Mon, Tue, Thu, Sat
  const START = Date.UTC(2026, 2, 16); // Monday 2026-03-16
  const DAY_MS = 86400000;

  function weightFor(name, equipment, barWeight, base, week) {
    const stall = STALLS[name];
    const effective = stall && week > stall[0] && week <= stall[1] ? stall[0] : week;
    const raw = base + (GAIN[name] || 0) * effective;
    const snapped = snap(equipment, raw, barWeight);
    return week === DELOAD_WEEK ? snap(equipment, snapped * 0.65, barWeight) : snapped;
  }

  function rpeFor(name, week, rand) {
    if (week === DELOAD_WEEK) return 6;
    const inBlock = week % BLOCK;
    let rpe = 7 + (inBlock / (BLOCK - 1)) * 2;
    const stall = STALLS[name];
    if (stall && week >= stall[0] && week <= stall[1]) rpe += 0.5 * (week - stall[0]);
    rpe += rand() < 0.5 ? -0.5 : 0;
    return Math.max(5, Math.min(10, Math.round(rpe * 2) / 2));
  }

  const repRange = (reps) => {
    const m = String(reps).match(/(\d+)(?:\s*-\s*(\d+))?/);
    if (!m) return [8, 8];
    return [parseInt(m[1], 10), parseInt(m[2] || m[1], 10)];
  };

  const SESSION_NOTES = [
    'Felt strong from the first warm-up set.',
    'Gym was packed — longer rests than planned.',
    'Low sleep last night, kept the top sets conservative.',
    'Bar speed good all session.',
    'Slight left elbow niggle on the pressing, stopped short of pain.',
    'Back in after a week off — deliberately left two in the tank.'
  ];
  const EXERCISE_NOTES = [
    'Last rep grindy.', 'Depth consistent.', 'Felt easy, next time up.',
    'Bracing better today.', 'Grip gave out before the back did.'
  ];

  /* ---------- session generation ---------- */
  function buildSessions(plan, rand) {
    const sessions = [];
    let n = 0;
    for (let week = 0; week < WEEKS; week++) {
      if (MISSED_WEEKS.includes(week)) continue;
      for (let slot = 0; slot < SLOT_DAYS.length; slot++) {
        if (MISSED_SESSIONS.some(([w, s]) => w === week && s === slot)) continue;
        const day = plan.days[n % plan.days.length];
        n++;
        const startedAt = START + (week * 7 + SLOT_DAYS[slot]) * DAY_MS
          + (16 * 60 + 20 + Math.floor(rand() * 90)) * 60000;
        const record = {
          id: 'demo-s' + String(n).padStart(3, '0'),
          date: new Date(startedAt).toISOString(),
          dayName: day.name,
          durationMin: 52 + Math.floor(rand() * 26),
          notes: rand() < 0.16 ? SESSION_NOTES[Math.floor(rand() * SESSION_NOTES.length)] : '',
          exercises: day.exercises.map(e => logExercise(e, week, rand)).filter(e => e.sets.length)
        };
        if (week === DELOAD_WEEK && !record.notes) record.notes = 'Deload week — bar speed only, nothing above RPE 6.';
        const doneWarmup = day.warmup.length - (rand() < 0.25 ? 1 : 0);
        record.warmup = { total: day.warmup.length, done: Math.max(0, doneWarmup) };
        if (rand() < 0.3) {
          record.readiness = {
            cmjCm: Math.round((33.5 + week * 0.12 + rand() * 2.4) * 10) / 10,
            subjectiveEnergy: 5 + Math.floor(rand() * 5)
          };
        }
        sessions.push(record);
      }
    }
    return sessions;
  }

  function logExercise(e, week, rand) {
    const weight = weightFor(e.name, e.equipment, e.barWeight, e.weight, week);
    const targetRpe = rpeFor(e.name, week, rand);
    const rec = {
      name: e.name, description: e.description,
      plannedSets: e.sets, plannedReps: e.reps, plannedWeight: weight,
      targetRpe: e.targetRpe, equipment: e.equipment, barWeight: e.barWeight,
      metric: e.metric, superset: e.superset, swappedFrom: null,
      notes: rand() < 0.1 ? EXERCISE_NOTES[Math.floor(rand() * EXERCISE_NOTES.length)] : '',
      sets: []
    };
    for (const k of ['durationSeconds', 'distanceMeters', 'speedKph']) if (e[k] != null) rec[k] = e[k];

    if (e.metric === 'duration') {
      const base = e.durationSeconds + Math.floor(week * 1.2);
      for (let i = 0; i < e.sets; i++) {
        rec.sets.push({ weight: 0, durationSeconds: base - i * 5 + (rand() < 0.5 ? 0 : 5), rpe: targetRpe });
      }
      return rec;
    }
    if (e.metric === 'distance') {
      for (let i = 0; i < e.sets; i++) {
        rec.sets.push({ weight, distanceMeters: e.distanceMeters + (rand() < 0.3 ? 10 : 0), rpe: targetRpe });
      }
      return rec;
    }
    if (e.metric === 'cardio') {
      const durationSeconds = e.durationSeconds;
      const distanceMeters = Math.round((e.distanceMeters + week * 14 + rand() * 120) / 10) * 10;
      rec.sets.push({
        weight: 0, durationSeconds, distanceMeters,
        speedKph: Math.round(distanceMeters / durationSeconds * 3.6 * 10) / 10,
        rpe: Math.min(9, targetRpe)
      });
      return rec;
    }

    // Ramp warm-ups, rounded down onto the ladder exactly as the app seeds them.
    const ramps = e.warmupSets === 1 ? [0.6] : e.warmupSets === 2 ? [0.5, 0.75]
      : e.warmupSets === 3 ? [0.4, 0.6, 0.8] : [];
    // A bodyweight movement has no load to add, so its progress has to show up
    // in reps — otherwise the demo's pull-up history is a flat line for 6 months
    // and its estimated 1RM is permanently 0.
    const repBonus = e.equipment === 'bodyweight' && week !== DELOAD_WEEK ? Math.floor(week / 6) : 0;
    const [low, high] = repRange(e.reps).map(v => v + repBonus);
    for (const f of ramps) {
      rec.sets.push({ weight: snap(e.equipment, weight * f, e.barWeight), reps: Math.min(high, low + 2), rpe: null, warmup: true });
    }
    // Occasionally the last working set is cut when the previous one was ugly.
    const done = e.sets - (targetRpe >= 9 && rand() < 0.12 ? 1 : 0);
    for (let i = 0; i < done; i++) {
      const fatigue = i >= 2 ? 1 : 0;
      const reps = Math.max(low, Math.min(high, high - fatigue - (rand() < 0.35 ? 1 : 0)));
      const rpe = Math.min(10, targetRpe + (i >= 2 ? 0.5 : 0));
      rec.sets.push({ weight, reps, rpe });
    }
    return rec;
  }

  function buildBodyWeight(rand) {
    const out = [];
    for (let d = 0; d <= WEEKS * 7; d += 3) {
      if (rand() < 0.18) continue; // not every logging day happens
      const trend = 78.4 + (d / (WEEKS * 7)) * 3.2;
      out.push({
        date: new Date(START + d * DAY_MS).toISOString().slice(0, 10),
        kg: Math.round((trend + (rand() - 0.5) * 0.8) * 10) / 10
      });
    }
    return out;
  }

  /* ---------- public API ---------- */
  function build() {
    const rand = makeRng(20260316);
    const plan = planTemplate();
    return {
      plan,
      sessions: buildSessions(plan, rand),
      bodyWeight: buildBodyWeight(rand),
      // Two legacy names, so the demo shows that renaming an exercise keeps its
      // history rather than orphaning it.
      aliases: { 'rdl': 'Romanian Deadlift', 'ohp': 'Overhead Press' }
    };
  }

  const api = { build, plan: planTemplate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GymDemoData = api;
})(typeof globalThis === 'object' ? globalThis : this);
