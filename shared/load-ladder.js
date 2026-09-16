// Extracted legacy kg ladder; parity is checked against the PWA.
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

module.exports = {nextWeight,isLoadable,weightIssueKind};
