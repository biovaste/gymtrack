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

/* ================= default starter plan ================= */
function defaultPlan() {
  const ex = (name, sets, reps, weight, rpe, rest, alternates = []) =>
    ({ id: uid(), name, sets, reps, weight, targetRpe: rpe, restSeconds: rest, description: '', notes: '', alternates });
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
        ex('Pull-Up', 3, '6-10', 0, 9, 150, [{ name: 'Lat Pulldown', weight: 55 }]),
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
let tab = 'workout';
let expandedDay = null;       // plan view expansion
let expandedSession = null;   // history view expansion
let historyExercise = '';     // history exercise picker

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
let rest = null; // { endsAt, total, label, fired }
function startRest(seconds, label) {
  if (!seconds || seconds <= 0) return;
  unlockAudio();
  rest = { endsAt: Date.now() + seconds * 1000, total: seconds, label: label || 'Rest', fired: false };
  renderRest();
}
function adjustRest(delta) { if (rest) { rest.endsAt += delta * 1000; rest.total = Math.max(rest.total + delta, 1); renderRest(); } }
function stopRest() { rest = null; renderRest(); }
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
    if (remain <= 0 && !rest.fired) { rest.fired = true; beep(3); buzz(); }
    if (remain <= -30) { rest = null; }  // auto-dismiss 30s after firing
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
      targetRpe: e.targetRpe, restSeconds: e.restSeconds,
      description: e.description, alternates: e.alternates, notes: '',
      sets: Array.from({ length: e.sets }, () => ({ weight: e.weight, reps: parseRepsLow(e.reps), rpe: e.targetRpe, done: false }))
    }))
  };
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
  closeModal(); render();
  const setCount = record.exercises.reduce((n, e) => n + e.sets.length, 0);
  let html = `<p>Saved <b>${esc(record.dayName)}</b> — ${setCount} sets in ${fmtDur(durationMin)}.</p>`;
  if (prs.length) html += `<p class="mt8">🏆 New PRs: ${prs.map(p => `<span class="pr-badge">${esc(p)}</span>`).join(' ')}</p>`;
  const syncing = settings.autoSync;
  html += `<p class="muted small mt8">${syncing ? '☁️ Syncing to the cloud for Claude…' : 'Head to the Claude tab to export this for your next plan update.'}</p>`;
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
      if (ex.name.toLowerCase() === e.name.toLowerCase())
        for (const set of ex.sets) oldBest = Math.max(oldBest, est1RM(set.weight, set.reps));
    }
    if (newBest > oldBest && oldBest > 0) prs.push(e.name);
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
    plan, sessions, bodyWeight, settings: { unit: settings.unit, sound: settings.sound, vibrate: settings.vibrate }
  }, null, 2);
}
function restoreBackup(raw) {
  const b = JSON.parse(raw);
  if (b.type !== 'gymtrack-backup') throw new Error('Not a GymTrack backup (expected type "gymtrack-backup").');
  plan = normalizePlan(b.plan); sessions = Array.isArray(b.sessions) ? b.sessions : [];
  bodyWeight = Array.isArray(b.bodyWeight) ? b.bodyWeight : [];
  if (b.settings) Object.assign(settings, { unit: b.settings.unit, sound: b.settings.sound, vibrate: b.settings.vibrate });
  // Adopt the source timestamp so we don't immediately bounce the same data back.
  dataUpdatedAt = b.updatedAt || Date.now();
  store.set('plan', plan); store.set('sessions', sessions); store.set('bw', bodyWeight);
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
          "description": "<1-2 sentence how-to>",
          "alternates": [ { "name": "<alternative exercise>", "weight": <number>, "description": "<short how-to>" } ]
        }
      ]
    }
  ]
}
- Progress weights based on my logged RPE: if RPE was at or below target, increase; if above, hold or reduce.
- Always include 1-2 "alternates" per exercise (for busy equipment) and a short "description" for each.
- Keep rest times realistic per lift type.

My data:
`;
const CLAUDE_URL_PROMPT = url => `You are my strength coach. Fetch my latest GymTrack training data from this URL (JSON):
${url}

