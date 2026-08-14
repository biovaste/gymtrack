/* GymTrack — offline-first gym workout tracker designed to exchange
   plans and logs with Claude via JSON. No dependencies. */
'use strict';

/* ================= storage ================= */
const store = {
  get(k, d) { try { const v = localStorage.getItem('gym.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { localStorage.setItem('gym.' + k, JSON.stringify(v)); },
  del(k) { localStorage.removeItem('gym.' + k); }
};

const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtClock = sec => { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + String(s).padStart(2, '0'); };
const fmtDur = min => min >= 60 ? Math.floor(min / 60) + 'h ' + (min % 60) + 'm' : min + ' min';
const fmtDate = iso => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const today = () => new Date().toISOString().slice(0, 10);
const est1RM = (w, reps) => reps > 0 ? Math.round(w * (1 + reps / 30) * 10) / 10 : w;

/* ================= inline SVG icons ================= */
const ICONS = {
  dumbbell: '<path d="M6.5 6.5v11M3.5 8.5v7M17.5 6.5v11M20.5 8.5v7M6.5 12h11"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  chart: '<path d="M3 3v18h18M7.5 14.5l4-4.5 3 3 5.5-6.5"/>',
  sparkle: '<path d="M12 3l2 5.6L19.5 10 14 12l-2 5.6L10 12 4.5 10 10 8.6 12 3z"/><path d="M19 15l.9 2.4 2.1.9-2.1.9L19 21.5l-.9-2.3-2.1-.9 2.1-.9L19 15z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>',
  plate: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/>',
  swap: '<path d="M17 2.5l4 4-4 4M21 6.5H8a4 4 0 0 0-4 4M7 21.5l-4-4 4-4M3 17.5h13a4 4 0 0 0 4-4"/>',
  note: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  chevRight: '<path d="M9 18l6-6-6-6"/>',
  chevDown: '<path d="M6 9l6 6 6-6"/>',
  video: '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 11l6-3.5v9l-6-3.5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'
};
const icon = (name, size = 20) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
function mountStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach(el => {
    el.innerHTML = icon(el.dataset.icon, el.classList.contains('tab-icon') ? 22 : 20);
  });
}

/* ================= CMJ flight-time math ================= */
const G_MS2 = 9.81;
// How many seconds of file timeline per second of real time. iPhone Slo-Mo renders
// against a 30fps nominal playback rate, so 120fps → 4× and 240fps → 8×. This is a
// property of the TIMELINE, not of the encode: when Photos re-compresses a slo-mo
// export down to ~24fps it keeps the stretched duration, so the factor is unchanged
// while the frame rate changes. That is why the factor cannot be derived from two
// frame rates (the old detectedFps/recordedFps approach gave 10× for a 240fps clip
// re-encoded at 24fps, when the truth is still 8×).
const SLOW_FACTORS = [1, 2, 4, 8];
// What the camera actually captured. This is stated by the user, not measured: the
// decoded-frame count is unreliable on iOS for 1080p HEVC at 60fps+ (the decoder drops
// frames during the sampling playthrough, under-reporting a 60fps timeline as ~24).
// Capture rate and slow factor together give the playback rate by construction —
// 240fps at 4× is a 60fps timeline — which is both more accurate than measuring it and
// what makes single-frame stepping land on real frame boundaries.
const CAPTURE_RATES = [30, 60, 120, 240];
const computeJumpHeightCm = flightTimeSec => (G_MS2 * flightTimeSec * flightTimeSec / 8) * 100;

/* ================= built-in exercise explanations (fallback) ================= */
const EX_LIBRARY = {
  'bench press': 'Lie on a flat bench, grip the bar slightly wider than shoulder width, lower it to mid-chest with elbows ~45–70°, press back up. Keep shoulder blades pinched and feet planted.',
  'incline bench press': 'Bench press on a 30–45° incline bench. Targets the upper chest and front delts. Lower the bar to the upper chest, just below the collarbones.',
  'dumbbell bench press': 'Like the bench press but with dumbbells — greater range of motion and each side works independently. Lower until elbows are just below the bench.',
  'squat': 'Bar on upper back, feet shoulder width, brace your core, sit down between your hips until thighs are at least parallel, drive back up through mid-foot. Keep knees tracking over toes.',
  'front squat': 'Bar racked on the front delts with elbows high. More upright torso than a back squat — emphasizes quads and upper back.',
  'deadlift': 'Bar over mid-foot, hinge down with a flat back, grip just outside the legs, push the floor away and stand tall. The bar stays in contact with the legs the whole way.',
  'romanian deadlift': 'From standing, push hips back with a slight knee bend, lowering the bar along the thighs until you feel a hamstring stretch (~mid-shin), then drive hips forward. No floor touch.',
  'overhead press': 'Standing, bar at the front delts, brace glutes and core, press straight overhead until elbows lock, head moves slightly "through" at the top.',
  'barbell row': 'Hinge to ~45°, flat back, pull the bar to the lower ribs/upper abdomen, squeeze the shoulder blades, lower under control.',
  'dumbbell row': 'One hand and knee on a bench, flat back, pull the dumbbell to your hip, elbow close to the body. Avoid twisting the torso.',
  'cable row': 'Seated, chest tall, pull the handle to your abdomen while drawing shoulder blades back. Don\'t lean back excessively.',
  'pull-up': 'Hang from a bar with an overhand grip, pull your chin over the bar by driving elbows down, lower fully. Add weight or use a band/machine to scale.',
  'chin-up': 'Pull-up with an underhand (supinated) grip — more biceps involvement.',
  'lat pulldown': 'Seated at the cable station, pull the bar to the upper chest with a tall chest, control the way up. Think "elbows to hips".',
  'dip': 'On parallel bars, lower until shoulders are just below elbows with a slight forward lean, press back up. Forward lean = more chest, upright = more triceps.',
  'lateral raise': 'Standing with dumbbells at your sides, raise arms out to shoulder height with a soft elbow bend, lower slowly. Light weight, strict form.',
  'face pull': 'Rope at upper-chest height, pull toward your face while externally rotating so knuckles face the ceiling at the end. Great for rear delts and shoulder health.',
  'rear delt fly': 'Hinged over (or chest on an incline bench), raise dumbbells out to the side with nearly straight arms, squeezing the rear delts.',
  'bicep curl': 'Elbows pinned at your sides, curl the weight up without swinging, lower slowly. Full stretch at the bottom.',
  'hammer curl': 'Curl with a neutral (thumbs-up) grip — hits the brachialis and forearms along with the biceps.',
  'triceps pushdown': 'At a cable with rope or bar, elbows pinned at your sides, extend the arms fully and squeeze, control the return.',
  'skull crusher': 'Lying on a bench, lower the bar/dumbbells to just above your forehead by bending only the elbows, then extend back up.',
  'leg press': 'Feet shoulder width on the platform, lower under control until knees are ~90° or slightly deeper, press without locking the knees harshly.',
  'leg extension': 'Seated machine, extend knees fully and squeeze the quads at the top, lower slowly.',
  'leg curl': 'Machine curl for the hamstrings — flex the knees fully, control the return. Keep hips down (lying version).',
  'calf raise': 'Rise onto the balls of your feet as high as possible, pause, lower to a full stretch. Slow and controlled beats heavy and bouncy.',
  'hip thrust': 'Upper back on a bench, bar over the hips, drive hips up until your torso is level, squeeze the glutes hard at the top, chin tucked.',
  'lunge': 'Step forward (or backward for reverse lunge), lower the back knee toward the floor, push back up through the front heel. Torso tall.',
  'bulgarian split squat': 'Rear foot elevated on a bench, lower straight down on the front leg until the thigh is parallel, drive up. Brutal but effective for quads and glutes.',
  'shrug': 'Holding a bar or dumbbells, lift your shoulders straight up toward your ears, pause, lower. No rolling.',
  'plank': 'Forearms and toes, body in a straight line, glutes and core braced. Don\'t let the hips sag or pike.',
  'chest fly': 'Slight elbow bend held constant, open the arms wide until you feel a chest stretch, bring them together in a hugging arc.',
  'good morning': 'Bar on the back, hinge at the hips with a flat back until your torso nears parallel, return. Light weight — it\'s a hamstring/back builder, not an ego lift.',
  'pullover': 'Lying across or on a bench, lower a dumbbell behind your head with slightly bent arms, feel the lat/chest stretch, pull back over the chest.'
};
function lookupExplanation(name) {
  const n = String(name || '').toLowerCase();
  if (EX_LIBRARY[n]) return EX_LIBRARY[n];
  for (const key of Object.keys(EX_LIBRARY)) {
    if (n.includes(key) || key.includes(n)) return EX_LIBRARY[key];
  }
  return null;
}

/* ================= equipment / plate calculator config ================= */
const EQUIPMENT_TYPES = ['barbell', 'trap-bar', 'landmine', 'training-bar', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other'];
const EQUIPMENT_LABELS = { barbell: 'Barbell', 'trap-bar': 'Trap bar', landmine: 'Landmine', 'training-bar': 'Training bar', dumbbell: 'Dumbbell', machine: 'Machine', cable: 'Cable', bodyweight: 'Bodyweight', other: 'Other' };
const PLATE_EQUIPMENT = new Set(['barbell', 'trap-bar', 'landmine', 'training-bar']); // shows the plate calculator
const BAR_WEIGHT_EQUIPMENT = new Set(['barbell', 'trap-bar', 'training-bar']); // landmine ignores bar weight entirely
const BAR_WEIGHT_DEFAULTS = { barbell: { kg: 20, lb: 45 }, 'trap-bar': { kg: 23, lb: 50 }, 'training-bar': { kg: 10, lb: 15 } };
function resolvedBarWeight(e) {
  if (e.barWeight != null) return e.barWeight;
  return BAR_WEIGHT_DEFAULTS[e.equipment]?.[unit()] ?? (unit() === 'lb' ? 45 : 20);
}
// Compact equipment label for exercise cards, plan rows and swap sheets.
// Bar weight is shown only when it is meaningful and non-default.
function equipChip(e) {
  const eq = e.equipment;
  if (!eq) return '';
  let label = EQUIPMENT_LABELS[eq] || eq;
  if (BAR_WEIGHT_EQUIPMENT.has(eq) && e.barWeight != null) label += ` · ${e.barWeight}${unit()}`;
  return `<span class="equip-chip">${esc(label)}</span>`;
}

/*
 * What an exercise's sets measure. 'load' is the default (weight × reps × RPE);
 * 'height' logs one jump attempt per row in cm and carries no weight, reps or
 * RPE at all — absent rather than zero, so nothing downstream mistakes a jump
 * for a 0 kg lift.
 */
const EXERCISE_METRICS = ['load', 'height'];
const isJump = e => e.metric === 'height';
const bestHeight = sets => sets.reduce((m, s) => (s.heightCm != null && s.heightCm > m ? s.heightCm : m), 0);

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
// kg-only bar defaults, local to this block on purpose: BAR_WEIGHT_DEFAULTS a
// few lines above already covers this (kg + lb), but this block has to stay
// self-contained so tools/weights.test.mjs can extract and evaluate it in
// isolation, and the ladder itself is always kg. Don't fold this into
// BAR_WEIGHT_DEFAULTS — that would break the isolated extraction.
const LADDER_BAR_DEFAULTS = { barbell: 20, 'trap-bar': 23, 'training-bar': 10 };
const ladderRound = v => Math.round(v * 100) / 100;

function ladderFor(equipment) {
  if (equipment === 'bodyweight') return null;
  return WEIGHT_LADDER[equipment] || LADDER_PLATE;
}
function ladderBase(equipment, barWeight) {
  const bar = barWeight != null ? barWeight : LADDER_BAR_DEFAULTS[equipment];
  return LADDER_BAR_TYPES.indexOf(equipment) !== -1 ? (bar || 0) : 0;
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
// Why a weight is not loadable, or null when it is fine. The caller builds the
// message — keeping this block free of unit()/DOM so the test can evaluate it.
// A falsy weight is always acceptable: 0 is the placeholder a new exercise
// starts at, and a bodyweight move must be exactly 0.
function weightIssueKind(equipment, barWeight, weight) {
  if (equipment === 'bodyweight') return (weight || 0) === 0 ? null : 'bodyweight';
  if (equipment === 'other' || !weight) return null;
  if (isLoadable(equipment, barWeight, weight)) return null;
  return ladderRound(weight - ladderBase(equipment, barWeight)) < -1e-9 ? 'below-bar' : 'off-ladder';
}
/* LADDER-END */

/* ================= default starter plan ================= */
function defaultPlan() {
  const ex = (name, sets, reps, weight, rpe, rest, alternates = [], equipment) =>
    ({ id: uid(), name, sets, reps, weight, targetRpe: rpe, restSeconds: rest, restSecondsNext: null, equipment: equipment || 'barbell', barWeight: null, metric: 'load', superset: null, description: '', notes: '', alternates });
  return {
    type: 'workout-plan', version: 1, name: 'Starter Push / Pull / Legs', createdAt: today(),
    days: [
      { id: uid(), name: 'Day A — Push', exercises: [
        ex('Bench Press', 4, '6-8', 60, 8, 150, [{ name: 'Dumbbell Bench Press', weight: 22, equipment: 'dumbbell' }, { name: 'Machine Chest Press', weight: 50, equipment: 'machine' }]),
        ex('Overhead Press', 3, '8-10', 35, 8, 120, [{ name: 'Seated Dumbbell Press', weight: 16, equipment: 'dumbbell' }]),
        ex('Incline Bench Press', 3, '8-12', 45, 8, 120, [{ name: 'Incline Dumbbell Press', weight: 18, equipment: 'dumbbell' }]),
        ex('Lateral Raise', 3, '12-15', 8, 9, 75, [{ name: 'Cable Lateral Raise', weight: 5, equipment: 'cable' }], 'dumbbell'),
        ex('Triceps Pushdown', 3, '10-15', 25, 9, 75, [{ name: 'Skull Crusher', weight: 20, equipment: 'barbell' }], 'cable')
      ]},
      { id: uid(), name: 'Day B — Pull', exercises: [
        ex('Deadlift', 3, '5', 100, 8, 180, [{ name: 'Romanian Deadlift', weight: 80 }]),
        ex('Pull-Up', 3, '6-10', 0, 9, 150, [{ name: 'Lat Pulldown', weight: 55, equipment: 'cable' }], 'bodyweight'),
        ex('Barbell Row', 3, '8-10', 60, 8, 120, [{ name: 'Cable Row', weight: 55, equipment: 'cable' }, { name: 'Dumbbell Row', weight: 26, equipment: 'dumbbell' }]),
        ex('Face Pull', 3, '12-15', 20, 9, 75, [{ name: 'Rear Delt Fly', weight: 8, equipment: 'dumbbell' }], 'cable'),
        ex('Bicep Curl', 3, '10-12', 12, 9, 75, [{ name: 'Hammer Curl', weight: 12 }], 'dumbbell')
      ]},
      { id: uid(), name: 'Day C — Legs', exercises: [
        ex('Squat', 4, '6-8', 80, 8, 180, [{ name: 'Leg Press', weight: 140, equipment: 'machine' }]),
        ex('Romanian Deadlift', 3, '8-10', 70, 8, 150, [{ name: 'Leg Curl', weight: 40, equipment: 'machine' }]),
        ex('Bulgarian Split Squat', 3, '8-10', 14, 9, 105, [{ name: 'Lunge', weight: 14 }], 'dumbbell'),
        ex('Leg Curl', 3, '10-12', 40, 9, 90, [{ name: 'Good Morning', weight: 40, equipment: 'barbell' }], 'machine'),
        ex('Calf Raise', 4, '10-15', 60, 9, 75, [], 'machine')
      ]}
    ]
  };
}

/* ================= state ================= */
let plan = store.get('plan', null) || defaultPlan();
let sessions = store.get('sessions', []);
let active = store.get('active', null);
let bodyWeight = store.get('bw', []);
let settings = Object.assign({ unit: 'kg', sound: true, vibrate: true, autoSync: true }, store.get('settings', {}));
delete settings.gistToken; delete settings.gistId; delete settings.gistOwner;

const WORKER_URL = 'https://api.gymtrack.hithitpull.fi';
let gymUUID = (() => {
  let id = localStorage.getItem('gymtrack_uuid');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('gymtrack_uuid', id); }
  return id;
})();
let aliases = store.get('aliases', {}); // { aliasLowercase: 'Canonical Name' } — display-time merge of exercise names
let tab = 'workout';
let prevTab = 'workout';      // where the settings view returns to
let expandedDay = null;       // plan view expansion
let expandedSession = null;   // history view expansion
let historyExercise = '';     // history exercise picker
let exExpanded = new Set();   // manually re-expanded completed exercises in the active session
let readinessOpen = null;     // null = auto (open until data/sets exist), true/false = manual override

/* cloud-sync runtime state */
let dataUpdatedAt = store.get('updatedAt', 0); // last meaningful local change (for last-write-wins)
let syncState = 'idle';                         // idle | syncing | ok | error
let lastSyncedAt = 0;
let lastSyncMsg = '';
let syncTimer = null;
let syncReady = false;                          // becomes true after the initial cloud reconcile

// touch() marks the data as changed and schedules a debounced cloud push.
function touch() {
  dataUpdatedAt = Date.now();
  store.set('updatedAt', dataUpdatedAt);
  if (syncReady) scheduleSync();
}
const savePlan = () => { store.set('plan', plan); touch(); };
const saveAliases = () => { store.set('aliases', aliases); touch(); };
const saveSessions = () => { store.set('sessions', sessions); touch(); };
const saveActive = () => active ? store.set('active', active) : store.del('active'); // intentionally not synced (local until finished)
const saveBW = () => { store.set('bw', bodyWeight); touch(); };
const saveSettings = () => store.set('settings', settings);
const unit = () => settings.unit;

/* ================= audio + haptics ================= */
let audioCtx = null;
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
function beep(times = 3, freq = 880) {
  if (!settings.sound) return;
  unlockAudio();
  if (!audioCtx) return;
  try {
    for (let i = 0; i < times; i++) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime + i * 0.38;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.start(t); o.stop(t + 0.32);
    }
  } catch (e) {}
}
function buzz(pattern = [200, 100, 200]) {
  if (settings.vibrate && navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
}

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
    const myRest = rest; // bind onended to this rest by identity, not to whatever `rest` is when it fires
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
      if (i === 0) o.onended = () => { if (rest === myRest) { rest.cueFired = true; saveRest(); } };
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

/* ================= wake lock (keep screen on during a session) ================= */
let wakeLock = null;
async function syncWakeLock() {
  if (active) startKeepAlive(); else stopKeepAlive();
  try {
    if (active && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!active && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { unlockAudio(); syncWakeLock(); }
  else if (syncReady && settings.autoSync && dataUpdatedAt > lastSyncedAt) {
    clearTimeout(syncTimer); workerPush({ silent: true }); // flush unsynced changes before backgrounding
  }
});

/* ================= rest timer ================= */
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
  cancelCue(); // cancel the outgoing rest's scheduled oscillators while `rest` still points at it
  rest = { endsAt: Date.now() + seconds * 1000, total: seconds, label: label || 'Rest', fired: false, cueFired: false, cueNodes: null };
  scheduleCue(seconds);
  saveRest(); renderRest();
}
function adjustRest(delta) {
  if (!rest) return;
  // Shortening must not push endsAt into the past. The tick loop auto-dismisses a
  // rest 30s after it ends, so an un-clamped −15s on a nearly-finished rest could
  // skip the "Rest over — GO!" state entirely. Clamping lands it exactly on zero.
  rest.endsAt = Math.max(Date.now(), rest.endsAt + delta * 1000);
  rest.total = Math.max(rest.total + delta, 1);
  const remain = (rest.endsAt - Date.now()) / 1000;
  rest.fired = false; rest.cueFired = false;
  // Past zero there is nothing left to schedule — drop the outgoing oscillator and
  // let the tick loop deliver the cue on its next pass instead.
  if (remain > 0) scheduleCue(remain); else cancelCue();
  saveRest(); renderRest();
}
function stopRest() { cancelCue(); rest = null; saveRest(); renderRest(); }
function renderRest() {
  const el = document.getElementById('rest-banner');
  if (!rest) { el.classList.add('hidden'); el.classList.remove('over'); return; }
  el.classList.remove('hidden');
  const remain = (rest.endsAt - Date.now()) / 1000;
  const over = remain <= 0;
  el.classList.toggle('over', over);
  const pct = Math.max(0, Math.min(100, (remain / rest.total) * 100));
  el.innerHTML = `
    <div class="row between">
      <div class="grow">
        <div class="muted small">${over ? 'Rest over — GO! 🔥' : esc(rest.label)}</div>
        <div class="rest-time ${over ? 'green' : ''}">${over ? '0:00' : fmtClock(remain)}</div>
      </div>
      ${over ? '' : '<button class="icon-btn" data-action="rest-sub">−15s</button>'}
      <button class="icon-btn" data-action="rest-add">+15s</button>
      <button class="icon-btn ${over ? 'success' : ''}" data-action="rest-skip">${over ? 'OK' : 'Skip'}</button>
    </div>
    <div class="rest-bar"><div style="width:${pct}%"></div></div>`;
}
setInterval(() => {
  if (rest) {
    const remain = (rest.endsAt - Date.now()) / 1000;
    // Fallback only: the cue is normally delivered by scheduleCue() on the audio
    // clock. Beep here only if that never landed, so a dead context still gets a
    // late cue and a delivered one never doubles up.
    if (remain <= 0 && !rest.fired) {
      rest.fired = true;
      if (!rest.cueFired) { beep(3); buzz(); } else buzz();
      saveRest();
    }
    if (remain <= -30) { cancelCue(); rest = null; saveRest(); }  // auto-dismiss 30s after firing
    renderRest();
  }
  // live session clock
  const chip = document.getElementById('session-chip');
  if (active) {
    chip.classList.remove('hidden');
    chip.textContent = '⏱ ' + fmtClock((Date.now() - active.startedAt) / 1000);
  } else chip.classList.add('hidden');
  // keep the "synced X min ago" line fresh while the Claude tab is open
  const sEl = document.getElementById('sync-status');
  if (sEl && syncState !== 'syncing') sEl.innerHTML = syncStatusHtml();
}, 1000);

/* ================= toast + modal ================= */
function toast(msg, kind = 'ok') {
  const root = document.getElementById('toast-root');
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  root.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
let modalActions = {};
function showModal(title, bodyHtml, actions) {
  modalActions = {};
  const btns = (actions || [{ label: 'Close' }]).map((a, i) => {
    modalActions['m' + i] = a.fn || null;
    return `<button class="${a.cls || ''}" data-action="modal-btn" data-idx="m${i}">${esc(a.label)}</button>`;
  }).join('');
  document.getElementById('modal-root').innerHTML = `
    <div class="overlay" data-action="modal-dismiss">
      <div class="sheet">
        <h3>${esc(title)}</h3>
        <div class="modal-body">${bodyHtml}</div>
        <div class="actions">${btns}</div>
      </div>
    </div>`;
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; modalActions = {}; }
const mval = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
const mnum = (id, d = 0) => { const v = parseFloat(mval(id)); return isNaN(v) ? d : v; };

/* ================= plan normalization (for imports) ================= */
function normalizePlan(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Not a JSON object.');
  if (raw.type && raw.type !== 'workout-plan') throw new Error('JSON "type" should be "workout-plan".');
  if (!Array.isArray(raw.days) || !raw.days.length) throw new Error('Plan needs a non-empty "days" array.');
  const p = {
    type: 'workout-plan', version: 1,
    name: String(raw.name || 'Imported plan'),
    createdAt: raw.createdAt || today(),
    days: raw.days.map(d => {
      if (!Array.isArray(d.exercises)) throw new Error(`Day "${d.name || '?'}" needs an "exercises" array.`);
      return {
        id: d.id || uid(), name: String(d.name || 'Day'),
        exercises: d.exercises.map(e => {
          if (!e.name) throw new Error('Every exercise needs a "name".');
          return {
            id: e.id || uid(), name: String(e.name),
            sets: Math.max(1, parseInt(e.sets, 10) || 3),
            reps: String(e.reps != null ? e.reps : '8-12'),
            weight: parseFloat(e.weight) || 0,
            targetRpe: e.targetRpe != null ? parseFloat(e.targetRpe) : null,
            restSeconds: parseInt(e.restSeconds, 10) || 120,
            restSecondsNext: e.restSecondsNext != null && e.restSecondsNext !== '' ? parseInt(e.restSecondsNext, 10) : null,
            equipment: EQUIPMENT_TYPES.includes(e.equipment) ? e.equipment : 'barbell',
            barWeight: e.barWeight != null && e.barWeight !== '' ? parseFloat(e.barWeight) : null,
            metric: EXERCISE_METRICS.includes(e.metric) ? e.metric : 'load',
            // Adjacent exercises sharing a tag form one superset. Uppercased and
            // trimmed so "a" and "A " group together rather than silently splitting.
            // This normalization must stay identical to the one in
            // tools/push-plan.mjs's validatePlan — otherwise the validator can
            // pass a plan whose tags collide only after this truncation, and the
            // app silently splits it into two cards.
            superset: e.superset ? String(e.superset).trim().toUpperCase().slice(0, 2) : null,
            description: String(e.description || ''),
            notes: String(e.notes || ''),
            alternates: Array.isArray(e.alternates) ? e.alternates.filter(a => a && a.name).map(a => ({
              name: String(a.name), weight: parseFloat(a.weight) || 0, description: String(a.description || ''),
              // Omitted equipment means "same as the parent" — keep it absent rather than
              // defaulting to barbell, so a swap inherits instead of silently relabelling.
              equipment: EQUIPMENT_TYPES.includes(a.equipment) ? a.equipment : null,
              barWeight: a.barWeight != null && a.barWeight !== '' ? parseFloat(a.barWeight) : null
            })) : []
          };
        })
      };
    })
  };
  return p;
}

/* ================= exercise name aliases ================= */
// Aliases merge name variants ("Bench Pres", "BB Bench") into one canonical
// exercise at read time — session records themselves are never rewritten.
function canonicalName(name) {
  const n = String(name || '').trim();
  return aliases[n.toLowerCase()] || n;
}
const sameExercise = (a, b) => canonicalName(a).toLowerCase() === canonicalName(b).toLowerCase();
// Most recent logged performance of an exercise (alias-aware), for the
// "Last:" line on session cards.
function lastPerformance(name) {
  for (let i = sessions.length - 1; i >= 0; i--) {
    for (const e of sessions[i].exercises) {
      if (sameExercise(e.name, name) && e.sets.length) {
        // Missing metric = pre-jump-feature record; treat as 'load' (backward compat).
        return { date: sessions[i].date, sets: e.sets, jump: e.metric === 'height' };
      }
    }
  }
  return null;
}

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

/* ================= session logic ================= */
function startSession(dayId) {
  const day = plan.days.find(d => d.id === dayId);
  if (!day) return;
  unlockAudio();
  active = {
    id: uid(), dayId: day.id, dayName: day.name, startedAt: Date.now(), notes: '',
    readiness: {},
    exercises: day.exercises.map(e => ({
      name: e.name, planId: e.id, swappedFrom: null,
      plannedSets: e.sets, plannedReps: e.reps, plannedWeight: e.weight,
      targetRpe: e.targetRpe, restSeconds: e.restSeconds, restSecondsNext: e.restSecondsNext,
      equipment: e.equipment || 'barbell', barWeight: e.barWeight,
      metric: e.metric === 'height' ? 'height' : 'load', superset: e.superset || null,
      description: e.description, alternates: e.alternates, notes: '',
      sets: e.metric === 'height'
        ? Array.from({ length: e.sets }, () => ({ heightCm: null, done: false }))
        : Array.from({ length: e.sets }, () => ({ weight: e.weight, reps: parseRepsLow(e.reps), rpe: e.targetRpe, done: false }))
    }))
  };
  exExpanded = new Set(); readinessOpen = null;
  saveActive(); syncWakeLock(); render();
  toast('Session started — go crush it 💪');
}
function parseRepsLow(reps) {
  const m = String(reps).match(/\d+/);
  return m ? parseInt(m[0], 10) : 8;
}
// Everything that must be reset when the active session goes away, whichever way
// it goes away (saved, discarded, or wiped by reset-all). Extracted because these
// three paths drifted three separate times: discard forgot closeModal() and left
// its own confirm sheet covering the screen, discard and reset-all both forgot
// exExpanded/readinessOpen so collapsed-card state leaked into the next session,
// and reset-all forgot syncWakeLock(). Callers still own closeModal()/render().
function endSession() {
  active = null; saveActive(); stopRest(); syncWakeLock();
  exExpanded = new Set(); readinessOpen = null;
}
function finishSession() {
  if (!active) return;
  const durationMin = Math.max(1, Math.round((Date.now() - active.startedAt) / 60000));
  const record = {
    id: active.id, date: new Date(active.startedAt).toISOString(), dayName: active.dayName,
    durationMin, notes: active.notes,
    exercises: active.exercises
      .map(e => ({ name: e.name, plannedSets: e.plannedSets, plannedReps: e.plannedReps,
        plannedWeight: e.plannedWeight, targetRpe: e.targetRpe,
        equipment: e.equipment, barWeight: e.barWeight, metric: e.metric === 'height' ? 'height' : 'load',
        superset: e.superset || null,
        swappedFrom: e.swappedFrom, notes: e.notes,
        sets: e.sets.filter(s => s.done).map(s => e.metric === 'height'
          ? ({ heightCm: s.heightCm })
          : ({ weight: s.weight, reps: s.reps, rpe: s.rpe })) }))
      .filter(e => e.sets.length)
  };
  const rd = active.readiness || {};
  if (rd.cmjCm != null || rd.broadJumpCm != null || rd.subjectiveEnergy != null) record.readiness = rd;
  const prs = detectPRs(record);
  sessions.push(record); saveSessions();
  endSession();
  closeModal(); render();
  const setCount = record.exercises.reduce((n, e) => n + e.sets.length, 0);
  let html = `<p>Saved <b>${esc(record.dayName)}</b> — ${setCount} sets in ${fmtDur(durationMin)}.</p>`;
  if (prs.length) html += `<p class="mt8">🏆 New PRs: ${prs.map(p => `<span class="pr-badge">${esc(p)}</span>`).join(' ')}</p>`;
  const syncing = settings.autoSync;
  html += `<p class="muted small mt8">${syncing ? '☁️ Syncing to the cloud for your AI coach…' : 'Head to the AI Coach tab to export this for your next plan update.'}</p>`;
  // Explicit action rather than the implicit "Close" default: the way out of this
  // sheet should be obvious, and it lands you back on the day list.
  showModal('Workout complete 🎉', html, [{ label: 'Done', cls: 'primary',
    fn: () => { closeModal(); tab = 'workout'; render(); window.scrollTo(0, 0); } }]);
  beep(2, 1100);
  if (syncing) workerPush({ silent: true }); // push the finished session right away
}
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

// Post-completion side effects for a set that has just been marked done: starts
// the right rest (respecting superset round-robin/group-complete transitions),
// buzzes, and persists + re-renders. Shared by the manual set-done tap and
// cmjAccept, so accepting a video measurement behaves exactly like tapping the
// checkmark — same rest timer, same round-robin advance inside a superset.
function completeSet(ei, si) {
  const ex = active.exercises[ei];
  const group = groupOf(active.exercises, ei);
  const exerciseDone = ex.sets.every(y => y.done);
  // Inside a group the whole group collapses together, so don't collapse a member.
  if (exerciseDone && !group) exExpanded.delete(ei);
  saveActive(); render();
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

/* ================= Claude data exchange ================= */
function buildExport() {
  return JSON.stringify({
    type: 'workout-log', version: 1, exportedAt: new Date().toISOString(), unit: unit(),
    bodyWeight: bodyWeight.slice(-20),
    sessions: sessions.slice(-15),
    currentPlan: plan
  }, null, 2);
}
function buildBackup() {
  return JSON.stringify({
    type: 'gymtrack-backup', version: 1, exportedAt: new Date().toISOString(),
    updatedAt: dataUpdatedAt,
    plan, sessions, bodyWeight, aliases, settings: { unit: settings.unit, sound: settings.sound, vibrate: settings.vibrate }
  }, null, 2);
}
function restoreBackup(raw) {
  const b = JSON.parse(raw);
  if (b.type !== 'gymtrack-backup') throw new Error('Not a GymTrack backup (expected type "gymtrack-backup").');
  plan = normalizePlan(b.plan); sessions = Array.isArray(b.sessions) ? b.sessions : [];
  bodyWeight = Array.isArray(b.bodyWeight) ? b.bodyWeight : [];
  aliases = b.aliases && typeof b.aliases === 'object' ? b.aliases : {};
  if (b.settings) Object.assign(settings, { unit: b.settings.unit, sound: b.settings.sound, vibrate: b.settings.vibrate });
  // Adopt the source timestamp so we don't immediately bounce the same data back.
  dataUpdatedAt = b.updatedAt || Date.now();
  store.set('plan', plan); store.set('sessions', sessions); store.set('bw', bodyWeight); store.set('aliases', aliases);
  store.set('updatedAt', dataUpdatedAt); saveSettings();
}
const CLAUDE_PROMPT = () => `You are my strength coach. Below is my recent training data exported from my GymTrack app (JSON). Review my actual sets, reps, weights, RPE, notes and body weight, then write my next workout plan.

Rules for the plan you produce:
- Output ONLY a JSON code block matching this exact schema (weights in ${unit()}):
{
  "type": "workout-plan",
  "version": 1,
  "name": "<plan name>",
  "days": [
    {
      "name": "<day name>",
      "exercises": [
        {
          "name": "<exercise>",
          "sets": <number>,
          "reps": "<e.g. 8-10>",
          "weight": <number>,
          "targetRpe": <number 1-10>,
          "restSeconds": <number>,
          "restSecondsNext": <number, optional — rest before moving to the next movement, omit if same as restSeconds>,
          "equipment": "<one of: barbell, trap-bar, landmine, training-bar, dumbbell, machine, cable, bodyweight, other>",
          "barWeight": <number, optional — only for barbell/trap-bar/training-bar if the bar isn't a standard 20kg/45lb bar; omit otherwise>,
          "metric": "<optional — 'load' (default, omit) or 'height' for a jump exercise logged in cm; use equipment 'bodyweight' and weight 0 with 'height'>",
          "superset": "<optional — a short tag like 'A' shared by adjacent exercises to log them as one alternating superset card; omit for a standalone exercise>",
          "description": "<1-2 sentence how-to>",
          "alternates": [ { "name": "<alternative exercise>", "weight": <number>, "description": "<short how-to>" } ]
        }
      ]
    }
  ]
}
- Progress weights based on my logged RPE: if RPE was at or below target, increase; if above, hold or reduce.
- Always include 1-2 "alternates" per exercise (for busy equipment) and a short "description" for each.
- Keep rest times realistic per lift type. Set "restSecondsNext" only when the rest before switching movements should genuinely differ from the between-set rest (e.g. longer before a heavy compound, shorter before a superset).
- Set "equipment" accurately per exercise — this drives whether the plate calculator shows up and whether the weight field is grayed out for bodyweight moves.
- Set "metric" to "height" only for jump-height tests (e.g. box jumps, CMJ-style training sets) logged in cm; leave it out for ordinary weight × reps exercises.
- Set "superset" to the same tag on exercises meant to be logged as one alternating superset — they must be adjacent in the "exercises" array; leave it out otherwise.

My data:
`;
const CLAUDE_URL_PROMPT = url => `You are my strength coach. Fetch my latest GymTrack training data from this URL (JSON):
${url}

It contains my recent sessions (actual weights, reps, RPE), notes, body weight and current plan. Review it, then write my next workout plan.

Reply with ONLY a JSON code block of type "workout-plan" (weights in ${unit()}) using the same field structure as the "plan" object in that data: days[] → exercises[] with name, sets, reps (string), weight, targetRpe, restSeconds, restSecondsNext (optional, only if it should differ from restSeconds), equipment (one of: barbell, trap-bar, landmine, training-bar, dumbbell, machine, cable, bodyweight, other), barWeight (optional, only if the bar isn't a standard 20kg/45lb bar), metric (optional, "load" default or "height" for a jump exercise logged in cm — use equipment "bodyweight" and weight 0 with it), superset (optional, a short tag shared by adjacent exercises to log as one alternating superset), description, and 1-2 alternates each. Progress weights from my logged RPE vs target (at/under target → increase; over → hold or reduce). I'll paste your JSON back into the app to load it.`;
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); return true; } catch (e2) { return false; } finally { ta.remove(); }
  }
}

/* ================= worker sync ================= */
const workerShareUrl = () => `${WORKER_URL}/data/${gymUUID}`;

function relTime(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.round(s / 60); if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60); if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}
function syncStatusHtml() {
  if (!settings.autoSync) return '<span class="muted small">⏸ Auto-sync off</span>';
  if (syncState === 'syncing') return '<span class="small amber">⟳ Syncing…</span>';
  if (syncState === 'error') return '<span class="small red">⚠ ' + esc(lastSyncMsg || 'Sync error') + '</span>';
  if (lastSyncedAt) return '<span class="small green">✓ Synced ' + relTime(lastSyncedAt) + '</span>';
  return '<span class="muted small">🔗 Connected — syncing on launch</span>';
}
function setSyncState(state, msg) {
  syncState = state;
  if (state === 'ok') { lastSyncedAt = Date.now(); lastSyncMsg = ''; }
  if (state === 'error') lastSyncMsg = msg || '';
  const el = document.getElementById('sync-status');
  if (el) el.innerHTML = syncStatusHtml();
}
function scheduleSync() {
  if (!settings.autoSync) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => workerPush({ silent: true }), 1500);
}

