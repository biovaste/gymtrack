/* Shared browser/Node data rules. No DOM, storage or dependencies. */
(function (root) {
  'use strict';
  const metrics = ['load', 'height', 'duration', 'distance', 'cardio'];
  const sides = ['unspecified', 'left', 'right', 'bilateral'];
  const timed = e => ['duration', 'distance', 'cardio'].includes(e.metric);
  const targetFields = e => e.metric === 'duration' ? ['durationSeconds'] : e.metric === 'distance' ? ['distanceMeters'] : e.metric === 'cardio' ? ['durationSeconds', 'distanceMeters', 'speedKph'] : [];
  const numeric = v => typeof v === 'number' && Number.isFinite(v);
  const fields = ['movementId', 'side', 'setupId', 'loadProfile', 'durationSeconds', 'distanceMeters', 'speedKph'];
  function metadata(e) {
    return Object.fromEntries(fields.filter(k => e[k] != null).map(k => [k,
      k === 'loadProfile' ? JSON.parse(JSON.stringify(e[k])) : e[k]]));
  }
  // Legacy names remain a separate namespace. Never guess a side or movement ID.
  function key(e, canonical = x => x) {
    const identity = e.movementId ? ['id', e.movementId] : ['name', canonical(e.name).trim().toLowerCase()];
    return JSON.stringify([...identity, e.side || 'unspecified', e.setupId || '', e.metric || 'load', ...(e.movementId ? [e.equipment || ''] : [])]);
  }
  function errors(e) {
    const out = [];
    if (e.metric != null && !metrics.includes(e.metric)) out.push('metric');
    if (e.side != null && !sides.includes(e.side)) out.push('side');
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
  const api = { metrics, sides, timed, targetFields, metadata, key, errors, loadable, nextLoad, row, recordSet, speed };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkoutModel = api;
})(typeof globalThis === 'object' ? globalThis : this);
