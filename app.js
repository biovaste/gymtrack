/* GymTrack — offline-first gym workout tracker designed to exchange
   plans and logs with AI assistants via JSON. No dependencies. */
'use strict';
const tr = (key, params) => I18n.t(key, params);

/* ================= configuration ================= */
const APP_CONFIG = (() => {
  const cfg = (typeof window !== 'undefined' && window.GYM_CONFIG) || {};
  // Mode comes from the origin alone. app-config.js only supplies version strings:
  // if the personal host ever loads without it (a stale cached index.html), it must
  // still open the personal storage and cloud copy, not an empty alpha profile.
  // Keep in sync with the same check in i18n.js.
  let mode = 'alpha';
  if (typeof location !== 'undefined') {
    const isDevHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const modeParam = new URLSearchParams(location.search).get('mode');
    if (location.hostname === 'gymtrack.hithitpull.fi') mode = 'personal';
    else if (isDevHost && location.port === '8765' && modeParam !== 'alpha') mode = 'personal';
    else if (isDevHost && location.port !== '8766' && modeParam === 'personal') mode = 'personal';
  }
  const isAlpha = mode !== 'personal';
  return {
    mode,
    isAlpha,
    version: isAlpha ? (cfg.alphaVersion || '0.1.0-alpha') : (cfg.version || '1.0.0'),
    build: cfg.build || '2026-09-15',
    cloudSync: true,
    keyPrefix: isAlpha ? 'gym_alpha.' : 'gym.',
    // Each track has its own cloud identity, so alpha data never lands on the personal UUID.
    uuidKey: isAlpha ? 'gymtrack_alpha_uuid' : 'gymtrack_uuid',
    tokenKey: isAlpha ? 'gymtrack_alpha_write_token' : 'gymtrack_write_token'
  };
})();

/* ================= storage ================= */
const corruptData = {}; // In-memory preservation of raw corrupt data
let storageAlert = null;

const store = {
  get prefix() { return APP_CONFIG.keyPrefix; },
  _activeTxId: null,
  rawGet(k) {
    try { return localStorage.getItem(this.prefix + k); } catch (e) { return null; }
  },
  rawSet(k, v) {
    try { localStorage.setItem(this.prefix + k, v); return { ok: true }; }
    catch (e) { return { ok: false, error: e.name || e.message || 'WriteFailed' }; }
  },
  rawDel(k) {
    try { localStorage.removeItem(this.prefix + k); return { ok: true }; }
    catch (e) { return { ok: false, error: e.name || e.message }; }
  },
  hasUnresolvedTx() {
    const raw = this.rawGet('pending_tx');
    if (!raw) {
      delete corruptData['pending_tx'];
      return false;
    }
    try {
      const tx = JSON.parse(raw);
      if (!tx || typeof tx !== 'object') return true;
      if (this._activeTxId && tx.id === this._activeTxId) return false;
      if (tx.status === 'committed') {
        this.rawDel('pending_tx');
        delete corruptData['pending_tx'];
        return false;
      }
      if (tx.status === 'rolled_back') {
        const res = this.rawDel('pending_tx');
        if (res.ok) delete corruptData['pending_tx'];
        return !res.ok;
      }
      if (corruptData['pending_tx'] !== undefined) return true;
      return true;
    } catch (e) {
      return true;
    }
  },
  get(k, d) {
    try {
      const raw = localStorage.getItem(this.prefix + k);
      if (raw === null) return d;
      try {
        const val = JSON.parse(raw);
        // Shape validation to catch unparseable/corrupt objects
        if (k === 'sessions' || k === 'bw') {
          if (!Array.isArray(val)) {
            corruptData[k] = raw;
            storageAlert = tr('storage.error.corrupt_data', { key: k });
            return d;
          }
        } else if (k === 'plan') {
          if (!val || typeof val !== 'object' || !Array.isArray(val.days)) {
            corruptData[k] = raw;
            storageAlert = tr('storage.error.corrupt_data', { key: k });
            return d;
          }
        } else if (k === 'settings' || k === 'aliases') {
          if (!val || typeof val !== 'object' || Array.isArray(val)) {
            corruptData[k] = raw;
            storageAlert = tr('storage.error.corrupt_data', { key: k });
            return d;
          }
        }
        return val;
      } catch (parseErr) {
        corruptData[k] = raw;
        storageAlert = tr('storage.error.corrupt_data', { key: k });
        return d;
      }
    } catch (e) {
      return d;
    }
  },
  set(k, v, opts = {}) {
    if (corruptData[k] !== undefined && !opts.allowCorruptRecovery) {
      console.warn('Blocked overwrite of corrupted key:', k);
      return { ok: false, error: 'corrupt_blocked' };
    }
    if (this.hasUnresolvedTx() && !opts.allowCorruptRecovery && !opts.inTx) {
      console.warn('Blocked write while transaction recovery is unresolved:', k);
      return { ok: false, error: 'recovery_required' };
    }
    try {
      localStorage.setItem(this.prefix + k, JSON.stringify(v));
      return { ok: true };
    } catch (e) {
      console.error('Storage write failed for key:', k, e);
      return { ok: false, error: e.name || e.message || 'WriteFailed' };
    }
  },
  del(k, opts = {}) {
    if (k !== 'pending_tx' && this.hasUnresolvedTx() && !opts.allowCorruptRecovery && !opts.inTx) {
      console.warn('Blocked del while transaction recovery is unresolved:', k);
      return { ok: false, error: 'recovery_required' };
    }
    delete corruptData[k];
    try {
      localStorage.removeItem(this.prefix + k);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.name || e.message };
    }
  },
  /* Durable, crash-safe multi-key commit transaction protocol.
     Records WAL journal into gym_pending_tx before mutating keys.
     Distinguishes in-flight vs committed journal states.
     If write fails, rolls back cleanly; retains journal if rollback fails.
     Prevents subsequent transactions if an unresolved journal exists.
     During recovery replacement (allowCorruptRecovery), durably preserves
     original journal and baseline pre-images until replacement commits. */
  commitTx(writes, opts = {}) {
    let originalTx = null;
    const existingTxRaw = this.rawGet('pending_tx');
    if (existingTxRaw) {
      try {
        const existingTx = JSON.parse(existingTxRaw);
        if (existingTx && existingTx.status !== 'committed' && existingTx.status !== 'rolled_back') {
          if (!opts.allowCorruptRecovery) {
            console.error('commitTx blocked: unresolved pending_tx exists:', existingTx);
            return { ok: false, error: 'UnresolvedPendingTransaction' };
          }
          // Keep existingTx as originalTx to preserve all known pre-images and status.
          // Do not discard existingTx in favor of existingTx.originalTx, which would drop
          // replacement-only pre-images recorded in existingTx.writes.
          originalTx = existingTx;
        }
      } catch (e) {
        if (!opts.allowCorruptRecovery) {
          return { ok: false, error: 'CorruptPendingTransaction' };
        }
        originalTx = { id: uid(), status: 'corrupt', raw: existingTxRaw, writes: [] };
      }
    } else if (corruptData['pending_tx'] !== undefined && !opts.allowCorruptRecovery) {
      return { ok: false, error: 'UnresolvedPendingTransaction' };
    }

    // Build the earliest known pre-image map across all prior transaction generations
    const origPreMap = new Map();
    if (originalTx) {
      const collectPreImages = (tx) => {
        if (!tx) return;
        // Traverse to oldest generation first so earliest pre-images take precedence
        if (tx.originalTx) collectPreImages(tx.originalTx);
        if (Array.isArray(tx.writes)) {
          for (const [k, prevRaw] of tx.writes) {
            // Keep earliest known pre-image for every affected key
            if (!origPreMap.has(k)) {
              origPreMap.set(k, prevRaw);
            }
          }
        }
      };
      collectPreImages(originalTx);
    }

    // Preserve baseline pre-images from all prior transaction generations so partial writes are never treated as baselines.
    // Start with all keys touched by the new writes:
    const journalWrites = writes.map(([k]) => [
      k,
      origPreMap.has(k) ? origPreMap.get(k) : this.rawGet(k)
    ]);
    // Then retain every key previously tracked in origPreMap that is not in the new writes:
    for (const [k, prevRaw] of origPreMap.entries()) {
      if (!writes.some(([wk]) => wk === k)) {
        journalWrites.push([k, prevRaw]);
      }
    }

    const journal = {
      id: uid(),
      status: 'pending',
      createdAt: Date.now(),
      ...(originalTx ? { originalTx } : {}),
      writes: journalWrites
    };
    const jRes = this.rawSet('pending_tx', JSON.stringify(journal));
    if (!jRes.ok) return { ok: false, error: 'JournalWriteFailed: ' + jRes.error };

    this._activeTxId = journal.id;
    let failedKey = null;
    let writeError = null;
    const appliedWrites = [];
    try {
      for (const [key, val] of writes) {
        const preRaw = origPreMap.has(key) ? origPreMap.get(key) : this.rawGet(key);
        const res = val === undefined ? this.del(key, { ...opts, inTx: true }) : this.set(key, val, { ...opts, inTx: true });
        if (!res.ok) {
          failedKey = key;
          writeError = res.error;
          break;
        }
        appliedWrites.push([key, preRaw]);
      }
    } finally {
      this._activeTxId = null;
    }

    if (failedKey !== null) {
      // Rollback applied keys in reverse order using baseline pre-images from journal
      let rollbackAllOk = true;
      const rollbackFailures = [];
      for (const [k, prevRaw] of appliedWrites.reverse()) {
        const rRes = prevRaw === null ? this.rawDel(k) : this.rawSet(k, prevRaw);
        if (!rRes.ok) {
          rollbackAllOk = false;
          rollbackFailures.push(`${k}: ${rRes.error}`);
        }
      }

      if (originalTx) {
        // Recovery / replacement failed! Do NOT delete the journal.
        // Durably preserve the complete combined recovery journal (including keys introduced
        // by the replacement) so mutations remain blocked and all recovery information remains available.
        const preservedTx = {
          id: journal.id,
          status: 'rollback_failed',
          createdAt: journal.createdAt,
          failedKey: failedKey,
          replacementFailures: rollbackFailures.length ? rollbackFailures : undefined,
          isRecovery: true,
          originalTx: originalTx,
          writes: journalWrites
        };
        this.rawSet('pending_tx', JSON.stringify(preservedTx));
        corruptData['pending_tx'] = JSON.stringify(preservedTx);
        storageAlert = tr('storage.error.corrupt_data', { key: 'pending_tx' });
        return {
          ok: false,
          error: rollbackAllOk
            ? `ReplacementFailed(${failedKey}): ${writeError}`
            : `ReplacementRollbackFailed: ${rollbackFailures.join(', ')} (original: ${writeError})`
        };
      }

      if (rollbackAllOk) {
        // Rollback succeeded completely — finalize by deleting pending_tx
        const delRes = this.rawDel('pending_tx');
        if (!delRes.ok) {
          // If deletion fails, record rolled_back so startup recovery does not re-rollback
          this.rawSet('pending_tx', JSON.stringify({ id: journal.id, status: 'rolled_back' }));
        } else {
          delete corruptData['pending_tx'];
        }
        return { ok: false, error: `KeyWriteFailed(${failedKey}): ${writeError}` };
      } else {
        // Rollback FAILED: persistent storage failure on an applied key!
        // Retain the journal so data is not lost and subsequent transactions cannot overwrite it
        journal.status = 'rollback_failed';
        journal.failedKey = failedKey;
        journal.rollbackFailures = rollbackFailures;
        this.rawSet('pending_tx', JSON.stringify(journal));
        corruptData['pending_tx'] = JSON.stringify(journal);
        storageAlert = tr('storage.error.corrupt_data', { key: 'pending_tx' });
        return { ok: false, error: `RollbackFailed: ${rollbackFailures.join(', ')} (original: ${writeError})` };
      }
    }

    // All writes succeeded! Establish durable commit point before deleting journal
    const commitRecord = JSON.stringify({ id: journal.id, status: 'committed', committedAt: Date.now() });
    const cRes = this.rawSet('pending_tx', commitRecord);
    if (!cRes.ok) {
      // Failed to record commit point; attempt direct deletion
      const dRes = this.rawDel('pending_tx');
      if (!dRes.ok) {
        return { ok: false, error: `FinalizationFailed: ${dRes.error}` };
      }
      delete corruptData['pending_tx'];
      return { ok: true };
    }

    // Commit point is durably recorded! Finalize by deleting the committed journal
    const cleanRes = this.rawDel('pending_tx');
    if (!cleanRes.ok) {
      console.warn('commitTx: committed journal cleanup delayed (status is committed):', cleanRes.error);
    } else {
      delete corruptData['pending_tx'];
    }
    return { ok: true };
  }
};

const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtClock = sec => { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + String(s).padStart(2, '0'); };
const fmtDur = min => min >= 60 ? Math.floor(min / 60) + 'h ' + (min % 60) + 'm' : min + ' min';
const fmtDate = iso => I18n.date(iso, { weekday: 'short', month: 'short', day: 'numeric' });
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
  chevUp: '<path d="M6 15l6-6 6 6"/>',
  video: '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 11l6-3.5v9l-6-3.5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>'
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
  if (EX_LIBRARY[n]) return I18n.explanation(name, EX_LIBRARY[n]);
  for (const key of Object.keys(EX_LIBRARY)) {
    if (n.includes(key) || key.includes(n)) return I18n.explanation(name, EX_LIBRARY[key]);
  }
  return null;
}

/* ================= equipment / plate calculator config ================= */
const EQUIPMENT_TYPES = ['barbell', 'trap-bar', 'landmine', 'training-bar', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other'];
const equipmentLabel = id => EQUIPMENT_TYPES.includes(id) ? tr('equipment.name.' + id) : id;
const PLATE_EQUIPMENT = new Set(['barbell', 'trap-bar', 'landmine', 'training-bar']); // shows the plate calculator
const BAR_WEIGHT_EQUIPMENT = new Set(['barbell', 'trap-bar', 'training-bar']); // landmine ignores bar weight entirely
const BAR_WEIGHT_DEFAULTS = { barbell: { kg: 20, lb: 45 }, 'trap-bar': { kg: 23, lb: 50 }, 'training-bar': { kg: 10, lb: 15 } };
function resolvedBarWeight(e) {
  if (e.barWeight != null) return e.barWeight;
  return BAR_WEIGHT_DEFAULTS[e.equipment]?.[unit()] ?? (unit() === 'lb' ? 45 : 20);
}
/*
 * Bodyweight lifts with added external load (weighted pull-ups, dips). The movement
 * stays classified as bodyweight; `weight` is the added load only, 0 = bodyweight
 * only. The athlete's body weight is never added in. Legacy bodyweight records have
 * no flag and keep their meaning — nothing is inferred from 0 or a missing weight.
 * Estimated 1RM and kg × reps volume need the total moved mass, which is not
 * recorded, so they are not calculated for these; progress and PRs use the heaviest
 * added load instead.
 */
const isAddedLoad = e => WorkoutModel.isAddedLoad(e);
const ADDED_LOAD_STEP = { kg: 1.25, lb: 2.5 }; // default stepper increment; a loadProfile overrides it
const loadText = (e, w) => isAddedLoad(e) ? '+' + (w || 0) : w;
function addedLoadBest(sets) {
  return sets.reduce((a, b) => !a || (b.weight || 0) > (a.weight || 0) || ((b.weight || 0) === (a.weight || 0) && (b.reps || 0) > (a.reps || 0)) ? b : a, null);
}
// Compact equipment label for exercise cards, plan rows and swap sheets.
// Bar weight is shown only when it is meaningful and non-default.
function equipChip(e) {
  const eq = e.equipment;
  if (!eq) return '';
  let label = equipmentLabel(eq) || eq;
  if (BAR_WEIGHT_EQUIPMENT.has(eq) && e.barWeight != null) label += ` · ${e.barWeight}${unit()}`;
  if (isAddedLoad(e)) label += ` · ${tr('exercise.added_load.chip')}`;
  if (e.side && e.side !== 'unspecified') label += ` · ${modelLabel(e.side)}`;
  if (e.setupId) label += ` · ${e.setupId}`;
  return `<span class="equip-chip">${esc(label)}</span>`;
}

/*
 * What an exercise's sets measure. 'load' is the default (weight × reps × RPE);
 * 'height' logs one jump attempt per row in cm and carries no weight, reps or
 * RPE at all — absent rather than zero, so nothing downstream mistakes a jump
 * for a 0 kg lift.
 */
const EXERCISE_METRICS = WorkoutModel.metrics;
const isJump = e => e.metric === 'height';
/*
 * Warm-up sets are logged like any other set but must never reach a statistic:
 * a ramp-up single would deflate average intensity, inflate tonnage, and could
 * never be a PR. Every stat surface reads through workingSets(); the session
 * progress bar deliberately does not, because a warm-up set IS work you did and
 * the bar answers "how far through this session am I".
 *
 * `warmup` is omitted rather than set false when absent, so session records
 * written before this existed keep their exact shape.
 */
const workingSets = sets => sets.filter(s => !s.warmup);
const bestHeight = sets => sets.reduce((m, s) => (!s.warmup && s.heightCm != null && s.heightCm > m ? s.heightCm : m), 0);

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
  const p = starterPlan();
  // Starter days are placeholders: an accepted coach program drops them unless edited.
  for (const d of p.days) d.source = { starter: true, hash: WorkoutModel.dayHash(d) };
  return p;
}
function starterPlan() {
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

// Startup recovery: check for an interrupted commit transaction (pending_tx)
(() => {
  const pendingRaw = store.rawGet('pending_tx');
  if (pendingRaw) {
    try {
      const journal = JSON.parse(pendingRaw);
      if (journal && journal.status === 'committed') {
        // Committed cleanup: the transaction reached its durable commit point before termination.
        // Do NOT roll back application keys! Just clean up the committed journal.
        console.log('Startup: cleaning up committed transaction journal:', journal.id);
        store.rawDel('pending_tx');
        delete corruptData['pending_tx'];
        return;
      }
      if (journal && journal.status === 'rolled_back') {
        // Already successfully rolled back prior to termination. Just clean up journal.
        store.rawDel('pending_tx');
        delete corruptData['pending_tx'];
        return;
      }
      if (journal && Array.isArray(journal.writes)) {
        console.warn('Startup: found interrupted pending_tx, rolling back keys:', journal.writes.map(w => w[0]));
        let allRollbackOk = true;
        const rollbackErrors = [];
        for (const [k, prevRaw] of journal.writes) {
          const res = prevRaw === null ? store.rawDel(k) : store.rawSet(k, prevRaw);
          if (!res.ok) {
            allRollbackOk = false;
            rollbackErrors.push(`${k}: ${res.error}`);
          }
        }
        if (allRollbackOk) {
          if (journal.originalTx) {
            console.warn('Startup: interrupted replacement transaction rolled back; retaining recovery journal');
            const preservedTx = Object.assign({}, journal.originalTx, {
              status: 'rollback_failed',
              interruptedAt: Date.now(),
              writes: journal.writes
            });
            store.rawSet('pending_tx', JSON.stringify(preservedTx));
            corruptData['pending_tx'] = JSON.stringify(preservedTx);
            storageAlert = tr('storage.error.corrupt_data', { key: 'pending_tx' });
            return;
          }
          const delRes = store.rawDel('pending_tx');
          if (!delRes.ok) {
            store.rawSet('pending_tx', JSON.stringify({ id: journal.id, status: 'rolled_back' }));
          } else {
            delete corruptData['pending_tx'];
            if (Object.keys(corruptData).length === 0) storageAlert = null;
          }
        } else {
          // Key rollback failed (persistent write failure): retain journal and expose recovery-required state.
          // Retain complete writes from journal (including any keys introduced by replacement)
          console.error('Startup: key restoration failed during rollback:', rollbackErrors);
          const failedTx = Object.assign({}, journal.originalTx || journal, {
            status: 'rollback_failed',
            rollbackErrors,
            writes: journal.writes
          });
          store.rawSet('pending_tx', JSON.stringify(failedTx));
          corruptData['pending_tx'] = JSON.stringify(failedTx);
          storageAlert = tr('storage.error.corrupt_data', { key: 'pending_tx' });
        }
      } else {
        corruptData['pending_tx'] = pendingRaw;
        storageAlert = tr('storage.error.corrupt_data', { key: 'pending_tx' });
      }
    } catch (err) {
      console.error('Startup: failed to parse pending_tx journal:', err);
      corruptData['pending_tx'] = pendingRaw;
      storageAlert = tr('storage.error.corrupt_data', { key: 'pending_tx' });
    }
  }
})();

/* ================= state ================= */
let plan = store.get('plan', null) || defaultPlan();
let sessions = store.get('sessions', []);
let active = store.get('active', null);
let bodyWeight = store.get('bw', []);
let settings = Object.assign({ unit: 'kg', sound: true, vibrate: true, autoSync: APP_CONFIG.cloudSync }, store.get('settings', {}));
delete settings.gistToken; delete settings.gistId; delete settings.gistOwner;
// Alpha shipped with cloud sync forced off; turn it on once now that alpha syncs too.
if (APP_CONFIG.isAlpha && !settings.alphaCloud) { settings.autoSync = true; settings.alphaCloud = 1; store.set('settings', settings); }

// Startup recovery check for interrupted workout completion
if (active && sessions.some(s => s.id === active.id)) {
  console.log('Startup: active workout already recorded in sessions, clearing stale draft:', active.id);
  active = null;
  store.del('active');
}

const WORKER_URL = 'https://api.gymtrack.hithitpull.fi';
let gymUUID = (() => {
  let id = localStorage.getItem(APP_CONFIG.uuidKey);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(APP_CONFIG.uuidKey, id); }
  return id;
})();
let writeToken = localStorage.getItem(APP_CONFIG.tokenKey) || '';
let aliases = store.get('aliases', {}); // { aliasLowercase: 'Canonical Name' } — display-time merge of exercise names
let tab = 'workout';
let prevTab = 'workout';      // where the settings view returns to
let expandedDay = null;       // plan view expansion
let expandedSession = null;   // history view expansion
let historyExercise = '';     // history exercise picker
let exExpanded = new Set();   // re-expanded completed exercises (exercise objects) and supersets ('ss:'+tag)
let readinessOpen = null;     // null = auto (open until data/sets exist), true/false = manual override
let warmupOpen = null;        // null = auto (open until every item is checked), true/false = manual override

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
  if (syncReady && APP_CONFIG.cloudSync) scheduleSync();
}
function savePlan() {
  const res = store.set('plan', plan);
  if (!res.ok) { toast(tr('storage.error.save_failed', { item: tr('navigation.plan') }), 'err'); return false; }
  touch();
  return true;
}
function saveAliases() {
  const res = store.set('aliases', aliases);
  if (!res.ok) { toast(tr('storage.error.save_failed', { item: 'Aliases' }), 'err'); return false; }
  touch();
  return true;
}
function saveSessions() {
  const res = store.set('sessions', sessions);
  if (!res.ok) { toast(tr('storage.error.save_failed', { item: tr('navigation.history') }), 'err'); return false; }
  touch();
  return true;
}
function saveActive() {
  if (active) {
    const res = store.set('active', active);
    if (!res.ok) { toast(tr('storage.error.save_failed', { item: tr('navigation.workout') }), 'err'); return false; }
  } else {
    const res = store.del('active');
    if (!res.ok) { toast(tr('storage.error.save_failed', { item: tr('navigation.workout') }), 'err'); return false; }
  }
  return true;
}
function saveBW() {
  const res = store.set('bw', bodyWeight);
  if (!res.ok) { toast(tr('storage.error.save_failed', { item: tr('view_coach.text.body_weight_log') }), 'err'); return false; }
  touch();
  return true;
}
function saveSettings() {
  const res = store.set('settings', settings);
  if (!res.ok) { toast(tr('storage.error.save_failed', { item: tr('navigation.settings') }), 'err'); return false; }
  return true;
}
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
  if (document.visibilityState === 'visible') { unlockAudio(); syncWakeLock(); refreshCoachInbox(); }
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
  rest = { endsAt: Date.now() + seconds * 1000, total: seconds, label: label || tr("start_rest.message.rest"), fired: false, cueFired: false, cueNodes: null };
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
        <div class="muted small">${over ? tr("render_rest.message.rest_over_go") : esc(rest.label)}</div>
        <div class="rest-time ${over ? 'green' : ''}">${over ? '0:00' : fmtClock(remain)}</div>
      </div>
      ${over ? '' : `<button class="icon-btn" data-action="rest-sub">${esc(tr("render_rest.text.15s"))}</button>`}
      <button class="icon-btn" data-action="rest-add">${esc(tr("render_rest.text.15s_2"))}</button>
      <button class="icon-btn ${over ? 'success' : ''}" data-action="rest-skip">${over ? tr("render_rest.message.ok") : tr("render_rest.message.skip")}</button>
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
  tickExerciseTimer();
  // live session clock
  const chip = document.getElementById('session-chip');
  if (active) {
    chip.classList.remove('hidden');
    chip.textContent = '⏱ ' + fmtClock((Date.now() - active.startedAt) / 1000);
  } else chip.classList.add('hidden');
  // keep the "synced X min ago" line fresh while the AI Coach tab is open
  const sEl = document.getElementById('sync-status');
  if (sEl && syncState !== 'syncing') sEl.innerHTML = syncStatusHtml();
}, 1000);

/* ================= exercise timer (sets prescribed by time) ================= */
/*
 * Distinct from the rest timer. The state lives on the set row it times
 * (`set.timer`), so it persists with the active workout, moves with a reordered
 * exercise, disappears with a removed set, swap, discard or finish, and can never
 * leak into a session record (recordSet copies measurement fields only).
 *
 *   { targetSec, state: 'running' | 'paused' | 'expired', endsAt?, remainingMs?, alerted }
 *
 * Rules:
 * - At most one exercise timer exists. Starting one replaces any other and ends a
 *   running rest, so two countdowns can never alarm over each other.
 * - Expiry never logs the set or writes a measurement. "Log" is an explicit tap that
 *   writes the elapsed time into the editable duration field, then follows the normal
 *   set-completion path (rest, warm-up and superset rules unchanged).
 * - Logging any set ends the exercise timer before a rest can start.
 * - The deadline is wall-clock based: reloads and backgrounding neither reset nor
 *   stretch it. An expiry discovered more than TIMER_STALE_MS late (app was
 *   suspended) is shown as finished without sounding a stale alarm; `alerted` is
 *   persisted so the cue can never repeat.
 */