async function workerPush(opts = {}) {
  clearTimeout(syncTimer);
  setSyncState('syncing');
  try {
    const res = await fetch(`${WORKER_URL}/data/${gymUUID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildBackup()
    });
    if (!res.ok) throw new Error('Sync error ' + res.status);
    setSyncState('ok');
    if (!opts.silent) toast('Synced to cloud ✓');
    return true;
  } catch (e) { setSyncState('error', e.message); if (!opts.silent) toast('Sync failed: ' + e.message, 'err'); return false; }
}
async function workerFetch() {
  const res = await fetch(`${WORKER_URL}/data/${gymUUID}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Fetch error ' + res.status);
  const text = await res.text();
  let parsed = {}; try { parsed = JSON.parse(text); } catch (e) {}
  return { raw: text, updatedAt: parsed.updatedAt || 0, parsed };
}
// Union two arrays by key: local entries are kept unless remote has the same
// key, in which case remote wins. This preserves local-only unsynced records
// (e.g. logged offline on one device) instead of a remote pull wiping them out.
function mergeByKey(remoteArr, localArr, keyFn) {
  const merged = new Map();
  for (const item of localArr) merged.set(keyFn(item), item);
  for (const item of remoteArr) merged.set(keyFn(item), item);
  return Array.from(merged.values());
}
// Pull-or-push depending on which side is newer / non-empty (last-write-wins),
// merging sessions/bodyWeight by id/date so a pull can't silently drop
// local-only records that hadn't synced yet.
async function workerReconcile() {
  const r = await workerFetch();
  if (!r) { await workerPush({ silent: true }); return 'pushed'; }
  const localEmpty = sessions.length === 0 && bodyWeight.length === 0;
  const remoteHasData = r.parsed && (((r.parsed.sessions || []).length) || ((r.parsed.bodyWeight || []).length) || r.parsed.plan);
  if (remoteHasData && (r.updatedAt > dataUpdatedAt || localEmpty)) {
    const remoteSessions = r.parsed.sessions || [], remoteBW = r.parsed.bodyWeight || [];
    const mergedSessions = mergeByKey(remoteSessions, sessions, s => s.id);
    const mergedBW = mergeByKey(remoteBW, bodyWeight, b => b.date);
    const hadLocalOnly = mergedSessions.length > remoteSessions.length || mergedBW.length > remoteBW.length;
    restoreBackup(r.raw);
    sessions = mergedSessions; bodyWeight = mergedBW;
    store.set('sessions', sessions); store.set('bw', bodyWeight);
    render(); setSyncState('ok');
    if (hadLocalOnly) { touch(); await workerPush({ silent: true }); }
    return 'pulled';
  }
  await workerPush({ silent: true });
  return 'pushed';
}
async function autoSyncOnLoad() {
  if (!settings.autoSync || active) { syncReady = true; return; }
  setSyncState('syncing');
  try { await workerReconcile(); } catch (e) { setSyncState('error', e.message); }
  syncReady = true;
}

/* ================= restore from backup code ================= */
// Shared by the settings view and the onboarding "I have a backup code" flow.
function restoreFromCode(raw) {
  if (!raw) { toast('Paste your backup code first', 'err'); return; }
  const match = raw.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (!match) { toast('Invalid backup code', 'err'); return; }
  const newUUID = match[1].toLowerCase();
  localStorage.setItem('gymtrack_uuid', newUUID);
  gymUUID = newUUID;
  setSyncState('syncing');
  (async () => {
    try {
      const r = await workerFetch();
      if (!r) { toast('No data found for this backup code', 'err'); setSyncState('error', 'Not found'); return; }
      restoreBackup(r.raw); closeModal(); render(); setSyncState('ok'); toast('Restored ✓');
    } catch (e) { setSyncState('error', e.message); toast('Restore failed: ' + e.message, 'err'); }
  })();
}

/* ================= first-run onboarding ================= */
function showOnboarding() {
  showModal('Welcome to GymTrack', `
    <div class="onboard-row">${icon('dumbbell', 22)}<div><b>Log your workouts</b><div class="muted small">Sets, reps, RPE — with a rest timer that runs itself.</div></div></div>
    <div class="onboard-row">${icon('sparkle', 22)}<div><b>Your AI coach writes the next plan</b><div class="muted small">Share your training data with Claude, ChatGPT or Gemini in one tap.</div></div></div>
    <div class="onboard-row">${icon('link', 22)}<div><b>Everything syncs automatically</b><div class="muted small">Your backup code (in Settings) restores it all on any device.</div></div></div>
    <p class="small muted mt12">A starter Push / Pull / Legs plan is loaded — edit it in the Plan tab or import your own.</p>`,
    [
      { label: 'Get started', cls: 'primary', fn: () => { store.set('onboarded', 1); closeModal(); } },
      { label: 'I have a backup code', fn: () => {
          store.set('onboarded', 1);
          showModal('Restore your data', `
            <p class="small muted">Paste the backup code (or share URL) from your old device.</p>
            <input id="restore-uuid-input" class="mt8" placeholder="Paste your backup code" style="width:100%;box-sizing:border-box">`,
            [
              { label: 'Restore', cls: 'primary', fn: () => restoreFromCode(mval('restore-uuid-input')) },
              { label: 'Cancel' }
            ]);
        } }
    ]);
}

/* ================= service worker updates ================= */
// sw.js intentionally does NOT call skipWaiting() on install, so a newly
// installed worker sits in "waiting" until the user taps the banner below —
// this replaces the old silent "updates land on the second app open" behavior.
let swWaiting = null;
function showUpdateBanner() {
  if (document.getElementById('update-banner')) return;
  const el = document.createElement('div');
  el.id = 'update-banner'; el.className = 'update-banner';
  el.innerHTML = `<span>New version available</span><button data-action="update-app">Update</button>`;
  document.body.prepend(el);
}
// Manual "Check for updates". Covers two distinct failure modes:
//  1. A new worker is installed and waiting but the banner was missed/dismissed.
//  2. sw.js is byte-identical to the installed one (a release that forgot to bump
//     CACHE), so no new worker ever installs — yet app.js on the server IS newer.
//     reg.update() reports "nothing new" here, which is why we also compare the
//     live app.js against the cached copy and offer a cache purge.
async function checkForUpdates() {
  const btn = document.querySelector('[data-action="check-updates"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  const reset = () => { if (btn) { btn.disabled = false; btn.textContent = 'Check for updates'; } };
  try {
    if (!('serviceWorker' in navigator)) { toast('Updates need a browser with service workers', 'err'); return reset(); }
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) { toast('App not installed as a PWA — just reload the page'); return reset(); }

    await reg.update(); // re-fetches sw.js; installs a new worker if it differs
    if (reg.waiting) { swWaiting = reg.waiting; showUpdateBanner(); toast('Update ready — tap Update'); return reset(); }

    // Worker is current. Is its cached app.js still current too?
    const [liveRes, cachedRes] = await Promise.all([
      fetch(`./app.js?fresh=${Date.now()}`, { cache: 'no-store' }),
      caches.match('./app.js')
    ]);
    if (!liveRes.ok || !cachedRes) { toast('You’re on the latest version ✓'); return reset(); }
    const [live, cached] = await Promise.all([liveRes.text(), cachedRes.text()]);
    if (live === cached) { toast('You’re on the latest version ✓'); return reset(); }

    reset();
    showModal('Update available', `
      <p class="small">A newer version is on the server, but this device is still serving a cached copy.</p>
      <p class="small muted mt8">Reloading clears the app cache and fetches it. Your workouts, plan and settings are stored separately and are not affected.</p>`,
      [{ label: 'Reload now', cls: 'primary', fn: forceRefresh }, { label: 'Not now' }]);
  } catch (err) {
    reset();
    toast('Could not check — are you offline?', 'err');
  }
}

// Purge every cache and reload from network. Only touches the SW cache; app data
// lives in localStorage and is untouched.
async function forceRefresh() {
  closeModal();
  try { await Promise.all((await caches.keys()).map(k => caches.delete(k))); } catch (err) { /* reload anyway */ }
  location.reload();
}

function initServiceWorkerUpdates() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    if (reg.waiting && reg.active) { swWaiting = reg.waiting; showUpdateBanner(); }
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) { swWaiting = nw; showUpdateBanner(); }
      });
    });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

