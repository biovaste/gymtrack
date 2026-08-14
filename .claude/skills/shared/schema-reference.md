# Schema Reference — GymTrack Skills (Shared)

## GymTrack Claude Export Format (`workout-log`)

The primary input format produced by the app's "Copy coaching prompt + data" button.

```json
{
  "type": "workout-log",
  "version": 1,
  "exportedAt": "ISO 8601 timestamp",
  "unit": "kg",
  "bodyWeight": [
    { "date": "YYYY-MM-DD", "weight": 82.5 }
  ],
  "sessions": [ /* last 15 sessions, newest first */ ],
  "currentPlan": { /* see plan schema below */ }
}
```

---

## Session Record

```json
{
  "id": "uid",
  "date": "ISO 8601 timestamp",
  "dayName": "Day A — Lower + Bench",
  "durationMin": 47,
  "notes": "Slept 5h, felt flat.",
  "readiness": {
    "cmjCm": 29.2,
    "broadJumpCm": 185.0,
    "subjectiveEnergy": 7,
    "method": "video",
    "flightTimeMs": 488,
    "cmjAttempts": [
      { "heightCm": 29.2, "flightTimeMs": 488, "effectiveFps": 240, "precisionCm": 0.3 },
      { "heightCm": 28.1, "flightTimeMs": 479, "effectiveFps": 240, "precisionCm": 0.3 }
    ]
  },
  "exercises": [
    {
      "name": "Bench Press",
      "plannedSets": 4,
      "plannedReps": "6-8",
      "plannedWeight": 80,
      "targetRpe": 8,
      "equipment": "barbell",
      "barWeight": 20,
      "metric": "load",
      "superset": null,
      "swappedFrom": null,
      "notes": "Slight shoulder discomfort set 3 — manageable",
      "sets": [
        { "weight": 82.5, "reps": 7, "rpe": 7 },
        { "weight": 82.5, "reps": 8, "rpe": 7 },
        { "weight": 82.5, "reps": 7, "rpe": 8 },
        { "weight": 82.5, "reps": 6, "rpe": 8 }
      ]
    },
    {
      "name": "Box Jump",
      "plannedSets": 3,
      "equipment": "bodyweight",
      "metric": "height",
      "sets": [
        { "heightCm": 31.4 },
        { "heightCm": 30.8 },
        { "heightCm": 29.1 }
      ]
    }
  ]
}
```

### Field Notes

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `readiness` | object | No | Full block optional; any sub-field can be absent |
| `readiness.cmjCm` | number | No | Countermovement jump in cm — primary neuromuscular readiness signal. **Best** attempt when `cmjAttempts` is present |
| `readiness.broadJumpCm` | number | No | Broad jump in cm |
| `readiness.subjectiveEnergy` | 1–10 | No | Self-reported readiness at session start |
| `readiness.method` | `"video"` | No | Present only when measured with the in-app video tool. Absent = hand-entered |
| `readiness.flightTimeMs` | number | No | Flight time of the best attempt. Video method only |
| `readiness.cmjAttempts` | array | No | One entry per jump measured in that session, in the order taken. Video method only |
| `cmjAttempts[].effectiveFps` | number | No | Real-time sampling rate = file frame rate × slow-motion factor (an 8× clip at 24 fps gives 192). **Below 60 the measurement is only ±2–5 cm** — don't read trends into differences smaller than `precisionCm` |
| `cmjAttempts[].precisionCm` | number | No | Half-frame timing residual in cm. The measurement's error bar |
| `plannedSets` | number | No | Required for `completionRate`. Absent in sessions from non-app data |
| `plannedReps` | string | No | Range string e.g. `"6-8"`. Parse lower bound for comparisons |
| `plannedWeight` | number | No | In same unit as `settings.unit` |
| `targetRpe` | number | No | 1–10 |
| `swappedFrom` | string \| null | No | Original exercise name if a swap occurred |
| `durationMin` | number | No | Total session wall-clock time |
| `equipment` | string | No | One of `barbell`, `trap-bar`, `landmine`, `training-bar`, `dumbbell`, `machine`, `cable`, `bodyweight`, `other`. **In practice this field is never actually absent** — `app.js` stamps `'barbell'` on any exercise whose plan never declared one (both on import, in `normalizePlan`, and again when a session starts). So a `barbell` value doesn't mean "confirmed barbell" — it may just mean "nobody said." A `barbell` label on a weight under ~20 kg (its own empty-bar weight) is almost certainly an undeclared dumbbell, cable or machine move wearing the fallback. Treat that combination as unknown equipment, not as a real barbell |
| `barWeight` | number | No | Only meaningful for `barbell`/`trap-bar`/`training-bar`. Absent = the gym default (20 / 23 / 10 kg) |
| `metric` | `"load"` \| `"height"` | No | Absent = `"load"`. A `"height"` exercise's sets carry **only** `heightCm` — no weight, reps or RPE. Never compute volume, e1RM or RPE stats from them |
| `superset` | string \| null | No | Adjacent exercises sharing a tag were performed as an alternating superset. Relevant to fatigue reads: RPE on the second movement is inflated by the first |
| `sets[].heightCm` | number | No | One jump attempt, in cm. `"height"` metric only |
| `sets[].warmup` | `true` | No | **Present only when true.** A ramp-up set, not a working set. See below |
| `warmup` | object | No | `{ total, done }` — the day's general warm-up checklist (bike, bands, mobility), present only when the plan day defined one. Not sets, and never part of volume |

