# GymTrack — Equipment ladder, supersets, equipment UI, timer audio, jump logging

> Design spec · 2026-07-30 · target: `Tracking app/` (no-build static PWA)

Five changes, in dependency order. 1 and 3 are prerequisites for the skill updates in §6; 2, 4 and 5 are independent of each other.

---

## 1. Equipment-aware weight ladder

### Problem

`stepperStep()` ([app.js:1370](../../../app.js)) returns a hardcoded `2.5` for every weight field regardless of equipment. Tapping `+2.5` on a dumbbell produces 22.5 kg, which does not exist; on a cable stack it produces 22.5 kg, which the current validator rejects outright. `weightProblem()` in [tools/push-plan.mjs:54](../../../tools/push-plan.mjs) encodes a flat-step ladder that disagrees with the real gym below 25 kg on stacks and below 10 kg on dumbbells.

### Design

One pure function, walking **rungs** rather than adding deltas, so segment boundaries are exact:

```js
nextWeight(equipment, barWeight, current, dir) → number   // dir = +1 | -1
loadStep(equipment, barWeight, current, dir)  → number     // the delta, for button labels
```

Rungs per equipment type:

| Equipment | Rungs (kg) |
|---|---|
| `barbell` / `trap-bar` / `training-bar` | `bar + n×2.5` (bar from `barWeight`, else `BAR_WEIGHT_DEFAULTS`) |
| `landmine` | `n×1.25` — load on the single end, no bar subtraction |
| `dumbbell` | 1…10 by 1, then 12, 14, 16 … |
| `cable` / `machine` | 2.5…25 by 2.5, then 30, 35 … |
| `bodyweight` | none — weight stepper suppressed |
| `other` | `n×2.5` in the stepper; **not enforced** by the validator |

`other` means "equipment not classified", so the stepper needs a usable default (2.5) but `weightProblem()` must keep returning `null` for it as it does today — enforcing a ladder on an unclassified movement would produce false refusals.

Implemented as per-type segment tables:

```js
const WEIGHT_LADDER = {
  dumbbell: [[10, 1], [Infinity, 2]],       // [upperBound, stepBelowThatBound]
  cable:    [[25, 2.5], [Infinity, 5]],
  machine:  [[25, 2.5], [Infinity, 5]],
  landmine: [[Infinity, 1.25]],
  other:    [[Infinity, 2.5]],
  // plate-loaded types: base = resolved bar weight, single 2.5 segment above it
};
```

`nextWeight` works in "load above base" space (base = the bar for plate-loaded types, 0 otherwise), finds the segment containing the current load, and snaps to the segment boundary when a step would cross it.

**Boundary behaviour, as required:**

| Current | Direction | Result |
|---|---|---|
| DB 10 | up | 12 |
| DB 10 | down | 9 |
| DB 9 | up | 10 |
| Cable 25 | up | 30 |
| Cable 25 | down | 22.5 |
| Cable 22.5 | up | 25 |
| Trap bar 83 | up | 85.5 |

So 11 kg dumbbells and 27.5 kg cable settings do not exist, matching the gym.

### Call sites

1. **Session stepper bar** — `showStepper()` / the `pointerdown` handler ([app.js:1381-1411](../../../app.js)). The stepper resolves the exercise via the input's existing `data-ei` (`active.exercises[ei]`) to get `equipment` + `barWeight`. Buttons show the true, possibly asymmetric deltas — `−1` / `+2` at a 10 kg dumbbell. For `bodyweight`, the weight field gets no stepper at all (reps still do).
2. **Plan editor** weight input `step` attribute ([app.js:1211](../../../app.js)), recomputed when the equipment `<select>` changes (the existing `edit-equipment` bind at [app.js:2158](../../../app.js) already fires there).
3. **`weightProblem()`** in `tools/push-plan.mjs`, rewritten against the same ladder.
4. **`sports/CLAUDE.md`** ladder table.

### Accepted trade-offs

- **The ladder is duplicated** in `app.js` and `tools/push-plan.mjs`. `app.js` is a classic script (no `import`), and `push-plan.mjs` is Node ESM; there is no build step to share a module through. `BAR_DEFAULTS` is already duplicated the same way. Mitigation: `tools/weights.test.mjs` (below) asserts the two copies agree.
- **kg only.** In `lb` mode the stepper keeps today's flat step rather than inventing a pound ladder, and `push-plan.mjs` keeps its existing "unit is not kg, weights not checked" warning.

### Test

`tools/weights.test.mjs` — plain `node`, no dependencies, exits non-zero on failure:

- Every boundary case in the table above.
- Known-real logged weights pass: bench 77.5, trap bar 83 and 88, DB 22, cable 22.5.
- Known-bad weights fail: DB 22.5, trap bar 85, cable 27.5, bodyweight with weight ≠ 0.
- The `app.js` ladder and the `push-plan.mjs` ladder agree across a swept range per equipment type. `app.js` cannot be imported, so the test extracts the `WEIGHT_LADDER` table and `nextWeight` body from the file text and evaluates them in a `vm` sandbox. If that extraction ever fails, the test fails loudly rather than silently skipping.

---

## 2. Supersets

### Design

**Schema:** an optional `"superset": "A"` string on an exercise. A maximal run of *adjacent* exercises sharing the same tag is one group. Plans without the field behave exactly as today — no migration.

**Rest semantics — no new fields.** The existing rule at [app.js:1966](../../../app.js) already computes rest as "that exercise's own `restSeconds`, or `restSecondsNext` once the exercise is finished". Inside a group that yields the right thing for free: after an `A1` set → `A1.restSeconds` (the short transition), after an `A2` set → `A2.restSeconds` (the round rest).

The one required change: `restSecondsNext` currently triggers when *that exercise* is complete. For a group member it must wait until **every member of the group** is complete, otherwise A1 finishing its last round fires the next-movement rest while A2 still has a set left.

Which value fires then is stated explicitly, because with unequal set counts the last member to *finish* need not be the last member in plan order: use the **group's last member in plan order**, `restSecondsNext ?? restSeconds`. So a group's next-movement rest is authored on its final member, exactly as it would be for a lone exercise.

Rest labels become directional:

| Situation | Label |
|---|---|
| Another member has a set left in this round | `→ Seated Row` |
| Round complete, more rounds left | `Round 3 of 4` |
| Whole group complete | `Rest — next movement` |

**UI:** members render inside one card under a `Superset A` header, each keeping its own name line, equipment chip and `set-grid`. A "next up" highlight follows round-robin order (A1 r1 → A2 r1 → A1 r2 → …). The card collapses as a unit when the group finishes, replacing the per-exercise collapse for members.

This deliberately keeps the existing `set-grid` component rather than rebuilding it as a round-major table. Same logging flow, materially less risk.

**Unequal set counts** (A1 has 4, A2 has 3): rounds beyond a member's set count simply skip it. The round counter uses `max(sets)` across the group.

**Editing:** `exEditModal` gains a `Superset group` selector (None / A / B / C / D). Because members must be adjacent and the plan editor has no reordering, plan exercise rows gain **move up / move down** buttons — without them a superset cannot be assembled in-app at all.

**Validation:** `push-plan.mjs` errors on a superset tag appearing in two non-adjacent runs. In-app, a non-adjacent tag renders as two separate cards, which is visibly wrong and therefore self-reporting.

---

## 3. Equipment in the UI, and on alternates

### Design

**Alternates gain optional `equipment` and `barWeight`.** Omitted = inherit the parent's, so every existing plan is unaffected.

```json
"alternates": [
  { "name": "DB Bench", "weight": 30, "equipment": "dumbbell", "description": "…" }
]
```

Threaded through:

- The import sanitiser ([app.js:348](../../../app.js)) — currently strips both keys.
- `doPlanSwap` ([app.js:1250](../../../app.js)) — the demoted main exercise must carry *its own* `equipment`/`barWeight` down into `alternates`, or a swap-then-swap-back silently changes the equipment type.
- `doSessionSwap` ([app.js:1280](../../../app.js)) — applies the alternate's equipment to the live exercise.
- `sessionSwapModal`'s custom-typed exercise ([app.js:1271](../../../app.js)) gains an equipment `<select>` defaulting to the parent's. This is the "when changing exercise, allow to select the equipment" requirement.

**`equipChip(e)` helper** renders a compact label — `Cable`, `Trap bar · 23 kg`, `Bodyweight` — in three places: the active-session exercise card header, the Plan tab day rows, and beside each alternate in both swap sheets. Label only, no per-type glyphs.

**Two follow-on fixes this exposes:**

- `finishSession` ([app.js:410](../../../app.js)) currently **drops** `equipment` and `barWeight` from the saved session record. They get persisted, so history and the coaching skills can see what a weight was actually loaded on. This is a prerequisite for the skill updates in §6.
- `guessAlternateEquipment` in `push-plan.mjs` demotes to a fallback, used only when an alternate omits `equipment`. When an alternate declares it, the weight check becomes an error rather than an inference-based warning.

---

## 4. Rest timer sound

### Root cause

Two independent defects, both present in the code as written.

**(a) `unlockAudio` only resumes a `'suspended'` context** ([app.js:204](../../../app.js)). WebKit uses a non-standard `'interrupted'` state after a screen lock, an incoming call, or another app taking audio, and stays there. `beep()` then builds oscillators on a dead context and produces nothing, silently — every `catch (e) {}` in that path swallows the evidence. The Test button works because a user gesture makes WebKit auto-resume.