/* ================= views ================= */
function render() {
  hideStepper(); // any focused set input is about to be replaced
  const app = document.getElementById('app');
  document.querySelectorAll('#tabbar .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'workout') app.innerHTML = active ? viewActiveSession() : viewStart();
  else if (tab === 'plan') app.innerHTML = viewPlan();
  else if (tab === 'history') app.innerHTML = viewHistory();
  else if (tab === 'settings') app.innerHTML = viewSettings();
  else app.innerHTML = viewCoach();
}

/* ---- workout: pick a day ---- */
function viewStart() {
  const last = sessions[sessions.length - 1];
  let suggest = '';
  if (last) {
    const idx = plan.days.findIndex(d => d.name === last.dayName);
    if (idx >= 0) suggest = plan.days[(idx + 1) % plan.days.length].id;
  }
  return `
    <h2 class="section">Start a workout</h2>
    ${plan.days.map(d => `
      <div class="card">
        <div class="row between">
          <div class="grow">
            <div class="bold">${esc(d.name)} ${d.id === suggest ? '<span class="day-pill green">up next</span>' : ''}</div>
            <div class="muted small mt8">${d.exercises.map(e => esc(e.name)).join(' · ')}</div>
          </div>
        </div>
        <button class="primary wide mt12" data-action="start-session" data-id="${d.id}">Start ${esc(d.name.split('—')[0].trim())}</button>
      </div>`).join('')}
    ${last ? `<p class="muted small" style="text-align:center">Last workout: ${esc(last.dayName)} · ${fmtDate(last.date)}</p>` : ''}
    <button class="ghost wide mt12" data-action="cmj-open">${icon('video', 16)} Test CMJ measurement</button>`;
}

/* ---- workout: active session ---- */
function viewActiveSession() {
  const totalSets = active.exercises.reduce((n, e) => n + e.sets.length, 0);
  const doneSets = active.exercises.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0);
  const pct = totalSets ? Math.round((doneSets / totalSets) * 100) : 0;
  const r = active.readiness || {};
  const hasReadiness = r.cmjCm != null || r.broadJumpCm != null || r.subjectiveEnergy != null;
  const readinessExpanded = readinessOpen != null ? readinessOpen : !(hasReadiness || doneSets > 0);
  const readinessSummary = hasReadiness
    ? [r.cmjCm != null ? `CMJ ${r.cmjCm}${r.cmjAttempts?.length > 1 ? ` (${r.cmjAttempts.length} att)` : ''}` : '', r.broadJumpCm != null ? `Broad ${r.broadJumpCm}` : '', r.subjectiveEnergy != null ? `Energy ${r.subjectiveEnergy}` : ''].filter(Boolean).join(' · ')
    : 'tap to log CMJ / energy';
  return `
    <div class="row between">
      <h2 class="section" style="margin:4px">${esc(active.dayName)}</h2>
      <button class="danger icon-btn" data-action="confirm-finish">Finish</button>
    </div>
    <div class="session-progress">
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <span class="small muted progress-label">${doneSets}/${totalSets} sets</span>
    </div>
    ${readinessExpanded ? `
    <h2 class="section tappable" data-action="readiness-toggle">Pre-session readiness <span class="muted small">(optional)</span> <span class="chev">${icon('chevDown', 14)}</span></h2>
    <div class="card">
      <div class="row" style="gap:12px">
        <label style="flex:1">
          <span class="small muted">CMJ (cm)</span>
          <input type="number" step="0.1" min="0" max="100" data-bind="readiness-cmj"
            value="${active.readiness?.cmjCm ?? ''}" placeholder="—">
        </label>
        <label style="flex:1">
          <span class="small muted">Broad jump (cm)</span>
          <input type="number" step="1" min="0" max="400" data-bind="readiness-broad"
            value="${active.readiness?.broadJumpCm ?? ''}" placeholder="—">
        </label>
        <label style="flex:1">
          <span class="small muted">Energy (1–10)</span>
          <input type="number" step="1" min="1" max="10" data-bind="readiness-energy"
            value="${active.readiness?.subjectiveEnergy ?? ''}" placeholder="—">
        </label>
      </div>
      <button class="ghost wide mt8" data-action="cmj-open">${icon('video', 16)} Measure CMJ via video</button>
    </div>` : `
    <div class="card collapsed-ex tappable" data-action="readiness-toggle">
      <div class="row between">
        <div class="grow"><span class="bold small">Readiness</span> <span class="muted small">· ${esc(readinessSummary)}</span></div>
        <span class="chev">${icon('chevRight', 16)}</span>
      </div>
    </div>`}
    ${supersetGroups(active.exercises).map(g => g.tag
      ? supersetCard(g)
      : exerciseCard(active.exercises[g.idx[0]], g.idx[0])).join('')}
    <h2 class="section">Session notes</h2>
    <div class="card">
      <textarea data-bind="session-notes" placeholder="How did it go? Anything Claude should know? (sleep, pain, energy…)">${esc(active.notes)}</textarea>
    </div>
    <button class="wide success mt12" data-action="confirm-finish">Finish workout</button>
    <button class="wide ghost danger mt8" data-action="confirm-discard">Discard session</button>`;
}
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
function exerciseCard(e, ei, opts) {
  const inGroup = !!(opts && opts.inGroup);
  const doneCount = e.sets.filter(s => s.done).length;
  const allDone = doneCount === e.sets.length && e.sets.length > 0;
  // Inside a superset the whole group collapses as a unit, so a member never
  // collapses on its own — the athlete still needs its rows for the next round.
  if (allDone && !inGroup && !exExpanded.has(ei)) {
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
  const lastP = lastPerformance(e.name);
  const lastRpe = lastP ? Math.max(0, ...lastP.sets.map(s => s.rpe || 0)) : 0;
  return `
  <div class="${inGroup ? 'ss-body' : 'card'}">
    <div class="row between">
      <div class="grow">
        <div class="ex-name">${allDone ? '✅ ' : ''}${esc(e.name)}</div>
        <div class="target-line">${isJump(e)
          ? `Plan: ${e.plannedSets} attempt${e.plannedSets === 1 ? '' : 's'} · rest ${fmtClock(e.restSeconds)} ${equipChip(e)}`
          : `Plan: ${e.plannedSets}×${esc(e.plannedReps)} @ ${e.plannedWeight}${unit()}${e.targetRpe ? ' · RPE ' + e.targetRpe : ''} · rest ${fmtClock(e.restSeconds)} ${equipChip(e)}`}</div>
        ${lastP ? `<div class="last-line">Last: ${lastP.jump ? `best ${bestHeight(lastP.sets)} cm` : lastP.sets.map(s => `${s.weight}×${s.reps}`).join(' · ') + (lastRpe ? ` @RPE ${lastRpe}` : '')} — ${fmtDate(lastP.date)}</div>` : ''}
        ${e.swappedFrom ? `<div class="swap-note">↺ swapped from ${esc(e.swappedFrom)}</div>` : ''}
      </div>
      <button class="icon-btn" data-action="ex-info" data-ei="${ei}" title="Explain">${icon('info', 18)}</button>
      ${!isJump(e) && PLATE_EQUIPMENT.has(e.equipment || 'barbell') ? `<button class="icon-btn" data-action="plate-calc" data-ei="${ei}" title="Plate calculator">${icon('plate', 18)}</button>` : ''}
      <button class="icon-btn" data-action="ex-swap" data-ei="${ei}" title="Swap">${icon('swap', 18)}</button>
    </div>
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
    <div class="row mt12">
      <button class="ghost icon-btn" data-action="set-add" data-ei="${ei}">+ Set</button>
      <button class="ghost icon-btn" data-action="set-remove" data-ei="${ei}">− Set</button>
      ${isJump(e) ? `<button class="ghost icon-btn" data-action="cmj-open" data-ei="${ei}">${icon('video', 15)} Measure</button>` : ''}
      <button class="ghost icon-btn grow note-btn" data-action="ex-note" data-ei="${ei}">${icon('note', 15)} ${e.notes ? esc(e.notes.slice(0, 24)) + (e.notes.length > 24 ? '…' : '') : 'Note'}</button>
    </div>
  </div>`;
}

/* ---- plan view ---- */
function viewPlan() {
  return `
    <div class="row between">
      <div class="grow">
        <div class="bold">${esc(plan.name)}</div>
        <div class="muted small">${plan.days.length} days · created ${esc(plan.createdAt || '?')}</div>
      </div>
      <button class="icon-btn" data-action="plan-rename">✏️</button>
    </div>
    <div class="mt12"></div>
    ${plan.days.map(d => {
      const open = expandedDay === d.id;
      return `
      <div class="card">
        <div class="row between tappable" data-action="day-toggle" data-id="${d.id}">
          <div class="bold grow">${esc(d.name)}</div>
          <span class="day-pill">${d.exercises.length} exercise${d.exercises.length === 1 ? '' : 's'}</span>
          <span class="chev">${icon(open ? 'chevDown' : 'chevRight', 16)}</span>
        </div>
        ${open ? `
          <div class="divider"></div>
          ${d.exercises.map((e, i) => `
            <div class="row between" style="padding:9px 0">
              <div class="grow tappable" data-action="ex-menu" data-day="${d.id}" data-i="${i}">
                <div class="bold">${esc(e.name)}${e.superset ? ` <span class="day-pill">SS ${esc(e.superset)}</span>` : ''}</div>
                <div class="muted small">${e.sets}×${esc(e.reps)} @ ${e.weight}${unit()}${e.targetRpe ? ' · RPE ' + e.targetRpe : ''} · rest ${fmtClock(e.restSeconds)}${e.alternates.length ? ' · ' + e.alternates.length + ' alt' : ''} ${equipChip(e)}</div>
              </div>
              <button class="icon-btn" data-action="ex-move" data-day="${d.id}" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="icon-btn" data-action="ex-move" data-day="${d.id}" data-i="${i}" data-dir="1" ${i === d.exercises.length - 1 ? 'disabled' : ''}>↓</button>
            </div>`).join('')}
          <div class="row mt8">
            <button class="ghost icon-btn" data-action="ex-add" data-day="${d.id}">+ Exercise</button>
            <button class="ghost icon-btn" data-action="day-rename" data-id="${d.id}">Rename</button>
            <button class="ghost icon-btn red" data-action="day-delete" data-id="${d.id}">Delete</button>
          </div>` : ''}
      </div>`;
    }).join('')}
    <button class="wide mt8" data-action="day-add">+ Add day</button>
    <p class="muted small mt12" style="text-align:center">Tap an exercise to edit targets, swap alternates, or read how to do it.<br>Import a whole new plan in the AI Coach tab.</p>`;
}

/* ---- history view ---- */
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
// Line chart with min/max value labels and first/last date labels.
// points: [{ v: number, d: dateIso }]
function chartSvg(points, w = 320, h = 84) {
  if (points.length < 2) return '';
  const vals = points.map(p => p.v);
  const min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1;
  const padL = 38, padR = 10, top = 10, bottom = 20;
  const plotW = w - padL - padR, plotH = h - top - bottom;
  const x = i => padL + (i / (points.length - 1)) * plotW;
  const y = v => top + plotH - ((v - min) / span) * plotH;
  const pts = points.map((p, i) => `${x(i)},${y(p.v)}`).join(' ');
  const fmtD = iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const fmtV = v => String(Math.round(v * 10) / 10);
  return `<svg class="spark" width="100%" viewBox="0 0 ${w} ${h}">
    <line x1="${padL}" y1="${y(max)}" x2="${w - padR}" y2="${y(max)}" stroke="var(--border)" stroke-dasharray="3 4"/>
    ${max !== min ? `<line x1="${padL}" y1="${y(min)}" x2="${w - padR}" y2="${y(min)}" stroke="var(--border)" stroke-dasharray="3 4"/>` : ''}
    <text x="${padL - 6}" y="${y(max) + 3.5}" text-anchor="end" class="chart-label">${fmtV(max)}</text>
    ${max !== min ? `<text x="${padL - 6}" y="${y(min) + 3.5}" text-anchor="end" class="chart-label">${fmtV(min)}</text>` : ''}
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="3" fill="var(--accent)"/>`).join('')}
    <text x="${padL}" y="${h - 4}" class="chart-label">${fmtD(points[0].d)}</text>
    <text x="${w - padR}" y="${h - 4}" text-anchor="end" class="chart-label">${fmtD(points[points.length - 1].d)}</text>
  </svg>`;
}
/* weekly totals for the last N weeks (Monday-based) */
function weeklyStats(weeks = 8) {
  const thisMon = new Date(); thisMon.setHours(0, 0, 0, 0);
  thisMon.setDate(thisMon.getDate() - ((thisMon.getDay() + 6) % 7));
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(thisMon); start.setDate(start.getDate() - i * 7);
    out.push({ start, sessions: 0, sets: 0, volume: 0 });
  }
  for (const s of sessions) {
    const t = new Date(s.date);
    for (const wk of out) {
      if (t >= wk.start && t < new Date(wk.start.getTime() + 7 * 864e5)) {
        wk.sessions++;
        for (const e of s.exercises) {
          wk.sets += e.sets.length;
          // Height sets have no kg × reps to contribute; they still count as sets.
          if (e.metric === 'height') continue;
          for (const st of e.sets) wk.volume += (st.weight || 0) * (st.reps || 0);
        }
      }
    }
  }
  return out;
}
function weeklyBarsSvg(stats, w = 320, h = 96) {
  const maxSets = Math.max(1, ...stats.map(s => s.sets));
  const padL = 6, padR = 6, top = 14, bottom = 18;
  const plotH = h - top - bottom;
  const bw = (w - padL - padR) / stats.length;
  const label = d => d.getDate() + '.' + (d.getMonth() + 1) + '.';
  return `<svg class="spark" width="100%" viewBox="0 0 ${w} ${h}">
    ${stats.map((s, i) => {
      const bh = (s.sets / maxSets) * plotH;
      const x = padL + i * bw + bw * 0.18, width = bw * 0.64;
      const y = top + plotH - bh;
      return `
        ${s.sets ? `<rect x="${x}" y="${y}" width="${width}" height="${Math.max(bh, 2)}" rx="3" fill="${i === stats.length - 1 ? 'var(--accent)' : 'var(--accent2)'}"/>
        <text x="${x + width / 2}" y="${y - 4}" text-anchor="middle" class="chart-label">${s.sets}</text>` : ''}
        <text x="${x + width / 2}" y="${h - 4}" text-anchor="middle" class="chart-label">${label(s.start)}</text>`;
    }).join('')}
  </svg>`;
}
function viewHistory() {
  const exNames = [...new Set(sessions.flatMap(s => s.exercises.map(e => canonicalName(e.name))))].sort();
  if (historyExercise && !exNames.includes(historyExercise)) historyExercise = '';
  const sel = historyExercise || exNames[0] || '';
  const hist = sel ? exerciseHistory(sel) : [];
  const histJump = hist.length ? hist[hist.length - 1].jump : false;
  // A metric switch mid-history (e.g. load -> height) leaves older rows shaped
  // for the other metric — mixing them into one chart/list produces NaN and
  // "undefined" values, so only rows matching the newest row's metric are shown.
  const histRows = hist.filter(r => r.jump === histJump);
  const prBest = histRows.length ? Math.max(...histRows.map(r => histJump ? r.heightCm : r.e1rm)) : 0;
  const bwLast = bodyWeight[bodyWeight.length - 1];
  const weeks = sessions.length ? weeklyStats(8) : [];
  const thisWeek = weeks[weeks.length - 1];
  return `
    ${sessions.length ? `
    <h2 class="section">Weekly training</h2>
    <div class="card">
      ${weeklyBarsSvg(weeks)}
      <div class="muted small mt8">This week: <b class="green">${thisWeek.sessions} session${thisWeek.sessions === 1 ? '' : 's'}</b> · ${thisWeek.sets} sets · ${Math.round(thisWeek.volume).toLocaleString()} ${unit()} lifted</div>
    </div>` : ''}

    <h2 class="section">Body weight</h2>
    <div class="card">
      <div class="row">
        <input id="bw-input" type="number" inputmode="decimal" step="0.1" placeholder="${bwLast ? bwLast.weight : 'e.g. 80'}" style="max-width:130px">
        <span class="muted">${unit()}</span>
        <button class="primary grow" data-action="bw-add">Log today</button>
      </div>
      ${bodyWeight.length ? `
        ${chartSvg(bodyWeight.slice(-15).map(b => ({ v: b.weight, d: b.date })))}
        <div class="muted small mt8">Latest: <b class="green">${bwLast.weight} ${unit()}</b> on ${fmtDate(bwLast.date)} · ${bodyWeight.length} entries
          <button class="ghost icon-btn small" data-action="bw-undo" style="float:right">undo last</button></div>` : ''}
    </div>

    <h2 class="section">Exercise progress</h2>
    <div class="card">
      ${exNames.length ? `
        <select data-bind="history-ex">${exNames.map(n => `<option ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        ${histRows.length ? `
          ${chartSvg(histRows.slice(-12).map(r => ({ v: histJump ? r.heightCm : r.e1rm, d: r.date })))}
          <div class="muted small mt8">${histJump ? `Best jump: <b class="amber">${prBest} cm</b>` : `Best est. 1RM: <b class="amber">${prBest} ${unit()}</b>`}</div>
          ${hist.length > histRows.length ? `<div class="muted small mt8">${hist.length - histRows.length} earlier session${hist.length - histRows.length === 1 ? '' : 's'} logged this exercise with a different metric and ${hist.length - histRows.length === 1 ? 'is' : 'are'} not shown.</div>` : ''}
          <div class="divider"></div>
          ${histRows.slice(-8).reverse().map(r => `
            <div class="row between" style="padding:5px 0">
              <span class="muted small">${fmtDate(r.date)}</span>
              <span class="small">${histJump ? r.sets.map(s => `${s.heightCm}cm`).join(' · ') : r.sets.map(s => `${s.weight}×${s.reps}`).join(' · ')}</span>
              <span class="small bold ${(histJump ? r.heightCm : r.e1rm) >= prBest ? 'amber' : ''}">${(histJump ? r.heightCm : r.e1rm) >= prBest ? '🏆 ' : ''}${histJump ? `${r.heightCm} cm` : `e1RM ${r.e1rm}`}</span>
            </div>`).join('')}` : '<p class="muted mt8">No logged sets for this exercise yet.</p>'}
        ${exNames.length > 1 || Object.keys(aliases).length ? `<button class="ghost wide mt8 small" data-action="merge-names" data-name="${esc(sel)}">Merge names…</button>` : ''}`
      : '<p class="empty"><span class="big">📈</span>Finish your first workout and your progress will show up here.</p>'}
    </div>

    <h2 class="section">Sessions (${sessions.length})</h2>
    ${sessions.length ? sessions.slice().reverse().map(s => {
      const open = expandedSession === s.id;
      const setCount = s.exercises.reduce((n, e) => n + e.sets.length, 0);
      return `
      <div class="card">
        <div class="row between tappable" data-action="session-toggle" data-id="${s.id}">
          <div class="grow">
            <div class="bold">${esc(s.dayName)}</div>
            <div class="muted small">${fmtDate(s.date)} · ${fmtDur(s.durationMin)} · ${setCount} sets</div>
          </div>
          <span class="chev">${icon(open ? 'chevDown' : 'chevRight', 16)}</span>
        </div>
        ${open ? `
          <div class="divider"></div>
          ${s.exercises.map(e => `
            <div style="padding:5px 0">
              <div class="bold small">${esc(e.name)}${e.swappedFrom ? ` <span class="swap-note">(was ${esc(e.swappedFrom)})</span>` : ''}</div>
              <div class="muted small">${e.metric === 'height'
                ? e.sets.map(x => `${x.heightCm} cm`).join(' · ')
                : e.sets.map(x => `${x.weight}${unit()}×${x.reps}${x.rpe ? '@' + x.rpe : ''}`).join(' · ')}</div>
              ${e.notes ? `<div class="small amber">📝 ${esc(e.notes)}</div>` : ''}
            </div>`).join('')}
          ${s.notes ? `<div class="divider"></div><div class="small">📝 ${esc(s.notes)}</div>` : ''}
          <button class="ghost icon-btn red mt8" data-action="session-delete" data-id="${s.id}">Delete session</button>` : ''}
      </div>`;
    }).join('') : '<p class="empty"><span class="big">🗓️</span>No sessions yet.</p>'}`;
}