const TIMER_STALE_MS = 5000;
let exTimerCue = null; // { endsAt, nodes, delivered } — live AudioNodes, never persisted
function timerTargetSec(e, s) {
  if (!e || !s || s.done || (e.metric !== 'duration' && e.metric !== 'cardio')) return null;
  if (s.durationSeconds > 0) return s.durationSeconds;
  return e.durationSeconds > 0 ? e.durationSeconds : null;
}
function findExerciseTimer() {
  if (!active) return null;
  for (let ei = 0; ei < active.exercises.length; ei++) {
    const sets = active.exercises[ei].sets;
    for (let si = 0; si < sets.length; si++) if (sets[si].timer) return { ei, si, e: active.exercises[ei], s: sets[si], t: sets[si].timer };
  }
  return null;
}
function timerRemainingMs(t, now = Date.now()) {
  if (t.state === 'running') return Math.max(0, t.endsAt - now);
  if (t.state === 'paused') return Math.max(0, t.remainingMs);
  return 0;
}
function timerElapsedSec(t, now = Date.now()) {
  return Math.max(0, Math.round((t.targetSec * 1000 - timerRemainingMs(t, now)) / 1000));
}
// Remove every exercise timer; returns what was removed so a failed save can restore it.
function takeExerciseTimers() {
  const taken = [];
  if (!active) return taken;
  for (const e of active.exercises) for (const s of e.sets) if (s.timer) { taken.push([s, s.timer]); delete s.timer; }
  return taken;
}
const restoreExerciseTimers = taken => taken.forEach(([s, t]) => { s.timer = t; });
// Apply a timer mutation atomically: persisted or fully reverted.
function mutateExerciseTimer(fn) {
  const before = active.exercises.flatMap(e => e.sets.map(s => [s, s.timer ? { ...s.timer } : null]));
  fn();
  if (!saveActive()) {
    for (const [s, t] of before) { if (t) s.timer = t; else delete s.timer; }
    render();
    return false;
  }
  render();
  return true;
}
function startExerciseTimer(ei, si) {
  const e = active && active.exercises[ei], s = e && e.sets[si];
  const target = timerTargetSec(e, s);
  if (!target) return;
  unlockAudio(); // the tap is the user gesture that lets the alarm play later
  const ok = mutateExerciseTimer(() => {
    takeExerciseTimers();
    s.timer = { targetSec: target, state: 'running', endsAt: Date.now() + target * 1000, alerted: false };
  });
  if (ok && rest) stopRest();
}
function pauseExerciseTimer(ei, si) {
  const s = active.exercises[ei].sets[si], t = s.timer;
  if (!t || t.state !== 'running') return;
  mutateExerciseTimer(() => { s.timer = { targetSec: t.targetSec, state: 'paused', remainingMs: timerRemainingMs(t), alerted: false }; });
}
function resumeExerciseTimer(ei, si) {
  const s = active.exercises[ei].sets[si], t = s.timer;
  if (!t || t.state !== 'paused') return;
  unlockAudio();
  mutateExerciseTimer(() => { s.timer = { targetSec: t.targetSec, state: 'running', endsAt: Date.now() + t.remainingMs, alerted: false }; });
}
function resetExerciseTimer(ei, si) {
  const s = active.exercises[ei].sets[si], t = s.timer;
  if (!t) return;
  mutateExerciseTimer(() => { s.timer = { targetSec: t.targetSec, state: 'paused', remainingMs: t.targetSec * 1000, alerted: false }; });
}
function cancelExerciseTimer(ei, si) {
  const s = active.exercises[ei].sets[si];
  if (!s.timer) return;
  mutateExerciseTimer(() => { delete s.timer; });
}
function logExerciseTimer(ei, si) {
  const e = active.exercises[ei], s = e.sets[si], t = s.timer;
  if (!t || s.done) return;
  const elapsed = timerElapsedSec(t);
  if (!(elapsed > 0)) { toast(tr('timer.error.nothing_elapsed'), 'err'); return; }
  const prevDuration = s.durationSeconds;
  s.durationSeconds = elapsed;
  delete s.timer;
  s.done = true;
  if (completeSet(ei, si) === false) {
    s.durationSeconds = prevDuration;
    s.timer = t;
    render();
  }
}
function cancelExerciseTimerCue() {
  if (!exTimerCue) return;
  for (const o of exTimerCue.nodes) { try { o.onended = null; o.stop(); } catch (e) {} }
  exTimerCue = null;
}
// Keep exactly one scheduled alarm matching the running timer (or none).
function syncExerciseTimerCue() {
  const f = findExerciseTimer();
  const endsAt = f && f.t.state === 'running' && settings.sound ? f.t.endsAt : null;
  if (exTimerCue && exTimerCue.endsAt === endsAt) return;
  cancelExerciseTimerCue();
  if (!endsAt || endsAt <= Date.now()) return;
  unlockAudio();
  if (!audioCtx) return;
  try {
    const cue = { endsAt, nodes: [], delivered: false };
    const t0 = audioCtx.currentTime + (endsAt - Date.now()) / 1000;
    for (let i = 0; i < 2; i++) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'square'; o.frequency.value = 660;       // lower and longer than the rest cue
      o.connect(g); g.connect(audioCtx.destination);
      const t = t0 + i * 0.7;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.start(t); o.stop(t + 0.6);
      if (i === 0) o.onended = () => { if (exTimerCue === cue) cue.delivered = true; };
      cue.nodes.push(o);
    }
    exTimerCue = cue;
  } catch (e) {}
}
function tickExerciseTimer() {
  const f = findExerciseTimer();
  if (!f) return;
  const now = Date.now();
  if (f.t.state === 'running' && now >= f.t.endsAt) {
    const late = now - f.t.endsAt;
    const delivered = !!(exTimerCue && exTimerCue.delivered && exTimerCue.endsAt === f.t.endsAt);
    f.s.timer = { targetSec: f.t.targetSec, state: 'expired', alerted: true };
    if (!f.t.alerted && late < TIMER_STALE_MS) {
      if (!delivered) beep(2, 660);
      buzz([300, 120, 300]);
    }
    exTimerCue = null;
    saveActive(); // best effort: the deadline is already persisted, so a failed write re-derives the same state
    // Swap only this timer's block. A full render() here would steal focus from whatever
    // field the athlete is typing in (closing the phone keyboard) or cancel a drag.
    const block = document.querySelector(`[data-extimer-clock="${f.ei}-${f.si}"]`)?.closest('.ex-timer');
    if (block) block.outerHTML = exerciseTimerControls(f.e, f.ei, f.s, f.si);
    return;
  }
  const remain = Math.ceil(timerRemainingMs(f.t, now) / 1000);
  const clock = document.querySelector(`[data-extimer-clock="${f.ei}-${f.si}"]`);
  if (clock) clock.textContent = fmtClock(remain);
  const elapsed = document.querySelector(`[data-extimer-elapsed="${f.ei}-${f.si}"]`);
  if (elapsed) elapsed.textContent = tr('timer.action.log', { time: fmtClock(timerElapsedSec(f.t, now)) });
}
function exerciseTimerControls(e, ei, s, si) {
  const target = timerTargetSec(e, s);
  if (!target) return '';
  const t = s.timer;
  const attrs = `data-ei="${ei}" data-si="${si}"`;
  if (!t) {
    return `<div class="ex-timer idle">
      <button class="primary ex-timer-start" data-action="extimer-start" ${attrs}>${icon('timer', 18)} ${esc(tr('timer.action.start'))}</button>
      <span class="muted small">${esc(tr('timer.text.target', { time: fmtClock(target) }))}</span>
    </div>`;
  }
  const expired = t.state === 'expired';
  const status = expired ? tr('timer.status.finished', { time: fmtClock(t.targetSec) })
    : t.state === 'paused' ? tr('timer.status.paused', { time: fmtClock(t.targetSec) })
    : tr('timer.status.running', { time: fmtClock(t.targetSec) });
  return `<div class="ex-timer ${t.state}" role="group" aria-label="${esc(tr('timer.label', { exercise: I18n.exercise(e.name) }))}">
    <div class="row between">
      <div class="grow">
        <div class="ex-timer-clock" role="timer" data-extimer-clock="${ei}-${si}">${expired ? '0:00' : fmtClock(Math.ceil(timerRemainingMs(t) / 1000))}</div>
        <div class="small ${expired ? 'green bold' : 'muted'}" aria-live="polite">${esc(status)}</div>
      </div>
      <button class="icon-btn ghost" data-action="extimer-cancel" ${attrs} aria-label="${esc(tr('timer.action.cancel'))}" title="${esc(tr('timer.action.cancel'))}">✕</button>
    </div>
    <div class="row ex-timer-actions mt8">
      ${t.state === 'running' ? `<button class="ghost" data-action="extimer-pause" ${attrs}>${esc(tr('timer.action.pause'))}</button>` : ''}
      ${t.state === 'paused' ? `<button class="ghost" data-action="extimer-resume" ${attrs}>${esc(tr('timer.action.resume'))}</button><button class="ghost" data-action="extimer-reset" ${attrs}>${esc(tr('timer.action.reset'))}</button>` : ''}
      <button class="success grow" data-action="extimer-log" ${attrs} data-extimer-elapsed="${ei}-${si}">${esc(tr('timer.action.log', { time: fmtClock(timerElapsedSec(t)) }))}</button>
    </div>
    ${expired ? '' : `<p class="small muted mt8">${esc(tr('timer.text.foreground_only'))}</p>`}
  </div>`;
}

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
  const btns = (actions || [{ label: tr("common.action.close") }]).map((a, i) => {
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

/* ================= plan validation & normalization ================= */
function validatePlanImport(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(tr("normalize_plan.message.not_a_json_object"));
  }
  if (raw.type && raw.type !== 'workout-plan') {
    throw new Error(tr("normalize_plan.message.json_type_should_be_workout_plan"));
  }
  if (raw.version != null && (typeof raw.version !== 'number' || raw.version > 1 || raw.version < 1)) {
    throw new Error(tr("plan_import.error.unsupported_version", { version: raw.version }));
  }
  if (!Array.isArray(raw.days) || !raw.days.length) {
    throw new Error(tr("normalize_plan.message.plan_needs_a_non_empty_days_array"));
  }
  if (raw.library != null && !Array.isArray(raw.library)) {
    throw new Error(tr("plan_import.error.library_must_be_array"));
  }
  for (let di = 0; di < raw.days.length; di++) {
    const d = raw.days[di];
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      throw new Error(tr("normalize_plan.message.day_needs_an_exercises_array", { d_name: '#' + (di + 1) }));
    }
    if (!Array.isArray(d.exercises)) {
      throw new Error(tr("normalize_plan.message.day_needs_an_exercises_array", { d_name: d.name || '#' + (di + 1) }));
    }
    for (let ei = 0; ei < d.exercises.length; ei++) {
      const e = d.exercises[ei];
      if (!e || typeof e !== 'object' || Array.isArray(e) || !e.name) {
        throw new Error(tr("normalize_plan.message.every_exercise_needs_a_name"));
      }
    }
  }
  return true;
}
// Only the known fields of a day's origin survive import; anything else is dropped.
function daySource(src) {
  if (!src || typeof src !== 'object') return {};
  if (src.starter === true) return { source: { starter: true, ...(typeof src.hash === 'string' ? { hash: src.hash } : {}) } };
  if (typeof src.coachId !== 'string' || !src.coachId) return {};
  const out = { coachId: src.coachId, coachName: String(src.coachName || ''), assignmentId: String(src.assignmentId || '') };
  if (typeof src.hash === 'string') out.hash = src.hash;
  return { source: out };
}
function normalizePlan(raw) {
  if (!raw || typeof raw !== 'object') throw new Error(tr("normalize_plan.message.not_a_json_object"));
  if (raw.type && raw.type !== 'workout-plan') throw new Error(tr("normalize_plan.message.json_type_should_be_workout_plan"));
  if (!Array.isArray(raw.days) || !raw.days.length) throw new Error(tr("normalize_plan.message.plan_needs_a_non_empty_days_array"));
  const libraryProblems = raw.library == null ? [] : WorkoutModel.libraryListErrors(raw.library);
  if (libraryProblems.length) throw new Error(tr('exercise.model.invalid', { fields: libraryProblems.join(', ') }));
  const p = {
    type: 'workout-plan', version: 1,
    ...(raw.library ? { library: JSON.parse(JSON.stringify(raw.library)) } : {}),
    name: String(raw.name || tr("normalize_plan.message.imported_plan")),
    createdAt: raw.createdAt || today(),
    days: raw.days.map(d => {
      if (!Array.isArray(d.exercises)) throw new Error(tr("normalize_plan.message.day_needs_an_exercises_array", { d_name: d.name || '?' }));
      return {
        id: d.id || uid(), name: String(d.name || tr("normalize_plan.message.day")),
        ...daySource(d.source),
        // Day-level warm-up: a checklist of general prep (bike, band work,
        // mobility), not logged sets. Bare strings are accepted so a plan can
        // write ["Bike 5 min", "Band pull-apart x20"] without ceremony.
        warmup: Array.isArray(d.warmup) ? d.warmup.map(w => (typeof w === 'string'
          ? { name: w.trim(), detail: '' }
          : { name: String(w && w.name || '').trim(), detail: String(w && w.detail || '') })).filter(w => w.name) : [],
        exercises: d.exercises.map(e => {
          if (!e.name) throw new Error(tr("normalize_plan.message.every_exercise_needs_a_name"));
          const problems = [e, ...(e.alternates || [])].flatMap(WorkoutModel.errors);
          // Main exercises default to barbell/load when omitted, and alternates inherit from
          // the main exercise, so the combination is checked on the resolved values.
          const addedLoadMismatch = x => x.addedLoad === true && (x.equipment !== 'bodyweight' || (x.metric || 'load') !== 'load');
          if (addedLoadMismatch(e) || (e.alternates || []).some(a => a && addedLoadMismatch({ addedLoad: a.addedLoad, equipment: a.equipment || e.equipment, metric: a.metric || e.metric }))) problems.push('addedLoad / equipment');
          if ([e, ...(e.alternates || [])].some(x => x && x.addedLoad === true && Number(x.weight) < 0)) problems.push('addedLoad / weight');
          if (problems.length) throw new Error(tr('exercise.model.invalid', { fields: problems.join(', ') }));
          return {
            ...WorkoutModel.metadata(e),
            id: e.id || uid(), name: String(e.name),
            sets: Math.max(1, parseInt(e.sets, 10) || 3),
            // Ramp-up sets prepended to the working sets. `sets` keeps meaning
            // WORKING sets, so raising warmupSets never changes the prescription.
            warmupSets: Math.max(0, parseInt(e.warmupSets, 10) || 0),
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
              ...WorkoutModel.metadata(a),
              name: String(a.name), weight: parseFloat(a.weight) || 0, description: String(a.description || ''),
              // Omitted equipment means "same as the parent" — keep it absent rather than
              // defaulting to barbell, so a swap inherits instead of silently relabelling.
              equipment: EQUIPMENT_TYPES.includes(a.equipment) ? a.equipment : null,
              barWeight: a.barWeight != null && a.barWeight !== '' ? parseFloat(a.barWeight) : null,
              // Same inherit-when-omitted rule as equipment. Without this, swapping a
              // jump exercise for a loaded alternate left the exercise on metric
              // 'height' — a "# | cm | ✓" grid with nowhere to put weight or reps.
              metric: EXERCISE_METRICS.includes(a.metric) ? a.metric : null
            })) : []
          };
        })
      };
    })
  };
  return p;
}