**(b) The cue is only ever triggered from `setInterval`** ([app.js:278](../../../app.js)). Nothing is scheduled on the audio clock, so any throttling or suspension of that loop loses the cue outright rather than delaying it.

### Fix

1. `unlockAudio()` resumes on **any** non-`'running'` state, not just `'suspended'`.
2. Also call it from the existing `visibilitychange → visible` handler ([app.js:238](../../../app.js)).
3. **Keep the context alive during an active session** with a near-silent looped buffer source (1-sample buffer, gain ~0.0001), started on a gesture and stopped when the session ends. This prevents idle suspension and keeps `currentTime` advancing so pre-scheduled events fire on time.
4. **Pre-schedule the cue.** `startRest()` is always reached from a tap, so schedule the three beeps at `audioCtx.currentTime + seconds` there. Node references live on `rest` so `adjustRest()` and `stopRest()` can cancel and reschedule.
5. The `setInterval` path keeps a **fallback** beep guarded by a `cueFired` flag (set from the scheduled oscillator's `onended`), so a lost scheduled cue still beeps late and a delivered one never double-beeps.
6. Settings → Test sound also reports `audioCtx.state`, so a silent timer says why it is silent instead of looking like a dead feature.

### Stated, not fixed

- **`navigator.vibrate` does not exist on iOS Safari.** The Vibrate toggle in Settings ([app.js:1143](../../../app.js)) currently does nothing on the target phone. It gets labelled as unsupported when `navigator.vibrate` is absent rather than presenting a working switch.
- **A locked screen still suspends Web Audio.** This fix covers foreground / screen-on, which is what was reported. The guaranteed answer for a locked screen is a notification or the native wrapper already in `ROADMAP.md` Phase 3. Explicitly out of scope here rather than half-built.

---

## 5. Jump height logging

### Design

**New optional exercise field `"metric"`**, one of `"load"` (default) or `"height"`. Orthogonal to `equipment` — a jump is `equipment: "bodyweight"` with `metric: "height"`.

**Set rows for a height-metric exercise** are `# | cm | ✓` — **one attempt per row**, matching the CMJ protocol (3 attempts, best logged). The set object is `{ heightCm, done }`; `weight`, `reps` and `rpe` are absent rather than zero, so nothing downstream mistakes a jump for a 0 kg lift. `+ Set` adds an attempt. The stepper steps `heightCm` by 0.5.

Height-metric cards also get a **Measure via video** button that drops the existing CMJ analyzer's result into the next empty attempt row, reusing the tool at [app.js:1422](../../../app.js).

### Three stats paths that must learn the metric

Without these, jumps corrupt existing numbers:

| Path | Change |
|---|---|
| `detectPRs` ([app.js:435](../../../app.js)) | PRs on max `heightCm`, not `est1RM(weight, reps)` — which would be `NaN` |
| `weeklyStats` volume ([app.js:966](../../../app.js)) | Skip height sets when summing `weight × reps`; still count them in the set total |
| `exerciseHistory` + chart ([app.js:918](../../../app.js)) | Plot best cm per session with a cm axis instead of e1RM |

`push-plan.mjs` skips the weight ladder for height-metric exercises and requires `weight` to be 0 or absent.

### Scope boundary

The pre-session **readiness** CMJ / broad-jump panel ([app.js:794](../../../app.js)) stays exactly as it is. It measures readiness under a standardised pre-session protocol; a jump-metric exercise measures training output. Conflating them would poison the fatigue signal (see §6).

**Formal re-tests** — including the August protocol — are logged as a normal session containing jump exercises. There is no separate standalone test log.

---

## 6. Coaching skill updates

The skills in `Tracking app/.claude/skills/` read the log and plan schemas directly, so §1, §3 and §5 change their inputs. `C:\Users\henri\.claude\skills\{session-feedback,weekly-review,shared}` are directory junctions to this path — editing here updates both views.

### `shared/schema-reference.md`

- **Session record:** add `equipment`, `barWeight`, `superset`, `metric` to the exercise object; document the height-metric set shape `{ heightCm }`; add `equipment`/`barWeight` to alternates.
- **Plan schema:** the example is missing `equipment`, `barWeight`, `restSecondsNext` and `targetRpe` notes even today — bring it level with the real schema and add `superset` and `metric`.
- **Plan Authoring Constraints §2:** the ladder is no longer one flat step per type; it has breakpoints. Point at `sports/CLAUDE.md` for the table and state the breakpoint rule explicitly, because "round to 2.5" is now wrong for dumbbells under 10 kg and stacks under 25 kg.
- **New constraint §3:** superset tags must form a single adjacent run.
- **New constraint §4:** alternates now carry their own `equipment` — set it rather than relying on the pushed-plan validator's name inference, which is a fallback and only warns.
- **Derived Metrics:** volume must exclude height-metric sets; add a `jumpBest` row.

### `weekly-review/SKILL.md`

- Lines 129–131: the auto-regulation table says `+2.5 kg` / `−2.5 kg`. Replace with **±1 rung on that exercise's ladder**, since +2.5 is unloadable on a dumbbell and on a stack above 25 kg.
- Line 139 ("Round every result to a loadable rung"): update to reference the breakpoint ladder.
- Line 137 already warns about splitting an exercise out of a superset and inventing a load. Extend it: creating or dissolving a superset changes the rest structure, not just the exercise list.
- Add height-metric exercises to Phase 0 inputs and to the progression rules: **you do not progress a jump by adding load.** Report the height trend and adjust volume or leave it alone.

### `weekly-review/schema-supplement.md`

- Plan Mutation Contract, line 52: `Exercise weights (± 2.5 kg)` → `± 1 rung on the ladder`.
- New rows: changing an exercise's `equipment` requires confirmation (it silently changes the loadability check and the plate calculator); creating or dissolving a superset requires confirmation (it is a restructuring); changing `metric` requires confirmation.
- Weekly aggregates: add a jump-height-from-training-sets aggregate, kept distinct from `cmjWeeklyDelta`.

### `weekly-review/periodization.md`

- §D treats CMJ as purely a readiness proxy. With §5 shipped, CMJ can arrive from two places with different meanings. State the rule: **`readiness.cmjCm` is the fatigue signal; in-session jump sets are training output and are not a clean readiness measure** (they are taken warm, fatigued, and unstandardised). Do not average them together or compare across sources.

### `session-feedback/SKILL.md` + `examples.md`

- Equipment is now in the session record: use it when reading a planned-vs-actual weight gap, since an unloadable planned weight looks exactly like auto-regulation (already documented as a signature in `schema-reference.md` — now checkable rather than inferred).
- Handle height-metric exercises: no RPE, no volume, no e1RM. Comment on attempt-to-attempt drop within the session and best-vs-history.
- Add one superset example to `examples.md`, since the rest structure changes how a fatigue read should be phrased.

---

## Staging

Five features is a lot for one deploy, and three of them touch the plan schema. The implementation plan should land them as separate commits, each with its own `CACHE` bump, in this order:

1. **Ladder** (§1) — self-contained, has a test, and de-risks everything else that writes a weight.
2. **Equipment UI + alternate equipment** (§3) — includes the `finishSession` persistence fix that §6 depends on.
3. **Timer audio** (§4) — fully independent; can be pulled forward if the silent timer is the most annoying item in practice.
4. **Jump logging** (§5) — touches three stats paths, so it wants a clean commit to bisect from.
5. **Supersets** (§2) — the largest UI change; last, on top of a settled schema.
6. **Skill updates** (§6) — after the schema is final, so the docs describe what shipped rather than what was planned.

## Files touched

| File | Change |
|---|---|
| `app.js` | All five features |
| `styles.css` | Superset card, equipment chip, jump set-grid column |
| `sw.js` | `CACHE` `gymtrack-v11` → `gymtrack-v12` |
| `tools/push-plan.mjs` | New ladder, superset adjacency check, alternate equipment, metric validation |
| `tools/weights.test.mjs` | New |
| `sports/CLAUDE.md` | Ladder table, plan schema, superset + metric rules |
| `Tracking app/README.md` | Same schema additions |
| `.claude/skills/**` | Per §6 |

`index.html` is unchanged — no new top-level shell elements are needed.

The `CACHE` bump is mandatory and must land in the same commit: without it no service worker installs, no update banner appears, and the phone keeps serving v11 while the deploy looks successful.

## Verification

1. `node tools/weights.test.mjs` — ladder correctness and app/validator agreement.
2. `node tools/push-plan.mjs` against a deliberately broken plan (non-adjacent superset, 22.5 kg dumbbell, 27.5 kg cable, jump exercise with a weight) — must refuse, listing each.
3. `python -m http.server 8765` + browser preview: walk a superset round-by-round confirming rest labels and durations; confirm chips render in all three places; confirm the swap sheet's equipment selector; log a jump exercise and check history plots cm; confirm the weight stepper shows `−1`/`+2` at a 10 kg dumbbell.
4. Rest cue: start a rest, confirm the beep is pre-scheduled (fires on time with the tab foregrounded), then background and refocus the tab mid-rest and confirm it still fires exactly once.

## Out of scope

- Locked-screen / backgrounded audio (needs notifications or the Phase 3 native wrapper).
- A pound-denominated ladder for `lb` mode.
- A standalone test log separate from sessions.
- Reordering exercises across days, or drag-to-reorder — only move up/down within a day, which is what supersets require.