/* ---- merge exercise names (aliases) ---- */
function mergeNamesModal(selName) {
  const sel = canonicalName(selName);
  const others = [...new Set(sessions.flatMap(s => s.exercises.map(e => canonicalName(e.name))))]
    .filter(n => n.toLowerCase() !== sel.toLowerCase()).sort();
  const currentAliases = Object.keys(aliases).filter(k => aliases[k].toLowerCase() === sel.toLowerCase()).sort();
  showModal('Merge into "' + sel + '"', `
    <p class="small muted">Tick names that are really the same exercise as <b>${esc(sel)}</b> (typos, abbreviations). Their history shows up under this name — the original logs are untouched.</p>
    ${others.length ? others.map(n => `
      <label class="merge-row"><input type="checkbox" class="merge-cb" value="${esc(n)}"><span>${esc(n)}</span></label>`).join('')
      : '<p class="muted small mt8">No other exercise names in your history.</p>'}
    ${currentAliases.length ? `<div class="divider"></div><p class="small muted">Already merged into this name:</p>
      ${currentAliases.map(k => `<div class="row between mt8"><span class="small">${esc(k)}</span><button class="ghost icon-btn red" data-action="unmerge-alias" data-k="${esc(k)}" data-name="${esc(sel)}">Remove</button></div>`).join('')}` : ''}`,
    [
      { label: 'Merge', cls: 'primary', fn: () => {
          const checked = [...document.querySelectorAll('.merge-cb:checked')].map(c => c.value);
          if (!checked.length) { closeModal(); return; }
          for (const n of checked) {
            aliases[n.toLowerCase()] = sel;
            // repoint anything that already aliased to the merged name
            for (const k of Object.keys(aliases)) if (aliases[k].toLowerCase() === n.toLowerCase()) aliases[k] = sel;
          }
          historyExercise = sel;
          saveAliases(); closeModal(); render();
          toast('Merged under ' + sel + ' ✓');
        } },
      { label: 'Cancel' }
    ]);
}

