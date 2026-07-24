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
const FPS_PRESETS = [30, 60, 120, 240];
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
const BAR_WEIGHT_DEFAULTS = { barbell: { kg: 20, lb: 45 }, 'trap-bar': { kg: 25, lb: 55 }, 'training-bar': { kg: 10, lb: 15 } };
function resolvedBarWeight(e) {
  if (e.barWeight != null) return e.barWeight;
  return BAR_WEIGHT_DEFAULTS[e.equipment]?.[unit()] ?? (unit() === 'lb' ? 45 : 20);
}

/* ================= default starter plan ================= */
function defaultPlan() {
  const ex = (name, sets, reps, weight, rpe, rest, alternates = [], equipment) =>
    ({ id: uid(), name, sets, reps, weight, targetRpe: rpe, restSeconds: rest, restSecondsNext: null, equipment: equipment || 'barbell', barWeight: null, description: '', notes: '', alternates });
  return {
    type: 'workout-plan', version: 1, name: 'Starter Push / Pull / Legs', createdAt: today(),
    days: [
      { id: uid(), name: 'Day A — Push', exercises: [
        ex('Bench Press', 4, '6-8', 60, 8, 150, [{ name: 'Dumbbell Bench Press', weight: 22 }, { name: 'Machine Chest Press', weight: 50 }]),
        ex('Overhead Press', 3, '8-10', 35, 8, 120, [{ name: 'Seated Dumbbell Press', weight: 16 }]),
        ex('Incline Bench Press', 3, '8-12', 45, 8, 120, [{ name: 'Incline Dumbbell Press', weight: 18 }]),
        ex('Lateral Raise', 3, '12-15', 8, 9, 75, [{ name: 'Cable Lateral Raise', weight: 5 }]),
        ex('Triceps Pushdown', 3, '10-15', 25, 9, 75, [{ name: 'Skull Crusher', weight: 20 }])
      ]},
      { id: uid(), name: 'Day B — Pull', exercises: [
        ex('Deadlift', 3, '5', 100, 8, 180, [{ name: 'Romanian Deadlift', weight: 80 }]),
        ex('Pull-Up', 3, '6-10', 0, 9, 150, [{ name: 'Lat Pulldown', weight: 55 }], 'bodyweight'),
        ex('Barbell Row', 3, '8-10', 60, 8, 120, [{ name: 'Cable Row', weight: 55 }, { name: 'Dumbbell Row', weight: 26 }]),
        ex('Face Pull', 3, '12-15', 20, 9, 75, [{ name: 'Rear Delt Fly', weight: 8 }]),
        ex('Bicep Curl', 3, '10-12', 12, 9, 75, [{ name: 'Hammer Curl', weight: 12 }])
      ]},
      { id: uid(), name: 'Day C — Legs', exercises: [
        ex('Squat', 4, '6-8', 80, 8, 180, [{ name: 'Leg Press', weight: 140 }]),
        ex('Romanian Deadlift', 3, '8-10', 70, 8, 150, [{ name: 'Leg Curl', weight: 40 }]),
        ex('Bulgarian Split Squat', 3, '8-10', 14, 9, 105, [{ name: 'Lunge', weight: 14 }]),
        ex('Leg Curl', 3, '10-12', 40, 9, 90, [{ name: 'Good Morning', weight: 40 }]),
        ex('Calf Raise', 4, '10-15', 60, 9, 75, [])
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
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {}
}
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

/* ================= wake lock (keep screen on during a session) ================= */
let wakeLock = null;
async function syncWakeLock() {
  try {
    if (active && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!active && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { syncWakeLock(); }
  else if (syncReady && settings.autoSync && dataUpdatedAt > lastSyncedAt) {
    clearTimeout(syncTimer); workerPush({ silent: true }); // flush unsynced changes before backgrounding
  }
});

/* ================= rest timer ================= */
let rest = store.get('rest', null); // { endsAt, total, label, fired } — persisted so a reload mid-rest doesn't lose the countdown
const saveRest = () => rest ? store.set('rest', rest) : store.del('rest');
function startRest(seconds, label) {
  if (!seconds || seconds <= 0) return;
  unlockAudio();
  rest = { endsAt: Date.now() + seconds * 1000, total: seconds, label: label || 'Rest', fired: false };
  saveRest(); renderRest();
}
function adjustRest(delta) { if (rest) { rest.endsAt += delta * 1000; rest.total = Math.max(rest.total + delta, 1); saveRest(); renderRest(); } }
function stopRest() { rest = null; saveRest(); renderRest(); }
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
      <button class="icon-btn" data-action="rest-add">+15s</button>
      <button class="icon-btn ${over ? 'success' : ''}" data-action="rest-skip">${over ? 'OK' : 'Skip'}</button>
    </div>
    <div class="rest-bar"><div style="width:${pct}%"></div></div>`;
}
setInterval(() => {
  if (rest) {
    const remain = (rest.endsAt - Date.now()) / 1000;
    if (remain <= 0 && !rest.fired) { rest.fired = true; saveRest(); beep(3); buzz(); }
    if (remain <= -30) { rest = null; saveRest(); }  // auto-dismiss 30s after firing
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
            description: String(e.description || ''),
            notes: String(e.notes || ''),
            alternates: Array.isArray(e.alternates) ? e.alternates.filter(a => a && a.name).map(a => ({
              name: String(a.name), weight: parseFloat(a.weight) || 0, description: String(a.description || '')
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
      if (sameExercise(e.name, name) && e.sets.length) return { date: sessions[i].date, sets: e.sets };
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
      description: e.description, alternates: e.alternates, notes: '',
      sets: Array.from({ length: e.sets }, () => ({ weight: e.weight, reps: parseRepsLow(e.reps), rpe: e.targetRpe, done: false }))
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
function finishSession() {
  if (!active) return;
  const durationMin = Math.max(1, Math.round((Date.now() - active.startedAt) / 60000));
  const record = {
    id: active.id, date: new Date(active.startedAt).toISOString(), dayName: active.dayName,
    durationMin, notes: active.notes,
    exercises: active.exercises
      .map(e => ({ name: e.name, plannedSets: e.plannedSets, plannedReps: e.plannedReps,
        plannedWeight: e.plannedWeight, targetRpe: e.targetRpe,
        swappedFrom: e.swappedFrom, notes: e.notes,
        sets: e.sets.filter(s => s.done).map(s => ({ weight: s.weight, reps: s.reps, rpe: s.rpe })) }))
      .filter(e => e.sets.length)
  };
  const rd = active.readiness || {};
  if (rd.cmjCm != null || rd.broadJumpCm != null || rd.subjectiveEnergy != null) record.readiness = rd;
  const prs = detectPRs(record);
  sessions.push(record); saveSessions();
  active = null; saveActive(); stopRest(); syncWakeLock();
  exExpanded = new Set(); readinessOpen = null;
  closeModal(); render();
  const setCount = record.exercises.reduce((n, e) => n + e.sets.length, 0);
  let html = `<p>Saved <b>${esc(record.dayName)}</b> — ${setCount} sets in ${fmtDur(durationMin)}.</p>`;
  if (prs.length) html += `<p class="mt8">🏆 New PRs: ${prs.map(p => `<span class="pr-badge">${esc(p)}</span>`).join(' ')}</p>`;
  const syncing = settings.autoSync;
  html += `<p class="muted small mt8">${syncing ? '☁️ Syncing to the cloud for your AI coach…' : 'Head to the AI Coach tab to export this for your next plan update.'}</p>`;
  showModal('Workout complete 🎉', html);
  beep(2, 1100);
  if (syncing) workerPush({ silent: true }); // push the finished session right away
}
function detectPRs(record) {
  const prs = [];
  for (const e of record.exercises) {
    const newBest = Math.max(...e.sets.map(s => est1RM(s.weight, s.reps)));
    let oldBest = 0;
    for (const s of sessions) for (const ex of s.exercises) {
      if (sameExercise(ex.name, e.name))
        for (const set of ex.sets) oldBest = Math.max(oldBest, est1RM(set.weight, set.reps));
    }
    if (newBest > oldBest && oldBest > 0) prs.push(canonicalName(e.name));
  }
  return prs;
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

My data:
`;
const CLAUDE_URL_PROMPT = url => `You are my strength coach. Fetch my latest GymTrack training data from this URL (JSON):
${url}

It contains my recent sessions (actual weights, reps, RPE), notes, body weight and current plan. Review it, then write my next workout plan.

Reply with ONLY a JSON code block of type "workout-plan" (weights in ${unit()}) using the same field structure as the "plan" object in that data: days[] → exercises[] with name, sets, reps (string), weight, targetRpe, restSeconds, restSecondsNext (optional, only if it should differ from restSeconds), equipment (one of: barbell, trap-bar, landmine, training-bar, dumbbell, machine, cable, bodyweight, other), barWeight (optional, only if the bar isn't a standard 20kg/45lb bar), description, and 1-2 alternates each. Progress weights from my logged RPE vs target (at/under target → increase; over → hold or reduce). I'll paste your JSON back into the app to load it.`;
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
    ? [r.cmjCm != null ? `CMJ ${r.cmjCm}` : '', r.broadJumpCm != null ? `Broad ${r.broadJumpCm}` : '', r.subjectiveEnergy != null ? `Energy ${r.subjectiveEnergy}` : ''].filter(Boolean).join(' · ')
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
    ${active.exercises.map((e, ei) => exerciseCard(e, ei)).join('')}
    <h2 class="section">Session notes</h2>
    <div class="card">
      <textarea data-bind="session-notes" placeholder="How did it go? Anything Claude should know? (sleep, pain, energy…)">${esc(active.notes)}</textarea>
    </div>
    <button class="wide success mt12" data-action="confirm-finish">Finish workout</button>
    <button class="wide ghost danger mt8" data-action="confirm-discard">Discard session</button>`;
}
function exerciseCard(e, ei) {
  const doneCount = e.sets.filter(s => s.done).length;
  const allDone = doneCount === e.sets.length && e.sets.length > 0;
  if (allDone && !exExpanded.has(ei)) {
    const best = e.sets.reduce((a, b) => est1RM(b.weight, b.reps) > est1RM(a.weight, a.reps) ? b : a);
    return `
    <div class="card collapsed-ex tappable" data-action="ex-expand" data-ei="${ei}">
      <div class="row between">
        <div class="grow"><span class="green bold">✓</span> <span class="bold">${esc(e.name)}</span>
          <span class="muted small">· ${e.sets.length} sets · best ${best.weight}×${best.reps}</span></div>
        <span class="chev">${icon('chevDown', 18)}</span>
      </div>
    </div>`;
  }
  const lastP = lastPerformance(e.name);
  const lastRpe = lastP ? Math.max(0, ...lastP.sets.map(s => s.rpe || 0)) : 0;
  return `
  <div class="card">
    <div class="row between">
      <div class="grow">
        <div class="ex-name">${allDone ? '✅ ' : ''}${esc(e.name)}</div>
        <div class="target-line">Plan: ${e.plannedSets}×${esc(e.plannedReps)} @ ${e.plannedWeight}${unit()}${e.targetRpe ? ' · RPE ' + e.targetRpe : ''} · rest ${fmtClock(e.restSeconds)}</div>
        ${lastP ? `<div class="last-line">Last: ${lastP.sets.map(s => `${s.weight}×${s.reps}`).join(' · ')}${lastRpe ? ` @RPE ${lastRpe}` : ''} — ${fmtDate(lastP.date)}</div>` : ''}
        ${e.swappedFrom ? `<div class="swap-note">↺ swapped from ${esc(e.swappedFrom)}</div>` : ''}
      </div>
      <button class="icon-btn" data-action="ex-info" data-ei="${ei}" title="Explain">${icon('info', 18)}</button>
      ${PLATE_EQUIPMENT.has(e.equipment || 'barbell') ? `<button class="icon-btn" data-action="plate-calc" data-ei="${ei}" title="Plate calculator">${icon('plate', 18)}</button>` : ''}
      <button class="icon-btn" data-action="ex-swap" data-ei="${ei}" title="Swap">${icon('swap', 18)}</button>
    </div>
    <div class="set-grid">
      <div class="head">#</div><div class="head">${unit()}</div><div class="head">Reps</div><div class="head">RPE</div><div class="head">✓</div>
      ${e.sets.map((s, si) => `
        <div class="set-no">${si + 1}</div>
        <input class="${s.done ? 'set-row-done-i' : ''}${e.equipment === 'bodyweight' ? ' bw-weight-i' : ''}" type="number" inputmode="decimal" step="0.5" value="${s.weight != null ? s.weight : ''}" data-bind="set" data-ei="${ei}" data-si="${si}" data-f="weight" ${s.done ? 'style="border-color:var(--green)"' : ''}>
        <input type="number" inputmode="numeric" value="${s.reps != null ? s.reps : ''}" data-bind="set" data-ei="${ei}" data-si="${si}" data-f="reps" ${s.done ? 'style="border-color:var(--green)"' : ''}>
        <button class="rpe-btn ${s.rpe != null ? '' : 'muted'}" data-action="rpe-pick" data-ei="${ei}" data-si="${si}" ${s.done ? 'style="border-color:var(--green)"' : ''}>${s.rpe != null ? s.rpe : '—'}</button>
        <button class="set-done-btn ${s.done ? 'success' : ''}" data-action="set-done" data-ei="${ei}" data-si="${si}">${s.done ? '✓' : '○'}</button>`).join('')}
    </div>
    <div class="row mt12">
      <button class="ghost icon-btn" data-action="set-add" data-ei="${ei}">+ Set</button>
      <button class="ghost icon-btn" data-action="set-remove" data-ei="${ei}">− Set</button>
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
            <div class="row between tappable" style="padding:9px 0" data-action="ex-menu" data-day="${d.id}" data-i="${i}">
              <div class="grow">
                <div class="bold">${esc(e.name)}</div>
                <div class="muted small">${e.sets}×${esc(e.reps)} @ ${e.weight}${unit()}${e.targetRpe ? ' · RPE ' + e.targetRpe : ''} · rest ${fmtClock(e.restSeconds)}${e.alternates.length ? ' · ' + e.alternates.length + ' alt' : ''}</div>
              </div>
              <span class="chev">${icon('chevRight', 16)}</span>
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
      const best = e.sets.reduce((a, b) => est1RM(b.weight, b.reps) > est1RM(a.weight, a.reps) ? b : a);
      rows.push({ date: s.date, best, e1rm: est1RM(best.weight, best.reps), sets: e.sets });
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
  const prBest = hist.length ? Math.max(...hist.map(r => r.e1rm)) : 0;
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
        ${hist.length ? `
          ${chartSvg(hist.slice(-12).map(r => ({ v: r.e1rm, d: r.date })))}
          <div class="muted small mt8">Best est. 1RM: <b class="amber">${prBest} ${unit()}</b></div>
          <div class="divider"></div>
          ${hist.slice(-8).reverse().map(r => `
            <div class="row between" style="padding:5px 0">
              <span class="muted small">${fmtDate(r.date)}</span>
              <span class="small">${r.sets.map(s => `${s.weight}×${s.reps}`).join(' · ')}</span>
              <span class="small bold ${r.e1rm >= prBest ? 'amber' : ''}">${r.e1rm >= prBest ? '🏆 ' : ''}e1RM ${r.e1rm}</span>
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
              <div class="muted small">${e.sets.map(x => `${x.weight}${unit()}×${x.reps}${x.rpe ? '@' + x.rpe : ''}`).join(' · ')}</div>
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
        <button class="icon-btn ${settings.vibrate ? 'success' : ''}" data-action="toggle-vibrate">${settings.vibrate ? 'On' : 'Off'}</button>
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
function exEditModal(dayId, i) {
  const day = plan.days.find(d => d.id === dayId);
  const e = i != null ? day.exercises[i] : { name: '', sets: 3, reps: '8-12', weight: 0, targetRpe: 8, restSeconds: 120, restSecondsNext: null, equipment: 'barbell', barWeight: null, description: '', alternates: [] };
  const equipment = e.equipment || 'barbell';
  showModal(i != null ? 'Edit exercise' : 'Add exercise', `
    <label class="field"><span>Name</span><input id="f-name" value="${esc(e.name)}"></label>
    <div class="row">
      <label class="field grow"><span>Sets</span><input id="f-sets" type="number" inputmode="numeric" value="${e.sets}"></label>
      <label class="field grow"><span>Reps</span><input id="f-reps" value="${esc(e.reps)}"></label>
    </div>
    <div class="row">
      <label class="field grow"><span>Weight (${unit()})</span><input id="f-weight" type="number" inputmode="decimal" step="0.5" value="${e.weight}"></label>
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
    <label class="field"><span>How-to / description (optional)</span><textarea id="f-desc" style="min-height:60px">${esc(e.description)}</textarea></label>`,
    [
      { label: 'Save', cls: 'primary', fn: () => {
          const name = mval('f-name'); if (!name) { toast('Name is required', 'err'); return; }
          const rpeRaw = document.getElementById('f-rpe').dataset.v;
          const restNextRaw = mval('f-rest-next');
          const barWeightRaw = mval('f-barweight');
          const upd = { name, sets: Math.max(1, mnum('f-sets', 3)), reps: mval('f-reps') || '8-12', weight: mnum('f-weight'),
            targetRpe: rpeRaw ? parseFloat(rpeRaw) : null, restSeconds: Math.max(0, mnum('f-rest', 120)),
            restSecondsNext: restNextRaw ? Math.max(0, parseInt(restNextRaw, 10)) : null,
            equipment: document.getElementById('f-equipment').value,
            barWeight: barWeightRaw ? parseFloat(barWeightRaw) : null,
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
      ${esc(a.name)}${a.weight ? ` · ${a.weight}${unit()}` : ''}</button>`).join(''),
    [{ label: 'Cancel' }]);
}
function doPlanSwap(dayId, i, ai) {
  const day = plan.days.find(d => d.id === dayId);
  const e = day.exercises[i];
  const a = e.alternates[ai];
  // The current main exercise becomes an alternate, the chosen alternate becomes main.
  const newAlts = e.alternates.filter((_, x) => x !== ai);
  newAlts.unshift({ name: e.name, weight: e.weight, description: e.description });
  Object.assign(e, { name: a.name, weight: a.weight || e.weight, description: a.description || '', alternates: newAlts });
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
        ${esc(a.name)}${a.weight ? ` · ${a.weight}${unit()}` : ''}</button>`).join('') : '<p class="muted small">No alternates in the plan for this one.</p>'}
    <div class="divider"></div>
    <label class="field"><span>…or type any exercise</span><input id="swap-custom" placeholder="e.g. Machine Chest Press"></label>`,
    [
      { label: 'Use typed exercise', cls: 'primary', fn: () => {
          const name = mval('swap-custom'); if (!name) { toast('Type a name first', 'err'); return; }
          doSessionSwap(ei, { name, weight: e.sets[0] ? e.sets[0].weight : e.plannedWeight, description: '' });
        } },
      { label: 'Cancel' }
    ]);
}
function doSessionSwap(ei, alt) {
  const e = active.exercises[ei];
  const original = e.swappedFrom || e.name;
  e.swappedFrom = original === alt.name ? null : original;
  e.name = alt.name;
  if (alt.weight) e.sets.forEach(s => { if (!s.done) s.weight = alt.weight; });
  if (alt.description) e.description = alt.description;
  saveActive(); closeModal(); render();
  toast('Swapped to ' + alt.name);
}
function exInfoModal(ei) {
  const e = active.exercises[ei];
  const desc = e.description || lookupExplanation(e.name) || 'No description available — ask your AI coach to include a "description" for each exercise in your next plan.';
  showModal(e.name, `<p>${esc(desc)}</p>
    <p class="muted small mt12">Target: ${e.plannedSets}×${esc(e.plannedReps)} @ ${e.plannedWeight}${unit()}${e.targetRpe ? ' · RPE ' + e.targetRpe : ''}</p>`);
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
function stepperStep(el) {
  if (!el || !el.dataset || el.dataset.bind !== 'set') return null;
  return el.dataset.f === 'weight' ? 2.5 : el.dataset.f === 'reps' ? 1 : null;
}
function positionStepper() {
  if (!stepperTarget) return;
  const bar = document.getElementById('stepper-bar');
  const vv = window.visualViewport;
  const keyboard = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  bar.style.bottom = Math.max(keyboard + 8, 74) + 'px';
}
function showStepper(el) {
  const step = stepperStep(el);
  if (step == null) return;
  clearTimeout(stepperHideTimer);
  stepperTarget = el;
  const bar = document.getElementById('stepper-bar');
  bar.innerHTML = `
    <button data-step="-1">−${step}</button>
    <span class="muted small">${el.dataset.f === 'weight' ? unit() : 'reps'}</span>
    <button data-step="1">+${step}</button>`;
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
  if (!btn || !stepperTarget) return;
  e.preventDefault(); // keep the input focused (no blur, keyboard stays up)
  const delta = stepperStep(stepperTarget) * parseInt(btn.dataset.step, 10);
  const cur = parseFloat(stepperTarget.value);
  const next = Math.max(0, Math.round(((isNaN(cur) ? 0 : cur) + delta) * 100) / 100);
  stepperTarget.value = next;
  stepperTarget.dispatchEvent(new Event('input', { bubbles: true })); // reuse the data-bind update path
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', positionStepper);
  window.visualViewport.addEventListener('scroll', positionStepper);
}

/* ================= CMJ video measurement ================= */
// Lives outside the render cycle like `rest` — mutated directly, with
// targeted DOM writes, rather than routed through the app's render().
let cmjState = null; // { objectUrl, video, canvas, ctx, fps, seeking, lastMediaTime, takeoffTime, landingTime, pollTimer }

function cmjVideoModal() {
  cmjState = { objectUrl: null, video: null, fps: 30, seeking: false, lastMediaTime: 0, takeoffTime: null, landingTime: null, pollTimer: null };
  showModal('Measure CMJ via video', `
    <input type="file" id="cmj-file-input" accept="video/*">
    <p class="small muted mt8">High-fps clips (120/240 fps, slo-mo or not): after detection, tap the rate you <em>recorded</em> at — if the file plays slower than real time, the timeline is corrected automatically.</p>
    <div id="cmj-fps-row" class="hidden mt8">
      <span class="small muted">Recording frame rate (auto-detected — tap to override)</span>
      <div class="cmj-fps-group mt8">
        ${FPS_PRESETS.map(f => `<button type="button" data-fps="${f}" class="ghost icon-btn ${f === 30 ? 'active' : ''}">${f} fps</button>`).join('')}
      </div>
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
        <button type="button" id="cmj-set-takeoff">Set takeoff</button>
        <button type="button" id="cmj-set-landing">Set landing</button>
      </div>
      <div id="cmj-markers" class="small muted mt8"></div>
      <div id="cmj-result" class="cmj-result hidden"></div>
    </div>`,
    [
      { label: 'Use this value', cls: 'primary', fn: cmjAccept },
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
  document.querySelectorAll('.cmj-fps-group [data-fps]').forEach(btn => {
    btn.addEventListener('click', () => {
      const chosen = parseInt(btn.dataset.fps, 10);
      cmjSetFps(chosen);
      const detectEl = document.getElementById('cmj-fps-detect');
      if (detectEl) {
        // Recording rate above the clip's playback rate = slo-mo export → the
        // stretched timeline is corrected in the result (see cmjTimeScale).
        detectEl.textContent = (cmjState.detectedFps && chosen > cmjState.detectedFps * 1.5)
          ? `Recorded ${chosen} fps, plays ~${cmjState.detectedFps} fps — timeline is ${(chosen / cmjState.detectedFps).toFixed(1)}× slower than real time; times corrected.`
          : '';
      }
      // The scale factor feeds the flight-time math, so recompute a shown result.
      if (cmjState.takeoffTime != null || cmjState.landingTime != null) cmjUpdateResultUI();
    });
  });
  document.getElementById('cmj-scrub').addEventListener('input', e => cmjOnScrubInput(parseFloat(e.target.value)));
  document.getElementById('cmj-step-back').addEventListener('click', () => cmjSeekBy(-1));
  document.getElementById('cmj-step-fwd').addEventListener('click', () => cmjSeekBy(1));
  document.getElementById('cmj-set-takeoff').addEventListener('click', cmjSetTakeoff);
  document.getElementById('cmj-set-landing').addEventListener('click', cmjSetLanding);
}

function cmjOnFileSelected(file) {
  if (cmjState.objectUrl) URL.revokeObjectURL(cmjState.objectUrl);
  cmjState.takeoffTime = null; cmjState.landingTime = null;
  document.getElementById('cmj-result').classList.add('hidden');
  document.getElementById('cmj-markers').innerHTML = '';
  const acceptBtn = document.querySelector('[data-idx="m0"]');
  if (acceptBtn) acceptBtn.disabled = true;

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

function cmjSetFps(fps) {
  cmjState.fps = fps;
  const rounded = Math.round(fps);
  document.querySelectorAll('.cmj-fps-group [data-fps]').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.fps, 10) === rounded);
  });
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
        if (detectEl) detectEl.textContent = `Detected ~${snapped} fps from the video`;
      } else if (detectEl) {
        detectEl.textContent = 'Could not detect frame rate — pick it above.';
      }
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

// iPhone slo-mo exports bake the slow-motion effect into the file: 120/240fps
// footage plays back at ~24-30fps with a stretched timeline, so media-time deltas
// are NOT real time. When the user's selected recording rate is clearly above the
// clip's measured playback rate, treat the clip as slo-mo and scale marked times
// by playbackFps/recordedFps to recover real time. Same-rate clips scale by 1.
function cmjTimeScale() {
  const playback = cmjState.detectedFps;
  if (playback && cmjState.fps > playback * 1.5) return playback / cmjState.fps;
  return 1;
}
// Timeline frame numbers always follow the rate the file actually plays at.
function cmjPlaybackFps() { return cmjState.detectedFps || cmjState.fps; }

function cmjUpdateResultUI() {
  const { takeoffTime, landingTime, fps } = cmjState;
  const markersEl = document.getElementById('cmj-markers');
  const resultEl = document.getElementById('cmj-result');
  const acceptBtn = document.querySelector('[data-idx="m0"]');
  const pf = cmjPlaybackFps();
  const fmt = t => t == null ? '—' : `${t.toFixed(3)}s (frame ${Math.round(t * pf)})`;
  markersEl.innerHTML = `Takeoff: ${fmt(takeoffTime)} &nbsp;·&nbsp; Landing: ${fmt(landingTime)}`;

  if (takeoffTime == null || landingTime == null) {
    resultEl.classList.add('hidden');
    if (acceptBtn) acceptBtn.disabled = true;
    return;
  }
  if (landingTime <= takeoffTime) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `<p class="small red">Landing must be after takeoff — re-mark one of the frames.</p>`;
    if (acceptBtn) acceptBtn.disabled = true;
    return;
  }
  const scale = cmjTimeScale();
  const flightTimeSec = (landingTime - takeoffTime) * scale;
  const heightCm = computeJumpHeightCm(flightTimeSec);
  const plausible = heightCm >= 3 && heightCm <= 180;
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = `
    <div class="big">${heightCm.toFixed(1)} cm</div>
    <div class="small muted">flight time ${Math.round(flightTimeSec * 1000)} ms</div>
    ${scale !== 1 ? `<div class="small muted">×${(1 / scale).toFixed(1)} timeline correction (recorded ${fps} fps, plays ~${cmjState.detectedFps} fps)</div>` : ''}
    ${plausible ? '' : '<p class="small amber mt8">That seems unusually low/high — double check your markers.</p>'}`;
  cmjState.resultHeightCm = heightCm;
  cmjState.resultFlightTimeMs = Math.round(flightTimeSec * 1000);
  if (acceptBtn) acceptBtn.disabled = false;
}

function cmjAccept() {
  if (!cmjState || cmjState.resultHeightCm == null) { cmjCancel(); return; }
  const heightCm = Math.round(cmjState.resultHeightCm * 10) / 10;
  if (active) {
    active.readiness.cmjCm = heightCm;
    active.readiness.flightTimeMs = cmjState.resultFlightTimeMs;
    active.readiness.method = 'video';
    saveActive();
    toast('CMJ height set from video ✓');
  } else {
    toast(`CMJ: ${heightCm} cm`);
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
    case 'settings-open': if (tab !== 'settings') { prevTab = tab; tab = 'settings'; render(); window.scrollTo(0, 0); } break;
    case 'settings-back': tab = prevTab; render(); window.scrollTo(0, 0); break;

    /* rest timer */
    case 'rest-add': adjustRest(15); break;
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
        [{ label: 'Discard', cls: 'danger', fn: () => { active = null; saveActive(); stopRest(); syncWakeLock(); render(); } }, { label: 'Keep going' }]);
      break;

    /* set logging */
    case 'set-done': {
      const ei = +el.dataset.ei;
      const ex = active.exercises[ei], s = ex.sets[+el.dataset.si];
      s.done = !s.done;
      const exerciseDone = ex.sets.every(y => y.done);
      if (s.done && exerciseDone) exExpanded.delete(ei); // auto-collapse the finished exercise
      saveActive(); render();
      if (s.done) {
        const remaining = active.exercises.some(x => x.sets.some(y => !y.done));
        if (remaining) {
          const seconds = exerciseDone && ex.restSecondsNext != null ? ex.restSecondsNext : ex.restSeconds;
          startRest(seconds, 'Rest — ' + ex.name);
        }
        buzz([60]);
      }
      break;
    }
    case 'ex-expand': exExpanded.add(+el.dataset.ei); render(); break;
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
      ex.sets.push({ weight: lastSet ? lastSet.weight : ex.plannedWeight, reps: lastSet ? lastSet.reps : parseRepsLow(ex.plannedReps), rpe: ex.targetRpe, done: false });
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
    case 'cmj-open': cmjVideoModal(); break;
    case 'session-swap-pick': {
      const ei = +el.dataset.ei;
      doSessionSwap(ei, active.exercises[ei].alternates[+el.dataset.ai]);
      break;
    }

    /* plan editing */
    case 'day-toggle': expandedDay = expandedDay === el.dataset.id ? null : el.dataset.id; render(); break;
    case 'ex-menu': exMenuModal(el.dataset.day, +el.dataset.i); break;
    case 'ex-add': exEditModal(el.dataset.day, null); break;
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
    case 'test-sound': beep(3); buzz(); toast('That\'s the rest-timer cue'); break;
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
            ['plan', 'sessions', 'active', 'bw', 'settings', 'updatedAt'].forEach(k => store.del(k));
            plan = defaultPlan(); sessions = []; active = null; bodyWeight = []; dataUpdatedAt = 0;
            settings = { unit: 'kg', sound: true, vibrate: true, autoSync: true };
            stopRest(); render(); toast('Fresh start');
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
    const v = parseFloat(el.value); active.readiness.cmjCm = isNaN(v) ? null : v; saveActive();
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
  }
});

/* boot */
store.set('plan', plan); // persist the default plan on first run WITHOUT bumping the sync clock
mountStaticIcons();
syncWakeLock();
render();
renderRest();
if (!store.get('onboarded', false) && sessions.length === 0) showOnboarding();
window.addEventListener('load', initServiceWorkerUpdates);
autoSyncOnLoad(); // reconcile with the cloud, then enable auto-push
