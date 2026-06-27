# Schema Reference — Session Feedback Skill

## GymTrack Claude Export Format

The skill accepts the `workout-log` JSON produced by the app's "Copy raw data" button, or any structurally compatible gym session data.

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
  "dayName": "Day A — Push",
  "durationMin": 47,
  "notes": "Slept 5h, felt flat. Left elbow okay.",
  "readiness": {
    "cmjCm": 29.2,
    "broadJumpCm": 185.0,
    "subjectiveEnergy": 7
  },
  "exercises": [
    {
      "name": "Bench Press",
      "plannedSets": 4,
      "plannedReps": "6-8",
      "plannedWeight": 80,
      "targetRpe": 8,
      "swappedFrom": null,
      "notes": "Slight shoulder discomfort set 3 — manageable",
      "sets": [
        { "weight": 82.5, "reps": 7, "rpe": 7 },
        { "weight": 82.5, "reps": 8, "rpe": 7 },
        { "weight": 82.5, "reps": 7, "rpe": 8 },
        { "weight": 82.5, "reps": 6, "rpe": 8 }
      ]
    }
  ]
}
```

### Field Notes

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `readiness` | object | No | Full block optional; any sub-field can be absent |
| `readiness.cmjCm` | number | No | Structured CMJ in cm. Enables High-confidence neuromuscular signal |
| `readiness.broadJumpCm` | number | No | Structured broad jump in cm |
| `readiness.subjectiveEnergy` | 1–10 | No | Self-reported readiness at session start |
| `plannedSets` | number | No | Required for `completionRate`. Absent in sessions logged before schema v2 or from non-app data |
| `plannedReps` | string | No | Range string e.g. `"6-8"`. Parse lower bound for comparisons |
| `plannedWeight` | number | No | In same unit as `settings.unit` |
| `targetRpe` | number | No | 1–10 |
| `swappedFrom` | string \| null | No | Original exercise name if a swap occurred |
| `durationMin` | number | No | Total session wall-clock time |

---

## Plan Schema (currentPlan)

```json
{
  "type": "workout-plan",
  "version": 1,
  "name": "Block name",
  "days": [
    {
      "name": "Day A — Push",
      "exercises": [
        {
          "name": "Bench Press",
          "sets": 4,
          "reps": "6-8",
          "weight": 80,
          "targetRpe": 8,
          "restSeconds": 150,
          "description": "Short coaching cue",
          "alternates": [
            { "name": "DB Bench", "weight": 30, "description": "…" }
          ]
        }
      ]
    }
  ]
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

## Derived Metrics

Computed at analysis time — not stored in the JSON.

| Metric | Formula | Notes |
|--------|---------|-------|
| `completionRate` | `actual_sets / plannedSets` per exercise, averaged across session | Skip if `plannedSets` absent |
| `velocityLossAnalogue` | `(first_set_reps − last_set_reps) / first_set_reps` at matched weight | See `science-reference.md §B` |
| `rpeEscalation` | `last_set_rpe − first_set_rpe` at same or increasing load | Requires RPE on all sets |
| `neuromuscularFatigueIndex` | VLA > 0.20 OR rpeEscalation ≥ 1.5 → High; else derived from magnitude | |
| `cmjDelta` | `current_cmjCm − previous_session_cmjCm` | Requires readiness block in both sessions |
| `bwTrend` | `(latest_bw − mean_of_7d_bw) / mean_of_7d_bw` | Context modifier only |

---

## Generic / Non-App Data

When the input is not `type: "workout-log"`, the skill works with any structured gym session data containing at minimum:

```
Exercise name + sets array with weight and reps
```

RPE and notes are optional but unlock Medium/High confidence. All `planned*` fields are optional — their absence triggers graceful degradation (skip completionRate and VLA, move to Medium confidence).