/* ---- AI coach tab ---- */
function viewCoach() {
  return `
    <h2 class="section">Share with AI</h2>
    <div class="card">
      <button class="primary wide" data-action="share-ai">${icon('link', 18)} Share with AI</button>
      <p class="small muted mt8">Copies a link you can paste into Claude, ChatGPT, or Gemini. The AI fetches your latest training data automatically — ask it to review your training or write your next plan.</p>
      <div id="sync-status" class="mt8">${syncStatusHtml()}</div>
    </div>

    <h2 class="section">Or copy your data directly</h2>
    <div class="card">
      <p class="small muted">Copies a coaching prompt + your last 15 sessions, body weight and current plan. Paste it into any AI chat.</p>
      <button class="wide mt12" data-action="copy-coach">${icon('copy', 18)} Copy coaching prompt + data</button>
      <button class="ghost wide mt8" data-action="copy-data">Copy raw data only</button>
    </div>

    <h2 class="section">Import a plan</h2>
    <div class="card">
      <p class="small muted">Paste the <code class="inline">workout-plan</code> JSON code block your AI coach gives you. It replaces your current plan (history is kept).</p>
      <textarea id="import-area" class="mt8" placeholder='{"type":"workout-plan", "days":[...]}'></textarea>
      <button class="primary wide mt8" data-action="import-plan">Import plan</button>
    </div>`;
}

/* ---- settings view (reached via the topbar gear, not a tab) ---- */
function viewSettings() {
  return `
    <div class="row settings-head">
      <button class="icon-btn ghost" data-action="settings-back" aria-label="Back">${icon('back', 22)}</button>
      <h2 class="settings-title">Settings</h2>
    </div>

    <h2 class="section">Preferences</h2>
    <div class="card">
      <div class="row between" style="padding:6px 0">
        <span>Weight unit</span>
        <select data-bind="set-unit" style="max-width:110px"><option ${unit() === 'kg' ? 'selected' : ''}>kg</option><option ${unit() === 'lb' ? 'selected' : ''}>lb</option></select>
      </div>
      <div class="row between" style="padding:6px 0">
        <span>Rest-timer sound</span>
        <button class="icon-btn ${settings.sound ? 'success' : ''}" data-action="toggle-sound">${settings.sound ? 'On' : 'Off'}</button>
      </div>
      <div class="row between" style="padding:6px 0">
        <span>Vibration</span>
        ${navigator.vibrate
          ? `<button class="icon-btn ${settings.vibrate ? 'success' : ''}" data-action="toggle-vibrate">${settings.vibrate ? 'On' : 'Off'}</button>`
          : `<span class="muted small">Not supported on this device</span>`}
      </div>
      <button class="ghost wide mt8" data-action="test-sound">🔊 Test the rest-timer sound</button>
    </div>

    <h2 class="section">Cloud sync</h2>
    <div class="card">
      <div class="row between">
        <span class="bold">Auto-sync</span>
        <button class="icon-btn ${settings.autoSync ? 'success' : ''}" data-action="toggle-autosync">${settings.autoSync ? 'On' : 'Off'}</button>
      </div>
      <div id="sync-status" class="mt8">${syncStatusHtml()}</div>
      <p class="small muted mt8">Syncs automatically after every workout — no setup needed.</p>
      <div class="divider"></div>
      <p class="small muted"><b>Your backup code</b></p>
      <code class="inline" style="word-break:break-all;display:block;margin-top:6px;user-select:all">${esc(gymUUID)}</code>
      <button class="ghost wide mt8" data-action="copy-uuid">Copy backup code</button>
      <p class="small muted mt8">Save this somewhere safe. If you lose your phone or clear the app, paste it into Restore below to recover all your data on a new device.</p>
      <div class="divider"></div>
      <p class="small muted"><b>Restore from backup code</b></p>
      <input id="restore-uuid-input" class="mt8" placeholder="Paste your backup code or full share URL" style="width:100%;box-sizing:border-box">
      <button class="ghost wide mt8" data-action="restore-uuid">Restore</button>
    </div>

    <h2 class="section">Backup</h2>
    <div class="card">
      <div class="row">
        <button class="grow" data-action="backup-copy">Copy full backup</button>
        <button class="grow" data-action="backup-restore">Restore backup</button>
      </div>
      <button class="ghost wide danger mt8" data-action="reset-all">Reset everything</button>
    </div>

    <h2 class="section">App version</h2>
    <div class="card">
      <button class="ghost wide" data-action="check-updates">Check for updates</button>
      <p class="small muted mt8">Updates normally appear as a banner at the top. Use this if the banner never shows.</p>
    </div>
    <p class="muted small" style="text-align:center">GymTrack v1 · data lives on this device${settings.autoSync ? ' + auto-synced to cloud' : ''}</p>`;
}

/* ================= modals for plan editing ================= */
function exMenuModal(dayId, i) {
  const day = plan.days.find(d => d.id === dayId); if (!day) return;
  const e = day.exercises[i];
  const desc = e.description || lookupExplanation(e.name);
  showModal(e.name, `
    <p class="muted small">${e.sets}×${esc(e.reps)} @ ${e.weight}${unit()}${e.targetRpe ? ' · RPE ' + e.targetRpe : ''} · rest ${fmtClock(e.restSeconds)}</p>
    ${desc ? `<p class="small mt8">${esc(desc)}</p>` : ''}
    ${e.alternates.length ? `<div class="divider"></div><p class="small muted">Alternates: ${e.alternates.map(a => esc(a.name)).join(', ')}</p>` : ''}`,
    [
      { label: 'Edit', cls: 'primary', fn: () => exEditModal(dayId, i) },
      ...(e.alternates.length ? [{ label: 'Swap', fn: () => exSwapPlanModal(dayId, i) }] : []),
      { label: 'Remove', cls: 'danger', fn: () => { day.exercises.splice(i, 1); savePlan(); closeModal(); render(); } },
      { label: 'Close' }
    ]);
}
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
function exEditModal(dayId, i) {
  const day = plan.days.find(d => d.id === dayId);
  const e = i != null ? day.exercises[i] : { name: '', sets: 3, reps: '8-12', weight: 0, targetRpe: 8, restSeconds: 120, restSecondsNext: null, equipment: 'barbell', barWeight: null, metric: 'load', superset: null, description: '', alternates: [] };
  const equipment = e.equipment || 'barbell';
  showModal(i != null ? 'Edit exercise' : 'Add exercise', `
    <label class="field"><span>Name</span><input id="f-name" value="${esc(e.name)}"></label>
    <div class="row">
      <label class="field grow"><span>Sets</span><input id="f-sets" type="number" inputmode="numeric" value="${e.sets}"></label>
      <label class="field grow"><span>Reps</span><input id="f-reps" value="${esc(e.reps)}"></label>
    </div>
    <div class="row">
      <label class="field grow"><span>Weight (${unit()})</span><input id="f-weight" type="number" inputmode="decimal" step="0.5" value="${e.weight}">
        <span class="field-hint" id="f-weight-hint">${esc(ladderHint(equipment))}</span></label>
      <label class="field grow"><span>Target RPE</span><button type="button" id="f-rpe" class="rpe-btn" data-action="edit-rpe-pick" data-v="${e.targetRpe != null ? e.targetRpe : ''}">${e.targetRpe != null ? e.targetRpe : '—'}</button></label>
    </div>
    <div class="row">
      <label class="field grow"><span>Rest between sets (sec)</span><input id="f-rest" type="number" inputmode="numeric" value="${e.restSeconds}"></label>
      <label class="field grow"><span>Rest before next movement (sec, optional)</span><input id="f-rest-next" type="number" inputmode="numeric" placeholder="same as above" value="${e.restSecondsNext != null ? e.restSecondsNext : ''}"></label>
    </div>
    <label class="field"><span>Equipment</span>
      <select id="f-equipment" data-bind="edit-equipment">${EQUIPMENT_TYPES.map(t => `<option value="${t}" ${t === equipment ? 'selected' : ''}>${EQUIPMENT_LABELS[t]}</option>`).join('')}</select>
    </label>
    <label class="field${BAR_WEIGHT_EQUIPMENT.has(equipment) ? '' : ' hidden'}" id="f-barweight-row"><span>Bar weight (${unit()})</span><input id="f-barweight" type="number" inputmode="decimal" step="0.5" placeholder="default ${resolvedBarWeight({ equipment, barWeight: null })}" value="${e.barWeight != null ? e.barWeight : ''}"></label>
    <label class="field"><span>What the sets measure</span>
      <select id="f-metric">
        <option value="load" ${e.metric !== 'height' ? 'selected' : ''}>Weight × reps (normal lift)</option>
        <option value="height" ${e.metric === 'height' ? 'selected' : ''}>Jump height in cm (one attempt per set)</option>
      </select>
    </label>
    <label class="field"><span>Superset group</span>
      <select id="f-superset">
        <option value="" ${!e.superset ? 'selected' : ''}>None</option>
        ${['A', 'B', 'C', 'D'].map(t => `<option value="${t}" ${e.superset === t ? 'selected' : ''}>${t}</option>`).join('')}
        ${e.superset && !['A', 'B', 'C', 'D'].includes(e.superset) ? `<option value="${esc(e.superset)}" selected>${esc(e.superset)}</option>` : ''}
      </select>
      <span class="field-hint">Members must sit next to each other in the day — use the ↑↓ buttons on the day list.</span>
    </label>
    <label class="field"><span>How-to / description (optional)</span><textarea id="f-desc" style="min-height:60px">${esc(e.description)}</textarea></label>`,
    [
      { label: 'Save', cls: 'primary', fn: () => {
          const name = mval('f-name'); if (!name) { toast('Name is required', 'err'); return; }
          const rpeRaw = document.getElementById('f-rpe').dataset.v;
          const restNextRaw = mval('f-rest-next');
          const barWeightRaw = mval('f-barweight');
          const eqVal = document.getElementById('f-equipment').value;
          const metricVal = document.getElementById('f-metric').value;
          const barVal = barWeightRaw ? parseFloat(barWeightRaw) : null;
          const wVal = mnum('f-weight');
          const barResolved = barVal != null ? barVal : resolvedBarWeight({ equipment: eqVal, barWeight: null });
          if (metricVal === 'height' && wVal) {
            toast('A jump-height exercise carries no weight — set it to 0 (box height goes in the description)', 'err');
            return;
          }
          if (metricVal !== 'height' && unit() === 'kg') {
            const kind = weightIssueKind(eqVal, barResolved, wVal);
            if (kind === 'bodyweight') {
              toast(`${wVal}${unit()} — bodyweight exercises must be 0${unit()}`, 'err');
              return;
            } else if (kind === 'below-bar') {
              toast(`${wVal}${unit()} is below the empty ${EQUIPMENT_LABELS[eqVal].toLowerCase()} (${barResolved}${unit()}) — is the Equipment field above set wrong? A dumbbell/cable/machine move this light usually isn't a barbell`, 'err');
              return;
            } else if (kind === 'off-ladder') {
              const n = nearestRungs(eqVal, barResolved, wVal);
              toast(`${wVal}${unit()} is not loadable on a ${EQUIPMENT_LABELS[eqVal].toLowerCase()} — try ${n.lo} or ${n.hi}`, 'err');
              return;
            }
          }
          const upd = { name, sets: Math.max(1, mnum('f-sets', 3)), reps: mval('f-reps') || '8-12', weight: wVal,
            targetRpe: rpeRaw ? parseFloat(rpeRaw) : null, restSeconds: Math.max(0, mnum('f-rest', 120)),
            restSecondsNext: restNextRaw ? Math.max(0, parseInt(restNextRaw, 10)) : null,
            equipment: eqVal,
            barWeight: barVal,
            metric: metricVal,
            superset: document.getElementById('f-superset').value || null,
            description: mval('f-desc') };
          if (i != null) Object.assign(day.exercises[i], upd);
          else day.exercises.push(Object.assign({ id: uid(), notes: '', alternates: [] }, upd));
          savePlan(); closeModal(); render();
        } },
      { label: 'Cancel' }
    ]);
}
function exSwapPlanModal(dayId, i) {
  const day = plan.days.find(d => d.id === dayId);
  const e = day.exercises[i];
  showModal('Swap ' + e.name, e.alternates.map((a, ai) => `
    <button class="wide mt8" data-action="plan-swap-pick" data-day="${dayId}" data-i="${i}" data-ai="${ai}">
      ${esc(a.name)}${a.weight ? ` · ${a.weight}${unit()}` : ''} ${equipChip({ equipment: a.equipment || e.equipment, barWeight: a.equipment ? a.barWeight : e.barWeight })}</button>`).join(''),
    [{ label: 'Cancel' }]);
}
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