### Warm-up sets — exclude them from every statistic

A set carrying `"warmup": true` was a ramp-up on the way to the working weight. It is real logged data, but it must be **excluded from every derived metric**:

- **volume / tonnage** — a 60 kg × 5 ramp before a 120 kg top set would inflate the number and understate average intensity
- **e1RM and PR detection** — a ramp-up set can never be a PR
- **RPE trends and `rpeEscalation`** — warm-up rows usually carry no RPE at all (`rpe: null`), and a low one where present is not a fatigue signal
- **`velocityLossAnalogue`** — the first-vs-last comparison must run over working sets only, or the ramp makes every exercise look like it got *stronger* across the session
- **set counts** in weekly volume reads

The app already applies this everywhere it computes something. When reading raw JSON yourself, filter first: `sets.filter(s => !s.warmup)`.

Absence of the field means a working set. Records written before 2026-08-14 have no warm-up sets marked at all — in those, a light first set may well have been a warm-up, but there is no way to know, so treat them all as working sets rather than guessing.

---

## Plan Schema (`workout-plan`)

The plan embedded in a `workout-log` export (`currentPlan`) and the format for import/push.

```json
{
  "type": "workout-plan",
  "version": 1,
  "name": "Block name",
  "createdAt": "YYYY-MM-DD",
  "days": [
    {
      "id": "uid",
      "name": "Day A — Lower + Bench",
      "warmup": [
        { "name": "Bike", "detail": "5 min easy" },
        { "name": "Band pull-apart × 20", "detail": "" }
      ],
      "exercises": [
        {
          "id": "uid",
          "name": "Bench Press",
          "sets": 4,
          "warmupSets": 2,
          "reps": "6-8",
          "weight": 80,
          "targetRpe": 8,
          "restSeconds": 150,
          "restSecondsNext": 210,
          "equipment": "barbell",
          "barWeight": 20,
          "metric": "load",
          "superset": null,
          "description": "Short coaching cue",
          "notes": "",
          "alternates": [
            { "name": "DB Bench", "weight": 30, "equipment": "dumbbell", "description": "…" }
          ]
        }
      ]
    }
  ]
}
```

**Normalization:** Missing `id` fields are auto-generated by the app on import. Missing `createdAt` defaults to today.

**`warmupSets`** (optional, default 0) prepends that many ramp rows ahead of the working sets. `sets` keeps meaning **working** sets, so adding warm-ups never changes the prescription. The app seeds each rung from the working weight (1 → 60%; 2 → 50/75%; 3 → 40/60/80%; 4+ spread 40–85%) and rounds **down** onto the real loadable ladder, so every seeded weight exists at the gym. All of it is editable in-session, and any row can be flipped between warm-up and working by tapping its number. Completing a warm-up set starts **no rest timer**. A `height`-metric exercise cannot carry `warmupSets` — there is no load to ramp.

**`days[].warmup`** (optional) is the day's general prep checklist — an array of `{ name, detail }` objects, or bare strings. It renders as a checklist in the session, not as logged sets, and the session record keeps only `{ total, done }`.

---

## Plan Authoring Constraints

Two constraints on any plan written for the app. Both have already reached the phone broken, and both are now enforced by `tools/push-plan.mjs`, which refuses to push a plan that violates them.

### 1. Exercise names must be unique across the entire plan

Exercise history, "last time" lookups and the `aliases` map are keyed on the exercise **name globally** — not per day. Two different movements sharing a name silently merge into one progression history, so their loads and RPEs get compared against each other.

*What this looked like in practice:* `Cable Triceps Extension` sat on both Day A (single-arm, 20 kg) and Day B (two-arm, 40 kg). One name, two movements, one polluted history — and auto-regulation reading a 20 → 40 kg jump as progress.

Disambiguate in the name itself: `… — Single-Arm` / `… — Two-Arm`, `Incline …`, `… (Paused)`.

**Renaming an exercise orphans its history.** When you rename, add an `aliases` entry — `{ "old name lowercased": "New Canonical Name" }` — so past sessions still resolve. Where one old name covers two movements, alias it to whichever has the most history and relabel the minority's session records so each lands on the right canonical name.

### 2. Every weight must be loadable on the actual equipment

Set `equipment` accurately **first** — the weight check depends on it, and it also drives the stepper's increments, whether the plate calculator appears, and whether the weight field is grayed. A cable exercise mislabelled `barbell` defeats all of it.

