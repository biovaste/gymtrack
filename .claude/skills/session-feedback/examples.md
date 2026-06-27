# Examples — Session Feedback Skill

## Test Case: French Contrast Session (Power Block)

### Input Data

```json
{
  "type": "workout-log",
  "unit": "kg",
  "bodyWeight": [
    { "date": "2026-06-27", "weight": 84.1 },
    { "date": "2026-06-26", "weight": 84.0 },
    { "date": "2026-06-25", "weight": 84.3 }
  ],
  "sessions": [
    {
      "date": "2026-06-27T10:00:00.000Z",
      "dayName": "Power Complex",
      "durationMin": 102,
      "notes": "Need 5 min between french contrast rotations to recover",
      "readiness": { "cmjCm": 29.2 },
      "exercises": [
        {
          "name": "Box Squat",
          "plannedSets": 4,
          "plannedReps": "3",
          "plannedWeight": 120,
          "targetRpe": 8,
          "swappedFrom": null,
          "notes": "",
          "sets": [
            { "weight": 120, "reps": 3, "rpe": 8 },
            { "weight": 120, "reps": 3, "rpe": 8 },
            { "weight": 120, "reps": 3, "rpe": 8 },
            { "weight": 120, "reps": 3, "rpe": 8 }
          ]
        },
        {
          "name": "Kettlebell Jump",
          "plannedSets": 4,
          "plannedReps": "5",
          "plannedWeight": 48,
          "targetRpe": null,
          "swappedFrom": null,
          "notes": "",
          "sets": [
            { "weight": 48, "reps": 5, "rpe": null },
            { "weight": 48, "reps": 5, "rpe": null },
            { "weight": 48, "reps": 5, "rpe": null },
            { "weight": 48, "reps": 5, "rpe": null }
          ]
        }
      ]
    },
    {
      "date": "2026-06-25T09:00:00.000Z",
      "dayName": "Power Complex",
      "durationMin": 85,
      "notes": "Front squat position caused too much elbow pain — swapped",
      "readiness": { "cmjCm": 28.3 },
      "exercises": [
        {
          "name": "Box Squat",
          "plannedSets": 4,
          "plannedReps": "3",
          "plannedWeight": 120,
          "targetRpe": 8,
          "swappedFrom": "Front Squat",
          "notes": "Elbow hurt too much in front squat position — used box squat instead",
          "sets": [
            { "weight": 120, "reps": 3, "rpe": 8 },
            { "weight": 120, "reps": 3, "rpe": 8 },
            { "weight": 120, "reps": 3, "rpe": 8 },
            { "weight": 120, "reps": 3, "rpe": 8 }
          ]
        }
      ]
    }
  ]
}
```

---

### Processing Path (June 27 Session)

**Step 1 — STaR Pain Check**

Scan all notes strings for the current session (June 27):
- `sessions[0].notes`: "Need 5 min between french contrast rotations to recover" — no pain keywords
- `sessions[0].exercises[0].notes`: empty
- `sessions[0].exercises[1].notes`: empty

Cross-session check: June 25 exercise notes contain "Elbow hurt too much in front squat position." The June 27 Box Squat has `swappedFrom: null` — the athlete loaded the intended movement with zero pain flags. Prior Load-Tolerance flag → **Managed/Autoregulated in prior session, no active flag in current session.**

**Step 2 — Completeness Check**

- `plannedSets` present: ✓
- RPE logged: Box Squat ✓, Kettlebell Jump null (power exercise, no RPE expected) — acceptable
- `readiness.cmjCm`: present ✓
- Confidence: **High**

**Step 3 — Completion Rate**

Box Squat: 4/4 sets ✓ | Kettlebell Jump: 4/4 sets ✓ | `completionRate = 1.0`

**Step 4 — Velocity Loss Analogue**

Box Squat (matched weight 120 kg): First set reps = 3, Last set reps = 3. VLA = 0/3 = **0.0**. No fatigue flag.
RPE Escalation: 8 → 8 → 8 → 8. No escalation.

Neuromuscular Fatigue Index: **Low**

**Step 5 — CMJ Delta**

`cmjDelta = 29.2 − 28.3 = +0.9 cm (+3.2%)`

Positive neuromuscular recovery signal. Priority 4 triggered.

**Step 6 — Duration Check**

Expected rest per contrast rotation: 5 min (athlete-noted). 4 rotations × ~5 min rest + ~2 min per rotation work = ~28 min base + context. 102 min is long but consistent with stated rest protocol. **No additional fatigue flag.**

**Step 7 — Body Weight**

BW trend: 84.3 → 84.0 → 84.1. Negligible fluctuation. No energy-deficit modifier applied.

**Step 8 — Signal Priority**

Active signals by priority:
1. Mechanical safety: none
2. High neuromuscular fatigue: none
3. Unmanaged load-tolerance: none
4. Performance stability / CMJ positive: **active** ← surfaces here
5. Progression opportunity: none needed

---

### Output

```
SESSION RESULT: 100% completion of the power complex with objective verification of elevated explosive output.

KEY POSITIVE: True neuromuscular recovery confirmed: opening CMJ climbed from 28.3 cm to 29.2 cm compared to last session.

KEY LIMITER: Session ran to 102 minutes — the 5-minute full-recovery intervals between contrast sets are working but extend the total training window.

NEXT ACTION: Hold the 48 kg kettlebell loading on jumps; preserve ground-contact speed while your explosive metrics are trending up.

CONFIDENCE: High.
```

*Word count: 85 words. Within 50–100 target.*

---

## Test Case: Partial Session with Pain Cutoff

### Setup

User completes 2 of 5 planned exercises. Exercise 2 notes say: "sharp pain in right shoulder — stopped immediately."

### Processing Path

**Step 1 — STaR:** "sharp pain" → Tier 1 Mechanical flag. Immediate escalation to Priority 1.

**Step 2 — Completion rate:** 2/5 = 40% → would trigger Partial Session branch, but Priority 1 pre-empts it.

**Step 3 — Skip all other metric computation.**

### Output

```
SESSION RESULT: Session cut short at exercise 2 due to a mechanical pain signal in the right shoulder.

KEY POSITIVE: [suppressed — safety flag active]

KEY LIMITER: Sharp shoulder pain is a Tier 1 signal. Do not push through or attempt to reproduce it.

NEXT ACTION: Rest today. If pain persists beyond 24 hours or recurs on first rep of next attempt, consult a sports physio before returning to pressing movements.

CONFIDENCE: High — signal is unambiguous.
```

---

## Test Case: Generic / Non-App Data (Low Confidence)

### Input

```
Leg day:
- Squat: 4×5 @ 100kg
- Romanian Deadlift: 3×8 @ 70kg
- Leg Press: 3×12 @ 150kg
```

No RPE, no notes, no plan context.

### Processing Path

- No structured JSON — parse as plain text
- No pain keywords detected
- No RPE → cannot compute RPE escalation
- No planned targets → cannot compute completionRate or VLA
- No readiness data → no CMJ signal
- Confidence: **Low**

### Output

```
SESSION RESULT: Solid lower-body volume session logged — squat, RDL, leg press all completed.

KEY POSITIVE: No pain or distress signals noted.

KEY LIMITER: No RPE or effort data available — cannot assess fatigue, proximity to failure, or readiness for progression.

NEXT ACTION: Log RPE (1–10) on your next session to unlock fatigue and progression tracking.

CONFIDENCE: Low — effort and comparison data absent.
```