/* ================= session modals ================= */
function sessionSwapModal(ei) {
  const e = active.exercises[ei];
  const alts = e.alternates || [];
  showModal('Swap ' + e.name, `
    ${alts.length ? alts.map((a, ai) => `
      <button class="wide mt8" data-action="session-swap-pick" data-ei="${ei}" data-ai="${ai}">
        ${esc(a.name)}${a.weight ? ` · ${a.weight}${unit()}` : ''} ${equipChip({ equipment: a.equipment || e.equipment, barWeight: a.equipment ? a.barWeight : e.barWeight })}</button>`).join('') : '<p class="muted small">No alternates in the plan for this one.</p>'}
    <div class="divider"></div>
    <label class="field"><span>…or type any exercise</span><input id="swap-custom" placeholder="e.g. Machine Chest Press"></label>
    <label class="field"><span>Equipment for the typed exercise</span>
      <select id="swap-custom-equip">${EQUIPMENT_TYPES.map(t => `<option value="${t}" ${t === (e.equipment || 'barbell') ? 'selected' : ''}>${EQUIPMENT_LABELS[t]}</option>`).join('')}</select>
    </label>`,
    [
      { label: 'Use typed exercise', cls: 'primary', fn: () => {
          const name = mval('swap-custom'); if (!name) { toast('Type a name first', 'err'); return; }
          const eq = document.getElementById('swap-custom-equip').value;
          doSessionSwap(ei, { name, weight: e.sets[0] ? e.sets[0].weight : e.plannedWeight,
            description: '', equipment: eq, barWeight: eq === e.equipment ? e.barWeight : null });
        } },
      { label: 'Cancel' }
    ]);
}
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
function exInfoModal(ei) {
  const e = active.exercises[ei];
  const desc = e.description || lookupExplanation(e.name) || 'No description available — ask your AI coach to include a "description" for each exercise in your next plan.';
  // A jump has no load or rep target — every other jump surface already branches
  // on the metric, so building this line unconditionally read "Target: 3×1 @ 0kg".
  const target = isJump(e)
    ? `${e.plannedSets} attempt${e.plannedSets === 1 ? '' : 's'}`
    : `${e.plannedSets}×${esc(e.plannedReps)} @ ${e.plannedWeight}${unit()}${e.targetRpe ? ' · RPE ' + e.targetRpe : ''}`;
  showModal(e.name, `<p>${esc(desc)}</p>
    <p class="muted small mt12">Target: ${target}</p>`);
}
function showPlateCalculator(e) {
  const isLb = unit() === 'lb';
  const plates = isLb ? [45, 35, 25, 10, 5, 2.5] : [25, 20, 15, 10, 5, 2.5, 1.25];
  const weight = e.plannedWeight || 0;
  const equipment = e.equipment || 'barbell';
  const isLandmine = equipment === 'landmine';
  const barWeight = isLandmine ? 0 : resolvedBarWeight(e);
  const sides = isLandmine ? 1 : 2;
  if (!isLandmine && weight <= barWeight) {
    showModal('Plate calculator', `<p class="muted">Target ${weight}${unit()} is at or below the bar (${barWeight}${unit()}) — no plates needed.</p>`);
    return;
  }
  let remain = (weight - barWeight) / sides;
  const rows = [];
  for (const p of plates) {
    const count = Math.floor(remain / p + 1e-9);
    if (count > 0) { rows.push({ p, count }); remain -= count * p; }
  }
  const sideLabel = isLandmine ? 'on the end' : 'per side';
  const summary = isLandmine
    ? `Target ${weight}${unit()} to load on the landmine end`
    : `Target ${weight}${unit()} · bar ${barWeight}${unit()} · ${((weight - barWeight) / sides).toFixed(2)}${unit()} per side`;
  showModal('Plate calculator', `
    <p class="muted small">${summary}</p>
    <div class="divider"></div>
    ${rows.length ? rows.map(r => `<div class="row between mt8"><span class="bold">${r.p}${unit()}</span><span>× ${r.count} ${sideLabel}</span></div>`).join('') : '<p class="muted small">Just the bar.</p>'}
    ${remain > 0.01 ? `<p class="muted small mt12">${remain.toFixed(2)}${unit()} ${sideLabel} can't be made with these plates.</p>` : ''}`);
}
function exNoteModal(ei) {
  const e = active.exercises[ei];
  showModal('Note — ' + e.name, `<textarea id="ex-note-area" placeholder="e.g. felt heavy, slight knee pain, used safety bar…">${esc(e.notes)}</textarea>`,
    [
      { label: 'Save', cls: 'primary', fn: () => { e.notes = mval('ex-note-area'); saveActive(); closeModal(); render(); } },
      { label: 'Cancel' }
    ]);
}

/* ================= RPE picker ================= */
// Renders into #picker-root (its own overlay layer) so it can open on top of
// a sheet modal (e.g. the plan's exercise-edit modal) without replacing it.
const RPE_SCALE = [
  [10, 'Max effort — nothing left'],
  [9.5, 'Maybe half a rep left'],
  [9, 'Could have done 1 more rep'],
  [8.5, '1–2 reps left'],
  [8, '2 reps left'],
  [7.5, '2–3 reps left'],
  [7, '3 reps left — bar still fast'],
  [6.5, '3–4 reps left'],
  [6, '4+ reps left / warm-up']
];
let rpePickCb = null;
function showRpePicker(current, onPick, title = 'How hard was that set?') {
  rpePickCb = onPick;
  document.getElementById('picker-root').innerHTML = `
    <div class="overlay" data-action="picker-dismiss">
      <div class="sheet">
        <h3>${esc(title)}</h3>
        <div class="modal-body">
          ${RPE_SCALE.map(([v, txt]) => `
            <button class="rpe-opt ${current === v ? 'active' : ''}" data-action="rpe-opt" data-v="${v}">
              <span class="rpe-val">${v}</span><span class="muted small">${txt}</span></button>`).join('')}
          <button class="rpe-opt" data-action="rpe-opt" data-v=""><span class="rpe-val muted">—</span><span class="muted small">Clear / skip</span></button>
        </div>
      </div>
    </div>`;
}
function closeRpePicker() { document.getElementById('picker-root').innerHTML = ''; rpePickCb = null; }

/* ================= weight/reps stepper bar ================= */
// Accessory bar shown while a set weight/reps input is focused: ±2.5 kg/lb or
// ±1 rep without retyping. Positioned above the keyboard via visualViewport.
let stepperTarget = null;
let stepperHideTimer = null;
/*
 * What the stepper bar should do for the focused input. Weight steps follow the
 * gym's ladder, so the two buttons are often asymmetric (at a 10 kg dumbbell it
 * is −1 / +2). Returns null when the field should get no stepper at all.
 */
function stepperInfo(el) {
  if (!el || !el.dataset || el.dataset.bind !== 'set') return null;
  const f = el.dataset.f;
  if (f === 'reps') return { kind: 'reps', label: 'reps', down: 1, up: 1 };
  if (f === 'heightCm') return { kind: 'height', label: 'cm', down: 0.5, up: 0.5 };
  if (f !== 'weight') return null;
  const ex = active && active.exercises[+el.dataset.ei];
  if (!ex || ex.equipment === 'bodyweight') return null;   // nothing to load
  if (unit() !== 'kg') return { kind: 'weight', label: unit(), down: 2.5, up: 2.5 };
  const cur = parseFloat(el.value) || 0;
  const bar = resolvedBarWeight(ex);
  // Clamp both directions to >= 0. When `cur` sits below the ladder base (e.g. an
  // undeclared-equipment exercise still carrying the 'barbell' default and its
  // 20kg bar), nextWeight(dir=-1) floors at the bar — a value ABOVE `cur` — which
  // would otherwise produce a negative down-step whose label lies and whose button
  // moves the weight the wrong way when pressed.
  return {
    kind: 'weight', label: unit(),
    down: Math.max(0, ladderRound(cur - nextWeight(ex.equipment, bar, cur, -1))),
    up: Math.max(0, ladderRound(nextWeight(ex.equipment, bar, cur, 1) - cur))
  };
}
function positionStepper() {
  if (!stepperTarget) return;
  const bar = document.getElementById('stepper-bar');
  const vv = window.visualViewport;
  const keyboard = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  bar.style.bottom = Math.max(keyboard + 8, 74) + 'px';
}
function showStepper(el) {
  const info = stepperInfo(el);
  if (!info) return;
  clearTimeout(stepperHideTimer);
  stepperTarget = el;
  const bar = document.getElementById('stepper-bar');
  bar.innerHTML = `
    <button data-step="-1" ${info.down === 0 ? 'disabled' : ''}>−${info.down}</button>
    <span class="muted small">${info.label}</span>
    <button data-step="1">+${info.up}</button>`;
  bar.classList.remove('hidden');
  positionStepper();
}
function hideStepper() {
  stepperTarget = null;
  document.getElementById('stepper-bar').classList.add('hidden');
}
document.addEventListener('focusin', e => showStepper(e.target));
document.addEventListener('focusout', e => {
  if (e.target === stepperTarget) stepperHideTimer = setTimeout(hideStepper, 150);
});
document.getElementById('stepper-bar').addEventListener('pointerdown', e => {
  const btn = e.target.closest('[data-step]');
  if (!btn || !stepperTarget || btn.disabled) return;
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
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', positionStepper);
  window.visualViewport.addEventListener('scroll', positionStepper);
}

/* ================= CMJ video measurement ================= */
// Lives outside the render cycle like `rest` — mutated directly, with
// targeted DOM writes, rather than routed through the app's render().
let cmjState = null; // { objectUrl, video, fps, detectedFps, seeking, lastMediaTime, takeoffTime, landingTime, attempts, pollTimer }

function cmjVideoModal(targetEi) {
  cmjState = { objectUrl: null, video: null, fps: 30, slowFactor: settings.cmjSlowFactor || 1, captureFps: settings.cmjCaptureFps || 240, seeking: false, lastMediaTime: 0, takeoffTime: null, landingTime: null, attempts: [], pollTimer: null, targetEi: targetEi != null ? targetEi : null };
  showModal('Measure CMJ via video', `
    <input type="file" id="cmj-file-input" accept="video/*">
    <details class="cmj-tips mt8">
      <summary class="small muted">How to record for accurate results</summary>
      <p class="small muted mt8">Frame rate <em>is</em> your accuracy. At a ~500&nbsp;ms flight time one frame is worth ~5&nbsp;cm at 24&nbsp;fps but only ~0.5&nbsp;cm at 240&nbsp;fps.</p>
      <ul class="small muted mt8">
        <li><b>Don't use “Take Video” here.</b> The camera iOS opens from a web page only does standard video — Slo-Mo isn't offered. It will give you 24–30 fps and a useless number.</li>
        <li><b>Record in the Camera app first</b>, in <b>Slo-Mo</b> (1080p/240 fps via Settings › Camera › Record Slo-mo), then come back and choose <b>Photo Library</b>.</li>
        <li><b>Keep the clip short — 3–4 seconds.</b> Start recording, jump, stop. iPhone only slows a <em>region</em> of a long clip, leaving the rest at normal speed, and a mixed-rate file makes every timing wrong.</li>
        <li><b>Set “Filmed at” to your Camera setting</b> (240 fps) and the <b>slow-motion factor</b> to match the clip — iPhone renders 240 fps Slo-Mo onto a 60 fps timeline, so that's <b>4×</b>. Check the “→ Xs real” line matches how long you actually filmed; if not, change the factor.</li>
        <li>Film side-on, whole body in frame, feet clearly visible, phone steady.</li>
      </ul>
    </details>
    <div id="cmj-fps-row" class="hidden mt8">
      <span class="small muted">Filmed at (your Camera app setting)</span>
      <div class="cmj-fps-group cmj-capture-group mt8">
        ${CAPTURE_RATES.map(f => `<button type="button" data-capture="${f}" class="ghost icon-btn">${f} fps</button>`).join('')}
      </div>
      <span class="small muted mt12" style="display:block">Slow motion in the clip</span>
      <div class="cmj-fps-group cmj-slow-group mt8">
        ${SLOW_FACTORS.map(f => `<button type="button" data-slow="${f}" class="ghost icon-btn">${f === 1 ? 'Normal' : f + '×'}</button>`).join('')}
      </div>
      <div id="cmj-duration-check" class="small muted mt8"></div>
      <div id="cmj-fps-detect" class="small muted mt8"></div>
    </div>
    <div id="cmj-stage" class="hidden mt12">
      <div class="cmj-video-wrap">
        <video id="cmj-video" muted playsinline webkit-playsinline preload="auto" class="cmj-video"></video>
      </div>
      <input type="range" id="cmj-scrub" min="0" max="1" step="0.001" value="0" class="mt8" style="width:100%">
      <div class="row between mt8">
        <button type="button" class="ghost icon-btn" id="cmj-step-back">◀ frame</button>
        <span id="cmj-time-readout" class="small muted">0:00.000 · frame 0</span>
        <button type="button" class="ghost icon-btn" id="cmj-step-fwd">frame ▶</button>
      </div>
      <div class="cmj-marker-row mt12">
        <button type="button" id="cmj-set-takeoff">Last frame on ground</button>
        <button type="button" id="cmj-set-landing">First frame back down</button>
      </div>
      <div id="cmj-markers" class="small muted mt8"></div>
      <div id="cmj-result" class="cmj-result hidden"></div>
      <button type="button" id="cmj-add-attempt" class="ghost wide mt8 hidden">Add attempt</button>
      <div id="cmj-attempts" class="cmj-attempts"></div>
    </div>`,
    [
      { label: 'Save best', cls: 'primary', fn: cmjAccept },
      { label: 'Cancel', fn: cmjCancel }
    ]);
  cmjInitListeners();
  const acceptBtn = document.querySelector('[data-idx="m0"]');
  if (acceptBtn) acceptBtn.disabled = true;
}

function cmjInitListeners() {
  const video = document.getElementById('cmj-video');
  cmjState.video = video;
  video.addEventListener('error', () => {
    // also fires when cmjCleanup() sets video.src = '' on close/accept — cmjState is
    // already null by then (set synchronously before this async event arrives), so
    // that case is distinguishable from a genuine load failure.
    if (!cmjState) return;
    toast('Could not load this video', 'err');
    document.getElementById('cmj-stage').classList.add('hidden');
  });
  const fileInput = document.getElementById('cmj-file-input');
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) cmjOnFileSelected(file);
  });
  document.getElementById('cmj-fps-row').addEventListener('click', e => {
    const slow = e.target.closest('[data-slow]');
    if (slow) { cmjSetSlowFactor(parseInt(slow.dataset.slow, 10), true); return; }
    const cap = e.target.closest('[data-capture]');
    if (cap) cmjSetCaptureFps(parseInt(cap.dataset.capture, 10), true);
  });
  document.getElementById('cmj-scrub').addEventListener('input', e => cmjOnScrubInput(parseFloat(e.target.value)));
  document.getElementById('cmj-step-back').addEventListener('click', () => cmjSeekBy(-1));
  document.getElementById('cmj-step-fwd').addEventListener('click', () => cmjSeekBy(1));
  document.getElementById('cmj-set-takeoff').addEventListener('click', cmjSetTakeoff);
  document.getElementById('cmj-set-landing').addEventListener('click', cmjSetLanding);
  document.getElementById('cmj-add-attempt').addEventListener('click', () => { cmjPushAttempt(); cmjUpdateResultUI(); });
  document.getElementById('cmj-attempts').addEventListener('click', e => {
    const del = e.target.closest('[data-attempt-del]');
    if (!del) return;
    cmjState.attempts.splice(parseInt(del.dataset.attemptDel, 10), 1);
    cmjUpdateResultUI();
  });
  cmjPaintRateChips(); // remembered settings must show as selected before a file loads
}

function cmjOnFileSelected(file) {
  if (cmjState.objectUrl) URL.revokeObjectURL(cmjState.objectUrl);
  // Markers reset per file, but `attempts` deliberately survives: the intended flow
  // is one clip per jump, loading a new file for each attempt in the same session.
  cmjState.takeoffTime = null; cmjState.landingTime = null;
  cmjUpdateResultUI();

  cmjState.objectUrl = URL.createObjectURL(file);
  const video = cmjState.video;
  video.src = cmjState.objectUrl;
  video.load(); // iOS: without an explicit load() a blob-src video may sit idle
  video.addEventListener('loadedmetadata', function onMeta() {
    video.removeEventListener('loadedmetadata', onMeta);
    document.getElementById('cmj-fps-row').classList.remove('hidden');
    document.getElementById('cmj-stage').classList.remove('hidden');
    const scrub = document.getElementById('cmj-scrub');
    scrub.max = String(video.duration || 1);
    cmjState.seeking = true;
    // iOS Safari does not decode ANY frames for a video that has never played:
    // the element renders black and seeks on it never complete (no 'seeked', no
    // rVFC), which would deadlock the whole modal. So run the fps-detection
    // play-through FIRST — muted+playsinline play() is allowed programmatically,
    // and it forces the decoder to start. Its restore step then seeks back to
    // the start, which now lands on a real decoded frame.
    if (!cmjAutoDetectFps()) {
      // Detection unavailable (clip too short / no counting API) — plain seek.
      // Nudge past zero: assigning currentTime = 0 when already at 0 is a no-op
      // seek that fires no events.
      video.currentTime = Math.min(video.duration || 1, 0.001);
      cmjAfterSeek(cmjDrawFrame);
    }
  }, { once: true });
}

