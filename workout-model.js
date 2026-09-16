/* Shared browser/Node data rules. No DOM, storage or dependencies. */
(function (root) {
  'use strict';
  const metrics = ['load', 'height', 'duration', 'distance', 'cardio'];
  const sides = ['unspecified', 'left', 'right', 'bilateral'];
  const timed = e => ['duration', 'distance', 'cardio'].includes(e.metric);
  const targetFields = e => e.metric === 'duration' ? ['durationSeconds'] : e.metric === 'distance' ? ['distanceMeters'] : e.metric === 'cardio' ? ['durationSeconds', 'distanceMeters', 'speedKph'] : [];
  const numeric = v => typeof v === 'number' && Number.isFinite(v);
  const fields = ['libraryEntry', 'movementId', 'side', 'setupId', 'loadProfile', 'addedLoad', 'durationSeconds', 'distanceMeters', 'speedKph'];
  // A bodyweight lift whose `weight` is external load added to the body (belt,
  // vest, dumbbell between the feet). 0 = bodyweight only. Never inferred: a legacy
  // bodyweight record without the flag keeps meaning "weight is not recorded".
  const isAddedLoad = e => !!e && e.addedLoad === true && (e.equipment || 'barbell') === 'bodyweight' && (e.metric || 'load') === 'load';
  function metadata(e) {
    return Object.fromEntries(fields.filter(k => e[k] != null).map(k => [k,
      ['loadProfile', 'libraryEntry'].includes(k) ? JSON.parse(JSON.stringify(e[k])) : e[k]]));
  }
  // Legacy names remain a separate namespace. Never guess a side or movement ID.
  function key(e, canonical = x => x) {
    const identity = e.movementId ? ['id', e.movementId] : ['name', canonical(e.name).trim().toLowerCase()];
    // The added-load convention is appended only when set, so every existing key is unchanged
    // and bodyweight-only history is never silently compared with added-load history.
    return JSON.stringify([...identity, e.side || 'unspecified', e.setupId || '', e.metric || 'load', ...(e.movementId ? [e.equipment || ''] : []), ...(e.addedLoad === true ? ['added-load'] : [])]);
  }
  function libraryErrors(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['libraryEntry'];
    const strings = ['id', 'name', 'category', 'equipment', 'movement', 'metric'];
    if (strings.some(k => typeof entry[k] !== 'string' || !entry[k].trim()) ||
        !metrics.includes(entry.metric) || !Array.isArray(entry.muscles) || entry.muscles.some(x => typeof x !== 'string') ||
        !Array.isArray(entry.aliases) || entry.aliases.some(x => typeof x !== 'string') ||
        ['description', 'position', 'execution'].some(k => typeof entry[k] !== 'string')) return ['libraryEntry'];
    return [];
  }
  function libraryListErrors(list) {
    if (!Array.isArray(list)) return ['library'];
    return list.flatMap(libraryErrors).concat(new Set(list.map(e => e?.id)).size !== list.length ? ['library duplicate id'] : []);
  }
  function errors(e) {
    const out = e.libraryEntry == null ? [] : libraryErrors(e.libraryEntry);
    if (e.libraryEntry && e.libraryEntry.id !== e.movementId) out.push('libraryEntry / movementId');
    if (e.metric != null && !metrics.includes(e.metric)) out.push('metric');
    if (e.side != null && !sides.includes(e.side)) out.push('side');
    if (e.addedLoad != null) {
      if (e.addedLoad !== true) out.push('addedLoad');
      // Alternates may omit equipment/metric and inherit them; only declared values are checked here.
      else if ((e.equipment != null && e.equipment !== 'bodyweight') || (e.metric != null && e.metric !== 'load')) out.push('addedLoad / equipment');
    }
    for (const k of ['movementId', 'setupId']) if (e[k] != null && (typeof e[k] !== 'string' || !e[k].trim())) out.push(k);
    for (const k of ['durationSeconds', 'distanceMeters', 'speedKph']) {
      if (e[k] != null && (!numeric(e[k]) || e[k] <= 0)) out.push(k);
    }
    const p = e.loadProfile;
    if (p != null) {
      if (typeof p !== 'object' || !['kg', 'lb'].includes(p.unit) || !numeric(p.offset) || p.offset < 0 ||
          (p.loads != null ? !Array.isArray(p.loads) || !p.loads.length || p.loads.some((v, i) => !numeric(v) || v < p.offset || (i && v <= p.loads[i - 1]))
            : !numeric(p.increment) || p.increment <= 0)) out.push('loadProfile');
    }
    return out;
  }
  // Explicit loads are total displayed loads, including the offset.
  function loadable(p, weight) {
    if (!numeric(weight) || weight < p.offset) return false;
    return p.loads ? p.loads.some(v => Math.abs(v - weight) < 1e-7)
      : Math.abs((weight - p.offset) / p.increment - Math.round((weight - p.offset) / p.increment)) < 1e-7;
  }
  function nextLoad(p, weight, dir) {
    if (p.loads) return dir > 0 ? p.loads.find(v => v > weight + 1e-7) ?? weight
      : [...p.loads].reverse().find(v => v < weight - 1e-7) ?? p.loads[0];
    const rung = (weight - p.offset) / p.increment;
    return Math.round((p.offset + Math.max(0, dir > 0 ? Math.floor(rung + 1e-7) + 1 : Math.ceil(rung - 1e-7) - 1) * p.increment) * 1000) / 1000;
  }
  function row(e) {
    if (e.metric === 'height') return { heightCm: null, done: false };
    if (!timed(e)) return { weight: e.weight || 0, reps: parseInt(e.reps, 10) || 8, rpe: e.targetRpe ?? null, done: false };
    const s = { weight: e.weight || 0, rpe: null, done: false };
    if (e.metric !== 'distance') s.durationSeconds = e.durationSeconds ?? null;
    if (e.metric !== 'duration') s.distanceMeters = e.distanceMeters ?? null;
    if (e.metric === 'cardio') s.speedKph = e.speedKph ?? null;
    return s;
  }
  function recordSet(e, s) {
    const keys = e.metric === 'height' ? ['heightCm'] : timed(e)
      ? ['weight', 'durationSeconds', 'distanceMeters', 'speedKph', 'rpe'] : ['weight', 'reps', 'rpe'];
    const record = Object.fromEntries(keys.filter(k => k in s).map(k => [k, s[k]]));
    if (s.warmup) record.warmup = true;
    return record;
  }
  function speed(s) {
    return s.distanceMeters > 0 && s.durationSeconds > 0 ? s.distanceMeters / s.durationSeconds * 3.6 : s.speedKph || null;
  }
  /*
   * Group-aware reordering. A group is a maximal run of adjacent exercises sharing a
   * superset tag (a lone tagged exercise is a group of one). Groups move as a unit and
   * keep their internal order; the same object references are returned in a new array,
   * so identities, logged sets and notes travel untouched.
   */
  function groupRuns(list) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const tag = list[i].superset || null;
      const idx = [i];
      while (tag && i + 1 < list.length && (list[i + 1].superset || null) === tag) idx.push(++i);
      out.push({ tag, idx });
    }
    return out;
  }
  // gap: insertion point between groups of the ORIGINAL list, 0..groups.length.
  // Returns the reordered array, or null when the move changes nothing.
  function moveGroupToGap(list, exerciseIndex, gap) {
    const groups = groupRuns(list);
    const from = groups.findIndex(g => g.idx.includes(exerciseIndex));
    if (from === -1 || !Number.isInteger(gap) || gap < 0 || gap > groups.length) return null;
    const slot = gap > from ? gap - 1 : gap;
    if (slot === from) return null;
    const rest = groups.filter((_, gi) => gi !== from);
    rest.splice(slot, 0, groups[from]);
    return rest.flatMap(g => g.idx.map(i => list[i]));
  }
  function moveGroupBy(list, exerciseIndex, dir) {
    const from = groupRuns(list).findIndex(g => g.idx.includes(exerciseIndex));
    if (from === -1) return null;
    return moveGroupToGap(list, exerciseIndex, dir < 0 ? from - 1 : from + 2);
  }
  const api = { isAddedLoad, groupRuns, moveGroupToGap, moveGroupBy, libraryErrors, libraryListErrors, metrics, sides, timed, targetFields, metadata, key, errors, loadable, nextLoad, row, recordSet, speed };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkoutModel = api;
})(typeof globalThis === 'object' ? globalThis : this);