**The ladder has breakpoints — "round to the nearest 2.5 kg" is wrong.** Dumbbells step 1 kg below 10 kg and 2 kg above it; cable and machine stacks step 2.5 kg below 25 kg and 5 kg above it. So 22.5 kg is a valid cable weight but not a valid dumbbell, and 27.5 kg is neither. The authoritative table is in the project's CLAUDE.md, and `tools/weights.test.mjs` is its executable form.

*Signature of this bug in the data:* a `plannedWeight` the athlete never logs, with a nearby value logged instead — planned 22.5 kg → logged 22 kg, twice. Since 2026-07-30 session records carry `equipment`, so this is now **checkable** rather than inferable: compare the planned weight against that equipment's ladder before reading a planned-vs-actual gap as auto-regulation. But `equipment` being *present* doesn't mean it was *declared* — see the field note above. Before trusting the comparison, sanity-check a `barbell` entry against its own weight: a "barbell" load under ~20 kg is the stamped default, not a fact, and belongs in the unknown bucket rather than fed into the barbell ladder.

### 3. Superset members must be adjacent

Exercises sharing a `superset` tag must sit next to each other in `days[].exercises`. A tag split across non-adjacent runs renders as two separate cards with independent rest cycles, and `tools/push-plan.mjs` rejects it.

Rest inside a group uses the existing fields, with no additions: each member's own `restSeconds` is the rest taken *after its own set*, and `restSecondsNext` on the group's **last member in plan order** is the rest after the final round. So a 15 s transition and a 90 s round rest on an A1/A2 pair means `A1.restSeconds = 15`, `A2.restSeconds = 90`.

### 4. Alternates carry their own equipment

An `alternate` may set `equipment` and `barWeight`; omitting them means "same as the parent". **Set them whenever the alternate differs from the parent** — a dumbbell alternate under a barbell exercise, say. When absent, `push-plan.mjs` falls back to guessing the equipment from the exercise name and downgrades the weight check to a warning, so an unloadable alternate weight can slip through.

---

## Full Backup Schema (`gymtrack-backup`)

What the Cloudflare Worker stores and returns on `GET /data/:uuid`.

```json
{
  "type": "gymtrack-backup",
  "version": 1,
  "exportedAt": "ISO 8601 timestamp",
  "updatedAt": 1719563400000,
  "plan": { /* workout-plan */ },
  "sessions": [ /* all sessions, newest first */ ],
  "bodyWeight": [ /* all entries */ ],
  "settings": { "unit": "kg", "sound": true, "vibrate": true }
}
```

---

## Confidence Tiers

| Tier | Conditions |
|------|-----------|
| **High** | All four: `plannedSets`, `rpe` on all sets, either structured `readiness` values or explicit notes, `swappedFrom` where applicable |
| **Medium** | Missing one of the above — most commonly RPE on some sets, or no readiness data |
| **Low** | Only `sets[].weight` and `sets[].reps`. No RPE, no notes, no plan context |

---

## Derived Metrics (Single Session)

Computed at analysis time — not stored in the JSON.

| Metric | Formula | Notes |
|--------|---------|-------|
| `completionRate` | `actual_sets / plannedSets` per exercise, averaged across session | Skip if `plannedSets` absent. Skip height-metric exercises |
| `velocityLossAnalogue` | `(first_set_reps − last_set_reps) / first_set_reps` at matched weight | See `science-reference.md §B`. Skip height-metric exercises — no reps |
| `rpeEscalation` | `last_set_rpe − first_set_rpe` at same or increasing load | Requires RPE on all sets. Skip height-metric exercises — no RPE |
| `neuromuscularFatigueIndex` | VLA > 0.20 OR rpeEscalation ≥ 1.5 → High; else derived from magnitude | |
| `cmjDelta` | `current_cmjCm − previous_session_cmjCm` | Requires readiness block in both sessions |
| `bwTrend` | `(latest_bw − mean_of_7d_bw) / mean_of_7d_bw` | Context modifier only |
| `jumpBest` | `max(sets[].heightCm)` per `"height"` exercise per session | Training output, **not** a readiness signal — see `periodization.md §D` |

---

## Generic / Non-App Data

When the input is not `type: "workout-log"`, the skill works with any structured gym session data containing at minimum:

```
Exercise name + sets array with weight and reps
```

RPE and notes are optional but unlock Medium/High confidence. All `planned*` fields are optional — their absence triggers graceful degradation.

---

## Worker API Endpoints

**Base URL:** `https://api.gymtrack.hithitpull.fi`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/data/:uuid` | GET | Fetch full backup |
| `/data/:uuid` | POST | Write full backup |
| `/data/:uuid/plan` | POST | Safe plan-only update (preserves sessions + BW) |

**Plan-only update** (`POST /data/:uuid/plan`) is the preferred path when only the plan changes — it fetches the existing backup, replaces `plan`, updates `updatedAt`, and writes back. Sessions and body weight are never touched.