function cmjSetFps(fps) { cmjState.fps = fps; }

// The slow-motion factor is the one thing the file cannot tell us, so it is an
// explicit choice. Persisted because a given phone's Slo-Mo setting rarely changes.
// `persist` only when the user taps a chip. Auto-application (a remembered factor, or
// forcing Normal for a raw high-fps clip) must not overwrite the stored default —
// one odd file shouldn't wipe the setting used for every Photos import.
function cmjSetSlowFactor(factor, persist) {
  cmjState.slowFactor = factor;
  if (persist) { settings.cmjSlowFactor = factor; saveSettings(); }
  cmjPaintRateChips();
  cmjRenderDurationCheck();
  cmjUpdateResultUI();
}

function cmjSetCaptureFps(fps, persist) {
  cmjState.captureFps = fps;
  if (persist) { settings.cmjCaptureFps = fps; saveSettings(); }
  cmjPaintRateChips();
  cmjRenderDurationCheck();
  cmjUpdateResultUI();
}

function cmjPaintRateChips() {
  document.querySelectorAll('[data-slow]').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.slow, 10) === (cmjState.slowFactor || 1));
  });
  document.querySelectorAll('[data-capture]').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.capture, 10) === (cmjState.captureFps || 240));
  });
}

// A wrong factor is otherwise invisible, so state the consequence in real units: the
// user knows roughly how long the action actually took, and can spot 8× vs 4× at once.
function cmjRenderDurationCheck() {
  const el = document.getElementById('cmj-duration-check');
  if (!el || !cmjState.video) return;
  const dur = cmjState.video.duration;
  if (!dur || !isFinite(dur)) { el.textContent = ''; return; }
  const factor = cmjState.slowFactor || 1;
  const eff = Math.round(cmjEffectiveFps());
  const precision = (G_MS2 * 0.5 / 4) * (0.5 / eff) * 100; // at a typical 500ms flight
  el.innerHTML = factor === 1
    ? `Clip is ${dur.toFixed(2)}s, played as filmed · <b>${eff} fps effective</b> (≈±${precision.toFixed(1)} cm)`
    : `Clip is ${dur.toFixed(2)}s in the file → <b>${(dur / factor).toFixed(2)}s real</b> at ${factor}×
       · timeline ${Math.round(cmjPlaybackFps())} fps · <b>${eff} fps effective</b> (≈±${precision.toFixed(1)} cm)
       <br><span class="muted">If that real duration doesn't match what you filmed, change the slow-motion factor.</span>`;
}

// Browsers don't expose a video file's true frame rate directly. Estimate it by
// briefly playing the clip and counting decoded frames over a short window. This
// play-through doubles as the iOS decoder primer (see cmjOnFileSelected). Falls
// back to the manual preset buttons if no counting API is available or the clip
// is too short to sample reliably.
function cmjAutoDetectFps() {
  const video = cmjState.video;
  const detectEl = document.getElementById('cmj-fps-detect');
  const startTime = video.currentTime;
  // Wider window = more frames counted = less sensitive to a noisy sample (e.g. a
  // camera's brief exposure/encoder ramp-up right at the start of a clip).
  const sampleWindow = Math.min(1, (video.duration || 0) - startTime - 0.02);
  if (sampleWindow < 0.15) return false;
  if (!cmjRvfcSupported() && !video.getVideoPlaybackQuality) return false;

  if (detectEl) detectEl.textContent = 'Detecting frame rate…';
  cmjState.seeking = true; // block stepper/scrub while we play through the sample window

  let done = false;
  const finish = detectedFps => {
    if (done) return;
    done = true;
    if (!cmjState) return; // modal closed mid-detection (e.g. the safety timeout fired late)
    const restore = () => {
      cmjState.seeking = false;
      cmjDrawFrame();
      if (detectedFps) {
        const snapped = cmjSnapFps(detectedFps);
        cmjState.detectedFps = snapped;
        cmjSetFps(snapped);
        // Advisory only. The decoder drops frames on 1080p HEVC, so a measured rate
        // well BELOW the derived timeline is expected and not worth alarming about;
        // a rate well above it means the settings above are genuinely wrong.
        if (detectEl) {
          const derived = cmjPlaybackFps();
          detectEl.innerHTML = snapped > derived * 1.5
            ? `<span class="amber">Measured ~${snapped} fps in this clip, but the settings above imply a ${Math.round(derived)} fps timeline — check them.</span>`
            : `<span class="muted">Measured ~${snapped} fps (rough — the decoder skips frames on high-rate clips, so this is a hint, not the truth).</span>`;
        }
      } else if (detectEl) {
        detectEl.textContent = '';
      }
      cmjPaintRateChips();
      cmjRenderDurationCheck();
      cmjUpdateResultUI();
    };
    video.pause();
    // Land a hair past zero, not at exactly startTime: if startTime was 0 a seek
    // to 0 can be treated as a no-op, and 0.001 guarantees a decoded frame now
    // that playback has primed the decoder.
    video.currentTime = Math.min(video.duration || 1, Math.max(0.001, startTime));
    cmjAfterSeek(restore);
  };
  // Safety net: if some browser combination never resolves either mechanism, don't
  // leave the stepper/scrub permanently frozen — give up after generous margin.
  setTimeout(() => finish(null), sampleWindow * 1000 + 2000);

  // Prefer getVideoPlaybackQuality: its totalVideoFrames counts DECODED frames,
  // including ones the display skips. rVFC's presentedFrames only counts frames
  // that actually hit the screen, which caps at the display refresh rate (~60Hz)
  // and would report a true 120/240fps clip as ~60. rVFC is fallback-only.
  if (video.getVideoPlaybackQuality) {
    const t0 = video.currentTime;
    const q0 = video.getVideoPlaybackQuality().totalVideoFrames;
    // setInterval rather than requestAnimationFrame: rAF is throttled/paused for a
    // backgrounded tab, and the math only depends on video.currentTime deltas, not
    // on the poll callback's own timing, so a plain timer works just as well and is
    // more robust across tab-visibility edge cases.
    const poll = setInterval(() => {
      if (!cmjState || done) { clearInterval(poll); return; }
      if (video.ended || video.currentTime - t0 >= sampleWindow) {
        clearInterval(poll);
        const q1 = video.getVideoPlaybackQuality().totalVideoFrames;
        const dtq = video.currentTime - t0;
        const frames = q1 - q0;
        finish(frames > 0 && dtq > 0 ? frames / dtq : null);
      }
    }, 50);
  } else {
    let first = null;
    const collect = (now, metadata) => {
      if (!cmjState || done) return;
      if (!first) { first = metadata; video.requestVideoFrameCallback(collect); return; }
      const dt = metadata.mediaTime - first.mediaTime;
      if (dt >= sampleWindow) {
        const frames = metadata.presentedFrames - first.presentedFrames;
        finish(frames > 0 && dt > 0 ? frames / dt : null);
      } else {
        video.requestVideoFrameCallback(collect);
      }
    };
    video.requestVideoFrameCallback(collect);
  }
  video.play().catch(() => finish(null)); // rejects e.g. in iOS Low Power Mode
  return true;
}

// Snap a noisy detected rate to the nearest common recording frame rate so a short
// sample window's counting error doesn't produce a confusing off value.
function cmjSnapFps(raw) {
  const candidates = [24, 25, 30, 50, 60, 100, 120, 200, 240];
  return candidates.reduce((best, c) => Math.abs(c - raw) < Math.abs(best - raw) ? c : best, candidates[0]);
}

function cmjRvfcSupported() { return 'requestVideoFrameCallback' in HTMLVideoElement.prototype; }

function cmjAfterSeek(cb) {
  // requestVideoFrameCallback exists (feature-detects true) on most browsers, but in
  // practice it does not reliably fire for a paused video that's just been seeked —
  // it's built for the playing case. Race it against the 'seeked' event, plus a hard
  // timeout as the last resort: iOS Safari can swallow BOTH events for a seek on
  // not-yet-decoded data, and without the timeout the `seeking` flag would stay
  // locked forever, freezing the scrub and frame-step buttons.
  const video = cmjState.video;
  let done = false;
  let timer = null;
  const finish = time => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (!cmjState) return; // modal closed while the seek was in flight
    cmjState.lastMediaTime = time;
    cmjState.seeking = false;
    cb();
  };
  timer = setTimeout(() => finish(video.currentTime), 800);
  if (cmjRvfcSupported()) {
    video.requestVideoFrameCallback((now, metadata) => finish(metadata.mediaTime));
  }
  video.addEventListener('seeked', function onSeeked() {
    video.removeEventListener('seeked', onSeeked);
    finish(video.currentTime);
  }, { once: true });
}

// Seeking to the time the video is already at is a no-op in most browsers — no
// 'seeked' event and no new frame callback ever fires, so cmjAfterSeek would hang.
// Skip the wait and draw immediately when the target time hasn't actually changed.
function cmjSeekTo(time, cb) {
  const video = cmjState.video;
  const clamped = Math.max(0, Math.min(video.duration || 0, time));
  if (Math.abs(clamped - video.currentTime) < 1e-4) {
    cmjState.lastMediaTime = video.currentTime;
    cmjState.seeking = false;
    cb();
    return;
  }
  cmjState.seeking = true;
  video.currentTime = clamped;
  cmjAfterSeek(cb);
}

function cmjSeekBy(deltaFrames) {
  if (!cmjState || !cmjState.video || cmjState.seeking) return;
  const video = cmjState.video;
  // Step by the clip's PLAYBACK rate, not the recording rate — on a slo-mo export
  // one timeline frame at ~24fps IS one captured frame, so this steps exactly one
  // source frame either way.
  cmjSeekTo(video.currentTime + deltaFrames / cmjPlaybackFps(), cmjDrawFrame);
}

function cmjOnScrubInput(value) {
  if (!cmjState || !cmjState.video || cmjState.seeking) return;
  cmjSeekTo(value, cmjDrawFrame);
}

// The video element itself is the display surface — after a seek the browser shows
// the sought frame natively. (An earlier canvas+drawImage approach was black on iOS
// Safari, which won't paint a paused, never-played video into a 2D canvas.)
function cmjDrawFrame() {
  const { video, lastMediaTime } = cmjState;
  if (!video) return;
  document.getElementById('cmj-scrub').value = String(lastMediaTime);
  document.getElementById('cmj-time-readout').textContent = `${lastMediaTime.toFixed(3)}s · frame ${Math.round(lastMediaTime * cmjPlaybackFps())}`;
}

function cmjSetTakeoff() {
  if (!cmjState) return;
  cmjState.takeoffTime = cmjState.lastMediaTime;
  cmjUpdateResultUI();
}
function cmjSetLanding() {
  if (!cmjState) return;
  cmjState.landingTime = cmjState.lastMediaTime;
  cmjUpdateResultUI();
}

// Media-time deltas are real time divided by the slow-motion factor.
function cmjTimeScale() { return 1 / (cmjState.slowFactor || 1); }

// Derived, not measured — see CAPTURE_RATES. 240fps captured and rendered at 4× is a
// 60fps timeline, so a single frame step is 1/60s and lands on a real frame boundary.
function cmjPlaybackFps() { return (cmjState.captureFps || 240) / (cmjState.slowFactor || 1); }

// Real-world frames per second, i.e. what the camera captured: the rate that sets
// timing resolution. Slowing the footage spreads those frames over a longer timeline
// but neither creates nor destroys them.
function cmjEffectiveFps() { return cmjState.captureFps || 240; }

// Flight time from the two marked frames, or null if they don't describe a jump.
// Height error scales as dh/dt = g·t/4 — at a ~500ms flight time that's 1.23 cm per
// millisecond, so a 24fps clip is worth ±5 cm per frame and a 240fps one ±0.5 cm.
function cmjCurrentResult() {
  const { takeoffTime, landingTime } = cmjState;
  if (takeoffTime == null || landingTime == null) return null;
  const effFps = cmjEffectiveFps();
  // Markers are frame-quantised. True takeoff lies half a frame AFTER the last frame
  // with feet on the ground; true landing half a frame BEFORE the first frame back in
  // contact. Subtracting one whole frame from the marked span makes the estimate
  // unbiased rather than systematically long by up to a frame.
  const flightTimeSec = (landingTime - takeoffTime) * cmjTimeScale() - 1 / effFps;
  if (!(flightTimeSec > 0)) return null;
  return {
    heightCm: computeJumpHeightCm(flightTimeSec),
    flightTimeMs: Math.round(flightTimeSec * 1000),
    effectiveFps: Math.round(effFps),
    precisionCm: (G_MS2 * flightTimeSec / 4) * (0.5 / effFps) * 100 // ±half a frame residual
  };
}

// Bank the current measurement and clear the markers, ready for the next clip. The
// video, the frame-rate setting and the attempt list all stay put.
function cmjPushAttempt() {
  const r = cmjCurrentResult();
  if (!r) return false;
  cmjState.attempts.push(r);
  cmjState.takeoffTime = null;
  cmjState.landingTime = null;
  return true;
}

function cmjRenderAttempts() {
  const el = document.getElementById('cmj-attempts');
  if (!el) return;
  const list = cmjState.attempts;
  if (!list.length) { el.innerHTML = ''; return; }
  const bestIdx = list.reduce((b, a, i) => a.heightCm > list[b].heightCm ? i : b, 0);
  el.innerHTML = `<div class="small muted mt12">Attempts</div>` + list.map((a, i) => `
    <div class="cmj-attempt${i === bestIdx ? ' best' : ''}">
      <b>${a.heightCm.toFixed(1)} cm</b>
      <span class="small muted">±${a.precisionCm.toFixed(1)} · ${a.flightTimeMs} ms · ${a.effectiveFps} fps</span>
      <button type="button" class="ghost icon-btn" data-attempt-del="${i}" aria-label="Remove attempt ${i + 1}">✕</button>
    </div>`).join('');
}

function cmjUpdateResultUI() {
  const { takeoffTime, landingTime, fps, attempts } = cmjState;
  const markersEl = document.getElementById('cmj-markers');
  const resultEl = document.getElementById('cmj-result');
  const addBtn = document.getElementById('cmj-add-attempt');
  const acceptBtn = document.querySelector('[data-idx="m0"]');
  const pf = cmjPlaybackFps();
  const fmt = t => t == null ? '—' : `${t.toFixed(3)}s (frame ${Math.round(t * pf)})`;
  markersEl.innerHTML = `Last on ground: ${fmt(takeoffTime)} &nbsp;·&nbsp; First back down: ${fmt(landingTime)}`;

  const result = cmjCurrentResult();
  cmjRenderAttempts();
  if (addBtn) addBtn.classList.toggle('hidden', !result);
  if (acceptBtn) {
    // Accepting folds in a valid unmarked-as-attempt result, so count it here too —
    // otherwise a single measured jump would look unsaveable.
    const n = attempts.length + (result ? 1 : 0);
    acceptBtn.disabled = n === 0;
    acceptBtn.textContent = n > 1 ? `Save best (${n})` : 'Save best';
  }

  if (takeoffTime == null || landingTime == null) { resultEl.classList.add('hidden'); return; }
  resultEl.classList.remove('hidden');
  if (!result) {
    resultEl.innerHTML = `<p class="small red">No flight time from those frames — the first-back-down frame must be at least two frames after the last-on-ground frame.</p>`;
    return;
  }
  const factor = cmjState.slowFactor || 1;
  const plausible = result.heightCm >= 3 && result.heightCm <= 180;
  resultEl.innerHTML = `
    <div class="big">${result.heightCm.toFixed(1)} cm</div>
    <div class="small muted">± ${result.precisionCm.toFixed(1)} cm · flight ${result.flightTimeMs} ms · ${result.effectiveFps} fps effective</div>
    <div class="small muted">−1 frame applied (half-frame midpoint correction at each end)</div>
    ${factor !== 1 ? `<div class="small muted">${cmjState.captureFps} fps filmed at ${factor}× → ${Math.round(cmjPlaybackFps())} fps timeline</div>` : ''}
    ${result.effectiveFps < 60 ? `<p class="small amber mt8">Only ±${result.precisionCm.toFixed(1)} cm at ${result.effectiveFps} fps. Record in Slo-Mo at 240 fps for ~±0.3 cm — see “How to record” at the top.</p>` : ''}
    ${plausible ? '' : '<p class="small amber mt8">That seems unusually low/high — double check your markers.</p>'}`;
}