It contains my recent sessions (actual weights, reps, RPE), notes, body weight and current plan. Review it, then write my next workout plan.

Reply with ONLY a JSON code block of type "workout-plan" (weights in ${unit()}) using the same field structure as the "plan" object in that data: days[] → exercises[] with name, sets, reps (string), weight, targetRpe, restSeconds, description, and 1-2 alternates each. Progress weights from my logged RPE vs target (at/under target → increase; over → hold or reduce). I'll paste your JSON back into the app to load it.`;
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
// Pull-or-push depending on which side is newer / non-empty (last-write-wins).
async function workerReconcile() {
  const r = await workerFetch();
  if (!r) { await workerPush({ silent: true }); return 'pushed'; }
  const localEmpty = sessions.length === 0 && bodyWeight.length === 0;
  const remoteHasData = r.parsed && (((r.parsed.sessions || []).length) || ((r.parsed.bodyWeight || []).length) || r.parsed.plan);
  if (remoteHasData && (r.updatedAt > dataUpdatedAt || localEmpty)) {
    restoreBackup(r.raw); render(); setSyncState('ok');
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

/* ================= views ================= */
function render() {
  const app = document.getElementById('app');
  document.querySelectorAll('#tabbar .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'workout') app.innerHTML = active ? viewActiveSession() : viewStart();
  else if (tab === 'plan') app.innerHTML = viewPlan();
  else if (tab === 'history') app.innerHTML = viewHistory();
  else app.innerHTML = viewClaude();
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
    ${last ? `<p class="muted small" style="text-align:center">Last workout: ${esc(last.dayName)} · ${fmtDate(last.date)}</p>` : ''}`;
}

/* ---- workout: active session ---- */
function viewActiveSession() {
  return `
    <div class="row between">
      <h2 class="section" style="margin:4px">${esc(active.dayName)}</h2>
      <button class="danger icon-btn" data-action="confirm-finish">Finish</button>
    </div>
    <h2 class="section">Pre-session readiness <span class="muted small">(optional)</span></h2>
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
    </div>
    ${active.exercises.map((e, ei) => exerciseCard(e, ei)).join('')}
    <h2 class="section">Session notes</h2>
    <div class="card">
      <textarea data-bind="session-notes" placeholder="How did it go? Anything Claude should know? (sleep, pain, energy…)">${esc(active.notes)}</textarea>
    </div>
    <button class="wide ghost danger mt12" data-action="confirm-discard">Discard session</button>`;
}
function exerciseCard(e, ei) {
  const doneCount = e.sets.filter(s => s.done).length;
  const allDone = doneCount === e.sets.length && e.sets.length > 0;
  return `
  <div class="card">
    <div class="row between">
      <div class="grow">
        <div class="ex-name">${allDone ? '✅ ' : ''}${esc(e.name)}</div>
        <div class="target-line">Plan: ${e.plannedSets}×${esc(e.plannedReps)} @ ${e.plannedWeight}${unit()}${e.targetRpe ? ' · RPE ' + e.targetRpe : ''} · rest ${fmtClock(e.restSeconds)}</div>
        ${e.swappedFrom ? `<div class="swap-note">↺ swapped from ${esc(e.swappedFrom)}</div>` : ''}
      </div>
      <button class="icon-btn" data-action="ex-info" data-ei="${ei}" title="Explain">ℹ️</button>
      <button class="icon-btn" data-action="ex-swap" data-ei="${ei}" title="Swap">🔁</button>
    </div>
    <div class="set-grid">
      <div class="head">#</div><div class="head">${unit()}</div><div class="head">Reps</div><div class="head">RPE</div><div class="head">✓</div>
      ${e.sets.map((s, si) => `
        <div class="set-no">${si + 1}</div>
        <input class="${s.done ? 'set-row-done-i' : ''}" type="number" inputmode="decimal" step="0.5" value="${s.weight != null ? s.weight : ''}" data-bind="set" data-ei="${ei}" data-si="${si}" data-f="weight" ${s.done ? 'style="border-color:var(--green)"' : ''}>
        <input type="number" inputmode="numeric" value="${s.reps != null ? s.reps : ''}" data-bind="set" data-ei="${ei}" data-si="${si}" data-f="reps" ${s.done ? 'style="border-color:var(--green)"' : ''}>
        <input type="number" inputmode="decimal" step="0.5" min="1" max="10" value="${s.rpe != null ? s.rpe : ''}" data-bind="set" data-ei="${ei}" data-si="${si}" data-f="rpe" ${s.done ? 'style="border-color:var(--green)"' : ''}>
        <button class="set-done-btn ${s.done ? 'success' : ''}" data-action="set-done" data-ei="${ei}" data-si="${si}">${s.done ? '✓' : '○'}</button>`).join('')}
    </div>
    <div class="row mt12">
      <button class="ghost icon-btn" data-action="set-add" data-ei="${ei}">+ Set</button>
      <button class="ghost icon-btn" data-action="set-remove" data-ei="${ei}">− Set</button>
      <button class="ghost icon-btn grow" data-action="ex-note" data-ei="${ei}">${e.notes ? '📝 ' + esc(e.notes.slice(0, 24)) + (e.notes.length > 24 ? '…' : '') : '📝 Note'}</button>
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
          <span class="chev">${open ? '▾' : '▸'}</span>
        </div>
        ${open ? `
          <div class="divider"></div>
          ${d.exercises.map((e, i) => `
            <div class="row between tappable" style="padding:9px 0" data-action="ex-menu" data-day="${d.id}" data-i="${i}">
              <div class="grow">
                <div class="bold">${esc(e.name)}</div>
                <div class="muted small">${e.sets}×${esc(e.reps)} @ ${e.weight}${unit()}${e.targetRpe ? ' · RPE ' + e.targetRpe : ''} · rest ${fmtClock(e.restSeconds)}${e.alternates.length ? ' · ' + e.alternates.length + ' alt' : ''}</div>
              </div>
              <span class="chev">›</span>
            </div>`).join('')}
          <div class="row mt8">
            <button class="ghost icon-btn" data-action="ex-add" data-day="${d.id}">+ Exercise</button>
            <button class="ghost icon-btn" data-action="day-rename" data-id="${d.id}">Rename</button>
            <button class="ghost icon-btn red" data-action="day-delete" data-id="${d.id}">Delete</button>
          </div>` : ''}
      </div>`;
    }).join('')}
    <button class="wide mt8" data-action="day-add">+ Add day</button>
    <p class="muted small mt12" style="text-align:center">Tap an exercise to edit targets, swap alternates, or read how to do it.<br>Import a whole new plan from Claude in the ✳️ tab.</p>`;
}

/* ---- history view ---- */
function exerciseHistory(name) {
  const rows = [];
  for (const s of sessions) for (const e of s.exercises) {
    if (e.name.toLowerCase() === name.toLowerCase() && e.sets.length) {
      const best = e.sets.reduce((a, b) => est1RM(b.weight, b.reps) > est1RM(a.weight, a.reps) ? b : a);
      rows.push({ date: s.date, best, e1rm: est1RM(best.weight, best.reps), sets: e.sets });
    }
  }
  return rows;
}
function sparkline(values, w = 300, h = 46) {
  if (values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values), span = (max - min) || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (w - 8) + 4},${h - 6 - ((v - min) / span) * (h - 12)}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${values.map((v, i) => `<circle cx="${(i / (values.length - 1)) * (w - 8) + 4}" cy="${h - 6 - ((v - min) / span) * (h - 12)}" r="3" fill="var(--accent)"/>`).join('')}
  </svg>`;
}
function viewHistory() {
  const exNames = [...new Set(sessions.flatMap(s => s.exercises.map(e => e.name)))].sort();
  if (historyExercise && !exNames.includes(historyExercise)) historyExercise = '';
  const sel = historyExercise || exNames[0] || '';
  const hist = sel ? exerciseHistory(sel) : [];
  const prBest = hist.length ? Math.max(...hist.map(r => r.e1rm)) : 0;
  const bwLast = bodyWeight[bodyWeight.length - 1];
  return `
    <h2 class="section">Body weight</h2>
    <div class="card">
      <div class="row">
        <input id="bw-input" type="number" inputmode="decimal" step="0.1" placeholder="${bwLast ? bwLast.weight : 'e.g. 80'}" style="max-width:130px">
        <span class="muted">${unit()}</span>
        <button class="primary grow" data-action="bw-add">Log today</button>
      </div>
      ${bodyWeight.length ? `
        ${sparkline(bodyWeight.slice(-15).map(b => b.weight))}
        <div class="muted small mt8">Latest: <b class="green">${bwLast.weight} ${unit()}</b> on ${fmtDate(bwLast.date)} · ${bodyWeight.length} entries
          <button class="ghost icon-btn small" data-action="bw-undo" style="float:right">undo last</button></div>` : ''}
    </div>

    <h2 class="section">Exercise progress</h2>
    <div class="card">
      ${exNames.length ? `
        <select data-bind="history-ex">${exNames.map(n => `<option ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        ${hist.length ? `
          ${sparkline(hist.slice(-12).map(r => r.e1rm))}
          <div class="muted small mt8">Best est. 1RM: <b class="amber">${prBest} ${unit()}</b></div>
          <div class="divider"></div>
          ${hist.slice(-8).reverse().map(r => `
            <div class="row between" style="padding:5px 0">
              <span class="muted small">${fmtDate(r.date)}</span>
              <span class="small">${r.sets.map(s => `${s.weight}×${s.reps}`).join(' · ')}</span>
              <span class="small bold ${r.e1rm >= prBest ? 'amber' : ''}">${r.e1rm >= prBest ? '🏆 ' : ''}e1RM ${r.e1rm}</span>
            </div>`).join('')}` : '<p class="muted mt8">No logged sets for this exercise yet.</p>'}`
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
          <span class="chev">${open ? '▾' : '▸'}</span>
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

/* ---- claude tab ---- */
function viewClaude() {
  return `
    <h2 class="section">Get your data to Claude</h2>
    <div class="card">
      <p class="small muted">Copies a coaching prompt + your last 15 sessions, body weight and current plan. Paste it into any Claude chat and ask for your next plan.</p>
      <button class="primary wide mt12" data-action="copy-coach">📋 Copy coaching prompt + data</button>
      <button class="ghost wide mt8" data-action="copy-data">Copy raw data only</button>
    </div>

    <h2 class="section">Import a plan from Claude</h2>
    <div class="card">
      <p class="small muted">Paste the <code class="inline">workout-plan</code> JSON code block Claude gives you. It replaces your current plan (history is kept).</p>
      <textarea id="import-area" class="mt8" placeholder='{"type":"workout-plan", "days":[...]}'></textarea>
      <button class="primary wide mt8" data-action="import-plan">Import plan</button>
    </div>

    <h2 class="section">Cloud sync & AI access</h2>
    <div class="card">
      <div class="row between">
        <span class="bold">Auto-sync</span>
        <button class="icon-btn ${settings.autoSync ? 'success' : ''}" data-action="toggle-autosync">${settings.autoSync ? 'On' : 'Off'}</button>
      </div>
      <div id="sync-status" class="mt8">${syncStatusHtml()}</div>
      <p class="small muted mt8">Syncs automatically after every workout — no setup needed.</p>
      <div class="divider"></div>
      <p class="small muted"><b>Share with AI</b></p>
      <button class="primary wide mt8" data-action="share-ai">🔗 Share with AI</button>
      <p class="small muted mt8">Copies a link you can paste into Claude, ChatGPT, or Gemini. The AI fetches your latest training data automatically.</p>
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

    <h2 class="section">Settings</h2>
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
  const e = i != null ? day.exercises[i] : { name: '', sets: 3, reps: '8-12', weight: 0, targetRpe: 8, restSeconds: 120, description: '', alternates: [] };
  showModal(i != null ? 'Edit exercise' : 'Add exercise', `
    <label class="field"><span>Name</span><input id="f-name" value="${esc(e.name)}"></label>
    <div class="row">
      <label class="field grow"><span>Sets</span><input id="f-sets" type="number" inputmode="numeric" value="${e.sets}"></label>
      <label class="field grow"><span>Reps</span><input id="f-reps" value="${esc(e.reps)}"></label>
    </div>
    <div class="row">
      <label class="field grow"><span>Weight (${unit()})</span><input id="f-weight" type="number" inputmode="decimal" step="0.5" value="${e.weight}"></label>
      <label class="field grow"><span>Target RPE</span><input id="f-rpe" type="number" inputmode="decimal" step="0.5" min="1" max="10" value="${e.targetRpe != null ? e.targetRpe : ''}"></label>
      <label class="field grow"><span>Rest (sec)</span><input id="f-rest" type="number" inputmode="numeric" value="${e.restSeconds}"></label>
    </div>
    <label class="field"><span>How-to / description (optional)</span><textarea id="f-desc" style="min-height:60px">${esc(e.description)}</textarea></label>`,
    [
      { label: 'Save', cls: 'primary', fn: () => {
          const name = mval('f-name'); if (!name) { toast('Name is required', 'err'); return; }
          const upd = { name, sets: Math.max(1, mnum('f-sets', 3)), reps: mval('f-reps') || '8-12', weight: mnum('f-weight'),
            targetRpe: mval('f-rpe') ? mnum('f-rpe') : null, restSeconds: Math.max(0, mnum('f-rest', 120)), description: mval('f-desc') };
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
  const desc = e.description || lookupExplanation(e.name) || 'No description available — ask Claude to include a "description" for each exercise in your next plan.';
  showModal(e.name, `<p>${esc(desc)}</p>
    <p class="muted small mt12">Target: ${e.plannedSets}×${esc(e.plannedReps)} @ ${e.plannedWeight}${unit()}${e.targetRpe ? ' · RPE ' + e.targetRpe : ''}</p>`);
}
function exNoteModal(ei) {
  const e = active.exercises[ei];
  showModal('Note — ' + e.name, `<textarea id="ex-note-area" placeholder="e.g. felt heavy, slight knee pain, used safety bar…">${esc(e.notes)}</textarea>`,
    [
      { label: 'Save', cls: 'primary', fn: () => { e.notes = mval('ex-note-area'); saveActive(); closeModal(); render(); } },
      { label: 'Cancel' }
    ]);
}

/* ================= event wiring ================= */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  unlockAudio(); // every tap keeps the iOS audio context alive

  switch (a) {
    /* navigation */
    case 'modal-dismiss': if (e.target === el) closeModal(); break; // only when tapping the backdrop itself
    case 'modal-btn': { const fn = modalActions[el.dataset.idx]; if (fn) fn(); else closeModal(); break; }

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
      const ex = active.exercises[+el.dataset.ei], s = ex.sets[+el.dataset.si];
      s.done = !s.done;
      saveActive(); render();
      if (s.done) {
        const remaining = active.exercises.some(x => x.sets.some(y => !y.done));
        if (remaining) startRest(ex.restSeconds, 'Rest — ' + ex.name);
        buzz([60]);
      }
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
      showModal('Delete this session?', '<p>This permanently removes it from your history and Claude exports.</p>',
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
    case 'restore-uuid': {
      const raw = mval('restore-uuid-input');
      if (!raw) { toast('Paste your backup code first', 'err'); break; }
      const match = raw.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (!match) { toast('Invalid backup code', 'err'); break; }
      const newUUID = match[1].toLowerCase();
      localStorage.setItem('gymtrack_uuid', newUUID);
      gymUUID = newUUID;
      setSyncState('syncing');
      (async () => {
        try {
          const r = await workerFetch();
          if (!r) { toast('No data found for this backup code', 'err'); setSyncState('error', 'Not found'); return; }
          restoreBackup(r.raw); render(); setSyncState('ok'); toast('Restored ✓');
        } catch (e) { setSyncState('error', e.message); toast('Restore failed: ' + e.message, 'err'); }
      })();
      break;
    }
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
});

/* boot */
store.set('plan', plan); // persist the default plan on first run WITHOUT bumping the sync clock
syncWakeLock();
render();
autoSyncOnLoad(); // reconcile with the cloud, then enable auto-push