/* ================= exercise name aliases ================= */
function modelLabel(field) { return tr('exercise.model.' + field); }
function modelOptions(metric) {
  return EXERCISE_METRICS.map(m => `<option value="${m}" ${m === (metric || 'load') ? 'selected' : ''}>${esc(modelLabel(m))}</option>`).join('');
}
function modelFields(e, prefix) {
  const all = [...plan.days.flatMap(d => d.exercises), ...sessions.flatMap(s => s.exercises)];
  const movements = new Map(all.filter(x => x.movementId).map(x => [x.movementId, x.name]));
  const setups = new Map(all.filter(x => x.setupId).map(x => [x.setupId, x]));
  const input = (key, value, type = 'text') => `<label class="field" data-model-field="${key}" ${['durationSeconds', 'distanceMeters', 'speedKph'].includes(key) && !WorkoutModel.targetFields(e).includes(key) ? 'hidden' : ''}><span>${esc(modelLabel(key))}</span><input id="${prefix}-${key}" type="${type}" ${type === 'number' ? 'min="0" step="any"' : ''} value="${esc(value ?? '')}"></label>`;
  return `<details class="mt8"><summary>${esc(modelLabel('identity_setup'))}</summary>
    <p class="small muted">${esc(modelLabel('identity_hint'))}</p>
    <label class="field"><span>${esc(modelLabel('movementId'))}</span><input id="${prefix}-movementId" list="${prefix}-movements" value="${esc(e.movementId || '')}"><datalist id="${prefix}-movements">${[...movements].map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('')}</datalist></label>
    <label class="field"><span>${esc(modelLabel('side'))}</span><select id="${prefix}-side">${WorkoutModel.sides.map(s => `<option value="${s}" ${s === (e.side || 'unspecified') ? 'selected' : ''}>${esc(modelLabel(s))}</option>`).join('')}</select></label>
    <label class="field"><span>${esc(modelLabel('setupId'))}</span><input id="${prefix}-setupId" list="${prefix}-setups" data-bind="setup-profile" data-prefix="${prefix}" value="${esc(e.setupId || '')}"><datalist id="${prefix}-setups">${[...setups.keys()].map(id => `<option value="${esc(id)}"></option>`).join('')}</datalist></label>
    <p class="small muted">${esc(modelLabel('profile_hint'))}</p>
    <input id="${prefix}-profileUnit" type="hidden" value="${esc(e.loadProfile?.unit || unit())}">
    ${input('offset', e.loadProfile?.offset, 'number')}${input('increment', e.loadProfile?.increment, 'number')}${input('loads', e.loadProfile?.loads?.join(', '))}
    </details>
    <div class="model-targets" data-prefix="${prefix}" ${WorkoutModel.timed(e) ? '' : 'hidden'}>
    ${input('durationSeconds', e.durationSeconds, 'number')}${input('distanceMeters', e.distanceMeters, 'number')}${input('speedKph', e.speedKph, 'number')}
    <label class="field" data-model-field="pace" ${e.metric === 'cardio' ? '' : 'hidden'}><span>${esc(modelLabel('pace'))}</span><input id="${prefix}-pace" placeholder="5:00" data-bind="target-pace" data-prefix="${prefix}"></label>
    <p class="small muted">${esc(modelLabel('measurement_hint'))}</p></div>`;
}
function readModelFields(prefix, metric) {
  const value = k => document.getElementById(`${prefix}-${k}`)?.value.trim() || '';
  const out = { movementId: value('movementId') || undefined, side: value('side') || 'unspecified', setupId: value('setupId') || undefined, loadProfile: undefined,
    durationSeconds: undefined, distanceMeters: undefined, speedKph: undefined };
  if (value('offset') || value('increment') || value('loads')) {
    out.loadProfile = { unit: value('profileUnit') || unit(), offset: Number(value('offset') || 0),
      ...(value('loads') ? { loads: value('loads').split(',').map(v => Number(v.trim())) } : { increment: Number(value('increment')) }) };
  }
  if (WorkoutModel.timed({ metric })) {
    for (const k of WorkoutModel.targetFields({ metric })) if (value(k)) out[k] = Number(value(k));
  }
  const errors = WorkoutModel.errors({ ...out, metric });
  if (errors.length) throw new Error(tr('exercise.model.invalid', { fields: errors.join(', ') }));
  return out;
}
function measurementText(e, s) {
  if (e.metric === 'height') return `${s.heightCm ?? '—'} cm`;
  if (!WorkoutModel.timed(e)) return `${s.weight != null ? loadText(e, s.weight) : '—'}${unit()}×${s.reps ?? '—'}${s.rpe != null ? '@' + s.rpe : ''}`;
  const parts = [];
  if (s.weight) parts.push(`${s.weight}${unit()}`);
  if (s.durationSeconds != null) parts.push(`${s.durationSeconds} s`);
  if (s.distanceMeters != null) parts.push(`${s.distanceMeters} m`);
  const speed = WorkoutModel.speed(s);
  if (speed) parts.push(`${Math.round(speed * 100) / 100} km/h`, `${fmtClock(3600 / speed)} min/km`);
  if (s.rpe != null) parts.push(`RPE ${s.rpe}`);
  return parts.join(' · ') || '—';
}
function measurementGrid(e, ei) {
  const fields = ['weight', ...(e.metric !== 'distance' ? ['durationSeconds'] : []), ...(e.metric !== 'duration' ? ['distanceMeters'] : []), ...(e.metric === 'cardio' ? ['speedKph'] : [])];
  return e.sets.map((s, si) => `<div class="measurement-set mt8">
    <div class="row between"><button class="set-no-btn" data-action="set-warmup" data-ei="${ei}" data-si="${si}">${s.warmup ? 'W' : ''}${si + 1}</button>
    <button class="rpe-btn" data-action="rpe-pick" data-ei="${ei}" data-si="${si}">RPE ${s.rpe ?? '—'}</button>
    <button class="set-done-btn ${s.done ? 'success' : ''}" data-action="set-done" data-ei="${ei}" data-si="${si}">${s.done ? '✓' : '○'}</button></div>
    <div class="measurement-fields">${fields.map(f => `<label class="field"><span>${esc(f === 'weight' ? unit() : modelLabel(f))}</span><input type="number" min="0" step="any" data-bind="set" data-ei="${ei}" data-si="${si}" data-f="${f}" value="${s[f] ?? ''}"></label>`).join('')}</div>
    <div class="muted small" data-measurement-summary="${ei}-${si}">${esc(measurementText(e, s))}</div>
    ${exerciseTimerControls(e, ei, s, si)}</div>`).join('');
}
function historyLabel(e) {
  return [I18n.exercise(e.name), e.side && e.side !== 'unspecified' ? modelLabel(e.side) : '', e.setupId || '', modelLabel(e.metric || 'load')].filter(Boolean).join(' · ');
}
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
      if (typeof name === 'object' ? WorkoutModel.key(e, canonicalName) !== WorkoutModel.key(name, canonicalName) : !sameExercise(e.name, name)) continue;
      const ws = workingSets(e.sets); // "Last:" is a comparison line — ramp-ups aren't
      if (ws.length) {
        // Missing metric = pre-jump-feature record; treat as 'load' (backward compat).
        return { date: sessions[i].date, sets: ws, jump: e.metric === 'height', metric: e.metric, equipment: e.equipment, addedLoad: e.addedLoad };
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
// How many separate adjacent runs each tag forms. MIRRORS the check in
// tools/push-plan.mjs — used to refuse an edit that would split a group, since
// push-plan only sees a plan on its way out and the phone edits it in place.
function supersetRunCounts(list) {
  const runs = new Map();
  let prev = null;
  for (const e of list) {
    const tag = e.superset || null;
    if (tag && tag !== prev) runs.set(tag, (runs.get(tag) || 0) + 1);
    prev = tag;
  }
  return runs;
}
function groupOf(list, ei) {
  const g = supersetGroups(list).find(x => x.idx.includes(ei));
  // A one-member "group" is not a superset. Treating it as one wraps a single
  // exercise in a superset card and routes it through the round-robin rest
  // logic for a round it is the only member of — so the whole superset path
  // stays off until there are actually two members to alternate between.
  return g && g.tag && g.idx.length > 1 ? g : null;
}
const isRealGroup = g => !!(g.tag && g.idx.length > 1);
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

/* ================= warm-up set ramps ================= */
/*
 * Seeds for prescribed warm-up rows. Every value is a starting point to edit at
 * the rack, not a prescription — but it has to be a weight that EXISTS, so each
 * rung is rounded down onto the real loadable ladder. Rounding down, never up,
 * so a warm-up can't accidentally come out heavier than intended.
 */
const WARMUP_RAMPS = { 1: [0.6], 2: [0.5, 0.75], 3: [0.4, 0.6, 0.8] };
function warmupRamp(n) {
  if (WARMUP_RAMPS[n]) return WARMUP_RAMPS[n];
  return Array.from({ length: n }, (_, i) => 0.4 + 0.45 * (i / (n - 1)));
}
function roundDownToRung(equipment, barWeight, weight) {
  if (equipment === 'bodyweight') return 0;
  // isLoadable short-circuits true for 'other' (no ladder is enforced there),
  // which would leave a ramp sitting at 33.6 kg. Round it to something human.
  if (equipment === 'other') return Math.round(weight * 2) / 2;
  if (isLoadable(equipment, barWeight, weight)) return ladderRound(weight);
  return nextWeight(equipment, barWeight, weight, -1);
}
// The set rows a session starts with: warm-up rows first, then the working sets.
function buildSetRows(e) {
  if (WorkoutModel.timed(e)) return Array.from({ length: e.sets }, () => WorkoutModel.row(e));
  const jump = e.metric === 'height';
  const work = Array.from({ length: e.sets }, () => jump
    ? ({ heightCm: null, done: false })
    : ({ weight: e.weight, reps: parseRepsLow(e.reps), rpe: e.targetRpe, done: false }));
  const n = Math.max(0, parseInt(e.warmupSets, 10) || 0);
  // A jump attempt has no load to ramp — a warm-up jump is still markable by
  // tapping its row number, it just isn't something a plan can prescribe.
  if (!n || jump) return work;
  const eq = e.equipment || 'barbell';
  const warm = warmupRamp(n).map(f => ({
    weight: e.loadProfile ? WorkoutModel.nextLoad(e.loadProfile, e.weight * f + 1e-6, -1) : roundDownToRung(eq, e.barWeight, e.weight * f),
    reps: parseRepsLow(e.reps), rpe: null, warmup: true, done: false
  }));
  return warm.concat(work);
}

/* ================= session logic ================= */
function startSession(dayId) {
  const day = plan.days.find(d => d.id === dayId);
  if (!day) return;
  unlockAudio();
  const newActive = {
    id: uid(), dayId: day.id, dayName: day.name, startedAt: Date.now(), notes: '',
    readiness: {},
    warmup: (day.warmup || []).map(w => ({ name: w.name, detail: w.detail || '', done: false })),
    exercises: day.exercises.map(e => ({
      ...WorkoutModel.metadata(e),
      name: e.name, planId: e.id, swappedFrom: null,
      plannedSets: e.sets, plannedReps: e.reps, plannedWeight: e.weight,
      targetRpe: e.targetRpe, restSeconds: e.restSeconds, restSecondsNext: e.restSecondsNext,
      equipment: e.equipment || 'barbell', barWeight: e.barWeight,
      metric: e.metric || 'load', superset: e.superset || null,
      description: e.description, alternates: e.alternates, notes: '',
      sets: buildSetRows(e)
    }))
  };
  const prevActive = active;
  active = newActive;
  if (!saveActive()) {
    active = prevActive;
    return;
  }
  exExpanded = new Set(); readinessOpen = null; warmupOpen = null;
  syncWakeLock(); render();
  toast(tr("start_session.message.session_started_go_crush_it"));
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
  const prevActive = active;
  active = null;
  if (!saveActive()) {
    active = prevActive;
    return false;
  }
  stopRest(); syncWakeLock();
  exExpanded = new Set(); readinessOpen = null; warmupOpen = null;
  return true;
}
function finishSession() {
  if (!active) return;
  const durationMin = Math.max(1, Math.round((Date.now() - active.startedAt) / 60000));
  const record = {
    id: active.id, date: new Date(active.startedAt).toISOString(), dayName: active.dayName,
    durationMin, notes: active.notes,
    exercises: active.exercises
      .map(e => ({ ...WorkoutModel.metadata(e), name: e.name, description: e.description, plannedSets: e.plannedSets, plannedReps: e.plannedReps,
        plannedWeight: e.plannedWeight, targetRpe: e.targetRpe,
        equipment: e.equipment, barWeight: e.barWeight, metric: e.metric || 'load',
        superset: e.superset || null,
        swappedFrom: e.swappedFrom, notes: e.notes,
        sets: e.sets.filter(s => s.done).map(s => {
          const rec = WorkoutModel.recordSet(e, s);
          if (s.warmup) rec.warmup = true; // omitted when false — old records keep their exact shape
          return rec;
        }) }))
      .filter(e => e.sets.length)
  };
  const rd = active.readiness || {};
  if (rd.cmjCm != null || rd.broadJumpCm != null || rd.subjectiveEnergy != null) record.readiness = rd;
  if (active.warmup && active.warmup.length) {
    record.warmup = { total: active.warmup.length, done: active.warmup.filter(w => w.done).length };
  }
  const prs = detectPRs(record);

  // Check if active.id is already in sessions (retry / restart idempotency)
  const existingIdx = sessions.findIndex(s => s.id === active.id);
  const updatedSessions = existingIdx >= 0
    ? sessions.map((s, i) => i === existingIdx ? record : s)
    : [...sessions, record];

  const txRes = store.commitTx([
    ['sessions', updatedSessions],
    ['active', undefined]
  ]);
  if (!txRes.ok) {
    showModal(tr("storage.completion.failed_title"), `
      <p class="red">${esc(tr("storage.completion.failed_body"))}</p>
      <div class="mt8 small muted">${esc(txRes.error || '')}</div>`, [
      { label: tr("storage.completion.retry"), cls: 'primary', fn: finishSession },
      { label: tr("storage.completion.emergency_export"), fn: () => {
          copyText(buildEmergencyExport()).then(ok => toast(ok ? tr("storage.completion.emergency_copied") : tr("common.error.copy_failed"), ok ? 'ok' : 'err'));
        } },
      { label: tr("workout.action.keep_going"), fn: closeModal }
    ]);
    return;
  }

  sessions = updatedSessions;
  touch();
  endSession();
  closeModal(); render();
  const setCount = record.exercises.reduce((n, e) => n + workingSets(e.sets).length, 0);
  const warmCount = record.exercises.reduce((n, e) => n + (e.sets.length - workingSets(e.sets).length), 0);
  let html = `<p>${esc(tr("finish_session.text.saved"))} <b>${esc(record.dayName)}</b> ${esc(tr("finish_session.text.working_set_in", { setCount: setCount, setCount_1_s: setCount === 1 ? '' : 's', warmCount_tr_finish_session_: warmCount ? ` ${tr("finish_session.message.warm_up", { warmCount: warmCount })}` : '', fmtDur_durationMin: fmtDur(durationMin) }))}</p>`;
  const sl = sessionLoad(record);
  if (sl) html += `<p class="mt8">${esc(tr("finish_session.text.session_rpe"))} <b>${sl.rpe}</b> · <b>${sl.load}</b> AU${sl.partial ? ` <span class="muted small">${esc(tr("finish_session.text.only_of_sets_had_an_rpe", { Math_round_sl_coverage_100: Math.round(sl.coverage * 100) }))}</span>` : ''}</p>`;
  if (prs.length) html += `<p class="mt8">${esc(tr("finish_session.text.new_prs"))} ${prs.map(p => `<span class="pr-badge">${esc(I18n.exercise(p))}</span>`).join(' ')}</p>`;
  const syncing = settings.autoSync && APP_CONFIG.cloudSync;
  html += `<p class="muted small mt8">${esc(tr('sync.saved_locally'))}</p><div id="completion-sync-status">${syncing ? syncStatusHtml() : (!APP_CONFIG.cloudSync ? esc(tr("alpha.storage_note")) : esc(tr("finish_session.message.head_to_the_ai_coach_tab_to_export_this_for_your")))}</div>`;
  // Explicit action rather than the implicit "Close" default: the way out of this
  // sheet should be obvious, and it lands you back on the day list.
  showModal(tr("finish_session.message.workout_complete"), html, [{ label: tr("finish_session.button.done"), cls: 'primary',
    fn: () => { closeModal(); tab = 'workout'; render(); window.scrollTo(0, 0); } }]);
  beep(2, 1100);
  if (syncing) workerPush({ silent: true }); // push the finished session right away
}
/*
 * Legacy set-RPE-derived load estimate, not a whole-session rating.
 * Keeping it out of the session record means old sessions and the sync payload
 * stay byte-identical, and a fix to this formula retroactively fixes history.
 *
 * The mean is weighted by reps rather than by set, so ten reps at 8 count for
 * more effort than a heavy double at 8. Warm-ups are excluded (a ramp-up is not
 * effort you accumulate) and height-metric exercises are skipped entirely --
 * their sets carry no RPE at all, so counting them would look like missing data.
 *
 * Returns null when nothing was logged with an RPE; `partial` marks a session
 * whose coverage is thin enough that the number should be shown with a caveat
 * rather than trusted, so a half-logged hard day cannot read as a light one.
 */
const RPE_COVERAGE_MIN = 0.6;
function sessionLoad(record) {
  let weighted = 0, weight = 0, withRpe = 0, total = 0;
  for (const e of record.exercises || []) {
    if (e.metric && e.metric !== 'load') continue;
    for (const s of workingSets(e.sets || [])) {
      total++;
      if (s.rpe == null) continue;
      withRpe++;
      const w = s.reps > 0 ? s.reps : 1; // a rep-less set still counts once
      weighted += s.rpe * w; weight += w;
    }
  }
  if (!weight) return null;
  const rpe = Math.round((weighted / weight) * 10) / 10;
  const coverage = Math.round((withRpe / total) * 100) / 100;
  return { rpe, load: Math.round(rpe * (record.durationMin || 0)), coverage,
    partial: coverage < RPE_COVERAGE_MIN };
}
function detectPRs(record) {
  const prs = [];
  for (const e of record.exercises) {
    if (e.metric && e.metric !== 'load' && e.metric !== 'height') continue;
    const jump = e.metric === 'height';
    // Warm-ups are excluded on both sides — a ramp-up single can't be a PR, and
    // an old record full of them must not lower the bar a new session clears.
    const score = ex => {
      if (jump) return bestHeight(ex.sets);
      const ws = workingSets(ex.sets);
      if (isAddedLoad(ex)) return ws.length ? Math.max(...ws.map(s => s.weight || 0)) : 0;
      return ws.length ? Math.max(...ws.map(s => est1RM(s.weight, s.reps))) : 0;
    };
    const newBest = score(e);
    let oldBest = 0;
    for (const s of sessions) for (const ex of s.exercises) {
      // Compare like with like: a height PR must not be measured against loads.
      if (WorkoutModel.key(ex, canonicalName) === WorkoutModel.key(e, canonicalName) && (ex.metric === 'height') === jump) {
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
  const wasExpanded = exExpanded.has(ex);
  if (exerciseDone && !group) exExpanded.delete(ex);
  // An exercise timer never overlaps a rest: logging any set ends it first.
  const takenTimers = takeExerciseTimers();
  if (!saveActive()) {
    ex.sets[si].done = false;
    restoreExerciseTimers(takenTimers);
    if (wasExpanded) exExpanded.add(ex);
    render();
    return false;
  }
  render();
  const remaining = active.exercises.some(x => x.sets.some(y => !y.done));
  // No rest after a warm-up set. A 2:30 countdown following an empty-bar single
  // is how you train yourself to ignore the timer; the prescribed rest starts
  // applying from the first working set.
  if (remaining && !ex.sets[si].warmup) {
    if (group) {
      const nextEi = nextInRound(active.exercises, group, ei, si);
      if (nextEi != null) {
        // Mid-round: this exercise's own restSeconds is the short transition.
        startRest(ex.restSeconds, '→ ' + I18n.exercise(active.exercises[nextEi].name));
      } else if (!groupComplete(active.exercises, group)) {
        const rounds = Math.max(...group.idx.map(j => active.exercises[j].sets.length));
        startRest(ex.restSeconds, tr("complete_set.message.round_of", { Math_min_si_2_rounds: Math.min(si + 2, rounds), rounds: rounds }));
      } else {
        // Group finished. The next-movement rest is authored on the group's LAST
        // member in plan order — with unequal set counts the last member to
        // finish need not be that one, so don't read it off `ex`.
        const lastEx = active.exercises[group.idx[group.idx.length - 1]];
        startRest(lastEx.restSecondsNext != null ? lastEx.restSecondsNext : lastEx.restSeconds,
          tr("complete_set.message.rest_next_movement"));
      }
    } else {
      const seconds = exerciseDone && ex.restSecondsNext != null ? ex.restSecondsNext : ex.restSeconds;
      startRest(seconds, tr("workout.rest.for_exercise", { exercise: I18n.exercise(ex.name) }));
    }
  }
  buzz([60]);
}

/* ================= AI data exchange ================= */
function buildExport() {
  return JSON.stringify({
    type: 'workout-log', version: 1, exportedAt: new Date().toISOString(), unit: unit(),
    measurementNotes: 'movementId + side + setupId + metric + equipment identify comparable history. durationSeconds and distanceMeters are actual set measurements, never repetitions. addedLoad: true marks a bodyweight lift whose weight is external load added to body weight (0 = bodyweight only); body weight is not included, so no estimated 1RM or tonnage is derived for it. The derived rep-weighted set-RPE load estimate is not a whole-session RPE rating.',
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
function buildEmergencyExport() {
  return JSON.stringify({
    type: 'gymtrack-emergency-backup', version: 1, exportedAt: new Date().toISOString(),
    activeWorkout: active,
    plan, sessions, bodyWeight, aliases, settings: { unit: settings.unit, sound: settings.sound, vibrate: settings.vibrate }
  }, null, 2);
}
function buildPlanExport() {
  return JSON.stringify({
    type: 'workout-plan', version: 1,
    name: plan.name,
    createdAt: plan.createdAt || today(),
    days: plan.days,
    ...(plan.library && plan.library.length ? { library: plan.library } : {})
  }, null, 2);
}
function restoreBackup(raw) {
  let b;
  try {
    b = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    throw new Error(tr("common.error.invalid_json") || 'Invalid JSON');
  }
  if (!b || typeof b !== 'object' || Array.isArray(b)) {
    throw new Error(tr("restore_backup.message.not_a_gymtrack_backup_expected_type_gymtrack_bac"));
  }
  if (b.type !== 'gymtrack-backup') {
    throw new Error(tr("restore_backup.message.not_a_gymtrack_backup_expected_type_gymtrack_bac"));
  }
  if (b.version != null && (typeof b.version !== 'number' || b.version > 1 || b.version < 1)) {
    throw new Error(tr("plan_import.error.unsupported_version", { version: b.version }));
  }

  // Pre-validate plan
  validatePlanImport(b.plan);
  const normalizedPlan = normalizePlan(b.plan);

  // Pre-validate sessions strictly (no silent dropping of malformed records)
  if (b.sessions != null) {
    if (!Array.isArray(b.sessions)) throw new Error('Sessions must be an array');
    for (let idx = 0; idx < b.sessions.length; idx++) {
      const s = b.sessions[idx];
      if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error(`Invalid session at index ${idx}: expected an object`);
      if (typeof s.id !== 'string' || !s.id.trim()) throw new Error(`Invalid session at index ${idx}: missing or invalid id`);
      if (typeof s.date !== 'string' || !s.date.trim()) throw new Error(`Invalid session at index ${idx}: missing or invalid date`);
      if (!Array.isArray(s.exercises)) throw new Error(`Invalid session at index ${idx}: missing exercises array`);
    }
  }
  const restoredSessions = b.sessions || [];

  // Pre-validate body weight strictly (no silent dropping of malformed records)
  if (b.bodyWeight != null) {
    if (!Array.isArray(b.bodyWeight)) throw new Error('Body weight must be an array');
    for (let idx = 0; idx < b.bodyWeight.length; idx++) {
      const bw = b.bodyWeight[idx];
      if (!bw || typeof bw !== 'object' || Array.isArray(bw)) throw new Error(`Invalid body weight at index ${idx}: expected an object`);
      if (typeof bw.date !== 'string' || !bw.date.trim()) throw new Error(`Invalid body weight at index ${idx}: missing or invalid date`);
      if (typeof bw.weight !== 'number' || !Number.isFinite(bw.weight) || bw.weight <= 0) throw new Error(`Invalid body weight at index ${idx}: weight must be a positive number`);
    }
  }
  const restoredBW = b.bodyWeight || [];

  // Pre-validate aliases
  if (b.aliases != null && (typeof b.aliases !== 'object' || Array.isArray(b.aliases))) {
    throw new Error('Aliases must be an object');
  }
  const restoredAliases = b.aliases || {};

  // Stage writes and ensure all persist atomically before modifying in-memory state
  const newUpdatedAt = b.updatedAt || Date.now();
  const writes = [
    ['plan', normalizedPlan],
    ['sessions', restoredSessions],
    ['bw', restoredBW],
    ['aliases', restoredAliases],
    ['updatedAt', newUpdatedAt]
  ];
  let stagedSettings = null;
  if (b.settings && typeof b.settings === 'object') {
    stagedSettings = Object.assign({}, settings, {
      unit: b.settings.unit || settings.unit,
      sound: b.settings.sound ?? settings.sound,
      vibrate: b.settings.vibrate ?? settings.vibrate
    });
    writes.push(['settings', stagedSettings]);
  }

  // Commit writes via durable WAL commitTx protocol with corrupt recovery allowed
  const txRes = store.commitTx(writes, { allowCorruptRecovery: true });
  if (!txRes.ok) {
    throw new Error(tr("storage.error.restore_write_failed", { key: 'transaction', error: txRes.error }));
  }

  // Clear corruption records for restored keys now that durable commit succeeded
  writes.forEach(([k]) => { delete corruptData[k]; });
  delete corruptData['pending_tx'];
  store.rawDel('pending_tx');
  if (Object.keys(corruptData).length === 0) storageAlert = null;

  // Switch in-memory references only after atomic commit succeeds
  plan = normalizedPlan;
  sessions = restoredSessions;
  bodyWeight = restoredBW;
  aliases = restoredAliases;
  if (stagedSettings) Object.assign(settings, stagedSettings);
  dataUpdatedAt = newUpdatedAt;
  // Active workout is preserved intentionally
}
const coachPlanSchema = () => `{
  "type": "workout-plan",
  "version": 1,
  "name": "<plan name>",
  "library": <optional array of saved library entries; preserve IDs, metadata and aliases from currentPlan.library>,
  "days": [
    {
      "name": "<day name>",
      "warmup": <optional array of prep strings or {name, detail} objects>,
      "exercises": [
        {
          "name": "<exercise>",
          "sets": <number of working sets>,
          "warmupSets": <optional nonnegative integer; ramp sets for load exercises only>,
          "reps": "<e.g. 8-10>",
          "weight": <number>,
          "targetRpe": <number 1-10>,
          "restSeconds": <number>,
          "restSecondsNext": <number, optional — rest before moving to the next movement, omit if same as restSeconds>,
          "equipment": "<one of: barbell, trap-bar, landmine, training-bar, dumbbell, machine, cable, bodyweight, other>",
          "barWeight": <number, optional — only for barbell/trap-bar/training-bar if the bar isn't a standard 20kg/45lb bar; omit otherwise>,
          "metric": "<load (weight × reps), height (cm), duration (seconds + optional load), distance (metres + optional load), or cardio (time/distance/speed)>",
          "movementId": "<optional reusable movement/variant key; same across days, independent of display name>",
          "libraryEntry": <optional full entry snapshot; preserve id, name, movement, category, muscles, equipment, position, execution, metric, description, aliases; movementId must equal its id>,
          "side": "<unspecified, left, right, or bilateral>",
          "setupId": "<optional reusable equipment/setup name; different machines have separate history>",
          "addedLoad": <optional true only for a bodyweight load exercise logged with added external load (weighted pull-up/dip); weight is then the added load, 0 = bodyweight only. Omit otherwise; never use negative weight for assistance>,
          "loadProfile": <optional object for custom equipment loads: {unit: '${unit()}', offset: empty-equipment weight, increment: step}; alternatively use loads: [total loads] instead of increment. Omit unless known>,
          "durationSeconds": <optional positive number for duration/cardio>,
          "distanceMeters": <optional positive number for distance/cardio>,
          "speedKph": <optional positive number for cardio; pace is derived>,
          "superset": "<optional — a short tag like 'A' shared by adjacent exercises to log them as one alternating superset card; omit for a standalone exercise>",
          "description": "<1-2 sentence how-to>",
          "alternates": [ { "name": "<alternative exercise>", "weight": <number>, "description": "<short how-to>" } ]
        }
      ]
    }
  ]
}`;
const AI_PROMPT = () => tr('coach_prompt.copy_data', { unit: unit(), schema: coachPlanSchema() });
const AI_URL_PROMPT = url => tr('coach_prompt.share_url', { url, unit: unit(), schema: coachPlanSchema() });
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); return true; } catch (e2) { return false; } finally { ta.remove(); }
  }
}

/* ================= worker sync ================= */
const workerShareUrl = () => !APP_CONFIG.cloudSync ? '' : `${WORKER_URL}/data/${gymUUID}`;

function relTime(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return tr("sync.time.now");
  if (s < 60) return tr("sync.time.seconds", { count: s });
  const m = Math.round(s / 60); if (m < 60) return tr("sync.time.minutes", { count: m });
  const h = Math.round(m / 60); if (h < 24) return tr("sync.time.hours", { count: h });
  return tr("sync.time.days", { count: Math.round(h / 24) });
}
function syncStatusHtml() {
  if (!APP_CONFIG.cloudSync) return `<span class="muted small">${esc(tr("alpha.storage_note"))}</span>`;
  if (!settings.autoSync) return `<span class="muted small">${esc(tr("sync_status_html.text.auto_sync_off"))}</span>`;
  if (syncState === 'syncing') return `<span class="small amber">${esc(tr("sync_status_html.text.syncing"))}</span>`;
  if (syncState === 'error') return `<span class="small red">⚠ ` + esc(lastSyncMsg || tr("sync_status_html.message.sync_error")) + `</span> <button class="ghost" data-action="sync-retry">${esc(tr('sync.retry'))}</button>`;
  if (lastSyncedAt) return `<span class="small green">${esc(tr("sync.status.synced_at", { time: relTime(lastSyncedAt) }))}</span>`;
  return `<span class="muted small">${esc(tr("sync_status_html.text.connected_syncing_on_launch"))}</span>`;
}
function setSyncState(state, msg) {
  syncState = state;
  if (state === 'ok') { lastSyncedAt = Date.now(); lastSyncMsg = ''; }
  if (state === 'error') lastSyncMsg = msg || '';
  for (const id of ['sync-status', 'completion-sync-status']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = syncStatusHtml();
  }
}
function scheduleSync() {
  if (!APP_CONFIG.cloudSync || !settings.autoSync) return;
  if (store.hasUnresolvedTx()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => workerPush({ silent: true }), 1500);
}

async function workerPush(opts = {}) {
  if (!APP_CONFIG.cloudSync) return false;
  if (store.hasUnresolvedTx()) return false;
  clearTimeout(syncTimer);
  setSyncState('syncing');
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (writeToken) headers['X-GymTrack-Write'] = writeToken;
    const res = await syncFetch(`${WORKER_URL}/data/${gymUUID}`, {
      method: 'POST', headers, body: buildBackup()
    });
    // 409 = the cloud copy is newer than ours, so this push would clobber it.
    // Reconcile (merges by key) and retry once; a second 409 is a real error
    // rather than something to keep bouncing off.
    if (res.status === 409 && !opts.retried) {
      await workerReconcile({ retried: true });
      // Report what the reconcile's own push actually achieved — returning a
      // bare true here would claim success while the status line said error.
      return syncState === 'ok';
    }
    if (res.status === 401) throw new Error(tr("worker_push.message.write_token_missing_or_invalid_re_enter_it_in_se"));
    if (!res.ok) throw new Error(tr("cloud_sync.error.status", { status: res.status }));
    setSyncState('ok');
    if (!opts.silent) toast(tr("worker_push.message.synced_to_cloud"));
    return true;
  } catch (e) { setSyncState('error', e.message); if (!opts.silent) toast(tr("cloud_sync.error.push", { error: e.message }), 'err'); return false; }
}
async function syncFetch(url, options = {}) {
  if (!APP_CONFIG.cloudSync) {
    throw new Error(tr("alpha.cloud_disabled") || 'Cloud sync is disabled in athlete alpha mode');
  }
  if (store.hasUnresolvedTx()) {
    throw new Error('Sync disabled while transaction recovery is unresolved');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
async function workerFetch() {
  if (!APP_CONFIG.cloudSync) return null;
  if (store.hasUnresolvedTx()) return null;
  const res = await syncFetch(`${WORKER_URL}/data/${gymUUID}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(tr("cloud_fetch.error.status", { status: res.status }));
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
async function workerReconcile(opts = {}) {
  if (!APP_CONFIG.cloudSync) return 'local';
  if (store.hasUnresolvedTx()) return 'local';
  const r = await workerFetch();
  if (!r) { await workerPush({ silent: true, retried: opts.retried }); return 'pushed'; }
  const localEmpty = sessions.length === 0 && bodyWeight.length === 0;
  const remoteHasData = r.parsed && (((r.parsed.sessions || []).length) || ((r.parsed.bodyWeight || []).length) || r.parsed.plan);
  if (remoteHasData && (r.updatedAt > dataUpdatedAt || localEmpty)) {
    const remoteSessions = r.parsed.sessions || [], remoteBW = r.parsed.bodyWeight || [];
    const mergedSessions = mergeByKey(remoteSessions, sessions, s => s.id);
    const mergedBW = mergeByKey(remoteBW, bodyWeight, b => b.date);
    const remoteLibraryPlan = normalizePlan(r.parsed.plan);
    const mergedLibrary = ExerciseLibrary.importLibrary(plan, remoteLibraryPlan);
    const libraryChanged = JSON.stringify(mergedLibrary) !== JSON.stringify(ExerciseLibrary.retained(remoteLibraryPlan));
    const hadLocalOnly = mergedSessions.length > remoteSessions.length || mergedBW.length > remoteBW.length || libraryChanged;
    restoreBackup(r.raw);
    sessions = mergedSessions; bodyWeight = mergedBW;
    if (mergedLibrary.length) plan.library = mergedLibrary;
    store.set('plan', plan);
    store.set('sessions', sessions); store.set('bw', bodyWeight);
    render(); setSyncState('ok');
    if (hadLocalOnly) { touch(); await workerPush({ silent: true, retried: opts.retried }); }
    return 'pulled';
  }
  await workerPush({ silent: true, retried: opts.retried });
  return 'pushed';
}
async function autoSyncOnLoad() {
  if (!APP_CONFIG.cloudSync) { syncReady = true; return; }
  if (!settings.autoSync || active || store.hasUnresolvedTx()) { syncReady = true; return; }
  setSyncState('syncing');
  try { await workerReconcile(); } catch (e) { setSyncState('error', e.message); }
  syncReady = true;
}

/* ================= restore from backup code ================= */
// Shared by the settings view and the onboarding "I have a backup code" flow.
function restoreFromCode(raw) {
  if (!APP_CONFIG.cloudSync) { toast(tr("alpha.cloud_disabled"), 'err'); return; }
  if (!raw) { toast(tr("restore_from_code.message.paste_your_backup_code_first"), 'err'); return; }
  const match = raw.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (!match) { toast(tr("restore_from_code.message.invalid_backup_code"), 'err'); return; }
  const newUUID = match[1].toLowerCase();
  localStorage.setItem(APP_CONFIG.uuidKey, newUUID);
  gymUUID = newUUID;
  setSyncState('syncing');
  (async () => {
    try {
      const r = await workerFetch();
      if (!r) { toast(tr("restore_from_code.message.no_data_found_for_this_backup_code"), 'err'); setSyncState('error', tr("restore_from_code.message.not_found")); return; }
      restoreBackup(r.raw); closeModal(); render(); setSyncState('ok'); toast(tr("restore_from_code.message.restored"));
    } catch (e) { setSyncState('error', e.message); toast(tr("backup.error.restore", { error: e.message }), 'err'); }
  })();
}

// The token is HMAC-SHA256 hex, so 64 hex chars — anything else is a paste
// accident (a backup code, a truncated copy) and is worth catching here rather
// than as a 401 mid-workout.
function saveWriteToken(raw) {
  if (!APP_CONFIG.cloudSync) { toast(tr("alpha.cloud_disabled"), 'err'); return; }
  const t = (raw || '').trim().toLowerCase();
  if (!t) { toast(tr("save_write_token.message.paste_your_write_token_first"), 'err'); return; }
  if (!/^[0-9a-f]{64}$/.test(t)) { toast(tr("save_write_token.message.that_does_not_look_like_a_write_token_64_hex_cha"), 'err'); return; }
  localStorage.setItem(APP_CONFIG.tokenKey, t);
  writeToken = t;
  render();
  toast(tr("save_write_token.message.write_token_saved"));
  if (settings.autoSync) workerPush({ silent: true });
}

/* ================= coach programs (athlete alpha) ================= */
// See docs/plans/2026-09-19-coach-interface.md. The coach never writes this athlete's
// backup: programs wait in a server-side inbox and are applied here, by the athlete.
let coachLink = store.get('coach', null);  // { name } once linked
let coachInbox = [];                       // pending items from GET /inbox
let coachInboxFetchedAt = 0;

async function coachApi(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (writeToken) headers['X-GymTrack-Write'] = writeToken;
  const res = await syncFetch(WORKER_URL + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  let data = null; try { data = await res.json(); } catch (e) { /* non-JSON error page */ }
  if (!res.ok) throw new Error((data && data.error) || tr("cloud_sync.error.status", { status: res.status }));
  return data;
}
function saveCoachLink(link) {
  coachLink = link;
  if (link) store.set('coach', link); else store.del('coach');
}
async function refreshCoachInbox(force) {
  if (!APP_CONFIG.isAlpha || !APP_CONFIG.cloudSync || !writeToken || store.hasUnresolvedTx()) return;
  if (!force && Date.now() - coachInboxFetchedAt < 60000) return;
  coachInboxFetchedAt = Date.now();
  try {
    const r = await coachApi('GET', `/inbox/${gymUUID}`);
    coachInbox = Array.isArray(r.items) ? r.items : [];
    const name = r.coach ? r.coach.name : null;
    if ((coachLink && coachLink.name) !== name) saveCoachLink(name ? { name } : null);
    // Never re-render under an active workout; the banner waits for the day list.
    if (!active && (tab === 'workout' || tab === 'settings')) render();
  } catch (e) { /* offline or server down: retried on the next launch or resume */ }
}
function coachInboxBanner() {
  const item = coachInbox[0];
  if (!item) return '';
  return `<div class="card coach-banner">
      <div class="bold">${esc(tr("coach.inbox.banner", { coach: item.coachName, plan: (item.plan && item.plan.name) || '' }))}</div>
      <button class="primary wide mt8" data-action="coach-inbox-open">${esc(tr("coach.inbox.open"))}</button>
    </div>`;
}
function coachDayLabel(d) {
  if (!d.source || !d.source.coachId) return '';
  const key = d.source.hash && d.source.hash !== WorkoutModel.dayHash(d) ? "coach.plan.from_edited" : "coach.plan.from";
  return ` <span class="day-pill">${esc(tr(key, { coach: d.source.coachName || '' }))}</span>`;
}
function openCoachInbox() {
  const item = coachInbox[0];
  if (!item || active) return;
  let incoming;
  try { validatePlanImport(item.plan); incoming = normalizePlan(item.plan); }
  catch (err) { toast(tr("plan_import.error.invalid", { error: err.message }), 'err'); return; }
  const merge = WorkoutModel.mergeCoachPlan(plan, incoming, { coachId: item.coachId, coachName: item.coachName, assignmentId: item.id });
  const list = (key, days) => days.length ? `<p class="small mt4">${esc(tr(key, { days: days.join(', ') }))}</p>` : '';
  const body = `
    ${item.note ? `<p class="mt4">${esc(tr("coach.preview.note", { note: item.note }))}</p>` : ''}
    <div class="mt8">
      ${list("coach.preview.added", merge.added)}
      ${list("coach.preview.replaced", merge.replaced)}
      ${list("coach.preview.removed", merge.removed)}
      ${list("coach.preview.kept", merge.kept)}
    </div>
    ${merge.overwrittenEdits.length ? `<p class="small amber mt8">⚠ ${esc(tr("coach.preview.edits_lost", { days: merge.overwrittenEdits.join(', ') }))}</p>` : ''}
    <p class="small green mt12">✓ ${esc(tr("coach.preview.history"))}</p>`;
  showModal(tr("coach.preview.title", { coach: item.coachName, plan: incoming.name }), body, [
    { label: tr("coach.action.accept"), cls: 'primary', fn: () => acceptCoachProgram(item, incoming, merge) },
    { label: tr("coach.action.decline"), fn: () => declineCoachProgram(item) },
    { label: tr("common.action.cancel"), fn: closeModal }
  ]);
}
async function acceptCoachProgram(item, incoming, merge) {
  const next = { ...plan, name: merge.name, days: merge.days };
  next.library = ExerciseLibrary.importLibrary(plan, incoming);
  const prevPlan = plan;
  plan = next;
  if (!savePlan()) { plan = prevPlan; render(); return; }
  coachInbox = coachInbox.filter(i => i.id !== item.id);
  expandedDay = null; closeModal(); render();
  toast(tr("coach.toast.accepted"));
  // Already applied locally. A failed ack leaves the item "sent" on the server, so it
  // is offered again next launch; accepting it twice yields the same plan.
  try { await coachApi('POST', `/inbox/${gymUUID}/${item.id}/ack`, { status: 'accepted' }); }
  catch (e) { toast(tr("coach.error.ack", { error: e.message }), 'err'); }
}
async function declineCoachProgram(item) {
  try {
    await coachApi('POST', `/inbox/${gymUUID}/${item.id}/ack`, { status: 'declined' });
    coachInbox = coachInbox.filter(i => i.id !== item.id);
    closeModal(); render(); toast(tr("coach.toast.declined"));
  } catch (e) { toast(tr("coach.error.ack", { error: e.message }), 'err'); }
}
function viewCoachSettings() {
  if (coachLink) return `
    <h2 class="section">${esc(tr("coach.settings.title"))}</h2>
    <div class="card">
      <p>${esc(tr("coach.settings.linked", { coach: coachLink.name }))}</p>
      <button class="ghost wide mt8" data-action="coach-unlink">${esc(tr("coach.settings.unlink"))}</button>
    </div>`;
  return `
    <h2 class="section">${esc(tr("coach.settings.title"))}</h2>
    <div class="card">
      <label class="field"><span>${esc(tr("coach.settings.code_label"))}</span><input id="coach-code" autocapitalize="characters" autocomplete="off" maxlength="8"></label>
      <label class="field mt8"><span>${esc(tr("coach.settings.name_label"))}</span><input id="coach-name" maxlength="60"></label>
      <p class="small muted mt8">${esc(tr("coach.settings.consent"))}</p>
      <button class="primary wide mt8" data-action="coach-link">${esc(tr("coach.settings.link"))}</button>
    </div>`;
}
async function linkCoach(code, displayName) {
  code = (code || '').trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) { toast(tr("coach.error.code_format"), 'err'); return; }
  try {
    const r = await coachApi('POST', '/link', { code, uuid: gymUUID, displayName: (displayName || '').trim() });
    if (r.writeToken) { localStorage.setItem(APP_CONFIG.tokenKey, r.writeToken); writeToken = r.writeToken; }
    saveCoachLink({ name: r.coachName });
    render();
    toast(tr("coach.toast.linked", { coach: r.coachName }));
    if (settings.autoSync) workerPush({ silent: true });
    refreshCoachInbox(true);
  } catch (e) { toast(tr("coach.error.link", { error: e.message }), 'err'); }
}
function confirmUnlinkCoach() {
  if (!coachLink) return;
  showModal(tr("coach.settings.unlink"), `<p>${esc(tr("coach.settings.unlink_confirm", { coach: coachLink.name }))}</p>`, [
    { label: tr("coach.settings.unlink"), cls: 'primary', fn: async () => {
      try {
        await coachApi('DELETE', `/inbox/${gymUUID}/coach`);
        saveCoachLink(null); coachInbox = [];
        closeModal(); render(); toast(tr("coach.toast.unlinked"));
      } catch (e) { toast(tr("coach.error.link", { error: e.message }), 'err'); }
    } },
    { label: tr("common.action.cancel"), fn: closeModal }
  ]);
}

/* ================= first-run onboarding ================= */
function showOnboarding() {
  if (!APP_CONFIG.cloudSync) {
    showModal(tr("show_onboarding.message.welcome_to_gymtrack"), `
      <div class="onboard-row">${icon('dumbbell', 22)}<div><b>${esc(tr("show_onboarding.text.log_your_workouts"))}</b><div class="muted small">${esc(tr("show_onboarding.text.sets_reps_rpe_with_a_rest_timer_that_runs_itself"))}</div></div></div>
      <div class="onboard-row">${icon('list', 22)}<div><b>${esc(tr("alpha.badge"))}</b><div class="muted small">${esc(tr("alpha.storage_note"))}</div></div></div>
      <p class="small muted mt12">${esc(tr("show_onboarding.text.a_starter_push_pull_legs_plan_is_loaded_edit_it_"))}</p>`,
      [
        { label: tr("show_onboarding.button.get_started"), cls: 'primary', fn: () => { store.set('onboarded', 1); closeModal(); } }
      ]);
    return;
  }
  showModal(tr("show_onboarding.message.welcome_to_gymtrack"), `
    <div class="onboard-row">${icon('dumbbell', 22)}<div><b>${esc(tr("show_onboarding.text.log_your_workouts"))}</b><div class="muted small">${esc(tr("show_onboarding.text.sets_reps_rpe_with_a_rest_timer_that_runs_itself"))}</div></div></div>
    <div class="onboard-row">${icon('sparkle', 22)}<div><b>${esc(tr("show_onboarding.text.your_ai_coach_writes_the_next_plan"))}</b><div class="muted small">${esc(tr("show_onboarding.text.share_your_training_data_with_claude_chatgpt_or_"))}</div></div></div>
    <div class="onboard-row">${icon('link', 22)}<div><b>${esc(tr("show_onboarding.text.everything_syncs_automatically"))}</b><div class="muted small">${esc(tr("show_onboarding.text.your_backup_code_in_settings_restores_it_all_on_"))}</div></div></div>
    <p class="small muted mt12">${esc(tr("show_onboarding.text.a_starter_push_pull_legs_plan_is_loaded_edit_it_"))}</p>`,
    [
      { label: tr("show_onboarding.button.get_started"), cls: 'primary', fn: () => { store.set('onboarded', 1); closeModal(); } },
      { label: tr("show_onboarding.button.i_have_a_backup_code"), fn: () => {
          store.set('onboarded', 1);
          showModal(tr("show_onboarding.message.restore_your_data"), `
            <p class="small muted">${esc(tr("show_onboarding.text.paste_the_backup_code_or_share_url_from_your_old"))}</p>
            <input id="restore-uuid-input" class="mt8" placeholder="${esc(tr("show_onboarding.placeholder.paste_your_backup_code"))}" style="width:100%;box-sizing:border-box">`,
            [
              { label: tr("common.action.restore"), cls: 'primary', fn: () => restoreFromCode(mval('restore-uuid-input')) },
              { label: tr("common.action.cancel") }
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
  el.innerHTML = `<span>${esc(tr("show_update_banner.text.new_version_available"))}</span><button data-action="update-app">${esc(tr("show_update_banner.text.update"))}</button>`;
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
  if (btn) { btn.disabled = true; btn.textContent = tr("check_for_updates.message.checking"); }
  const reset = () => { if (btn) { btn.disabled = false; btn.textContent = tr("updates.action.check"); } };
  try {
    if (!('serviceWorker' in navigator)) { toast(tr("check_for_updates.message.updates_need_a_browser_with_service_workers"), 'err'); return reset(); }
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) { toast(tr("check_for_updates.message.app_not_installed_as_a_pwa_just_reload_the_page")); return reset(); }

    await reg.update(); // re-fetches sw.js; installs a new worker if it differs
    if (reg.waiting) { swWaiting = reg.waiting; showUpdateBanner(); toast(tr("check_for_updates.message.update_ready_tap_update")); return reset(); }

    // Worker is current. Is its cached app.js still current too?
    const [liveRes, cachedRes] = await Promise.all([
      fetch(`./app.js?fresh=${Date.now()}`, { cache: 'no-store' }),
      caches.match('./app.js')
    ]);
    if (!liveRes.ok || !cachedRes) { toast(tr("updates.status.latest")); return reset(); }
    const [live, cached] = await Promise.all([liveRes.text(), cachedRes.text()]);
    if (live === cached) { toast(tr("updates.status.latest")); return reset(); }

    reset();
    showModal(tr("check_for_updates.message.update_available"), `
      <p class="small">${esc(tr("check_for_updates.text.a_newer_version_is_on_the_server_but_this_device"))}</p>
      <p class="small muted mt8">${esc(tr("check_for_updates.text.reloading_clears_the_app_cache_and_fetches_it_yo"))}</p>`,
      [{ label: tr("check_for_updates.button.reload_now"), cls: 'primary', fn: forceRefresh }, { label: tr("check_for_updates.button.not_now") }]);
  } catch (err) {
    reset();
    toast(tr("check_for_updates.message.could_not_check_are_you_offline"), 'err');
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
  if (drag) endDrag(); // the dragged nodes are about to be replaced: cancel rather than drop blind
  hideStepper(); // any focused set input is about to be replaced
  const app = document.getElementById('app');
  document.querySelectorAll('#tabbar .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

  let corruptBanner = '';
  const corruptKeys = Object.keys(corruptData);
  if (corruptKeys.length > 0) {
    corruptBanner = `
      <div class="card" style="border:1px solid var(--red);margin-bottom:12px;background:rgba(255,80,80,0.08)">
        <b class="red">⚠ ${esc(tr("storage.corrupt.banner"))}</b>
        <p class="small mt4">${esc(tr("storage.error.corrupt_data", { key: corruptKeys.join(', ') }))}</p>
        <button class="ghost mt8" data-action="copy-corrupt-raw">${esc(tr("storage.corrupt.copy_raw"))}</button>
      </div>`;
  }

  let content = '';
  if (tab === 'workout') content = active ? viewActiveSession() : viewStart();
  else if (tab === 'plan') content = viewPlan();
  else if (tab === 'history') content = viewHistory();
  else if (tab === 'settings') content = viewSettings();
  else content = viewCoach();

  app.innerHTML = corruptBanner + content;
  syncExerciseTimerCue();
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
    ${coachInboxBanner()}
    <h2 class="section">${esc(tr("view_start.text.start_a_workout"))}</h2>
    ${plan.days.map(d => `
      <div class="card">
        <div class="row between">
          <div class="grow">
            <div class="bold">${esc(d.name)} ${d.id === suggest ? `<span class="day-pill green">${esc(tr("view_start.text.up_next"))}</span>` : ''}</div>
            <div class="muted small mt8">${d.exercises.map(e => esc(I18n.exercise(e.name))).join(' · ')}</div>
          </div>
        </div>
        <button class="primary wide mt12" data-action="start-session" data-id="${d.id}">${esc(tr("view_start.text.start", { d_name_split_0_trim: d.name.split('—')[0].trim() }))}</button>
      </div>`).join('')}
    ${last ? `<p class="muted small" style="text-align:center">${esc(tr("view_start.text.last_workout", { last_dayName: last.dayName, fmtDate_last_date: fmtDate(last.date) }))}</p>` : ''}
    <button class="ghost wide mt12" data-action="cmj-open">${icon('video', 16)} ${esc(tr("view_start.text.test_cmj_measurement"))}</button>`;
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
    ? [r.cmjCm != null ? tr("view_active_session.message.cmj", { r_cmjCm: r.cmjCm, r_cmjAttempts_length_1_tr_vi: r.cmjAttempts?.length > 1 ? ` ${tr("view_active_session.message.att", { r_cmjAttempts_length: r.cmjAttempts.length })}` : '' }) : '', r.broadJumpCm != null ? tr("view_active_session.message.broad", { r_broadJumpCm: r.broadJumpCm }) : '', r.subjectiveEnergy != null ? tr("view_active_session.message.energy", { r_subjectiveEnergy: r.subjectiveEnergy }) : ''].filter(Boolean).join(' · ')
    : tr("view_active_session.message.tap_to_log_cmj_energy");
  return `
    <div class="row between">
      <h2 class="section" style="margin:4px">${esc(active.dayName)}</h2>
      <button class="danger icon-btn" data-action="confirm-finish">${esc(tr("view_active_session.text.finish"))}</button>
    </div>
    <div class="session-progress">
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <span class="small muted progress-label">${esc(tr("view_active_session.text.sets", { doneSets: doneSets, totalSets: totalSets }))}</span>
    </div>
    ${readinessExpanded ? `
    <h2 class="section tappable" data-action="readiness-toggle">${esc(tr("view_active_session.text.pre_session_readiness"))} <span class="muted small">${esc(tr("view_active_session.text.optional"))}</span> <span class="chev">${icon('chevDown', 14)}</span></h2>
    <div class="card">
      <div class="row" style="gap:12px">
        <label style="flex:1">
          <span class="small muted">${esc(tr("view_active_session.text.cmj_cm"))}</span>
          <input type="number" step="0.1" min="0" max="100" data-bind="readiness-cmj"
            value="${active.readiness?.cmjCm ?? ''}" placeholder="—">
        </label>
        <label style="flex:1">
          <span class="small muted">${esc(tr("view_active_session.text.broad_jump_cm"))}</span>
          <input type="number" step="1" min="0" max="400" data-bind="readiness-broad"
            value="${active.readiness?.broadJumpCm ?? ''}" placeholder="—">
        </label>
        <label style="flex:1">
          <span class="small muted">${esc(tr("view_active_session.text.energy_1_10"))}</span>
          <input type="number" step="1" min="1" max="10" data-bind="readiness-energy"
            value="${active.readiness?.subjectiveEnergy ?? ''}" placeholder="—">
        </label>
      </div>
      <button class="ghost wide mt8" data-action="cmj-open">${icon('video', 16)} ${esc(tr("view_active_session.text.measure_cmj_via_video"))}</button>
    </div>` : `
    <div class="card collapsed-ex tappable" data-action="readiness-toggle">
      <div class="row between">
        <div class="grow"><span class="bold small">${esc(tr("view_active_session.text.readiness"))}</span> <span class="muted small">· ${esc(readinessSummary)}</span></div>
        <span class="chev">${icon('chevRight', 16)}</span>
      </div>
    </div>`}
    ${warmupCard()}
    <div data-reorder-list="session">
    ${supersetGroups(active.exercises).map((g, gi, groups) => {
      const pos = { first: gi === 0, last: gi === groups.length - 1 };
      return `<div class="reorder-unit" data-reorder-unit="${gi}">${isRealGroup(g)
        ? supersetCard(g, pos)
        : exerciseCard(active.exercises[g.idx[0]], g.idx[0], pos)}</div>`;
    }).join('')}
    </div>
    <button class="ghost wide mt8" data-action="session-ex-add">${esc(tr("view_active_session.text.add_exercise"))}</button>
    <h2 class="section">${esc(tr("view_active_session.text.session_notes"))}</h2>
    <div class="card">
      <textarea data-bind="session-notes" placeholder="${esc(tr("view_active_session.placeholder.how_did_it_go_anything_claude_should_know_sleep_"))}">${esc(active.notes)}</textarea>
    </div>
    <button class="wide success mt12" data-action="confirm-finish">${esc(tr("view_active_session.text.finish_workout"))}</button>
    <button class="wide ghost danger mt8" data-action="confirm-discard">${esc(tr("view_active_session.text.discard_session"))}</button>`;
}
/*
 * The day's general warm-up: a checklist, not logged sets. Sits below readiness
 * because the CMJ readiness measurement is taken cold, before any of this.
 * Auto-collapses once every item is ticked, same pattern as the readiness card.
 */
function warmupCard() {
  const items = active.warmup || [];
  if (!items.length) return '';
  const done = items.filter(w => w.done).length;
  const open = warmupOpen != null ? warmupOpen : done < items.length;
  if (!open) return `
    <div class="card collapsed-ex tappable" data-action="warmup-toggle">
      <div class="row between">
        <div class="grow"><span class="green bold">✓</span> <span class="bold small">${esc(tr("warmup_card.heading"))}</span>
          <span class="muted small">${esc(tr("warmup_card.text.done", { done: done, items_length: items.length }))}</span></div>
        <span class="chev">${icon('chevRight', 16)}</span>
      </div>
    </div>`;
  return `
    <h2 class="section tappable" data-action="warmup-toggle">${esc(tr("warmup_card.heading"))}
      <span class="muted small">(${done}/${items.length})</span> <span class="chev">${icon('chevDown', 14)}</span></h2>
    <div class="card">
      ${items.map((w, i) => `
        <label class="merge-row">
          <input type="checkbox" data-action="warmup-check" data-i="${i}" ${w.done ? 'checked' : ''}>
          <span class="grow ${w.done ? 'warmup-done' : ''}"><span class="bold small">${esc(w.name)}</span>${w.detail ? `<div class="muted small">${esc(w.detail)}</div>` : ''}</span>
        </label>`).join('')}
    </div>`;
}
function supersetCard(group, pos = {}) {
  const list = active.exercises;
  const groupName = tr("superset_card.heading", { group_tag: group.tag });
  const rounds = Math.max(...group.idx.map(j => list[j].sets.length));
  const doneRounds = Array.from({ length: rounds }, (_, si) =>
    group.idx.every(j => !list[j].sets[si] || list[j].sets[si].done)).filter(Boolean).length;
  const complete = groupComplete(list, group);
  const key = 'ss:' + group.tag;
  if (complete && !exExpanded.has(key)) {
    return `
    <div class="card collapsed-ex tappable" data-action="ex-toggle" data-key="${esc(key)}">
      <div class="row between">
        ${reorderHandle('session', '', group.idx[0], groupName)}
        <div class="grow"><span class="green bold">✓</span> <span class="bold">${esc(groupName)}</span>
          <span class="muted small">· ${group.idx.map(j => esc(I18n.exercise(list[j].name))).join(' + ')}</span></div>
        ${moveButtons('session', '', group.idx[0], pos, groupName)}
        <span class="chev">${icon('chevDown', 18)}</span>
      </div>
    </div>`;
  }
  const slot = groupNextSlot(list, group);
  return `
  <div class="card superset-card">
    <div class="superset-head row between">
      ${reorderHandle('session', '', group.idx[0], groupName)}
      <span class="bold grow">${esc(groupName)}</span>
      <span class="muted small">${complete ? tr("workout.superset.complete") : tr("superset_card.message.round_of", { Math_min_doneRounds_1_rounds: Math.min(doneRounds + 1, rounds), rounds: rounds })}</span>
      ${moveButtons('session', '', group.idx[0], pos, groupName)}
      ${complete ? `<button class="icon-btn" data-action="ex-toggle" data-key="${esc(key)}" title="${esc(tr("common.action.collapse"))}">${icon('chevUp', 18)}</button>` : ''}
    </div>
    ${group.idx.map(j => `<div class="superset-member${slot && slot.ei === j ? ' ss-next' : ''}">${exerciseCard(list[j], j, { inGroup: true })}</div>`).join('')}
  </div>`;
}
// Row labels for a set grid: warm-ups count W1, W2… and the working sets number
// from 1, so "set 3" always means the third working set no matter how long the
// ramp was. Warm-ups need not be contiguous — the row number is a manual toggle.
function setLabels(sets) {
  let w = 0, k = 0;
  return sets.map((s, si) => ({ s, si, label: s.warmup ? tr("set_labels.message.w") + (++w) : String(++k) }));
}
function exerciseCard(e, ei, opts) {
  const inGroup = !!(opts && opts.inGroup);
  const exName = I18n.exercise(e.name);
  const doneCount = e.sets.filter(s => s.done).length;
  const allDone = doneCount === e.sets.length && e.sets.length > 0;
  // Inside a superset the whole group collapses as a unit, so a member never
  // collapses on its own — the athlete still needs its rows for the next round.
  if (allDone && !inGroup && !exExpanded.has(e)) {
    // The summary reports the working sets; warm-ups are acknowledged in the
    // count but never chosen as the "best" set.
    const ws = workingSets(e.sets);
    const warmN = e.sets.length - ws.length;
    const warmTag = warmN ? ` ${tr("exercise_card.message.warm_up", { warmN: warmN })}` : '';
    let summary;
    if (isJump(e)) {
      summary = tr("exercise_card.message.attempt_best_cm", { ws_length: ws.length, ws_length_1_s: ws.length === 1 ? '' : 's', warmTag: warmTag, bestHeight_e_sets: bestHeight(e.sets) });
    } else if (WorkoutModel.timed(e)) {
      summary = ws.map(s => measurementText(e, s)).join(' · ');
    } else if (ws.length) {
      const best = isAddedLoad(e) ? addedLoadBest(ws) : ws.reduce((a, b) => est1RM(b.weight, b.reps) > est1RM(a.weight, a.reps) ? b : a);
      summary = tr("exercise_card.message.set_best", { ws_length: ws.length, ws_length_1_s: ws.length === 1 ? '' : 's', warmTag: warmTag, best_weight: loadText(e, best.weight), best_reps: best.reps });
    } else {
      summary = tr("exercise_card.message.warm_up_set_only", { warmN: warmN, warmN_1_s: warmN === 1 ? '' : 's' });
    }
    // The note button carries its own data-action, and the delegated listener
    // resolves via closest('[data-action]'), so it wins over the row's expand
    // handler — the note is reachable without expanding the card back open.
    return `
    <div class="card collapsed-ex tappable" data-action="ex-toggle" data-ei="${ei}">
      <div class="row between">
        ${reorderHandle('session', '', ei, exName)}
        <div class="grow"><span class="green bold">✓</span> <span class="bold">${esc(exName)}</span>
          <span class="muted small">· ${esc(summary)}</span>
          ${e.notes ? `<div class="small amber collapsed-note">${icon('note', 13)} ${esc(e.notes.slice(0, 60))}${e.notes.length > 60 ? '…' : ''}</div>` : ''}</div>
        <button class="icon-btn" data-action="ex-note" data-ei="${ei}" title="${esc(tr("exercise_card.title.note"))}">${icon('note', 16)}</button>
        ${moveButtons('session', '', ei, opts || {}, exName)}
        <span class="chev">${icon('chevDown', 18)}</span>
      </div>
    </div>`;
  }
  const lastP = lastPerformance(e);
  const lastRpe = lastP ? Math.max(0, ...lastP.sets.map(s => s.rpe || 0)) : 0;
  return `
  <div class="${inGroup ? 'ss-body' : 'card'}">
    <div class="row between">
      ${inGroup ? '' : reorderCluster('session', '', ei, opts || {}, exName)}
      <div class="grow">
        <div class="ex-name">${allDone ? '✅ ' : ''}${esc(exName)}</div>
        <div class="target-line">${WorkoutModel.timed(e) ? esc(`${e.plannedSets} × ${measurementText(e, { ...e, weight: e.plannedWeight })}`) : isJump(e)
          ? tr("exercise_card.message.plan_attempt_rest", { e_plannedSets: e.plannedSets, e_plannedSets_1_s: e.plannedSets === 1 ? '' : 's', fmtClock_e_restSeconds: fmtClock(e.restSeconds) })
          : tr("exercise_card.message.plan_rest", { e_plannedSets: e.plannedSets, e_plannedReps: e.plannedReps, e_plannedWeight: loadText(e, e.plannedWeight), unit: unit(), e_targetRpe_tr_exercise_card: e.targetRpe ? tr("format.rpe_suffix", { rpe: e.targetRpe }) : '', fmtClock_e_restSeconds: fmtClock(e.restSeconds) })} ${equipChip(e)}</div>
        ${lastP ? `<div class="last-line">${esc(tr("exercise_card.text.last", { lastP_jump_tr_exercise_card_: WorkoutModel.timed(lastP) ? lastP.sets.map(s => measurementText(lastP, s)).join(' · ') : lastP.jump ? tr("exercise_card.message.best_cm", { bestHeight_lastP_sets: bestHeight(lastP.sets) }) : lastP.sets.map(s => `${loadText(lastP, s.weight)}×${s.reps}`).join(' · ') + (lastRpe ? ` ${tr("exercise_card.message.rpe_2", { lastRpe: lastRpe })}` : ''), fmtDate_lastP_date: fmtDate(lastP.date) }))}</div>` : ''}
        ${e.swappedFrom ? `<div class="swap-note">${esc(tr("exercise_card.text.swapped_from", { e_swappedFrom: I18n.exercise(e.swappedFrom) }))}</div>` : ''}
      </div>
      <button class="icon-btn" data-action="ex-info" data-ei="${ei}" title="${esc(tr("exercise_card.title.explain"))}">${icon('info', 18)}</button>
      ${!isJump(e) && PLATE_EQUIPMENT.has(e.equipment || 'barbell') ? `<button class="icon-btn" data-action="plate-calc" data-ei="${ei}" title="${esc(tr("exercise_card.title.plate_calculator"))}">${icon('plate', 18)}</button>` : ''}
      <button class="icon-btn" data-action="ex-swap" data-ei="${ei}" title="${esc(tr("common.action.swap"))}">${icon('swap', 18)}</button>
      ${allDone && !inGroup ? `<button class="icon-btn" data-action="ex-toggle" data-ei="${ei}" title="${esc(tr("common.action.collapse"))}">${icon('chevUp', 18)}</button>` : ''}
    </div>
    ${WorkoutModel.timed(e) ? measurementGrid(e, ei) : isJump(e) ? `
    <div class="set-grid jump">
      <div class="head">#</div><div class="head">cm</div><div class="head">✓</div>
      ${setLabels(e.sets).map(({ s, si, label }) => `
        <button class="set-no-btn${s.warmup ? ' warm' : ''}" data-action="set-warmup" data-ei="${ei}" data-si="${si}" title="${esc(tr("exercise_card.action.mark_warmup"))}">${label}</button>
        <input class="${s.done ? 'set-row-done-i' : ''}${s.warmup ? ' warm-i' : ''}" type="number" inputmode="decimal" step="0.5" value="${s.heightCm != null ? s.heightCm : ''}" data-bind="set" data-ei="${ei}" data-si="${si}" data-f="heightCm" ${s.done ? 'style="border-color:var(--green)"' : ''}>
        <button class="set-done-btn ${s.done ? 'success' : ''}" data-action="set-done" data-ei="${ei}" data-si="${si}">${s.done ? '✓' : '○'}</button>`).join('')}
    </div>` : `
    <div class="set-grid">
      <div class="head">#</div><div class="head"${isAddedLoad(e) ? ` title="${esc(tr('exercise.added_load.label', { unit: unit() }))}"` : ''}>${isAddedLoad(e) ? '+' : ''}${unit()}</div><div class="head">${esc(tr("exercise_card.text.reps"))}</div><div class="head">RPE</div><div class="head">✓</div>
      ${setLabels(e.sets).map(({ s, si, label }) => `
        <button class="set-no-btn${s.warmup ? ' warm' : ''}" data-action="set-warmup" data-ei="${ei}" data-si="${si}" title="${esc(tr("exercise_card.action.mark_warmup"))}">${label}</button>
        <input class="${s.done ? 'set-row-done-i' : ''}${e.equipment === 'bodyweight' && !isAddedLoad(e) ? ' bw-weight-i' : ''}${s.warmup ? ' warm-i' : ''}" type="number" inputmode="decimal" step="any" min="0" value="${s.weight != null ? s.weight : ''}" data-bind="set" data-ei="${ei}" data-si="${si}" data-f="weight" ${isAddedLoad(e) ? `aria-label="${esc(tr('exercise.added_load.label', { unit: unit() }))}"` : ''} ${s.done ? 'style="border-color:var(--green)"' : ''}>
        <input class="${s.warmup ? 'warm-i' : ''}" type="number" inputmode="numeric" value="${s.reps != null ? s.reps : ''}" data-bind="set" data-ei="${ei}" data-si="${si}" data-f="reps" ${s.done ? 'style="border-color:var(--green)"' : ''}>
        <button class="rpe-btn ${s.rpe != null ? '' : 'muted'}" data-action="rpe-pick" data-ei="${ei}" data-si="${si}" ${s.done ? 'style="border-color:var(--green)"' : ''}>${s.rpe != null ? s.rpe : '—'}</button>
        <button class="set-done-btn ${s.done ? 'success' : ''}" data-action="set-done" data-ei="${ei}" data-si="${si}">${s.done ? '✓' : '○'}</button>`).join('')}
    </div>`}
    <div class="row mt12">
      <button class="ghost icon-btn" data-action="set-add" data-ei="${ei}">${esc(tr("exercise_card.text.set"))}</button>
      <button class="ghost icon-btn" data-action="set-remove" data-ei="${ei}">${esc(tr("exercise_card.text.set_2"))}</button>
      ${isJump(e) ? `<button class="ghost icon-btn" data-action="cmj-open" data-ei="${ei}">${icon('video', 15)} ${esc(tr("exercise_card.text.measure"))}</button>` : ''}
      <button class="ghost icon-btn grow note-btn" data-action="ex-note" data-ei="${ei}">${icon('note', 15)} ${e.notes ? esc(e.notes.slice(0, 24)) + (e.notes.length > 24 ? '…' : '') : tr("exercise_card.message.note")}</button>
    </div>
  </div>`;
}

function applyImportedPlan(newPlan) {
  newPlan.library = ExerciseLibrary.importLibrary(plan, newPlan);
  const prevPlan = plan;
  plan = newPlan;
  if (!savePlan()) {
    plan = prevPlan;
    render();
    return false;
  }
  expandedDay = null;
  tab = 'plan';
  closeModal();
  render();
  toast(tr("action_import-plan.message.plan_imported"));
  return true;
}

function showPlanImportPreview(newPlan, onConfirm) {
  const totalExercises = newPlan.days.reduce((n, d) => n + d.exercises.length, 0);

  const daysHtml = newPlan.days.map(d => {
    const exList = d.exercises.map(e => {
      let targetDesc = '';
      if (WorkoutModel.timed(e)) {
        targetDesc = `${e.sets} × ${measurementText(e, e)}`;
      } else if (e.metric === 'height') {
        targetDesc = `${e.sets} attempts`;
      } else {
        targetDesc = `${e.warmupSets ? `${e.warmupSets}W + ` : ''}${e.sets} × ${e.reps}${e.weight || isAddedLoad(e) ? ` @ ${loadText(e, e.weight)}${unit()}` : ''}${e.targetRpe ? ` @ RPE ${e.targetRpe}` : ''}`;
      }

      const techDetails = [
        e.side && e.side !== 'unspecified' ? modelLabel(e.side) : '',
        e.setupId ? e.setupId : '',
        e.equipment && e.equipment !== 'barbell' ? equipmentLabel(e.equipment) : '',
        e.superset ? `SS ${e.superset}` : ''
      ].filter(Boolean).join(' · ');

      return `
        <div class="row between" style="padding:4px 0;border-bottom:1px solid var(--border)">
          <div>
            <b>${esc(I18n.exercise(e.name))}</b>
            <div class="small muted">${esc(targetDesc)}${techDetails ? ` <span class="equip-chip">${esc(techDetails)}</span>` : ''}</div>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="card mt8" style="background:var(--card-bg)">
        <div class="bold">${esc(d.name)} (${d.exercises.length})</div>
        ${d.warmup && d.warmup.length ? `<div class="small muted mt4">Prep: ${esc(d.warmup.map(w => w.name || w).join(', '))}</div>` : ''}
        <div class="mt4">${exList}</div>
      </div>`;
  }).join('');

  const bodyHtml = `
    <div style="max-height:60vh;overflow-y:auto">
      <div class="bold" style="font-size:1.1em">${esc(newPlan.name)}</div>
      <p class="small muted">${esc(tr("plan.preview.summary", { days: newPlan.days.length, exercises: totalExercises }))}</p>
      <div class="mt8">${daysHtml}</div>
      <p class="small green mt12">✓ ${esc(tr("plan.preview.preserves_history"))}</p>
    </div>`;

  showModal(tr("plan.import.title", { plan: newPlan.name }), bodyHtml, [
    { label: tr("action_import-plan.button.import"), cls: 'primary', fn: onConfirm },
    { label: tr("common.action.cancel"), fn: closeModal }
  ]);
}

/* ---- plan view ---- */
function viewPlan() {
  return `
    <div class="row between">
      <div class="grow">
        <div class="bold">${esc(plan.name)}</div>
        <div class="muted small">${esc(tr("view_plan.text.days_created", { plan_days_length: plan.days.length, plan_createdAt: plan.createdAt || '?' }))}</div>
      </div>
      <div class="row" style="gap:4px">
        <button class="icon-btn ghost" data-action="plan-export" title="${esc(tr("plan.action.export"))}">${icon('copy', 18)}</button>
        <button class="icon-btn ghost" data-action="plan-import-open" title="${esc(tr("plan.action.import"))}">${icon('link', 18)}</button>
        <button class="icon-btn" data-action="plan-rename">✏️</button>
      </div>
    </div>
    <div class="mt12"></div>
    ${plan.days.map(d => {
      const open = expandedDay === d.id;
      return `
      <div class="card">
        <div class="row between tappable" data-action="day-toggle" data-id="${d.id}">
          <div class="bold grow">${esc(d.name)}${coachDayLabel(d)}</div>
          <span class="day-pill">${esc(tr("view_plan.text.exercise_2", { d_exercises_length: d.exercises.length, d_exercises_length_1_s: d.exercises.length === 1 ? '' : 's' }))}</span>
          <span class="chev">${icon(open ? 'chevDown' : 'chevRight', 16)}</span>
        </div>
        ${open ? (() => {
          // ↑↓ move whole superset groups, so they disable at GROUP boundaries:
          // every member of the first group has ↑ disabled, not just the first
          // exercise in the day.
          const groups = supersetGroups(d.exercises);
          return `
          <div class="divider"></div>
          <div data-reorder-list="plan" data-day="${d.id}">
          ${groups.map((g, gi) => `<div class="reorder-unit${isRealGroup(g) ? ' plan-group' : ''}" data-reorder-unit="${gi}">${g.idx.map(i => { const e = d.exercises[i]; return `
            <div class="row between" style="padding:9px 0">
              ${reorderHandle('plan', d.id, i, I18n.exercise(e.name))}
              <div class="grow tappable" data-action="ex-menu" data-day="${d.id}" data-i="${i}">
                <div class="bold">${esc(I18n.exercise(e.name))}${e.superset ? ` <span class="day-pill">${esc(tr("view_plan.text.ss", { e_superset: e.superset }))}</span>` : ''}</div>
                <div class="muted small">${WorkoutModel.timed(e) ? esc(`${e.sets} × ${measurementText(e, e)}`) : esc(tr("view_plan.text.rest", { e_warmupSets_tr_view_plan_me: e.warmupSets ? `${tr("view_plan.message.w", { e_warmupSets: e.warmupSets })} ` : '', e_sets: e.sets, e_reps: e.reps, e_weight: loadText(e, e.weight), unit: unit(), e_targetRpe_tr_view_plan_mes: e.targetRpe ? tr("format.rpe_suffix", { rpe: e.targetRpe }) : '', fmtClock_e_restSeconds: fmtClock(e.restSeconds), e_alternates_length_e_altern: e.alternates.length ? ' · ' + e.alternates.length + ' alt' : '' }))} ${equipChip(e)}</div>
              </div>
              ${moveButtons('plan', d.id, i, { first: gi === 0, last: gi === groups.length - 1 }, I18n.exercise(e.name))}
            </div>`; }).join('')}</div>`).join('')}
          </div>
          <div class="row mt8 wrap-row">
            <button class="ghost icon-btn" data-action="ex-add" data-day="${d.id}">${esc(tr("view_plan.text.exercise"))}</button>
            <button class="ghost icon-btn" data-action="day-warmup" data-id="${d.id}">${esc(tr("view_plan.text.warm_up", { d_warmup_length_d_warmup_len: (d.warmup || []).length ? ` (${d.warmup.length})` : '' }))}</button>
            <button class="ghost icon-btn" data-action="day-rename" data-id="${d.id}">${esc(tr("view_plan.text.rename"))}</button>
            <button class="ghost icon-btn red" data-action="day-delete" data-id="${d.id}">${esc(tr("common.action.delete"))}</button>
          </div>`;
        })() : ''}
      </div>`;
    }).join('')}
    <div class="row mt8" style="gap:6px">
      <button class="grow" data-action="day-add">${esc(tr("view_plan.text.add_day"))}</button>
      <button class="ghost" data-action="plan-export">${icon('copy', 16)} ${esc(tr("plan.action.export"))}</button>
      <button class="ghost" data-action="plan-import-open">${icon('link', 16)} ${esc(tr("plan.action.import"))}</button>
    </div>
    <p class="muted small mt12" style="text-align:center">${esc(tr("view_plan.text.tap_an_exercise_to_edit_targets_swap_alternates_"))}</p>`;
}

/* ---- history view ---- */
function exerciseHistory(name) {
  const rows = [];
  for (const s of sessions) for (const e of s.exercises) {
    if (WorkoutModel.key(e, canonicalName) !== name) continue;
    // Progress is a working-set story throughout — a ramp-up set is neither a
    // data point on the chart nor a candidate for the best set of the day.
    const ws = workingSets(e.sets);
    if (!ws.length) continue;
    if (WorkoutModel.timed(e)) {
      rows.push({ date: s.date, timed: true, metric: e.metric, sets: ws });
    } else if (e.metric === 'height') {
      rows.push({ date: s.date, jump: true, heightCm: bestHeight(e.sets), sets: ws });
    } else if (isAddedLoad(e)) {
      const best = addedLoadBest(ws);
      rows.push({ date: s.date, jump: false, addedLoad: true, equipment: e.equipment, metric: e.metric, best, e1rm: best.weight || 0, sets: ws });
    } else {
      const best = ws.reduce((a, b) => est1RM(b.weight, b.reps) > est1RM(a.weight, a.reps) ? b : a);
      rows.push({ date: s.date, jump: false, best, e1rm: est1RM(best.weight, best.reps), sets: ws });
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
          const ws = workingSets(e.sets); // ramp-ups are neither volume nor a set here
          wk.sets += ws.length;
          // Height sets have no kg × reps to contribute; they still count as sets.
          if (e.metric && e.metric !== 'load') continue;
          if (isAddedLoad(e)) continue; // added load × reps is not tonnage; the sets still count
          for (const st of ws) wk.volume += (st.weight || 0) * (st.reps || 0);
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
  const historyEntries = new Map(sessions.flatMap(s => s.exercises.map(e => [WorkoutModel.key(e, canonicalName), e])));
  const exNames = [...historyEntries.keys()].sort((a, b) => historyLabel(historyEntries.get(a)).localeCompare(historyLabel(historyEntries.get(b))));
  if (historyExercise && !exNames.includes(historyExercise)) historyExercise = '';
  const sel = historyExercise || exNames[0] || '';
  const hist = sel ? exerciseHistory(sel) : [];
  const histJump = hist.length ? hist[hist.length - 1].jump : false;
  const histTimed = hist.length ? hist[hist.length - 1].timed : false;
  // A metric switch mid-history (e.g. load -> height) leaves older rows shaped
  // for the other metric — mixing them into one chart/list produces NaN and
  // "undefined" values, so only rows matching the newest row's metric are shown.
  const histRows = hist.filter(r => r.jump === histJump && r.timed === (histTimed || undefined));
  const prBest = !histTimed && histRows.length ? Math.max(...histRows.map(r => histJump ? r.heightCm : r.e1rm)) : 0;
  const histAdded = !!(histRows.length && histRows[histRows.length - 1].addedLoad);
  const bwLast = bodyWeight[bodyWeight.length - 1];
  const weeks = sessions.length ? weeklyStats(8) : [];
  const thisWeek = weeks[weeks.length - 1];
  return `
    ${sessions.length ? `
    <h2 class="section">${esc(tr("view_history.text.weekly_training"))}</h2>
    <div class="card">
      ${weeklyBarsSvg(weeks)}
      <div class="muted small mt8">${esc(tr("history.week.summary", {
        sessions: thisWeek.sessions, sets: thisWeek.sets,
        volume: I18n.number(Math.round(thisWeek.volume)), unit: unit()
      }))}</div>
    </div>` : ''}

    <h2 class="section">${esc(tr("view_history.text.body_weight"))}</h2>
    <div class="card">
      <div class="row">
        <input id="bw-input" type="number" inputmode="decimal" step="0.1" placeholder="${bwLast ? bwLast.weight : tr("history.weight.example")}" style="max-width:130px">
        <span class="muted">${unit()}</span>
        <button class="primary grow" data-action="bw-add">${esc(tr("view_history.text.log_today"))}</button>
      </div>
      ${bodyWeight.length ? `
        ${chartSvg(bodyWeight.slice(-15).map(b => ({ v: b.weight, d: b.date })))}
        <div class="muted small mt8">${esc(tr("history.body_weight.latest", {
          weight: bwLast.weight, unit: unit(), date: fmtDate(bwLast.date), entries: bodyWeight.length
        }))}
          <button class="ghost icon-btn small" data-action="bw-undo" style="float:right">${esc(tr("view_history.text.undo_last"))}</button></div>` : ''}
    </div>

    <h2 class="section">${esc(tr("view_history.text.exercise_progress"))}</h2>
    <div class="card">
      ${exNames.length ? `
        <select data-bind="history-ex">${exNames.map(n => `<option value="${esc(n)}" ${n === sel ? 'selected' : ''}>${esc(historyLabel(historyEntries.get(n)))}</option>`).join('')}</select>
        ${histTimed ? histRows.slice(-8).reverse().map(r => `<div class="mt8"><span class="muted small">${fmtDate(r.date)}</span><div>${esc(r.sets.map(s => measurementText(r, s)).join(' · '))}</div></div>`).join('') : histRows.length ? `
          ${chartSvg(histRows.slice(-12).map(r => ({ v: histJump ? r.heightCm : r.e1rm, d: r.date })))}
          <div class="muted small mt8">${histJump ? `${esc(tr("view_history.text.best_jump"))} <b class="amber">${esc(tr("view_history.text.cm", { prBest: prBest }))}</b>` : histAdded ? `${esc(tr("history.added_load.best"))} <b class="amber">+${prBest} ${unit()}</b> <span class="muted">${esc(tr("history.added_load.no_e1rm"))}</span>` : `${esc(tr("view_history.text.best_est_1rm"))} <b class="amber">${prBest} ${unit()}</b>`}</div>
          ${hist.length > histRows.length ? `<div class="muted small mt8">${esc(tr("view_history.text.earlier_session_logged_this_exercise_with_a_diff", { hist_length_histRows_length: hist.length - histRows.length, hist_length_histRows_length_: hist.length - histRows.length === 1 ? '' : 's', hist_length_histRows_length_2: hist.length - histRows.length === 1 ? 'is' : 'are' }))}</div>` : ''}
          <div class="divider"></div>
          ${histRows.slice(-8).reverse().map(r => `
            <div class="row between" style="padding:5px 0">
              <span class="muted small">${fmtDate(r.date)}</span>
              <span class="small">${histJump ? r.sets.map(s => tr("view_history.message.cm", { s_heightCm: s.heightCm })).join(' · ') : r.sets.map(s => `${loadText(r, s.weight)}×${s.reps}`).join(' · ')}</span>
              <span class="small bold ${(histJump ? r.heightCm : r.e1rm) >= prBest ? 'amber' : ''}">${(histJump ? r.heightCm : r.e1rm) >= prBest ? '🏆 ' : ''}${histJump ? tr("view_history.message.cm_2", { r_heightCm: r.heightCm }) : r.addedLoad ? tr("history.added_load.top", { weight: r.e1rm, unit: unit() }) : tr("view_history.message.e1rm", { r_e1rm: r.e1rm })}</span>
            </div>`).join('')}` : `<p class="muted mt8">${esc(tr("view_history.text.no_logged_sets_for_this_exercise_yet"))}</p>`}
        ${!historyEntries.get(sel)?.movementId && (exNames.length > 1 || Object.keys(aliases).length) ? `<button class="ghost wide mt8 small" data-action="merge-names" data-name="${esc(historyEntries.get(sel)?.name)}">${esc(tr("view_history.text.merge_names"))}</button>` : ''}`
      : `<p class="empty"><span class="big">📈</span>${esc(tr("view_history.text.finish_your_first_workout_and_your_progress_will"))}</p>`}
    </div>

    <h2 class="section">${esc(tr("view_history.text.sessions", { sessions_length: sessions.length }))}</h2>
    ${sessions.length ? sessions.slice().reverse().map(s => {
      const open = expandedSession === s.id;
      const setCount = s.exercises.reduce((n, e) => n + workingSets(e.sets).length, 0);
      const sl = sessionLoad(s);
      return `
      <div class="card">
        <div class="row between tappable" data-action="session-toggle" data-id="${s.id}">
          <div class="grow">
            <div class="bold">${esc(s.dayName)}</div>
            <div class="muted small">${esc(tr("view_history.text.sets", { fmtDate_s_date: fmtDate(s.date), fmtDur_s_durationMin: fmtDur(s.durationMin), setCount: setCount, sl_tr_view_history_message_r: sl ? ` ${tr("view_history.message.rpe_au", { sl_rpe: sl.rpe, sl_load: sl.load, sl_partial: sl.partial ? '*' : '' })}` : '' }))}</div>
          </div>
          <span class="chev">${icon(open ? 'chevDown' : 'chevRight', 16)}</span>
        </div>
        ${open ? `
          <div class="divider"></div>
          ${sl && sl.partial ? `<div class="muted small">${esc(tr("view_history.text.session_rpe_from_only_of_sets_the_rest_were_logg", { Math_round_sl_coverage_100: Math.round(sl.coverage * 100) }))}</div>` : ''}
          ${s.exercises.map(e => `
            <div style="padding:5px 0">
              <div class="bold small">${esc(I18n.exercise(e.name))}${e.swappedFrom ? ` <span class="swap-note">${esc(tr("view_history.text.was", { e_swappedFrom: I18n.exercise(e.swappedFrom) }))}</span>` : ''}</div>
              <div class="muted small">${e.sets.map(x => {
                const txt = measurementText(e, x);
                // Warm-ups stay visible here — this is the raw log, not a stat —
                // but dimmed and prefixed so they can't be misread as work sets.
                return x.warmup ? `<span class="warmup-set">${esc(tr("view_history.text.w", { txt: txt }))}</span>` : txt;
              }).join(' · ')}</div>
              ${e.notes ? `<div class="small amber">📝 ${esc(e.notes)}</div>` : ''}
            </div>`).join('')}
          ${s.notes ? `<div class="divider"></div><div class="small">📝 ${esc(s.notes)}</div>` : ''}
          <button class="ghost icon-btn red mt8" data-action="session-delete" data-id="${s.id}">${esc(tr("view_history.text.delete_session"))}</button>` : ''}
      </div>`;
    }).join('') : `<p class="empty"><span class="big">🗓️</span>${esc(tr("view_history.text.no_sessions_yet"))}</p>`}`;
}

/* ---- merge exercise names (aliases) ---- */
function mergeNamesModal(selName) {
  const sel = canonicalName(selName);
  const others = [...new Set(sessions.flatMap(s => s.exercises.map(e => canonicalName(e.name))))]
    .filter(n => n.toLowerCase() !== sel.toLowerCase()).sort();
  const currentAliases = Object.keys(aliases).filter(k => aliases[k].toLowerCase() === sel.toLowerCase()).sort();
  showModal(tr("history.merge.title", { exercise: sel }), `
    <p class="small muted">${esc(tr("merge_names_modal.text.tick_names_that_are_really_the_same_exercise_as"))} <b>${esc(sel)}</b> ${esc(tr("merge_names_modal.text.typos_abbreviations_their_history_shows_up_under"))}</p>
    ${others.length ? others.map(n => `
      <label class="merge-row"><input type="checkbox" class="merge-cb" value="${esc(n)}"><span>${esc(n)}</span></label>`).join('')
      : `<p class="muted small mt8">${esc(tr("merge_names_modal.text.no_other_exercise_names_in_your_history"))}</p>`}
    ${currentAliases.length ? `<div class="divider"></div><p class="small muted">${esc(tr("merge_names_modal.text.already_merged_into_this_name"))}</p>
      ${currentAliases.map(k => `<div class="row between mt8"><span class="small">${esc(k)}</span><button class="ghost icon-btn red" data-action="unmerge-alias" data-k="${esc(k)}" data-name="${esc(sel)}">${esc(tr("merge_names_modal.text.remove"))}</button></div>`).join('')}` : ''}`,
    [
      { label: tr("merge_names_modal.button.merge"), cls: 'primary', fn: () => {
          const checked = [...document.querySelectorAll('.merge-cb:checked')].map(c => c.value);
          if (!checked.length) { closeModal(); return; }
          const prevAliases = { ...aliases };
          for (const n of checked) {
            aliases[n.toLowerCase()] = sel;
            // repoint anything that already aliased to the merged name
            for (const k of Object.keys(aliases)) if (aliases[k].toLowerCase() === n.toLowerCase()) aliases[k] = sel;
          }
          if (!saveAliases()) {
            aliases = prevAliases;
            return;
          }
          historyExercise = sel;
          closeModal(); render();
          toast(tr("history.merge.success", { exercise: sel }));
        } },
      { label: tr("common.action.cancel") }
    ]);
}

/* ---- AI coach tab ---- */
function viewCoach() {
  return `
    <h2 class="section">${esc(tr("view_coach.text.share_with_ai"))}</h2>
    ${!APP_CONFIG.cloudSync ? `
    <div class="card">
      <p class="small muted">${esc(tr("alpha.cloud_disabled"))}</p>
      <p class="small muted mt4">${esc(tr("alpha.storage_note"))}</p>
    </div>` : `
    <div class="card">
      <button class="primary wide" data-action="share-ai">${icon('link', 18)} ${esc(tr("view_coach.text.share_with_ai_2"))}</button>
      <p class="small muted mt8">${esc(tr("view_coach.text.copies_a_link_you_can_paste_into_claude_chatgpt_"))}</p>
      <div id="sync-status" class="mt8">${syncStatusHtml()}</div>
    </div>`}

    <h2 class="section">${esc(tr("view_coach.text.or_copy_your_data_directly"))}</h2>
    <div class="card">
      <p class="small muted">${esc(tr("view_coach.text.copies_a_coaching_prompt_your_last_15_sessions_b"))}</p>
      <button class="wide mt12" data-action="copy-coach">${icon('copy', 18)} ${esc(tr("view_coach.text.copy_coaching_prompt_data"))}</button>
      <button class="ghost wide mt8" data-action="copy-data">${esc(tr("view_coach.text.copy_raw_data_only"))}</button>
    </div>

    <h2 class="section">${esc(tr("view_coach.text.import_a_plan"))}</h2>
    <div class="card">
      <p class="small muted">${esc(tr("view_coach.import.instructions"))}</p>
      <textarea id="import-area" class="mt8" placeholder='{"type":"workout-plan", "days":[...]}'></textarea>
      <button class="primary wide mt8" data-action="import-plan">${esc(tr("view_coach.text.import_plan"))}</button>
    </div>`;
}

/* ---- settings view (reached via the topbar gear, not a tab) ---- */
function viewSettings() {
  return `
    <div class="row settings-head">
      <button class="icon-btn ghost" data-action="settings-back" aria-label="${esc(tr("view_settings.aria-label.back"))}">${icon('back', 22)}</button>
      <h2 class="settings-title">${esc(tr("view_settings.text.settings"))}</h2>
    </div>

    <div class="card"><label class="row between"><span>${esc(tr("settings.language.label"))}</span><select data-bind="set-language" aria-label="${esc(tr("settings.language.label"))}"><option value="en" ${I18n.locale() === 'en' ? 'selected' : ''}>${esc(tr("settings.language.english"))}</option><option value="fi" ${I18n.locale() === 'fi' ? 'selected' : ''}>${esc(tr("settings.language.finnish"))}</option></select></label></div>
    <div class="card">
      <p class="small muted">${esc(I18n.pendingExercises().length ? tr("settings.exercise_review.pending", { count: I18n.pendingExercises().length }) : tr("settings.exercise_review.none"))}</p>
      <button class="ghost wide mt8" data-action="download-pending-exercises" ${I18n.pendingExercises().length ? '' : 'disabled'}>${esc(tr("settings.exercise_review.download"))}</button>
    </div>
    <h2 class="section">${esc(tr("view_settings.text.preferences"))}</h2>
    <div class="card">
      <div class="row between" style="padding:6px 0">
        <span>${esc(tr("view_settings.text.weight_unit"))}</span>
        <select data-bind="set-unit" style="max-width:110px"><option ${unit() === 'kg' ? 'selected' : ''}>kg</option><option ${unit() === 'lb' ? 'selected' : ''}>lb</option></select>
      </div>
      <div class="row between" style="padding:6px 0">
        <span>${esc(tr("view_settings.text.rest_timer_sound"))}</span>
        <button class="icon-btn ${settings.sound ? 'success' : ''}" data-action="toggle-sound">${settings.sound ? tr("view_settings.message.on") : tr("view_settings.message.off")}</button>
      </div>
      <div class="row between" style="padding:6px 0">
        <span>${esc(tr("view_settings.text.vibration"))}</span>
        ${navigator.vibrate
          ? `<button class="icon-btn ${settings.vibrate ? 'success' : ''}" data-action="toggle-vibrate">${settings.vibrate ? tr("view_settings.message.on_2") : tr("view_settings.message.off_2")}</button>`
          : `<span class="muted small">${esc(tr("view_settings.text.not_supported_on_this_device"))}</span>`}
      </div>
      <button class="ghost wide mt8" data-action="test-sound">${esc(tr("view_settings.text.test_the_rest_timer_sound"))}</button>
    </div>

    ${APP_CONFIG.isAlpha ? viewCoachSettings() : ''}
    ${!APP_CONFIG.cloudSync ? `
    <h2 class="section">${esc(tr("alpha.badge"))}</h2>
    <div class="card">
      <p class="small muted">${esc(tr("alpha.storage_note"))}</p>
      <div class="small green mt8">✓ ${esc(tr("alpha.version_label", { version: APP_CONFIG.version, build: APP_CONFIG.build }))}</div>
    </div>` : `
    <h2 class="section">${esc(tr("view_settings.text.cloud_sync"))}</h2>
    <div class="card">
      <div class="row between">
        <span class="bold">${esc(tr("view_settings.text.auto_sync"))}</span>
        <button class="icon-btn ${settings.autoSync ? 'success' : ''}" data-action="toggle-autosync">${settings.autoSync ? tr("view_settings.message.on_3") : tr("view_settings.message.off_3")}</button>
      </div>
      <div id="sync-status" class="mt8">${syncStatusHtml()}</div>
      <p class="small muted mt8">${esc(tr("view_settings.text.syncs_automatically_after_every_workout_no_setup"))}</p>
      <div class="divider"></div>
      <p class="small muted"><b>${esc(tr("view_settings.text.your_backup_code"))}</b></p>
      <code class="inline" style="word-break:break-all;display:block;margin-top:6px;user-select:all">${esc(gymUUID)}</code>
      <button class="ghost wide mt8" data-action="copy-uuid">${esc(tr("view_settings.text.copy_backup_code"))}</button>
      <p class="small muted mt8">${esc(tr("view_settings.text.save_this_somewhere_safe_if_you_lose_your_phone_"))}</p>
      <div class="divider"></div>
      <p class="small muted"><b>${esc(tr("view_settings.text.restore_from_backup_code"))}</b></p>
      <input id="restore-uuid-input" class="mt8" placeholder="${esc(tr("view_settings.placeholder.paste_your_backup_code_or_full_share_url"))}" style="width:100%;box-sizing:border-box">
      <button class="ghost wide mt8" data-action="restore-uuid">${esc(tr("common.action.restore"))}</button>
      <div class="divider"></div>
      <p class="small muted"><b>${esc(tr("view_settings.text.write_token"))}</b> ${writeToken ? `<span class="green">${esc(tr("view_settings.text.set"))}</span>` : `<span class="red">${esc(tr("view_settings.text.not_set"))}</span>`}</p>
      <input id="write-token-input" class="mt8" placeholder="${esc(tr("view_settings.placeholder.paste_your_write_token"))}" style="width:100%;box-sizing:border-box">
      <button class="ghost wide mt8" data-action="save-write-token">${esc(tr("view_settings.text.save_write_token"))}</button>
      <p class="small muted mt8">${esc(tr("settings.write_token.explanation"))}</p>
    </div>`}

    <h2 class="section">${esc(tr("view_settings.text.backup"))}</h2>
    <div class="card">
      <div class="row">
        <button class="grow" data-action="backup-copy">${esc(tr("view_settings.text.copy_full_backup"))}</button>
        <button class="grow" data-action="backup-restore">${esc(tr("view_settings.text.restore_backup"))}</button>
      </div>
      <p class="small muted mt8">${esc(tr("backup.note.active_excluded"))}</p>
      <button class="ghost wide danger mt8" data-action="reset-all">${esc(tr("view_settings.text.reset_everything"))}</button>
    </div>

    <h2 class="section">${esc(tr("view_settings.text.app_version"))}</h2>
    <div class="card">
      ${APP_CONFIG.isAlpha ? `<p class="bold">${esc(tr("alpha.version_label", { version: APP_CONFIG.version, build: APP_CONFIG.build }))}</p>` : ''}
      <button class="ghost wide ${APP_CONFIG.isAlpha ? 'mt8' : ''}" data-action="check-updates">${esc(tr("updates.action.check"))}</button>
      <p class="small muted mt8">${esc(tr("view_settings.text.updates_normally_appear_as_a_banner_at_the_top_u"))}</p>
    </div>
    <p class="muted small" style="text-align:center">${esc(tr("view_settings.text.gymtrack_v1_data_lives_on_this_device", { settings_autoSync_tr_view_se: settings.autoSync ? tr("view_settings.message.auto_synced_to_cloud") : '' }))}</p>`;
}

/* ================= modals for plan editing ================= */
function exMenuModal(dayId, i) {
  const day = plan.days.find(d => d.id === dayId); if (!day) return;
  const e = day.exercises[i];
  const desc = ExerciseLibrary.instructions(e, I18n.explanation, lookupExplanation);
  showModal(I18n.exercise(e.name), `
    <p class="muted small">${WorkoutModel.timed(e) ? esc(`${e.sets} × ${measurementText(e, e)}`) : esc(tr("ex_menu_modal.text.rest", { e_sets: e.sets, e_reps: e.reps, e_weight: loadText(e, e.weight), unit: unit(), e_targetRpe_tr_ex_menu_modal: e.targetRpe ? tr("format.rpe_suffix", { rpe: e.targetRpe }) : '', fmtClock_e_restSeconds: fmtClock(e.restSeconds) }))}</p>
    ${desc ? `<p class="small mt8">${esc(desc)}</p>` : ''}
    ${e.alternates.length ? `<div class="divider"></div><p class="small muted">${esc(tr("ex_menu_modal.text.alternates", { e_alternates_map_a_esc_a_nam: e.alternates.map(a => esc(I18n.exercise(a.name))).join(', ') }))}</p>` : ''}`,
    [
      { label: tr("ex_menu_modal.button.edit"), cls: 'primary', fn: () => exEditModal(dayId, i) },
      ...(e.alternates.length ? [{ label: tr("common.action.swap"), fn: () => exSwapPlanModal(dayId, i) }] : []),
      { label: tr("ex_menu_modal.button.remove"), cls: 'danger', fn: () => {
          const removed = day.exercises.splice(i, 1);
          if (!savePlan()) { day.exercises.splice(i, 0, ...removed); return; }
          closeModal(); render();
        } },
      { label: tr("common.action.close") }
    ]);
}
// Human-readable increment rule for the plan editor's weight field.
function ladderHint(equipment, addedLoad) {
  if (addedLoad && equipment === 'bodyweight') return tr('exercise.added_load.hint', { step: ADDED_LOAD_STEP[unit()] || 1.25, unit: unit() });
  if (unit() !== 'kg') return '';
  if (equipment === 'bodyweight') return tr("ladder_hint.message.bodyweight_leave_at_0");
  if (equipment === 'other') return tr("exercise.weight.unchecked");
  if (equipment === 'dumbbell') return tr("ladder_hint.message.1_kg_steps_to_10_kg_then_2_kg");
  if (equipment === 'cable' || equipment === 'machine') return tr("ladder_hint.message.2_5_kg_steps_to_25_kg_then_5_kg");
  if (equipment === 'landmine') return tr("ladder_hint.message.1_25_kg_steps_load_on_the_end");
  return tr("ladder_hint.message.2_5_kg_steps_from_the_kg_bar", { resolvedBarWeight_equipment_: resolvedBarWeight({ equipment, barWeight: null }) });
}
/*
 * The one place a weight is judged before it can be saved. Shared by the plan
 * editor and the mid-session add modal — a second hand-written copy of this
 * block is exactly how a "22.5 kg dumbbell" gets into a plan through whichever
 * screen was forgotten. Returns a ready-to-toast message, or null when fine.
 */
function weightValidationError({ equipment, barWeight, weight, metric, loadProfile, addedLoad }) {
  if (metric === 'height') return weight ? tr('weight_validation_error.message.a_jump_height_exercise_carries_no_weight_set_it_') : null;
  if (addedLoad && equipment === 'bodyweight' && metric === 'load' && !(weight >= 0)) return tr('exercise.added_load.negative');
  if (loadProfile && weight) {
    if (loadProfile.unit !== unit() || !WorkoutModel.loadable(loadProfile, weight)) return tr('exercise.model.invalid', { fields: 'loadProfile / weight' });
    return null;
  }
  if (WorkoutModel.timed({ metric }) && equipment === 'bodyweight') return null;
  // Added load is checked against a custom profile when one exists (above); otherwise any
  // non-negative value is accepted — belts and vests have no verified gym ladder yet.
  if (addedLoad && equipment === 'bodyweight' && metric === 'load') return null;
  if (unit() !== 'kg') return null; // the ladder is kg-only
  const bar = barWeight != null ? barWeight : resolvedBarWeight({ equipment, barWeight: null });
  const kind = weightIssueKind(equipment, bar, weight);
  if (kind === 'bodyweight') return tr("weight_validation_error.message.bodyweight_exercises_must_be_0", { weight: weight, unit: unit(), unit2: unit() });
  if (kind === 'below-bar') {
    return tr("weight_validation.error.below_empty_equipment", {
      weight, unit: unit(), equipment: equipmentLabel(equipment).toLowerCase(), bar
    });
  }
  if (kind === 'off-ladder') {
    const n = nearestRungs(equipment, bar, weight);
    return tr("weight_validation_error.message.is_not_loadable_on_a_try_or", { weight: weight, unit: unit(), EQUIPMENT_LABELS_equipment_t: equipmentLabel(equipment, 'validation').toLowerCase(), n_lo: n.lo, n_hi: n.hi });
  }
  return null;
}
function libraryVariantLabel(value) {
  if (!value) return '';
  const key = 'exercises.modifier_' + ExerciseLibrary.normalize(value).replace(/[^a-z0-9]+/g, '_') + '.name';
  return I18n.english(key) ? tr(key) : I18n.exercise(value);
}
function exerciseLibraryModal(dayId) {
  const items = ExerciseLibrary.entries(plan);
  const label = key => I18n.english('library.' + key) ? tr('library.' + key) : key.split('.').at(-1);
  const options = (values, kind) => `<option value="">${esc(label('all'))}</option>` + values.map(v => `<option value="${esc(v)}">${esc(label(kind + '.' + v))}</option>`).join('');
  showModal(tr('library.title'), `
    <p class="small muted">${esc(tr('library.choice'))}</p>
    <label class="field"><span>${esc(tr('library.search'))}</span><input id="library-query" type="search"></label>
    <label class="field"><span>${esc(tr('library.category'))}</span><select id="library-category">${options([...new Set(items.map(e => e.category))], 'category')}</select></label>
    <label class="field"><span>${esc(tr('library.muscle'))}</span><select id="library-muscle">${options([...new Set(items.flatMap(e => e.muscles))], 'muscle')}</select></label>
    <div id="library-results"></div>`, [
      { label: tr('library.custom'), fn: () => customLibraryModal(dayId, mval('library-query')) },
      { label: tr('common.action.cancel') }
    ]);
  function refresh() {
    const query = mval('library-query');
    const results = ExerciseLibrary.search(items, query, mval('library-category'), mval('library-muscle'), libraryVariantLabel, I18n.exerciseSearchNames);
    const container = document.getElementById('library-results');
    container.innerHTML = results.length ? results.map(e => `<button class="ghost wide mt8" data-library-id="${esc(e.id)}">${esc(I18n.exercise(e.name))}<br><span class="small muted">${esc([I18n.exercise(e.movement), equipmentLabel(e.equipment), libraryVariantLabel(e.position), libraryVariantLabel(e.execution)].filter(Boolean).join(' → '))}</span></button>`).join('') : `<p class="muted">${esc(tr('library.no_matches'))}</p>`;
    container.querySelectorAll('[data-library-id]').forEach(button => button.onclick = () => {
      const entry = items.find(e => e.id === button.dataset.libraryId);
      if (!query || ExerciseLibrary.normalize(query) === ExerciseLibrary.normalize(entry.name) || ExerciseLibrary.normalize(query) === ExerciseLibrary.normalize(I18n.exercise(entry.name))) {
        exEditModal(dayId, null, ExerciseLibrary.attach(entry));
        return;
      }
      showModal(tr('library.link_title'), `<p>${esc(tr('library.link_question', { name: query, match: I18n.exercise(entry.name) }))}</p>`, [
        { label: tr('library.use'), fn: () => exEditModal(dayId, null, ExerciseLibrary.attach(entry)) },
        { label: tr('library.alias'), fn: () => exEditModal(dayId, null, ExerciseLibrary.attach({ ...entry, aliases: [...new Set([...entry.aliases, query])] }, query)) },
        { label: tr('common.action.cancel'), fn: () => exerciseLibraryModal(dayId) }
      ]);
    });
  }
  for (const id of ['library-query', 'library-category', 'library-muscle']) document.getElementById(id).addEventListener('input', refresh);
  refresh();
}
function customLibraryModal(dayId, name) {
  const candidates = ExerciseLibrary.entries(plan);
  const suggestions = ExerciseLibrary.search(candidates, name, '', '', I18n.exercise, I18n.exerciseSearchNames);
  const ordered = [...suggestions, ...candidates.filter(e => !suggestions.includes(e))];
  const select = (id, values, prefix) => `<select id="custom-${id}">${values.map(v => `<option value="${esc(v)}">${esc(tr(prefix + v))}</option>`).join('')}</select>`;
  const field = (id, text, value = '') => `<label class="field"><span>${esc(tr('library.' + text))}</span><input id="custom-${id}" value="${esc(value)}"></label>`;
  showModal(tr('library.custom'), `
    <p class="small muted">${esc(tr('library.custom_choice'))}</p>
    <label class="field"><span>${esc(tr('library.link_title'))}</span><select id="custom-link"><option value="">${esc(tr('library.custom'))}</option>${ordered.map(e => `<option value="${esc(e.id)}">${esc(I18n.exercise(e.name))}</option>`).join('')}</select></label>
    ${field('name', 'name', name)}
    <div id="custom-fields">${field('movement', 'movement', name)}
    <label class="field"><span>${esc(tr('library.category'))}</span>${select('category', ['press','pull','squat','hinge','lunge','isolation','core','carry','cardio','other'], 'library.category.')}</label>
    <label class="field"><span>${esc(tr('library.muscle'))}</span>${select('muscle', ['chest','shoulders','back','quadriceps','hamstrings','glutes','calves','biceps','triceps','core','legs','other'], 'library.muscle.')}</label>
    <label class="field"><span>${esc(tr('exercise.form.equipment'))}</span>${select('equipment', EQUIPMENT_TYPES, 'equipment.name.')}</label>
    ${field('position', 'position')}${field('execution', 'execution')}
    <label class="field"><span>${esc(tr('exercise.form.measurement'))}</span><select id="custom-metric">${modelOptions('load')}</select></label>
    <label class="field"><span>${esc(tr('library.defaults'))}</span><textarea id="custom-description"></textarea></label></div>`, [
      { label: tr('library.continue'), cls: 'primary', fn: () => {
        if (!mval('custom-name')) { toast(tr('exercise.validation.name_required'), 'err'); return; }
        const linked = candidates.find(e => e.id === mval('custom-link'));
        if (linked) {
          exEditModal(dayId, null, ExerciseLibrary.attach({ ...linked, aliases: [...new Set([...linked.aliases, mval('custom-name')])] }, mval('custom-name')));
          return;
        }
        const entry = { id: 'custom:' + crypto.randomUUID(), name: mval('custom-name'), movement: mval('custom-movement') || mval('custom-name'),
          category: mval('custom-category'), muscles: [mval('custom-muscle')], equipment: mval('custom-equipment'),
          position: mval('custom-position'), execution: mval('custom-execution'), metric: mval('custom-metric'),
          description: mval('custom-description'), aliases: [] };
        exEditModal(dayId, null, ExerciseLibrary.attach(entry));
      } },
      { label: tr('common.action.cancel'), fn: () => exerciseLibraryModal(dayId) }
    ]);
}

// "Added weight" option for bodyweight load exercises in the plan editor and the
// mid-workout add sheet. Hidden (and ignored on save) for any other equipment/metric.
function addedLoadToggle(prefix, e, equipment) {
  const show = equipment === 'bodyweight' && (e.metric || 'load') === 'load';
  return `<label class="merge-row${show ? '' : ' hidden'}" id="${prefix}-addedload-row">
    <input type="checkbox" id="${prefix}-addedload" data-bind="added-load" data-prefix="${prefix}" ${e.addedLoad === true ? 'checked' : ''}>
    <span class="grow"><span class="small bold">${esc(tr('exercise.added_load.toggle'))}</span><span class="field-hint">${esc(tr('exercise.added_load.toggle_hint'))}</span></span>
  </label>`;
}
function readAddedLoad(prefix, equipment, metric) {
  const box = document.getElementById(`${prefix}-addedload`);
  return !!(box && box.checked && equipment === 'bodyweight' && metric === 'load');
}
function refreshAddedLoadFields(prefix) {
  const eq = document.getElementById(`${prefix}-equipment`), metric = document.getElementById(`${prefix}-metric`);
  const row = document.getElementById(`${prefix}-addedload-row`);
  if (!eq || !row) return;
  const applicable = eq.value === 'bodyweight' && (metric ? metric.value : 'load') === 'load';
  row.classList.toggle('hidden', !applicable);
  const added = applicable && document.getElementById(`${prefix}-addedload`).checked;
  const label = document.getElementById(`${prefix}-weight-label`);
  if (label) label.textContent = added ? tr('exercise.added_load.label', { unit: unit() }) : tr('exercise.form.weight', { unit: unit() });
  const hint = document.getElementById(`${prefix}-weight-hint`);
  if (hint) hint.textContent = ladderHint(eq.value, added);
}
function exEditModal(dayId, i, selection = null) {
  const day = plan.days.find(d => d.id === dayId);
  const e = i != null ? day.exercises[i] : { name: '', sets: 3, warmupSets: 0, reps: '8-12', weight: 0, targetRpe: 8, restSeconds: 120, restSecondsNext: null, equipment: 'barbell', barWeight: null, metric: 'load', superset: null, description: '', alternates: [] };
  if (selection) Object.assign(e, selection);
  const equipment = e.equipment || 'barbell';
  showModal(i != null ? tr("ex_edit_modal.message.edit_exercise") : tr("exercise.add.title"), `
    <label class="field"><span>${esc(tr("exercise.form.name"))}</span><input id="f-name" value="${esc(e.name)}"><span class="field-hint">${esc(tr("exercise.edit.translated_name", { name: I18n.exercise(e.name) }))}</span></label>
    <div class="row">
      <label class="field grow"><span>${esc(tr("exercise.form.sets"))}</span><input id="f-sets" type="number" inputmode="numeric" value="${e.sets}"></label>
      <label class="field grow" ${e.metric && e.metric !== 'load' ? 'hidden' : ''}><span>${esc(tr("exercise.form.reps"))}</span><input id="f-reps" value="${esc(e.reps)}"></label>
      <label class="field grow" ${e.metric && e.metric !== 'load' ? 'hidden' : ''}><span>${esc(tr("ex_edit_modal.text.warm_up_sets"))}</span><input id="f-warmupsets" type="number" inputmode="numeric" min="0" value="${e.warmupSets || 0}">
        <span class="field-hint">${esc(tr("ex_edit_modal.text.extra_ramp_rows_seeded_from_the_working_weight"))}</span></label>
    </div>
    <div class="row">
      <label class="field grow"><span id="f-weight-label">${esc(isAddedLoad(e) ? tr('exercise.added_load.label', { unit: unit() }) : tr("exercise.form.weight", { unit: unit() }))}</span><input id="f-weight" type="number" inputmode="decimal" step="any" value="${e.weight}">
        <span class="field-hint" id="f-weight-hint">${esc(ladderHint(equipment, isAddedLoad(e)))}</span></label>
      <label class="field grow"><span>${esc(tr("ex_edit_modal.text.target_rpe"))}</span><button type="button" id="f-rpe" class="rpe-btn" data-action="edit-rpe-pick" data-v="${e.targetRpe != null ? e.targetRpe : ''}">${e.targetRpe != null ? e.targetRpe : '—'}</button></label>
    </div>
    <div class="row">
      <label class="field grow"><span>${esc(tr("ex_edit_modal.text.rest_between_sets_sec"))}</span><input id="f-rest" type="number" inputmode="numeric" value="${e.restSeconds}"></label>
      <label class="field grow"><span>${esc(tr("ex_edit_modal.text.rest_before_next_movement_sec_optional"))}</span><input id="f-rest-next" type="number" inputmode="numeric" placeholder="${esc(tr("ex_edit_modal.placeholder.same_as_above"))}" value="${e.restSecondsNext != null ? e.restSecondsNext : ''}"></label>
    </div>
    <label class="field"><span>${esc(tr("exercise.form.equipment"))}</span>
      <select id="f-equipment" data-bind="edit-equipment">${EQUIPMENT_TYPES.map(t => `<option value="${t}" ${t === equipment ? 'selected' : ''}>${esc(equipmentLabel(t, 'edit'))}</option>`).join('')}</select>
    </label>
    ${addedLoadToggle('f', e, equipment)}
    <label class="field${BAR_WEIGHT_EQUIPMENT.has(equipment) ? '' : ' hidden'}" id="f-barweight-row"><span>${esc(tr("ex_edit_modal.text.bar_weight", { unit: unit() }))}</span><input id="f-barweight" type="number" inputmode="decimal" step="0.5" placeholder="${esc(tr("ex_edit_modal.placeholder.default", { resolvedBarWeight_equipment_: resolvedBarWeight({ equipment, barWeight: null }) }))}" value="${e.barWeight != null ? e.barWeight : ''}"></label>
    <label class="field"><span>${esc(tr("exercise.form.measurement"))}</span>
      <select id="f-metric" data-bind="model-metric" data-prefix="f">${modelOptions(e.metric)}</select>
    </label>
    ${modelFields(e, 'f')}
    <label class="field"><span>${esc(tr("ex_edit_modal.text.superset_group"))}</span>
      <select id="f-superset">
        <option value="" ${!e.superset ? 'selected' : ''}>${esc(tr("ex_edit_modal.text.none"))}</option>
        ${["A", "B", "C", "D"].map(t => `<option value="${t}" ${e.superset === t ? 'selected' : ''}>${t}</option>`).join('')}
        ${e.superset && !["A", "B", "C", "D"].includes(e.superset) ? `<option value="${esc(e.superset)}" selected>${esc(e.superset)}</option>` : ''}
      </select>
      <span class="field-hint">${esc(tr("ex_edit_modal.text.members_must_sit_next_to_each_other_in_the_day_u"))}</span>
    </label>
    ${e.libraryEntry ? `<p class="small muted">${esc(tr("library.instructions"))}<br>${esc(ExerciseLibrary.instructions({ ...e, description: '' }, I18n.explanation, lookupExplanation) || '')}</p>` : ''}
    <label class="field"><span>${esc(tr("ex_edit_modal.text.how_to_description_optional"))}</span><textarea id="f-desc" style="min-height:60px">${esc(e.description)}</textarea></label>`,
    [
      { label: tr("common.action.save"), cls: 'primary', fn: () => {
          const name = mval('f-name'); if (!name) { toast(tr("exercise.validation.name_required"), 'err'); return; }
          const rpeRaw = document.getElementById('f-rpe').dataset.v;
          const restNextRaw = mval('f-rest-next');
          const barWeightRaw = mval('f-barweight');
          const eqVal = document.getElementById('f-equipment').value;
          const metricVal = document.getElementById('f-metric').value;
          const barVal = barWeightRaw ? parseFloat(barWeightRaw) : null;
          const wVal = mnum('f-weight');
          let metadata;
          try { metadata = readModelFields('f', metricVal); } catch (err) { toast(err.message, 'err'); return; }
          const addedVal = readAddedLoad('f', eqVal, metricVal);
          const wErr = weightValidationError({ equipment: eqVal, barWeight: barVal, weight: wVal, metric: metricVal, loadProfile: metadata.loadProfile, addedLoad: addedVal });
          if (wErr) { toast(wErr, 'err'); return; }
          // A tag must form ONE adjacent run. Split across the day it renders as
          // two cards with independent rest cycles, both headed "Superset A" and
          // sharing a collapse key. push-plan.mjs refuses this on push; without
          // the same check here it can still be built by editing on the phone.
          const ssVal = document.getElementById('f-superset').value || null;
          if (ssVal) {
            const sim = day.exercises.map((x, xi) => ({ superset: xi === i ? ssVal : (x.superset || null) }));
            if (i == null) sim.push({ superset: ssVal });
            if ((supersetRunCounts(sim).get(ssVal) || 0) > 1) {
              toast(tr("ex_edit_modal.message.superset_would_be_split_across_the_day_move_its_", { ssVal: ssVal }), 'err');
              return;
            }
          }
          const warmN = Math.max(0, mnum('f-warmupsets', 0));
          if (metricVal !== 'load' && warmN) {
            toast(tr("ex_edit_modal.message.a_jump_exercise_has_no_load_to_ramp_mark_a_warm_"), 'err');
            return;
          }
          const upd = { ...metadata, name, sets: Math.max(1, mnum('f-sets', 3)), warmupSets: warmN, reps: mval('f-reps') || '8-12', weight: wVal,
            targetRpe: rpeRaw ? parseFloat(rpeRaw) : null, restSeconds: Math.max(0, mnum('f-rest', 120)),
            restSecondsNext: restNextRaw ? Math.max(0, parseInt(restNextRaw, 10)) : null,
            equipment: eqVal,
            barWeight: barVal,
            metric: metricVal,
            superset: ssVal,
            description: mval('f-desc') };
          if (addedVal) upd.addedLoad = true;
          const prevLibrary = plan.library ? [...plan.library] : [];
          if (e.libraryEntry) {
            if (metadata.movementId !== e.libraryEntry.id) { toast(tr('library.identity_locked'), 'err'); return; }
            upd.libraryEntry = e.libraryEntry;
            const items = ExerciseLibrary.retained(plan);
            const saved = items.find(x => x.id === e.libraryEntry.id);
            const entry = saved ? { ...saved, aliases: [...new Set([...saved.aliases, ...e.libraryEntry.aliases])] } : e.libraryEntry;
            plan.library = [...items.filter(x => x.id !== entry.id), entry];
          }
          const prevEx = i != null ? { ...day.exercises[i] } : null;
          if (i != null) { delete day.exercises[i].addedLoad; Object.assign(day.exercises[i], upd); }
          else day.exercises.push(Object.assign({ id: uid(), notes: '', alternates: [] }, upd));

          if (!savePlan()) {
            if (i != null) day.exercises[i] = prevEx;
            else day.exercises.pop();
            plan.library = prevLibrary;
            return;
          }
          closeModal(); render();
        } },
      { label: tr("common.action.cancel") }
    ]);
}
// Free-text editor for a day's warm-up checklist — one item per line, with an
// optional note after a dash. A textarea beats a per-item row builder here: the
// list is short, edited rarely, and usually pasted in whole from a plan.
function dayWarmupModal(dayId) {
  const day = plan.days.find(d => d.id === dayId); if (!day) return;
  const text = (day.warmup || []).map(w => w.detail ? `${w.name} — ${w.detail}` : w.name).join('\n');
  showModal(tr("warmup_editor.title", { day: day.name }), `
    <p class="muted small">${esc(tr("day_warmup_modal.text.one_item_per_line_anything_after_a_dash_becomes_"))}</p>
    <textarea id="f-warmup" style="min-height:150px" placeholder="${esc(tr("day_warmup_modal.placeholder.bike_5_min_easy_10_band_pull_apart_20_10_empty_b"))}">${esc(text)}</textarea>`,
    [
      { label: tr("common.action.save"), cls: 'primary', fn: () => {
          const prevWarmup = day.warmup ? [...day.warmup] : [];
          day.warmup = mval('f-warmup').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
            const m = l.match(/^(.*?)\s+[—–-]\s+(.*)$/);
            return m ? { name: m[1].trim(), detail: m[2].trim() } : { name: l, detail: '' };
          });
          if (!savePlan()) {
            day.warmup = prevWarmup;
            return;
          }
          closeModal(); render();
        } },
      { label: tr("common.action.cancel") }
    ]);
}
function exSwapPlanModal(dayId, i) {
  const day = plan.days.find(d => d.id === dayId);
  const e = day.exercises[i];
  showModal(tr("exercise.swap.title", { exercise: I18n.exercise(e.name) }), e.alternates.map((a, ai) => `
    <button class="wide mt8" data-action="plan-swap-pick" data-day="${dayId}" data-i="${i}" data-ai="${ai}">
      ${esc(I18n.exercise(a.name))}${a.weight ? ` · ${a.weight}${unit()}` : ''} ${equipChip({ equipment: a.equipment || e.equipment, barWeight: a.equipment ? a.barWeight : e.barWeight })}</button>`).join(''),
    [{ label: tr("common.action.cancel") }]);
}
function doPlanSwap(dayId, i, ai) {
  const day = plan.days.find(d => d.id === dayId);
  const e = day.exercises[i];
  const a = e.alternates[ai];
  const prevExercise = structuredClone(e);
  // The current main exercise becomes an alternate, the chosen alternate becomes main.
  // Equipment travels with each — without that, swap-then-swap-back changes the
  // equipment type, which then changes the ladder the weight is checked against.
  const newAlts = e.alternates.filter((_, x) => x !== ai);
  newAlts.unshift({ ...WorkoutModel.metadata(e), name: e.name, weight: e.weight, description: e.description,
    equipment: e.equipment, barWeight: e.barWeight, metric: e.metric || 'load' });
  const newMetric = a.metric || e.metric || 'load';
  for (const k of Object.keys(WorkoutModel.metadata(e))) delete e[k];
  Object.assign(e, {
    ...WorkoutModel.metadata(a),
    name: a.name, weight: a.weight || e.weight, description: a.description || '',
    equipment: a.equipment || e.equipment,
    barWeight: a.equipment ? a.barWeight : e.barWeight,
    metric: newMetric,
    // A jump prescribes no load; a lift needs one. Carrying the old value across
    // a metric change would produce a plan the validator rejects on next push.
    ...(newMetric === 'height' ? { weight: 0 } : {}),
    alternates: newAlts
  });
  if (!savePlan()) {
    day.exercises[i] = prevExercise;
    return;
  }
  closeModal(); render();
  toast(tr("exercise.swap.success", { exercise: I18n.exercise(a.name) }));
}

/* ================= session modals ================= */
function sessionSwapModal(ei) {
  const e = active.exercises[ei];
  const alts = e.alternates || [];
  showModal(tr("exercise.swap.title", { exercise: I18n.exercise(e.name) }), `
    ${alts.length ? alts.map((a, ai) => `
      <button class="wide mt8" data-action="session-swap-pick" data-ei="${ei}" data-ai="${ai}">
        ${esc(I18n.exercise(a.name))}${a.weight ? ` · ${a.weight}${unit()}` : ''} ${equipChip({ equipment: a.equipment || e.equipment, barWeight: a.equipment ? a.barWeight : e.barWeight })}</button>`).join('') : `<p class="muted small">${esc(tr("session_swap_modal.text.no_alternates_in_the_plan_for_this_one"))}</p>`}
    <div class="divider"></div>
    <label class="field"><span>${esc(tr("session_swap_modal.text.or_type_any_exercise"))}</span><input id="swap-custom" placeholder="${esc(tr("session_swap_modal.placeholder.e_g_machine_chest_press"))}"></label>
    <label class="field"><span>${esc(tr("session_swap_modal.text.equipment_for_the_typed_exercise"))}</span>
      <select id="swap-custom-equip">${EQUIPMENT_TYPES.map(t => `<option value="${t}" ${t === (e.equipment || 'barbell') ? 'selected' : ''}>${esc(equipmentLabel(t, 'swap'))}</option>`).join('')}</select>
    </label>`,
    [
      { label: tr("session_swap_modal.button.use_typed_exercise"), cls: 'primary', fn: () => {
          const name = mval('swap-custom'); if (!name) { toast(tr("session_swap_modal.message.type_a_name_first"), 'err'); return; }
          const eq = document.getElementById('swap-custom-equip').value;
          doSessionSwap(ei, { name, weight: e.sets[0] ? e.sets[0].weight : e.plannedWeight,
            description: '', equipment: eq, barWeight: eq === e.equipment ? e.barWeight : null });
        } },
      { label: tr("common.action.cancel") }
    ]);
}
function doSessionSwap(ei, alt) {
  const e = active.exercises[ei];
  const newMetric = alt.metric || e.metric || 'load';
  const metricChanged = newMetric !== (e.metric || 'load');
  // The two metrics log different shapes — kg × reps per row vs one height per
  // row — so a change has to rebuild the grid. Refuse once anything is logged
  // rather than silently discarding sets the athlete actually did.
  if (e.sets.some(s => s.done)) {
    toast(tr('exercise.model.swap_logged'), 'err');
    return;
  }
  const prevExercise = structuredClone(e);
  const original = e.swappedFrom || e.name;
  e.swappedFrom = original === alt.name ? null : original;
  e.name = alt.name;
  for (const k of Object.keys(WorkoutModel.metadata(e))) delete e[k];
  Object.assign(e, WorkoutModel.metadata(alt));
  if (alt.equipment) { e.equipment = alt.equipment; e.barWeight = alt.barWeight != null ? alt.barWeight : null; }
  if (metricChanged) {
    e.metric = newMetric;
    const n = e.sets.length;
    e.sets = Array.from({ length: n }, () => WorkoutModel.row({ ...e, weight: alt.weight || 0, reps: e.plannedReps }));
  } else if (WorkoutModel.timed(e)) {
    e.sets = e.sets.map(() => WorkoutModel.row({ ...e, weight: alt.weight || 0 }));
  } else if (alt.weight != null) {
    e.sets.forEach(s => { if (!s.done) s.weight = alt.weight; });
  }
  e.plannedWeight = alt.weight ?? e.plannedWeight;
  if (alt.description) e.description = alt.description;
  if (!saveActive()) {
    active.exercises[ei] = prevExercise;
    return;
  }
  closeModal(); render();
  toast(tr("exercise.swap.success", { exercise: I18n.exercise(alt.name) }));
}
/*
 * Add a movement to the workout already in progress. Session-only by default —
 * the checkbox is for the case where the improvised extra turns out to be part
 * of the routine after all.
 *
 * The new exercise always lands at the END of the list and always carries
 * superset: null, which is what keeps it from breaking superset adjacency: a
 * trailing tagged group stays a contiguous run when an untagged exercise is
 * appended after it.
 */
function sessionAddExerciseModal() {
  if (!active) return;
  const day = plan.days.find(d => d.id === active.dayId);
  showModal(tr("exercise.add.title"), `
    <p class="muted small">${esc(tr("session_add_exercise_modal.text.logged_in_this_session_only_unless_you_tick_the_"))}</p>
    <label class="field"><span>${esc(tr("exercise.form.name"))}</span><input id="a-name" placeholder="${esc(tr("session_add_exercise_modal.placeholder.e_g_face_pull"))}"></label>
    <div class="row">
      <label class="field grow"><span>${esc(tr("exercise.form.sets"))}</span><input id="a-sets" type="number" inputmode="numeric" value="3"></label>
      <label class="field grow"><span>${esc(tr("exercise.form.reps"))}</span><input id="a-reps" value="8-12"></label>
    </div>
    <div class="row">
      <label class="field grow"><span id="a-weight-label">${esc(tr("exercise.form.weight", { unit: unit() }))}</span><input id="a-weight" type="number" inputmode="decimal" step="any" value="0">
        <span class="field-hint" id="a-weight-hint">${esc(ladderHint('barbell'))}</span></label>
      <label class="field grow"><span>${esc(tr("session_add_exercise_modal.text.rest_sec"))}</span><input id="a-rest" type="number" inputmode="numeric" value="120"></label>
    </div>
    <label class="field"><span>${esc(tr("exercise.form.equipment"))}</span>
      <select id="a-equipment" data-bind="add-equipment">${EQUIPMENT_TYPES.map(t => `<option value="${t}">${esc(equipmentLabel(t, 'add'))}</option>`).join('')}</select>
    </label>
    ${addedLoadToggle('a', {}, 'barbell')}
    <label class="field"><span>${esc(tr("exercise.form.measurement"))}</span>
      <select id="a-metric" data-bind="model-metric" data-prefix="a">${modelOptions('load')}</select>
    </label>
    ${modelFields({}, 'a')}
    ${day ? `<label class="merge-row"><input type="checkbox" id="a-to-plan"><span class="small">${esc(tr("session_add_exercise_modal.option.add_to_plan", { day: day.name }))}</span></label>` : ''}`,
    [
      { label: tr("common.action.add"), cls: 'primary', fn: () => {
          const name = mval('a-name');
          if (!name) { toast(tr("exercise.validation.name_required"), 'err'); return; }
          const eqVal = document.getElementById('a-equipment').value;
          const metricVal = document.getElementById('a-metric').value;
          const wVal = mnum('a-weight');
          let metadata;
          try { metadata = readModelFields('a', metricVal); } catch (err) { toast(err.message, 'err'); return; }
          const planBox = document.getElementById('a-to-plan');
          const toPlan = !!(day && planBox && planBox.checked);

          // Exercise history, PR tracking and the aliases map are all keyed on
          // name GLOBALLY, so two different movements sharing a name silently
          // merge into one progression history. Same rule push-plan.mjs enforces.
          if (!metadata.movementId && active.exercises.some(x => sameExercise(x.name, name))) {
            toast(tr("session_add_exercise_modal.message.is_already_in_this_session_give_it_a_distinct_na", { name: name }), 'err'); return;
          }
          if (!metadata.movementId && toPlan && plan.days.some(d => d.exercises.some(x => sameExercise(x.name, name)))) {
            toast(tr("session_add_exercise_modal.message.already_exists_in_your_plan_history_is_keyed_on_", { name: name }), 'err'); return;
          }
          const addedVal = readAddedLoad('a', eqVal, metricVal);
          if (addedVal) metadata.addedLoad = true;
          const wErr = weightValidationError({ equipment: eqVal, barWeight: null, weight: wVal, metric: metricVal, loadProfile: metadata.loadProfile, addedLoad: addedVal });
          if (wErr) { toast(wErr, 'err'); return; }

          const sets = Math.max(1, mnum('a-sets', 3));
          const reps = mval('a-reps') || '8-12';
          const rest = Math.max(0, mnum('a-rest', 120));
          const newExPlan = { ...metadata, id: uid(), name, sets, reps, weight: wVal, targetRpe: null,
            restSeconds: rest, restSecondsNext: null, equipment: eqVal, barWeight: null,
            metric: metricVal, superset: null, description: '', notes: '', alternates: [] };
          const newExActive = {
            ...metadata,
            name, planId: null, swappedFrom: null,
            plannedSets: sets, plannedReps: reps, plannedWeight: wVal,
            targetRpe: null, restSeconds: rest, restSecondsNext: null,
            equipment: eqVal, barWeight: null, metric: metricVal, superset: null,
            description: '', alternates: [], notes: '',
            sets: Array.from({ length: sets }, () => WorkoutModel.row({ ...metadata, metric: metricVal, weight: wVal, reps }))
          };

          if (toPlan) {
            const nextPlan = structuredClone(plan);
            const targetDay = nextPlan.days.find(d => d.id === active.dayId);
            if (targetDay) targetDay.exercises.push(newExPlan);
            const nextActive = structuredClone(active);
            nextActive.exercises.push(newExActive);
            const txRes = store.commitTx([
              ['plan', nextPlan],
              ['active', nextActive]
            ]);
            if (!txRes.ok) {
              toast(tr('storage.error.save_failed', { item: tr('navigation.plan') }), 'err');
              return;
            }
            plan = nextPlan;
            active = nextActive;
            touch();
          } else {
            const prevExercises = [...active.exercises];
            active.exercises.push(newExActive);
            if (!saveActive()) {
              active.exercises = prevExercises;
              return;
            }
          }
          closeModal(); render();
          toast(toPlan ? tr("session_add_exercise_modal.message.added_also_saved_to", { name: name, day_name: day.name }) : tr("session_add_exercise_modal.message.added_for_today", { name: name }));
        } },
      { label: tr("common.action.cancel") }
    ]);
}
function exInfoModal(ei) {
  const e = active.exercises[ei];
  const desc = ExerciseLibrary.instructions(e, I18n.explanation, lookupExplanation) || tr("ex_info_modal.message.no_description_available_ask_your_ai_coach_to_in");
  // A jump has no load or rep target — every other jump surface already branches
  // on the metric, so building this line unconditionally read "Target: 3×1 @ 0kg".
  const target = WorkoutModel.timed(e) ? `${e.plannedSets} × ${measurementText(e, { ...e, weight: e.plannedWeight })}` : isJump(e)
    ? tr("ex_info_modal.message.attempt", { e_plannedSets: e.plannedSets, e_plannedSets_1_s: e.plannedSets === 1 ? '' : 's' })
    : `${e.plannedSets}×${esc(e.plannedReps)} @ ${loadText(e, e.plannedWeight)}${unit()}${e.targetRpe ? tr("format.rpe_suffix", { rpe: e.targetRpe }) : ''}`;
  showModal(I18n.exercise(e.name), `<p>${esc(desc)}</p>
    <p class="muted small mt12">${esc(tr("ex_info_modal.text.target", { target: target }))}</p>`);
}
// Greedy largest-first breakdown of one side's load. `remain` is whatever the
// plate set can't express — surfaced rather than silently dropped.
function platesPerSide(load, plates) {
  const rows = [];
  let remain = Math.max(0, load);
  for (const p of plates) {
    const count = Math.floor(remain / p + 1e-9);
    if (count > 0) { rows.push({ p, count }); remain -= count * p; }
  }
  return { rows, remain };
}
// What to physically change between two loadouts, as add/strip lists. Diffing the
// breakdowns rather than the arithmetic difference is the point: 120 → 125 kg has
// to read "add one 2.5 per side", not "+5 kg, work it out yourself".
function plateDiff(fromRows, toRows) {
  const net = new Map();
  for (const r of fromRows) net.set(r.p, (net.get(r.p) || 0) - r.count);
  for (const r of toRows) net.set(r.p, (net.get(r.p) || 0) + r.count);
  const add = [], strip = [];
  for (const [p, n] of [...net].sort((a, b) => b[0] - a[0])) {
    if (n > 0) add.push({ p, count: n });
    else if (n < 0) strip.push({ p, count: -n });
  }
  return { add, strip };
}
function showPlateCalculator(e) {
  const isLb = unit() === 'lb';
  const plates = isLb ? [45, 35, 25, 10, 5, 2.5] : [25, 20, 15, 10, 5, 2.5, 1.25];
  const equipment = e.equipment || 'barbell';
  const isLandmine = equipment === 'landmine';
  const barWeight = isLandmine ? 0 : resolvedBarWeight(e);
  const sides = isLandmine ? 1 : 2;

  // The rack question is always about the set you are ABOUT to do, never the one
  // the plan prescribed — the moment a set deviates, plannedWeight is the wrong
  // number to be standing in front of a loaded bar with.
  const nextIdx = e.sets.findIndex(s => !s.done);
  const idx = nextIdx !== -1 ? nextIdx : e.sets.length - 1;
  const targetSet = e.sets[idx];
  const weight = targetSet && targetSet.weight != null ? targetSet.weight : (e.plannedWeight || 0);
  const lbl = setLabels(e.sets)[idx];
  const setLabel = lbl ? (lbl.s.warmup ? tr("show_plate_calculator.message.warm_up", { lbl_label_slice_1: lbl.label.slice(1) }) : tr("show_plate_calculator.message.set", { lbl_label: lbl.label })) : '';
  // …and the useful answer is what CHANGES, so find the last set actually loaded.
  let prev = null;
  for (let i = idx - 1; i >= 0; i--) {
    if (e.sets[i].done && e.sets[i].weight != null) { prev = e.sets[i].weight; break; }
  }

  const fmtPlates = rs => rs.map(r => `${r.count} × ${r.p}${unit()}`).join(' + ');
  const head = `<p class="plate-target"><b>${weight}${unit()}</b>${setLabel ? ` <span class="muted small">· ${setLabel}</span>` : ''}</p>`;

  if (!isLandmine && weight <= barWeight) {
    const strip = prev != null && prev > barWeight
      ? `<p class="plate-delta">${esc(tr("show_plate_calculator.text.strip_everything_down_from", { prev: prev, unit: unit() }))}</p>` : '';
    showModal(tr("plate_calculator.title"), `${head}${strip}
      <p class="muted small">${esc(tr("show_plate_calculator.text.is_at_or_below_the_bar_no_plates_needed", { weight: weight, unit: unit(), barWeight: barWeight, unit2: unit() }))}</p>`);
    return;
  }

  const { rows, remain } = platesPerSide((weight - barWeight) / sides, plates);
  let deltaHtml = '';
  if (prev != null && prev !== weight) {
    const { rows: prevRows } = platesPerSide((prev - barWeight) / sides, plates);
    const { add, strip } = plateDiff(prevRows, rows);
    const diff = Math.round((weight - prev) * 100) / 100;
    const params = {
      sign: diff > 0 ? '+' : '−', difference: Math.abs(diff), unit: unit(), previous: prev,
      remove: fmtPlates(strip), add: fmtPlates(add)
    };
    const change = strip.length && add.length ? 'replace' : strip.length ? 'remove' : add.length ? 'add' : 'unavailable';
    const position = isLandmine ? 'end' : 'side';
    deltaHtml = `<p class="plate-delta">${esc(tr(change === 'unavailable' ? 'plates.delta.unavailable' : `plates.delta.${change}.${position}`, params))}</p>`;
  }
  const summary = isLandmine
    ? tr("show_plate_calculator.message.load_on_the_landmine_end")
    : tr("show_plate_calculator.message.bar_per_side", { barWeight: barWeight, unit: unit(), weight_barWeight_sides_toFix: ((weight - barWeight) / sides).toFixed(2), unit2: unit() });
  showModal(tr("plate_calculator.title"), `
    ${head}
    ${deltaHtml}
    <p class="muted small">${summary}</p>
    <div class="divider"></div>
    ${rows.length ? rows.map(r => `<div class="row between mt8"><span class="bold">${r.p}${unit()}</span><span>${esc(tr(isLandmine ? "plates.row.end" : "plates.row.side", { count: r.count }))}</span></div>`).join('') : `<p class="muted small">${esc(tr("show_plate_calculator.text.just_the_bar"))}</p>`}
    ${remain > 0.01 ? `<p class="muted small mt12">${esc(tr(isLandmine ? "plates.unavailable.end" : "plates.unavailable.side", { remainder: remain.toFixed(2), unit: unit() }))}</p>` : ''}`);
}
function exNoteModal(ei) {
  const e = active.exercises[ei];
  showModal(tr("exercise.note.title", { exercise: I18n.exercise(e.name) }), `<textarea id="ex-note-area" placeholder="${esc(tr("ex_note_modal.placeholder.e_g_felt_heavy_slight_knee_pain_used_safety_bar"))}">${esc(e.notes)}</textarea>`,
    [
      { label: tr("common.action.save"), cls: 'primary', fn: () => {
          const prevNotes = e.notes;
          e.notes = mval('ex-note-area');
          if (!saveActive()) {
            e.notes = prevNotes;
            return;
          }
          closeModal(); render();
        } },
      { label: tr("common.action.cancel") }
    ]);
}

/* ================= RPE picker ================= */
// Renders into #picker-root (its own overlay layer) so it can open on top of
// a sheet modal (e.g. the plan's exercise-edit modal) without replacing it.
const RPE_SCALE = [
  [10, "app.message.max_effort_nothing_left"],
  [9.5, "app.message.maybe_half_a_rep_left"],
  [9, "app.message.could_have_done_1_more_rep"],
  [8.5, "app.message.1_2_reps_left"],
  [8, "app.message.2_reps_left"],
  [7.5, "app.message.2_3_reps_left"],
  [7, "app.message.3_reps_left_bar_still_fast"],
  [6.5, "app.message.3_4_reps_left"],
  [6, "app.message.4_reps_left"],
  [5.5, "app.message.4_5_reps_left"],
  [5, "app.message.5_reps_left_easy"]
];
let rpePickCb = null;
function showRpePicker(current, onPick, title = tr("show_rpe_picker.message.how_hard_was_that_set")) {
  rpePickCb = onPick;
  document.getElementById('picker-root').innerHTML = `
    <div class="overlay" data-action="picker-dismiss">
      <div class="sheet">
        <h3>${esc(title)}</h3>
        <div class="modal-body">
          ${RPE_SCALE.map(([v, txt]) => `
            <button class="rpe-opt ${current === v ? 'active' : ''}" data-action="rpe-opt" data-v="${v}">
              <span class="rpe-val">${v}</span><span class="muted small">${esc(tr(txt))}</span></button>`).join('')}
          <button class="rpe-opt" data-action="rpe-opt" data-v=""><span class="rpe-val muted">—</span><span class="muted small">${esc(tr("show_rpe_picker.text.clear_skip"))}</span></button>
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
  if (f === 'reps') return { kind: 'reps', label: tr("stepper_info.button.reps"), down: 1, up: 1 };
  if (f === 'heightCm') return { kind: 'height', label: tr("stepper_info.button.cm"), down: 0.5, up: 0.5 };
  if (f !== 'weight') return null;
  const ex = active && active.exercises[+el.dataset.ei];
  if (!ex || (ex.equipment === 'bodyweight' && !ex.loadProfile && !WorkoutModel.timed(ex) && !isAddedLoad(ex))) return null;
  if (ex.loadProfile?.unit === unit()) {
    const current = parseFloat(el.value) || 0;
    return { kind: 'weight', label: unit(), down: Math.max(0, current - WorkoutModel.nextLoad(ex.loadProfile, current, -1)), up: Math.max(0, WorkoutModel.nextLoad(ex.loadProfile, current, 1) - current) };
  }
  if (ex.loadProfile) return null; // A profile expressed in another unit is not a usable ladder.
  if (isAddedLoad(ex)) {
    const step = ADDED_LOAD_STEP[unit()] || 1.25, current = parseFloat(el.value) || 0;
    return { kind: 'added', label: '+' + unit(), down: Math.min(step, Math.max(0, current)), up: step };
  }
  if (WorkoutModel.timed(ex) && ex.equipment === 'bodyweight') return { kind: 'weight', label: unit(), down: 2.5, up: 2.5 };
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
    next = ex.loadProfile?.unit === unit() ? WorkoutModel.nextLoad(ex.loadProfile, curN, dir) : info.kind === 'added' ? curN + dir * (dir > 0 ? info.up : info.down) : WorkoutModel.timed(ex) && ex.equipment === 'bodyweight' ? curN + dir * 2.5 : nextWeight(ex.equipment, resolvedBarWeight(ex), curN, dir);
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
  showModal(tr("cmj_video_modal.message.measure_cmj_via_video"), `
    <input type="file" id="cmj-file-input" accept="video/*">
    <details class="cmj-tips mt8">
      <summary class="small muted">${esc(tr("cmj_video_modal.text.how_to_record_for_accurate_results"))}</summary>
      <p class="small muted mt8">${esc(tr("cmj_video_modal.tip.frame_rate_accuracy"))}</p>
      <ul class="small muted mt8">
        <li>${esc(tr("cmj_video_modal.tip.avoid_web_camera"))}</li>
        <li>${esc(tr("cmj_video_modal.tip.record_slow_motion"))}</li>
        <li>${esc(tr("cmj_video_modal.tip.keep_clip_short"))}</li>
        <li>${esc(tr("cmj_video_modal.tip.match_capture_settings"))}</li>
        <li>${esc(tr("cmj_video_modal.text.film_side_on_whole_body_in_frame_feet_clearly_vi"))}</li>
      </ul>
    </details>
    <div id="cmj-fps-row" class="hidden mt8">
      <span class="small muted">${esc(tr("cmj_video_modal.text.filmed_at_your_camera_app_setting"))}</span>
      <div class="cmj-fps-group cmj-capture-group mt8">
        ${CAPTURE_RATES.map(f => `<button type="button" data-capture="${f}" class="ghost icon-btn">${esc(tr("cmj_video_modal.text.fps", { f: f }))}</button>`).join('')}
      </div>
      <span class="small muted mt12" style="display:block">${esc(tr("cmj_video_modal.text.slow_motion_in_the_clip"))}</span>
      <div class="cmj-fps-group cmj-slow-group mt8">
        ${SLOW_FACTORS.map(f => `<button type="button" data-slow="${f}" class="ghost icon-btn">${f === 1 ? tr("cmj_video_modal.message.normal") : f + '×'}</button>`).join('')}
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
        <button type="button" class="ghost icon-btn" id="cmj-step-back">${esc(tr("cmj_video_modal.text.frame"))}</button>
        <span id="cmj-time-readout" class="small muted">${esc(tr("cmj_video_modal.text.0_00_000_frame_0"))}</span>
        <button type="button" class="ghost icon-btn" id="cmj-step-fwd">${esc(tr("cmj_video_modal.text.frame_2"))}</button>
      </div>
      <div class="cmj-marker-row mt12">
        <button type="button" id="cmj-set-takeoff">${esc(tr("cmj_video_modal.text.last_frame_on_ground"))}</button>
        <button type="button" id="cmj-set-landing">${esc(tr("cmj_video_modal.text.first_frame_back_down"))}</button>
      </div>
      <div id="cmj-markers" class="small muted mt8"></div>
      <div id="cmj-result" class="cmj-result hidden"></div>
      <button type="button" id="cmj-add-attempt" class="ghost wide mt8 hidden">${esc(tr("cmj_video_modal.text.add_attempt"))}</button>
      <div id="cmj-attempts" class="cmj-attempts"></div>
    </div>`,
    [
      { label: tr("cmj.action.save_best"), cls: 'primary', fn: cmjAccept },
      { label: tr("common.action.cancel"), fn: cmjCancel }
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
    toast(tr("cmj_init_listeners.message.could_not_load_this_video"), 'err');
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
  if (persist) {
    const prev = settings.cmjSlowFactor;
    settings.cmjSlowFactor = factor;
    if (!saveSettings()) settings.cmjSlowFactor = prev;
  }
  cmjPaintRateChips();
  cmjRenderDurationCheck();
  cmjUpdateResultUI();
}

function cmjSetCaptureFps(fps, persist) {
  cmjState.captureFps = fps;
  if (persist) {
    const prev = settings.cmjCaptureFps;
    settings.cmjCaptureFps = fps;
    if (!saveSettings()) settings.cmjCaptureFps = prev;
  }
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
    ? esc(tr("cmj.duration.played_as_filmed", {
        fileSeconds: dur.toFixed(2), effectiveFps: eff, precisionCm: precision.toFixed(1)
      }))
    : `${esc(tr("cmj.duration.slow_motion", {
        fileSeconds: dur.toFixed(2), realSeconds: (dur / factor).toFixed(2), factor,
        timelineFps: Math.round(cmjPlaybackFps()), effectiveFps: eff,
        precisionCm: precision.toFixed(1)
      }))}<br><span class="muted">${esc(tr("cmj_render_duration_check.text.if_that_real_duration_doesn_t_match_what_you_fil"))}</span>`;
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

  if (detectEl) detectEl.textContent = tr("cmj_auto_detect_fps.message.detecting_frame_rate");
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
            ? `<span class="amber">${esc(tr("restore.text.measured_fps_in_this_clip_but_the_settings_above", { snapped: snapped, Math_round_derived: Math.round(derived) }))}</span>`
            : `<span class="muted">${esc(tr("restore.text.measured_fps_rough_the_decoder_skips_frames_on_h", { snapped: snapped }))}</span>`;
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
  document.getElementById('cmj-time-readout').textContent = tr("cmj_draw_frame.message.s_frame", { lastMediaTime_toFixed_3: lastMediaTime.toFixed(3), Math_round_lastMediaTime_cmj: Math.round(lastMediaTime * cmjPlaybackFps()) });
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
  el.innerHTML = `<div class="small muted mt12">${esc(tr("cmj_render_attempts.text.attempts"))}</div>` + list.map((a, i) => `
    <div class="cmj-attempt${i === bestIdx ? tr("cmj.attempt.best") : ''}">
      <b>${esc(tr("cmj_render_attempts.text.cm", { a_heightCm_toFixed_1: a.heightCm.toFixed(1) }))}</b>
      <span class="small muted">${esc(tr("cmj_render_attempts.text.ms_fps", { a_precisionCm_toFixed_1: a.precisionCm.toFixed(1), a_flightTimeMs: a.flightTimeMs, a_effectiveFps: a.effectiveFps }))}</span>
      <button type="button" class="ghost icon-btn" data-attempt-del="${i}" aria-label="${esc(tr("cmj_render_attempts.aria-label.remove_attempt", { i_1: i + 1 }))}">✕</button>
    </div>`).join('');
}

function cmjUpdateResultUI() {
  const { takeoffTime, landingTime, fps, attempts } = cmjState;
  const markersEl = document.getElementById('cmj-markers');
  const resultEl = document.getElementById('cmj-result');
  const addBtn = document.getElementById('cmj-add-attempt');
  const acceptBtn = document.querySelector('[data-idx="m0"]');
  const pf = cmjPlaybackFps();
  const fmt = t => t == null ? '—' : tr("fmt.message.s_frame", { t_toFixed_3: t.toFixed(3), Math_round_t_pf: Math.round(t * pf) });
  markersEl.innerHTML = tr("cmj_update_result_ui.message.last_on_ground_nbsp_nbsp_first_back_down", { fmt_takeoffTime: fmt(takeoffTime), fmt_landingTime: fmt(landingTime) });

  const result = cmjCurrentResult();
  cmjRenderAttempts();
  if (addBtn) addBtn.classList.toggle('hidden', !result);
  if (acceptBtn) {
    // Accepting folds in a valid unmarked-as-attempt result, so count it here too —
    // otherwise a single measured jump would look unsaveable.
    const n = attempts.length + (result ? 1 : 0);
    acceptBtn.disabled = n === 0;
    acceptBtn.textContent = n > 1 ? tr("cmj_update_result_ui.message.save_best", { n: n }) : tr("cmj.action.save_best");
  }

  if (takeoffTime == null || landingTime == null) { resultEl.classList.add('hidden'); return; }
  resultEl.classList.remove('hidden');
  if (!result) {
    resultEl.innerHTML = `<p class="small red">${esc(tr("cmj_update_result_ui.text.no_flight_time_from_those_frames_the_first_back_"))}</p>`;
    return;
  }
  const factor = cmjState.slowFactor || 1;
  const plausible = result.heightCm >= 3 && result.heightCm <= 180;
  resultEl.innerHTML = `
    <div class="big">${esc(tr("cmj_update_result_ui.text.cm", { result_heightCm_toFixed_1: result.heightCm.toFixed(1) }))}</div>
    <div class="small muted">${esc(tr("cmj_update_result_ui.text.cm_flight_ms_fps_effective", { result_precisionCm_toFixed_1: result.precisionCm.toFixed(1), result_flightTimeMs: result.flightTimeMs, result_effectiveFps: result.effectiveFps }))}</div>
    <div class="small muted">${esc(tr("cmj_update_result_ui.text.1_frame_applied_half_frame_midpoint_correction_a"))}</div>
    ${factor !== 1 ? `<div class="small muted">${esc(tr("cmj_update_result_ui.text.fps_filmed_at_fps_timeline", { cmjState_captureFps: cmjState.captureFps, factor: factor, Math_round_cmjPlaybackFps: Math.round(cmjPlaybackFps()) }))}</div>` : ''}
    ${result.effectiveFps < 60 ? `<p class="small amber mt8">${esc(tr("cmj_update_result_ui.text.only_cm_at_fps_record_in_slo_mo_at_240_fps_for_0", { result_precisionCm_toFixed_1: result.precisionCm.toFixed(1), result_effectiveFps: result.effectiveFps }))}</p>` : ''}
    ${plausible ? '' : `<p class="small amber mt8">${esc(tr("cmj_update_result_ui.text.that_seems_unusually_low_high_double_check_your_"))}</p>`}`;
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
    toast(tr("cmj_accept.message.cm_logged_to", { heightCm: heightCm, targetEx_name: I18n.exercise(targetEx.name) }));
  } else if (active) {
    const prevCm = active.readiness.cmjCm;
    const prevFlightTime = active.readiness.flightTimeMs;
    const prevMethod = active.readiness.method;
    const prevAttempts = active.readiness.cmjAttempts;
    active.readiness.cmjCm = heightCm;
    active.readiness.flightTimeMs = best.flightTimeMs;
    active.readiness.method = 'video';
    active.readiness.cmjAttempts = list;
    if (!saveActive()) {
      active.readiness.cmjCm = prevCm;
      active.readiness.flightTimeMs = prevFlightTime;
      active.readiness.method = prevMethod;
      active.readiness.cmjAttempts = prevAttempts;
      cmjCleanup();
      closeModal();
      return;
    }
    toast(list.length > 1 ? tr("cmj_accept.message.cmj_cm_best_of", { heightCm: heightCm, list_length: list.length }) : tr("cmj_accept.message.cmj_height_set_from_video"));
  } else {
    // Nothing to attach to: say so loudly rather than silently dropping a full test set.
    toast(tr("cmj_accept.message.best_cm_of_not_saved_start_a_session_first", { heightCm: heightCm, list_length: list.length }), 'err');
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

/* ================= exercise reordering ================= */
/*
 * One move path for the plan editor (future workouts) and the active workout (this
 * workout only). The exercise objects themselves are moved, never rebuilt, so
 * identities, logged sets, notes, setups, library snapshots and an exercise timer
 * (which lives on its set row) travel with them. A failed save restores the previous
 * array, so the screen never shows an order that was not persisted.
 */
function reorderHandle(scope, dayId, i, name) {
  return `<button type="button" class="icon-btn ghost drag-handle" data-reorder-handle data-scope="${scope}" data-day="${esc(dayId)}" data-i="${i}" aria-label="${esc(tr('reorder.handle.label', { exercise: name }))}" title="${esc(tr('reorder.handle.title'))}">${icon('grip', 18)}</button>`;
}
function moveButton(scope, dayId, i, dir, disabled, name) {
  const label = dir < 0 ? 'reorder.move_up.label' : 'reorder.move_down.label';
  return `<button type="button" class="icon-btn ghost move-btn" data-action="ex-move" data-scope="${scope}" data-day="${esc(dayId)}" data-i="${i}" data-dir="${dir}" aria-label="${esc(tr(label, { exercise: name }))}" title="${esc(tr(label, { exercise: name }))}" ${disabled ? 'disabled' : ''}>${dir < 0 ? '↑' : '↓'}</button>`;
}
function moveButtons(scope, dayId, i, pos, name) {
  return moveButton(scope, dayId, i, -1, pos.first, name) + moveButton(scope, dayId, i, 1, pos.last, name);
}
// Vertical ↑ / grip / ↓ for expanded workout cards, where a horizontal row would crowd the name.
function reorderCluster(scope, dayId, i, pos, name) {
  return `<div class="reorder-cluster">${moveButton(scope, dayId, i, -1, pos.first, name)}${reorderHandle(scope, dayId, i, name)}${moveButton(scope, dayId, i, 1, pos.last, name)}</div>`;
}
function reorderList(scope, dayId) {
  if (scope === 'session') return active ? active.exercises : null;
  const day = plan.days.find(d => d.id === dayId);
  return day ? day.exercises : null;
}
function announce(msg) {
  let live = document.getElementById('sr-live');
  if (!live) {
    live = document.createElement('div');
    live.id = 'sr-live'; live.className = 'sr-only';
    live.setAttribute('aria-live', 'polite');
    document.body.appendChild(live);
  }
  live.textContent = msg;
}
function applyExerciseOrder(scope, dayId, next, moved, opts = {}) {
  const list = reorderList(scope, dayId);
  if (!list || !next || next.length !== list.length || !next.includes(moved)) return false;
  if (scope === 'session') {
    const prev = active.exercises;
    active.exercises = next;
    if (!saveActive()) { active.exercises = prev; render(); toast(tr('reorder.error.not_saved'), 'err'); return false; }
  } else {
    const day = plan.days.find(d => d.id === dayId);
    const prev = day.exercises;
    day.exercises = next;
    if (!savePlan()) { day.exercises = prev; render(); toast(tr('reorder.error.not_saved'), 'err'); return false; }
  }
  render();
  const at = next.indexOf(moved);
  const groups = WorkoutModel.groupRuns(next);
  const gi = groups.findIndex(g => g.idx.includes(at));
  announce(tr('reorder.announce.moved', { exercise: I18n.exercise(moved.name), position: gi + 1, total: groups.length }));
  // Keep keyboard and screen-reader focus on the control that was used, at its new index.
  const byHandle = document.querySelector(`[data-reorder-handle][data-scope="${scope}"][data-i="${at}"]`);
  const byMove = opts.focus === 'move'
    ? [...document.querySelectorAll(`[data-action="ex-move"][data-scope="${scope}"][data-i="${at}"]`)].find(b => !b.disabled && +b.dataset.dir === opts.dir)
    : null;
  const target = opts.focus ? (byMove || byHandle) : null;
  if (target) target.focus({ preventScroll: true });
  return true;
}
function moveExercise(scope, dayId, i, dir, opts) {
  const list = reorderList(scope, dayId);
  if (!list || !list[i]) return false;
  return applyExerciseOrder(scope, dayId, WorkoutModel.moveGroupBy(list, i, dir), list[i], opts);
}

/*
 * Drag controller. Only the grip handle starts a drag, so inputs, set buttons and
 * ordinary page scrolling behave exactly as before. Mouse: press and move. Touch and
 * pen: press and hold, then move; moving before the hold completes cancels it.
 * Escape, pointercancel or any re-render cancels without changing the order.
 */
const DRAG_HOLD_MS = 350;
let drag = null;
function dragUnits(d) { return [...d.listEl.querySelectorAll(':scope > [data-reorder-unit]')]; }
// Insertion gap in the ORIGINAL order (0..units.length), from unit midpoints.
function dragGap(d) {
  const units = dragUnits(d);
  let gap = 0;
  for (const u of units) {
    const r = u.getBoundingClientRect();
    if (d.y > r.top + r.height / 2) gap++;
  }
  return gap;
}
function paintDrag(d) {
  d.preview.style.top = (d.y - d.offsetY) + 'px';
  d.gap = dragGap(d);
  const units = dragUnits(d);
  const listRect = d.listEl.getBoundingClientRect();
  const y = d.gap < units.length ? units[d.gap].getBoundingClientRect().top - 5 : units[units.length - 1].getBoundingClientRect().bottom + 3;
  Object.assign(d.indicator.style, { top: y + 'px', left: listRect.left + 'px', width: listRect.width + 'px' });
  const from = units.indexOf(d.unit);
  d.indicator.classList.toggle('noop', d.gap === from || d.gap === from + 1);
}
function beginDrag() {
  const d = drag;
  if (!d || d.started) return;
  if (!d.unit.isConnected) { endDrag(); return; }
  d.started = true;
  // Editing and dragging are exclusive: commit/close any focused field first.
  if (document.activeElement && document.activeElement !== d.handle && document.activeElement.blur) document.activeElement.blur();
  hideStepper();
  const r = d.unit.getBoundingClientRect();
  d.offsetY = Math.min(d.y - r.top, 60);
  d.preview = d.unit.cloneNode(true);
  d.preview.classList.add('drag-preview');
  d.preview.removeAttribute('data-reorder-unit');
  d.preview.setAttribute('aria-hidden', 'true');
  d.preview.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  Object.assign(d.preview.style, { left: r.left + 'px', width: r.width + 'px' });
  d.indicator = document.createElement('div');
  d.indicator.className = 'drop-indicator';
  document.body.append(d.preview, d.indicator);
  d.unit.classList.add('drag-source');
  document.body.classList.add('dragging');
  try { d.handle.setPointerCapture(d.pointerId); } catch (e) {}
  if (d.touch) buzz([15]);
  paintDrag(d);
  const scroll = () => {
    if (drag !== d) return;
    const top = 70, bottom = window.innerHeight - 150;
    const v = d.y < top ? -Math.ceil((top - d.y) / 5) : d.y > bottom ? Math.ceil((d.y - bottom) / 5) : 0;
    if (v) { window.scrollBy(0, v); paintDrag(d); }
    d.raf = requestAnimationFrame(scroll);
  };
  d.raf = requestAnimationFrame(scroll);
}
function endDrag() {
  const d = drag;
  drag = null;
  if (!d) return null;
  clearTimeout(d.timer);
  if (d.raf) cancelAnimationFrame(d.raf);
  if (d.preview) d.preview.remove();
  if (d.indicator) d.indicator.remove();
  d.unit.classList.remove('drag-source');
  document.body.classList.remove('dragging');
  return d;
}
document.addEventListener('pointerdown', e => {
  const handle = e.target.closest && e.target.closest('[data-reorder-handle]');
  if (!handle || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const unit = handle.closest('[data-reorder-unit]'), listEl = handle.closest('[data-reorder-list]');
  if (!unit || !listEl) return;
  drag = { handle, unit, listEl, pointerId: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY,
    touch: e.pointerType !== 'mouse', started: false, gap: null,
    scope: handle.dataset.scope, dayId: handle.dataset.day, index: +handle.dataset.i };
  if (drag.touch) drag.timer = setTimeout(beginDrag, DRAG_HOLD_MS);
  else e.preventDefault(); // no text selection while dragging with a mouse
});
document.addEventListener('pointermove', e => {
  const d = drag;
  if (!d || e.pointerId !== d.pointerId) return;
  d.x = e.clientX; d.y = e.clientY;
  if (!d.started) {
    const dist = Math.hypot(d.x - d.startX, d.y - d.startY);
    if (d.touch && dist > 10) endDrag();           // moved before the hold: not a drag
    else if (!d.touch && dist > 4) beginDrag();
    return;
  }
  e.preventDefault();
  paintDrag(d);
}, { passive: false });
document.addEventListener('pointerup', e => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (drag.started) paintDrag(drag);
  const d = endDrag();
  if (!d.started || d.gap == null) return;
  const list = reorderList(d.scope, d.dayId);
  if (!list || !list[d.index]) return;
  const next = WorkoutModel.moveGroupToGap(list, d.index, d.gap);
  if (next) applyExerciseOrder(d.scope, d.dayId, next, list[d.index], { focus: 'handle' });
});
document.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.pointerId) endDrag(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && drag) { endDrag(); return; }
  const handle = e.target.closest && e.target.closest('[data-reorder-handle]');
  if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  e.preventDefault();
  moveExercise(handle.dataset.scope, handle.dataset.day, +handle.dataset.i, e.key === 'ArrowUp' ? -1 : 1, { focus: 'handle' });
});
// A long press on the handle must not open the browser's context menu or callout.
document.addEventListener('contextmenu', e => { if (e.target.closest && e.target.closest('[data-reorder-handle]')) e.preventDefault(); });

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

    /* exercise timer */
    case 'extimer-start': startExerciseTimer(+el.dataset.ei, +el.dataset.si); break;
    case 'extimer-pause': pauseExerciseTimer(+el.dataset.ei, +el.dataset.si); break;
    case 'extimer-resume': resumeExerciseTimer(+el.dataset.ei, +el.dataset.si); break;
    case 'extimer-reset': resetExerciseTimer(+el.dataset.ei, +el.dataset.si); break;
    case 'extimer-cancel': cancelExerciseTimer(+el.dataset.ei, +el.dataset.si); break;
    case 'extimer-log': logExerciseTimer(+el.dataset.ei, +el.dataset.si); break;

    /* session lifecycle */
    case 'start-session': startSession(el.dataset.id); break;
    case 'confirm-finish': {
      const done = active.exercises.reduce((n, x) => n + x.sets.filter(s => s.done).length, 0);
      showModal(tr("action_confirm-finish.message.finish_workout"), `<p>${esc(tr("action_confirm-finish.text.sets_logged_in", { done: done, fmtClock_Date_now_active_sta: fmtClock((Date.now() - active.startedAt) / 1000) }))}</p>`,
        [{ label: tr("action_confirm-finish.button.finish_save"), cls: 'success', fn: finishSession }, { label: tr("workout.action.keep_going") }]);
      break;
    }
    case 'confirm-discard':
      showModal(tr("action_confirm-discard.message.discard_session"), `<p>${esc(tr("action_confirm-discard.text.all_logged_sets_from_this_session_will_be_lost"))}</p>`,
        [{ label: tr("action_confirm-discard.button.discard"), cls: 'danger', fn: () => {
            // A button WITH a handler owns closing its own modal — the modal-btn
            // dispatcher only auto-closes handler-less buttons.
            if (!endSession()) return;
            closeModal(); render(); toast(tr("action_confirm-discard.message.session_discarded"));
          } }, { label: tr("workout.action.keep_going") }]);
      break;

    /* set logging */
    case 'set-done': {
      const ei = +el.dataset.ei, si = +el.dataset.si;
      const ex = active.exercises[ei], s = ex.sets[si];
      if (!s.done && WorkoutModel.timed(ex) && (
          !(ex.metric === 'duration' ? s.durationSeconds > 0 : ex.metric === 'distance' ? s.distanceMeters > 0 : s.durationSeconds > 0 || s.distanceMeters > 0) ||
          ['weight', 'durationSeconds', 'distanceMeters', 'speedKph'].some(k => s[k] != null && (!Number.isFinite(s[k]) || s[k] < 0)))) {
        toast(tr('exercise.model.actual_required'), 'err'); return;
      }
      s.done = !s.done;
      if (s.done) completeSet(ei, si);
      else {
        if (!saveActive()) { s.done = true; return; }
        render();
      }
      break;
    }
    case 'ex-toggle': {
      // Keys are dual-typed on purpose: a plain exercise is keyed by its object, so a
      // reorder keeps the right card open; a superset by 'ss:'+tag, because the whole
      // group collapses as a unit.
      const k = el.dataset.key != null ? el.dataset.key : active.exercises[+el.dataset.ei];
      if (exExpanded.has(k)) exExpanded.delete(k); else exExpanded.add(k);
      render();
      break;
    }
    case 'warmup-toggle': {
      const items = active.warmup || [];
      const shown = warmupOpen != null ? warmupOpen : items.filter(w => w.done).length < items.length;
      warmupOpen = !shown;
      render();
      break;
    }
    case 'warmup-check': {
      const w = (active.warmup || [])[+el.dataset.i];
      if (w) {
        w.done = !w.done;
        if (!saveActive()) { w.done = !w.done; return; }
        render();
      }
      break;
    }
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
      showRpePicker(s.rpe, v => {
        const prev = s.rpe;
        s.rpe = v;
        if (!saveActive()) { s.rpe = prev; return; }
        render();
      });
      break;
    }
    case 'edit-rpe-pick': {
      const btn = el;
      showRpePicker(btn.dataset.v ? parseFloat(btn.dataset.v) : null,
        v => { btn.dataset.v = v != null ? v : ''; btn.textContent = v != null ? v : '—'; }, tr("action_edit-rpe-pick.message.target_rpe"));
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
    case 'set-warmup': {
      const s = active.exercises[+el.dataset.ei].sets[+el.dataset.si];
      const prevWarmup = s.warmup;
      const prevRpe = s.rpe;
      s.warmup = !s.warmup;
      if (s.warmup) s.rpe = null; // an RPE on a ramp-up set is noise, not data
      if (!saveActive()) { s.warmup = prevWarmup; s.rpe = prevRpe; return; }
      render();
      break;
    }
    case 'set-add': {
      const ex = active.exercises[+el.dataset.ei];
      // Seed from the last WORKING set — an extra set follows the working weight,
      // not whatever a warm-up row happens to be sitting at.
      const ws = workingSets(ex.sets);
      const lastSet = ws[ws.length - 1] || ex.sets[ex.sets.length - 1];
      ex.sets.push(WorkoutModel.timed(ex) ? { ...WorkoutModel.row(ex), ...lastSet, done: false } : isJump(ex)
        ? { heightCm: null, done: false }
        : { weight: lastSet ? lastSet.weight : ex.plannedWeight, reps: lastSet ? lastSet.reps : parseRepsLow(ex.plannedReps), rpe: ex.targetRpe, done: false });
      if (!saveActive()) { ex.sets.pop(); return; }
      render(); break;
    }
    case 'set-remove': {
      const ex = active.exercises[+el.dataset.ei];
      if (ex.sets.length > 1) {
        const popped = ex.sets.pop();
        if (!saveActive()) { ex.sets.push(popped); return; }
        render();
      }
      break;
    }
    case 'ex-info': exInfoModal(+el.dataset.ei); break;
    case 'ex-swap': sessionSwapModal(+el.dataset.ei); break;
    case 'ex-note': exNoteModal(+el.dataset.ei); break;
    case 'session-ex-add': sessionAddExerciseModal(); break;
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
    case 'ex-add': exerciseLibraryModal(el.dataset.day); break;
    case 'day-warmup': dayWarmupModal(el.dataset.id); break;
    case 'ex-move':
      // Moves operate on GROUPS, not individual exercises. Sliding one member out
      // of the middle of a superset silently splits it into two cards with
      // independent rest cycles — the exact state push-plan.mjs refuses to push.
      moveExercise(el.dataset.scope || 'plan', el.dataset.day, +el.dataset.i, +el.dataset.dir, { focus: 'move', dir: +el.dataset.dir });
      break;
    case 'plan-swap-pick': doPlanSwap(el.dataset.day, +el.dataset.i, +el.dataset.ai); break;
    case 'plan-rename':
      showModal(tr("action_plan-rename.message.rename_plan"), `<label class="field"><span>${esc(tr("action_plan-rename.text.plan_name"))}</span><input id="f-plan-name" value="${esc(plan.name)}"></label>`,
        [{ label: tr("common.action.save"), cls: 'primary', fn: () => {
            const prevName = plan.name;
            plan.name = mval('f-plan-name') || plan.name;
            if (!savePlan()) {
              plan.name = prevName;
              return;
            }
            closeModal(); render();
          } }, { label: tr("common.action.cancel") }]);
      break;
    case 'day-add':
      showModal(tr("action_day-add.message.add_day"), `<label class="field"><span>${esc(tr("plan.form.day_name"))}</span><input id="f-day-name" placeholder="${esc(tr("action_day-add.placeholder.day_d_upper"))}"></label>`,
        [{ label: tr("common.action.add"), cls: 'primary', fn: () => {
            const name = mval('f-day-name'); if (!name) return;
            const newDay = { id: uid(), name, warmup: [], exercises: [] };
            plan.days.push(newDay);
            const prevExpanded = expandedDay;
            expandedDay = newDay.id;
            if (!savePlan()) {
              plan.days.pop();
              expandedDay = prevExpanded;
              return;
            }
            closeModal(); render();
          } }, { label: tr("common.action.cancel") }]);
      break;
    case 'day-rename': {
      const day = plan.days.find(d => d.id === el.dataset.id);
      if (!day) break;
      showModal(tr("action_day-rename.message.rename_day"), `<label class="field"><span>${esc(tr("plan.form.day_name"))}</span><input id="f-day-name" value="${esc(day.name)}"></label>`,
        [{ label: tr("common.action.save"), cls: 'primary', fn: () => {
            const prevName = day.name;
            day.name = mval('f-day-name') || day.name;
            if (!savePlan()) {
              day.name = prevName;
              return;
            }
            closeModal(); render();
          } }, { label: tr("common.action.cancel") }]);
      break;
    }
    case 'day-delete': {
      const id = el.dataset.id;
      const day = plan.days.find(d => d.id === id);
      if (!day) break;
      showModal(tr("plan.day.delete.title", { day: day.name }), `<p>${esc(tr("action_day-delete.text.the_day_and_its_exercises_are_removed_from_the_p"))}</p>`,
        [{ label: tr("common.action.delete"), cls: 'danger', fn: () => {
            const prevDays = [...plan.days];
            plan.days = plan.days.filter(d => d.id !== id);
            if (!savePlan()) {
              plan.days = prevDays;
              return;
            }
            closeModal(); render();
          } }, { label: tr("common.action.cancel") }]);
      break;
    }

    /* history */
    case 'session-toggle': expandedSession = expandedSession === el.dataset.id ? null : el.dataset.id; render(); break;
    case 'session-delete': {
      const id = el.dataset.id;
      showModal(tr("action_session-delete.message.delete_this_session"), `<p>${esc(tr("action_session-delete.text.this_permanently_removes_it_from_your_history_an"))}</p>`,
        [{ label: tr("common.action.delete"), cls: 'danger', fn: () => {
            const prevSessions = [...sessions];
            sessions = sessions.filter(s => s.id !== id);
            if (!saveSessions()) {
              sessions = prevSessions;
              return;
            }
            closeModal(); render();
          } }, { label: tr("common.action.cancel") }]);
      break;
    }
    case 'bw-add': {
      const v = parseFloat(document.getElementById('bw-input').value);
      if (!v || v <= 0) { toast(tr("action_bw-add.message.enter_a_weight_first"), 'err'); break; }
      const prevBw = [...bodyWeight];
      bodyWeight = bodyWeight.filter(b => b.date !== today());
      bodyWeight.push({ date: today(), weight: v });
      if (!saveBW()) {
        bodyWeight = prevBw;
        return;
      }
      render(); toast(tr("action_bw-add.message.body_weight_logged"));
      break;
    }
    case 'bw-undo': {
      if (!bodyWeight.length) break;
      const popped = bodyWeight.pop();
      if (!saveBW()) {
        bodyWeight.push(popped);
        return;
      }
      render();
      break;
    }
    case 'merge-names': mergeNamesModal(el.dataset.name); break;
    case 'unmerge-alias': {
      const prevVal = aliases[el.dataset.k];
      delete aliases[el.dataset.k];
      if (!saveAliases()) {
        aliases[el.dataset.k] = prevVal;
        return;
      }
      render();
      mergeNamesModal(el.dataset.name); // reopen with the updated list
      break;
    }

    case 'plan-export': copyText(buildPlanExport()).then(ok => toast(ok ? tr("plan.export.copied") : tr("common.error.copy_failed"), ok ? 'ok' : 'err')); break;
    case 'plan-import-open':
      showModal(tr("plan.action.import"), `
        <p class="small muted">${esc(tr("view_coach.import.instructions"))}</p>
        <textarea id="import-area" class="mt8" placeholder='{"type":"workout-plan", "days":[...]}'></textarea>`,
        [{ label: tr("common.action.continue"), cls: 'primary', fn: () => {
            const raw = mval('import-area');
            if (!raw) { toast(tr("action_import-plan.message.paste_the_plan_json_first"), 'err'); return; }
            try {
              const cleaned = raw.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim();
              const parsed = JSON.parse(cleaned);
              validatePlanImport(parsed);
              const newPlan = normalizePlan(parsed);
              showPlanImportPreview(newPlan, () => applyImportedPlan(newPlan));
            } catch (err) { toast(tr("plan_import.error.invalid", { error: err.message }), 'err'); }
          } },
          { label: tr("common.action.cancel") }]);
      break;
    case 'copy-corrupt-raw': {
      const corruptJson = JSON.stringify(corruptData, null, 2);
      copyText(corruptJson).then(ok => toast(ok ? tr("storage.corrupt.copied") : tr("common.error.copy_failed"), ok ? 'ok' : 'err'));
      break;
    }

    /* AI Coach tab */
    case 'copy-coach': copyText(AI_PROMPT() + buildExport()).then(ok => toast(ok ? tr("action_copy-coach.message.coaching_prompt_copied_paste_it_to_claude") : tr("common.error.copy_failed"), ok ? 'ok' : 'err')); break;
    case 'copy-data': copyText(buildExport()).then(ok => toast(ok ? tr("action_copy-data.message.data_copied") : tr("common.error.copy_failed"), ok ? 'ok' : 'err')); break;
    case 'import-plan': {
      const raw = mval('import-area');
      if (!raw) { toast(tr("action_import-plan.message.paste_the_plan_json_first"), 'err'); break; }
      try {
        const cleaned = raw.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim();
        const parsed = JSON.parse(cleaned);
        validatePlanImport(parsed);
        const newPlan = normalizePlan(parsed);
        showPlanImportPreview(newPlan, () => applyImportedPlan(newPlan));
      } catch (err) { toast(tr("plan_import.error.invalid", { error: err.message }), 'err'); }
      break;
    }
    case 'sync-retry': workerPush({ silent: true }); break;
    case 'coach-inbox-open': openCoachInbox(); break;
    case 'coach-link': linkCoach(mval('coach-code'), mval('coach-name')); break;
    case 'coach-unlink': confirmUnlinkCoach(); break;
    case 'toggle-autosync':
      settings.autoSync = !settings.autoSync;
      if (!saveSettings()) { settings.autoSync = !settings.autoSync; return; }
      render();
      if (settings.autoSync) workerPush({ silent: true });
      break;
    case 'share-ai': copyText(workerShareUrl()).then(ok => toast(ok ? tr("action_share-ai.message.link_copied_paste_into_any_ai_chat") : tr("common.error.copy_failed"), ok ? 'ok' : 'err')); break;
    case 'copy-uuid': copyText(gymUUID).then(ok => toast(ok ? tr("action_copy-uuid.message.backup_code_copied") : tr("common.error.copy_failed"), ok ? 'ok' : 'err')); break;
    case 'download-pending-exercises': {
      const file = new Blob([I18n.exportPendingExercises()], { type: 'application/json' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(file);
      link.href = url;
      link.download = 'gymtrack-pending-exercises.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      break;
    }
    case 'restore-uuid': restoreFromCode(mval('restore-uuid-input')); break;
    case 'save-write-token': saveWriteToken(mval('write-token-input')); break;
    case 'toggle-sound':
      settings.sound = !settings.sound;
      if (!saveSettings()) { settings.sound = !settings.sound; return; }
      render();
      break;
    case 'toggle-vibrate':
      settings.vibrate = !settings.vibrate;
      if (!saveSettings()) { settings.vibrate = !settings.vibrate; return; }
      render();
      break;
    case 'test-sound': {
      beep(3); buzz();
      const st = audioState();
      toast(st === 'running' ? tr("action_test-sound.message.that_s_the_rest_timer_cue")
        : tr("action_test-sound.message.audio_context_is_sound_may_not_fire_tap_anywhere", { st: st }), st === 'running' ? 'ok' : 'err');
      break;
    }
    case 'backup-copy': copyText(buildBackup()).then(ok => toast(ok ? tr("action_backup-copy.message.backup_copied_store_it_somewhere_safe") : tr("common.error.copy_failed"), ok ? 'ok' : 'err')); break;
    case 'backup-restore':
      showModal(tr("action_backup-restore.message.restore_backup"), `<p class="muted small">${esc(tr("action_backup-restore.text.paste_a_backup_json_this_replaces_everything_on_"))}</p><textarea id="restore-area" class="mt8"></textarea>`,
        [{ label: tr("common.action.restore"), cls: 'danger', fn: () => {
            // A button with a handler owns closing its sheet; without this the Restore sheet
            // stayed open over the restored data and invited a second tap.
            try { restoreBackup(mval('restore-area')); closeModal(); render(); toast(tr("action_backup-restore.message.backup_restored")); }
            catch (err) { toast(tr("backup.error.restore", { error: err.message }), 'err'); }
          } }, { label: tr("common.action.cancel") }]);
      break;
    case 'reset-all':
      showModal(tr("action_reset-all.message.reset_everything"), `<p>${esc(tr("action_reset-all.text.deletes_your_plan_all_sessions_body_weight_log_a"))}</p>`,
        [{ label: tr("action_reset-all.button.reset"), cls: 'danger', fn: () => {
            const defaultSettings = { unit: 'kg', sound: true, vibrate: true, autoSync: true };
            const writes = [
              ['plan', defaultPlan()],
              ['sessions', []],
              ['active', undefined],
              ['bw', []],
              ['settings', defaultSettings],
              ['aliases', {}],
              ['updatedAt', undefined]
            ];
            const txRes = store.commitTx(writes, { allowCorruptRecovery: true });
            if (!txRes.ok) {
              toast(tr("storage.error.save_failed", { item: tr("view_settings.text.reset_everything") }), 'err');
              return;
            }
            if (active) {
              stopRest(); syncWakeLock();
              exExpanded = new Set(); readinessOpen = null; warmupOpen = null;
            }
            active = null;
            store.rawDel('pending_tx');
            for (const k in corruptData) delete corruptData[k];
            storageAlert = null;
            plan = defaultPlan(); sessions = []; bodyWeight = []; aliases = {}; dataUpdatedAt = 0;
            settings = defaultSettings;
            closeModal(); render(); toast(tr("action_reset-all.message.fresh_start"));
          } }, { label: tr("common.action.cancel") }]);
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
    const prev = s[el.dataset.f];
    const prevDomVal = el.value;
    const v = parseFloat(el.value);
    s[el.dataset.f] = isNaN(v) ? null : v;
    const summary = document.querySelector(`[data-measurement-summary="${el.dataset.ei}-${el.dataset.si}"]`);
    if (summary) summary.textContent = measurementText(active.exercises[+el.dataset.ei], s);
    if (!saveActive()) {
      s[el.dataset.f] = prev;
      el.value = prev != null ? prev : '';
      if (summary) summary.textContent = measurementText(active.exercises[+el.dataset.ei], s);
    }
  } else if (bind === 'session-notes' && active) {
    const prev = active.notes;
    active.notes = el.value;
    if (!saveActive()) {
      active.notes = prev;
      el.value = prev || '';
    }
  } else if (bind === 'readiness-cmj' && active) {
    const prevCm = active.readiness.cmjCm;
    const prevMethod = active.readiness.method;
    const prevFlightTime = active.readiness.flightTimeMs;
    const prevAttempts = active.readiness.cmjAttempts;
    const v = parseFloat(el.value);
    active.readiness.cmjCm = isNaN(v) ? null : v;
    // A typed value supersedes any earlier video measurement — drop its metadata so a
    // stale method/flight time/attempt list can't ride along with a hand-entered number.
    delete active.readiness.method;
    delete active.readiness.flightTimeMs;
    delete active.readiness.cmjAttempts;
    if (!saveActive()) {
      active.readiness.cmjCm = prevCm;
      if (prevMethod !== undefined) active.readiness.method = prevMethod;
      if (prevFlightTime !== undefined) active.readiness.flightTimeMs = prevFlightTime;
      if (prevAttempts !== undefined) active.readiness.cmjAttempts = prevAttempts;
      el.value = prevCm != null ? prevCm : '';
    }
  } else if (bind === 'readiness-broad' && active) {
    const prev = active.readiness.broadJumpCm;
    const v = parseFloat(el.value);
    active.readiness.broadJumpCm = isNaN(v) ? null : v;
    if (!saveActive()) {
      active.readiness.broadJumpCm = prev;
      el.value = prev != null ? prev : '';
    }
  } else if (bind === 'readiness-energy' && active) {
    const prev = active.readiness.subjectiveEnergy;
    const v = parseInt(el.value, 10);
    active.readiness.subjectiveEnergy = isNaN(v) ? null : Math.min(10, Math.max(1, v));
    if (!saveActive()) {
      active.readiness.subjectiveEnergy = prev;
      el.value = prev != null ? prev : '';
    }
  }
});
document.addEventListener('change', e => {
  const bind = e.target.dataset.bind;
  const prefix = e.target.dataset.prefix;
  if (bind === 'model-metric') {
    const metric = e.target.value;
    const targets = document.querySelector(`.model-targets[data-prefix="${prefix}"]`);
    targets.hidden = !WorkoutModel.timed({ metric });
    for (const field of targets.querySelectorAll('[data-model-field]')) field.hidden = field.dataset.modelField === 'pace' ? metric !== 'cardio' : !WorkoutModel.targetFields({ metric }).includes(field.dataset.modelField);
    const reps = document.getElementById(`${prefix}-reps`);
    if (reps) reps.closest('label').hidden = metric !== 'load';
    const warmups = document.getElementById(`${prefix}-warmupsets`);
    if (warmups) { warmups.closest('label').hidden = metric !== 'load'; if (metric !== 'load') warmups.value = 0; }
    refreshAddedLoadFields(prefix);
  }
  if (bind === 'target-pace') {
    const match = e.target.value.trim().match(/^(\d+):([0-5]\d)$/);
    if (match && (+match[1] * 60 + +match[2]) > 0) document.getElementById(`${prefix}-speedKph`).value = Math.round(360000 / (+match[1] * 60 + +match[2])) / 100;
    else if (e.target.value) { toast(tr('exercise.model.invalid', { fields: modelLabel('pace') }), 'err'); e.target.value = ''; }
  }
  if (bind === 'setup-profile') {
    const saved = [...plan.days.flatMap(d => d.exercises), ...sessions.flatMap(s => s.exercises)].find(x => x.setupId === e.target.value && x.loadProfile?.unit === unit());
    if (saved) for (const field of ['offset', 'increment', 'loads']) document.getElementById(`${prefix}-${field}`).value = field === 'loads' ? saved.loadProfile.loads?.join(', ') || '' : saved.loadProfile[field] ?? '';
    if (saved) {
      document.getElementById(`${prefix}-profileUnit`).value = saved.loadProfile.unit;
      const equipment = document.getElementById(`${prefix}-equipment`);
      equipment.value = saved.equipment;
      equipment.dispatchEvent(new Event('change', { bubbles: true }));
      const bar = document.getElementById(`${prefix}-barweight`);
      if (bar) bar.value = saved.barWeight ?? '';
    }
  }
  if (bind === 'set-language') {
    const drafts = [...document.querySelectorAll('#app input[id], #app textarea[id]')].map(el => [el.id, el.value]);
    I18n.setLocale(e.target.value); render(); renderRest();
    drafts.forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value; });
    const banner = document.getElementById('update-banner'); if (banner) { banner.remove(); showUpdateBanner(); }
  }
  if (bind === 'history-ex') { historyExercise = e.target.value; render(); }
  if (bind === 'set-unit') {
    const prevUnit = settings.unit;
    settings.unit = e.target.value;
    if (!saveSettings()) {
      settings.unit = prevUnit;
      render();
      return;
    }
    render();
    toast(tr("settings.unit.changed", { unit: settings.unit }));
  }
  if (bind === 'edit-equipment') {
    const row = document.getElementById('f-barweight-row');
    if (row) {
      row.classList.toggle('hidden', !BAR_WEIGHT_EQUIPMENT.has(e.target.value));
      const input = document.getElementById('f-barweight');
      if (input) input.placeholder = tr("ex_edit_modal.placeholder.default", { resolvedBarWeight_equipment_: resolvedBarWeight({ equipment: e.target.value, barWeight: null }) });
    }
    const hint = document.getElementById('f-weight-hint');
    if (hint) hint.textContent = ladderHint(e.target.value);
    refreshAddedLoadFields('f');
  }
  if (bind === 'add-equipment') {
    const hint = document.getElementById('a-weight-hint');
    if (hint) hint.textContent = ladderHint(e.target.value);
    refreshAddedLoadFields('a');
  }
  if (bind === 'added-load') refreshAddedLoadFields(prefix);
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
autoSyncOnLoad().then(() => refreshCoachInbox()); // reconcile with the cloud, then enable auto-push