function cmjAccept() {
  if (!cmjState) return;
  cmjPushAttempt(); // fold in a valid measurement the user never tapped "Add attempt" for
  const attempts = cmjState.attempts;
  if (!attempts.length) { cmjCancel(); return; }
  const round1 = n => Math.round(n * 10) / 10;
  const best = attempts.reduce((b, a) => a.heightCm > b.heightCm ? a : b);
  const heightCm = round1(best.heightCm);
  const list = attempts.map(a => ({
    heightCm: round1(a.heightCm),
    flightTimeMs: a.flightTimeMs,
    effectiveFps: a.effectiveFps,
    precisionCm: round1(a.precisionCm)
  }));
  const targetEi = cmjState.targetEi;
  const targetEx = targetEi != null && active ? active.exercises[targetEi] : null;
  if (targetEx && isJump(targetEx)) {
    // Fill the next empty attempt, or append one if every row is used.
    let slot = targetEx.sets.find(s => s.heightCm == null);
    if (!slot) { slot = { heightCm: null, done: false }; targetEx.sets.push(slot); }
    slot.heightCm = heightCm;
    slot.done = true;
    // Route through the same post-completion path as tapping the checkmark, so
    // this starts the rest timer and advances a superset's round-robin pointer.
    completeSet(targetEi, targetEx.sets.indexOf(slot));
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
  cmjCleanup();
  closeModal(); render();
}

function cmjCancel() {
  cmjCleanup();
  closeModal();
}

function cmjCleanup() {
  if (!cmjState) return;
  if (cmjState.objectUrl) URL.revokeObjectURL(cmjState.objectUrl);
  if (cmjState.pollTimer) clearInterval(cmjState.pollTimer);
  if (cmjState.video) { cmjState.video.pause(); cmjState.video.src = ''; }
  cmjState = null;
}

/* ================= event wiring ================= */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  unlockAudio(); // every tap keeps the iOS audio context alive

  switch (a) {
    /* navigation */
    case 'modal-dismiss': if (e.target === el) { closeModal(); if (cmjState) cmjCleanup(); } break; // only when tapping the backdrop itself
    case 'modal-btn': { const fn = modalActions[el.dataset.idx]; if (fn) fn(); else closeModal(); break; }
    case 'update-app': if (swWaiting) swWaiting.postMessage('skipWaiting'); break;
    case 'check-updates': checkForUpdates(); break;
    case 'settings-open': if (tab !== 'settings') { prevTab = tab; tab = 'settings'; render(); window.scrollTo(0, 0); } break;
    case 'settings-back': tab = prevTab; render(); window.scrollTo(0, 0); break;

    /* rest timer */
    case 'rest-add': adjustRest(15); break;
    case 'rest-sub': adjustRest(-15); break;
    case 'rest-skip': stopRest(); break;

    /* session lifecycle */
    case 'start-session': startSession(el.dataset.id); break;
    case 'confirm-finish': {
      const done = active.exercises.reduce((n, x) => n + x.sets.filter(s => s.done).length, 0);
      showModal('Finish workout?', `<p>${done} sets logged in ${fmtClock((Date.now() - active.startedAt) / 1000)}.</p>`,
        [{ label: 'Finish & save', cls: 'success', fn: finishSession }, { label: 'Keep going' }]);
      break;
    }
    case 'confirm-discard':
      showModal('Discard session?', '<p>All logged sets from this session will be lost.</p>',
        [{ label: 'Discard', cls: 'danger', fn: () => {
            // A button WITH a handler owns closing its own modal — the modal-btn
            // dispatcher only auto-closes handler-less buttons.
            endSession(); closeModal(); render(); toast('Session discarded');
          } }, { label: 'Keep going' }]);
      break;

    /* set logging */
    case 'set-done': {
      const ei = +el.dataset.ei, si = +el.dataset.si;
      const ex = active.exercises[ei], s = ex.sets[si];
      s.done = !s.done;
      if (s.done) completeSet(ei, si);
      else { saveActive(); render(); }
      break;
    }
    case 'ex-expand': exExpanded.add(el.dataset.key != null ? el.dataset.key : +el.dataset.ei); render(); break;
    case 'readiness-toggle': {
      const r = active.readiness || {};
      const hasReadiness = r.cmjCm != null || r.broadJumpCm != null || r.subjectiveEnergy != null;
      const anyDone = active.exercises.some(x => x.sets.some(y => y.done));
      const shown = readinessOpen != null ? readinessOpen : !(hasReadiness || anyDone);
      readinessOpen = !shown;
      render();
      break;
    }
    case 'rpe-pick': {
      const s = active.exercises[+el.dataset.ei].sets[+el.dataset.si];
      showRpePicker(s.rpe, v => { s.rpe = v; saveActive(); render(); });
      break;
    }
    case 'edit-rpe-pick': {
      const btn = el;
      showRpePicker(btn.dataset.v ? parseFloat(btn.dataset.v) : null,
        v => { btn.dataset.v = v != null ? v : ''; btn.textContent = v != null ? v : '—'; }, 'Target RPE');
      break;
    }
    case 'picker-dismiss': if (e.target === el) closeRpePicker(); break;
    case 'rpe-opt': {
      const v = el.dataset.v === '' ? null : parseFloat(el.dataset.v);
      const cb = rpePickCb;
      closeRpePicker();
      if (cb) cb(v);
      break;
    }
    case 'set-add': {
      const ex = active.exercises[+el.dataset.ei];
      const lastSet = ex.sets[ex.sets.length - 1];
      ex.sets.push(isJump(ex)
        ? { heightCm: null, done: false }
        : { weight: lastSet ? lastSet.weight : ex.plannedWeight, reps: lastSet ? lastSet.reps : parseRepsLow(ex.plannedReps), rpe: ex.targetRpe, done: false });
      saveActive(); render(); break;
    }
    case 'set-remove': {
      const ex = active.exercises[+el.dataset.ei];
      if (ex.sets.length > 1) { ex.sets.pop(); saveActive(); render(); }
      break;
    }
    case 'ex-info': exInfoModal(+el.dataset.ei); break;
    case 'ex-swap': sessionSwapModal(+el.dataset.ei); break;
    case 'ex-note': exNoteModal(+el.dataset.ei); break;
    case 'plate-calc': showPlateCalculator(active.exercises[+el.dataset.ei]); break;
    case 'cmj-open': cmjVideoModal(el.dataset.ei != null ? +el.dataset.ei : null); break;
    case 'session-swap-pick': {
      const ei = +el.dataset.ei;
      doSessionSwap(ei, active.exercises[ei].alternates[+el.dataset.ai]);
      break;
    }

    /* plan editing */
    case 'day-toggle': expandedDay = expandedDay === el.dataset.id ? null : el.dataset.id; render(); break;
    case 'ex-menu': exMenuModal(el.dataset.day, +el.dataset.i); break;
    case 'ex-add': exEditModal(el.dataset.day, null); break;
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
    case 'plan-swap-pick': doPlanSwap(el.dataset.day, +el.dataset.i, +el.dataset.ai); break;
    case 'plan-rename':
      showModal('Rename plan', `<label class="field"><span>Plan name</span><input id="f-plan-name" value="${esc(plan.name)}"></label>`,
        [{ label: 'Save', cls: 'primary', fn: () => { plan.name = mval('f-plan-name') || plan.name; savePlan(); closeModal(); render(); } }, { label: 'Cancel' }]);
      break;
    case 'day-add':
      showModal('Add day', `<label class="field"><span>Day name</span><input id="f-day-name" placeholder="Day D — Upper"></label>`,
        [{ label: 'Add', cls: 'primary', fn: () => {
            const name = mval('f-day-name'); if (!name) return;
            plan.days.push({ id: uid(), name, exercises: [] });
            expandedDay = plan.days[plan.days.length - 1].id;
            savePlan(); closeModal(); render();
          } }, { label: 'Cancel' }]);
      break;
    case 'day-rename': {
      const day = plan.days.find(d => d.id === el.dataset.id);
      showModal('Rename day', `<label class="field"><span>Day name</span><input id="f-day-name" value="${esc(day.name)}"></label>`,
        [{ label: 'Save', cls: 'primary', fn: () => { day.name = mval('f-day-name') || day.name; savePlan(); closeModal(); render(); } }, { label: 'Cancel' }]);
      break;
    }
    case 'day-delete': {
      const id = el.dataset.id;
      const day = plan.days.find(d => d.id === id);
      showModal('Delete ' + day.name + '?', '<p>The day and its exercises are removed from the plan. Past sessions are kept.</p>',
        [{ label: 'Delete', cls: 'danger', fn: () => { plan.days = plan.days.filter(d => d.id !== id); savePlan(); closeModal(); render(); } }, { label: 'Cancel' }]);
      break;
    }

    /* history */
    case 'session-toggle': expandedSession = expandedSession === el.dataset.id ? null : el.dataset.id; render(); break;
    case 'session-delete': {
      const id = el.dataset.id;
      showModal('Delete this session?', '<p>This permanently removes it from your history and AI exports.</p>',
        [{ label: 'Delete', cls: 'danger', fn: () => { sessions = sessions.filter(s => s.id !== id); saveSessions(); render(); } }, { label: 'Cancel' }]);
      break;
    }
    case 'bw-add': {
      const v = parseFloat(document.getElementById('bw-input').value);
      if (!v || v <= 0) { toast('Enter a weight first', 'err'); break; }
      bodyWeight = bodyWeight.filter(b => b.date !== today());
      bodyWeight.push({ date: today(), weight: v });
      saveBW(); render(); toast('Body weight logged ✓');
      break;
    }
    case 'bw-undo': bodyWeight.pop(); saveBW(); render(); break;
    case 'merge-names': mergeNamesModal(el.dataset.name); break;
    case 'unmerge-alias': {
      delete aliases[el.dataset.k];
      saveAliases(); render();
      mergeNamesModal(el.dataset.name); // reopen with the updated list
      break;
    }

    /* claude tab */
    case 'copy-coach': copyText(CLAUDE_PROMPT() + buildExport()).then(ok => toast(ok ? 'Coaching prompt copied — paste it to Claude' : 'Copy failed', ok ? 'ok' : 'err')); break;
    case 'copy-data': copyText(buildExport()).then(ok => toast(ok ? 'Data copied' : 'Copy failed', ok ? 'ok' : 'err')); break;
    case 'import-plan': {
      const raw = mval('import-area');
      if (!raw) { toast('Paste the plan JSON first', 'err'); break; }
      try {
        const cleaned = raw.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim();
        const newPlan = normalizePlan(JSON.parse(cleaned));
        showModal('Import "' + newPlan.name + '"?', `<p>${newPlan.days.length} days, ${newPlan.days.reduce((n, d) => n + d.exercises.length, 0)} exercises. Your current plan is replaced; workout history is kept.</p>`,
          [{ label: 'Import', cls: 'primary', fn: () => { plan = newPlan; savePlan(); expandedDay = null; tab = 'plan'; render(); toast('Plan imported ✓'); } }, { label: 'Cancel' }]);
      } catch (err) { toast('Invalid plan: ' + err.message, 'err'); }
      break;
    }
    case 'toggle-autosync': settings.autoSync = !settings.autoSync; saveSettings(); render(); if (settings.autoSync) workerPush({ silent: true }); break;
    case 'share-ai': copyText(workerShareUrl()).then(ok => toast(ok ? 'Link copied — paste into any AI chat' : 'Copy failed', ok ? 'ok' : 'err')); break;
    case 'copy-uuid': copyText(gymUUID).then(ok => toast(ok ? 'Backup code copied' : 'Copy failed', ok ? 'ok' : 'err')); break;
    case 'restore-uuid': restoreFromCode(mval('restore-uuid-input')); break;
    case 'toggle-sound': settings.sound = !settings.sound; saveSettings(); render(); break;
    case 'toggle-vibrate': settings.vibrate = !settings.vibrate; saveSettings(); render(); break;
    case 'test-sound': {
      beep(3); buzz();
      const st = audioState();
      toast(st === 'running' ? "That's the rest-timer cue"
        : `Audio context is "${st}" — sound may not fire. Tap anywhere and retry.`, st === 'running' ? 'ok' : 'err');
      break;
    }
    case 'backup-copy': copyText(buildBackup()).then(ok => toast(ok ? 'Backup copied — store it somewhere safe' : 'Copy failed', ok ? 'ok' : 'err')); break;
    case 'backup-restore':
      showModal('Restore backup', `<p class="muted small">Paste a backup JSON. This replaces everything on this device.</p><textarea id="restore-area" class="mt8"></textarea>`,
        [{ label: 'Restore', cls: 'danger', fn: () => {
            try { restoreBackup(mval('restore-area')); render(); toast('Backup restored ✓'); }
            catch (err) { toast('Restore failed: ' + err.message, 'err'); }
          } }, { label: 'Cancel' }]);
      break;
    case 'reset-all':
      showModal('Reset everything?', '<p>Deletes your plan, all sessions, body weight log and settings from this device. Consider copying a backup first.</p>',
        [{ label: 'Reset', cls: 'danger', fn: () => {
            endSession(); // clears `active` and its UI state, stops rest, releases the wake lock
            ['plan', 'sessions', 'active', 'bw', 'settings', 'updatedAt'].forEach(k => store.del(k));
            plan = defaultPlan(); sessions = []; bodyWeight = []; dataUpdatedAt = 0;
            settings = { unit: 'kg', sound: true, vibrate: true, autoSync: true };
            closeModal(); render(); toast('Fresh start');
          } }, { label: 'Cancel' }]);
      break;
  }
});

/* tab switching */
document.getElementById('tabbar').addEventListener('click', e => {
  const b = e.target.closest('.tab');
  if (b) { tab = b.dataset.tab; render(); window.scrollTo(0, 0); }
});

/* input binding (no re-render, so focus is preserved while typing) */
document.addEventListener('input', e => {
  const el = e.target;
  const bind = el.dataset.bind;
  if (!bind) return;
  if (bind === 'set' && active) {
    const s = active.exercises[+el.dataset.ei].sets[+el.dataset.si];
    const v = parseFloat(el.value);
    s[el.dataset.f] = isNaN(v) ? null : v;
    saveActive();
  } else if (bind === 'session-notes' && active) {
    active.notes = el.value; saveActive();
  } else if (bind === 'readiness-cmj' && active) {
    const v = parseFloat(el.value); active.readiness.cmjCm = isNaN(v) ? null : v;
    // A typed value supersedes any earlier video measurement — drop its metadata so a
    // stale method/flight time/attempt list can't ride along with a hand-entered number.
    delete active.readiness.method;
    delete active.readiness.flightTimeMs;
    delete active.readiness.cmjAttempts;
    saveActive();
  } else if (bind === 'readiness-broad' && active) {
    const v = parseFloat(el.value); active.readiness.broadJumpCm = isNaN(v) ? null : v; saveActive();
  } else if (bind === 'readiness-energy' && active) {
    const v = parseInt(el.value, 10); active.readiness.subjectiveEnergy = isNaN(v) ? null : Math.min(10, Math.max(1, v)); saveActive();
  }
});
document.addEventListener('change', e => {
  const bind = e.target.dataset.bind;
  if (bind === 'history-ex') { historyExercise = e.target.value; render(); }
  if (bind === 'set-unit') { settings.unit = e.target.value; saveSettings(); render(); toast('Unit set to ' + settings.unit + ' (existing numbers are not converted)'); }
  if (bind === 'edit-equipment') {
    const row = document.getElementById('f-barweight-row');
    if (row) {
      row.classList.toggle('hidden', !BAR_WEIGHT_EQUIPMENT.has(e.target.value));
      const input = document.getElementById('f-barweight');
      if (input) input.placeholder = 'default ' + resolvedBarWeight({ equipment: e.target.value, barWeight: null });
    }
    const hint = document.getElementById('f-weight-hint');
    if (hint) hint.textContent = ladderHint(e.target.value);
  }
});

/* boot */
store.set('plan', plan); // persist the default plan on first run WITHOUT bumping the sync clock
mountStaticIcons();
syncWakeLock();
render();
renderRest();
// A reload loses the scheduled cue (AudioNodes can't be persisted). Re-arm it —
// scheduleCue is a no-op until a gesture unlocks the context, and the interval
// fallback covers the gap until then.
if (rest && !rest.fired) scheduleCue(Math.max(0, (rest.endsAt - Date.now()) / 1000));
if (!store.get('onboarded', false) && sessions.length === 0) showOnboarding();
window.addEventListener('load', initServiceWorkerUpdates);
autoSyncOnLoad(); // reconcile with the cloud, then enable auto-push
