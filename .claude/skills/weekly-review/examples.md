# Examples — Weekly Review Skill

Two worked examples showing the full processing path.

---

## Example 1 — Typical progression week (3-session flex model)

### Input Data

```json
{
  "type": "workout-log",
  "unit": "kg",
  "bodyWeight": [
    { "date": "2026-06-28", "weight": 95.2 },
    { "date": "2026-06-27", "weight": 95.0 },
    { "date": "2026-06-26", "weight": 95.5 },
    { "date": "2026-06-25", "weight": 95.1 },
    { "date": "2026-06-23", "weight": 95.4 }
  ],
  "sessions": [
    {
      "date": "2026-06-27T10:00:00.000Z",
      "dayName": "Day C — Power / French Contrast",
      "durationMin": 65,
      "notes": "Felt powerful. Contrast complex was clean.",
      "readiness": { "cmjCm": 32.1, "subjectiveEnergy": 8 },
      "exercises": [
        {
          "name": "Box Squat",
          "plannedSets": 4, "plannedReps": "3", "plannedWeight": 120,
          "targetRpe": 8, "swappedFrom": null, "notes": "",
          "sets": [
            { "weight": 120, "reps": 3, "rpe": 8 },
            { "weight": 120, "reps": 3, "rpe": 8 },
            { "weight": 120, "reps": 3, "rpe": 8 },
            { "weight": 120, "reps": 3, "rpe": 8 }
          ]
        }
      ]
    },
    {
      "date": "2026-06-25T09:30:00.000Z",
      "dayName": "Day B — Upper + Power",
      "durationMin": 58,
      "notes": "",
      "readiness": { "cmjCm": 31.5, "subjectiveEnergy": 7 },
      "exercises": [
        {
          "name": "Bench Press (Close-Grip)",
          "plannedSets": 4, "plannedReps": "6", "plannedWeight": 60,
          "targetRpe": 7, "swappedFrom": null, "notes": "",
          "sets": [
            { "weight": 60, "reps": 6, "rpe": 7 },
            { "weight": 60, "reps": 6, "rpe": 6 },
            { "weight": 60, "reps": 6, "rpe": 7 },
            { "weight": 60, "reps": 6, "rpe": 7 }
          ]
        }
      ]
    },
    {
      "date": "2026-06-22T08:00:00.000Z",
      "dayName": "Day A — Lower + Bench",
      "durationMin": 62,
      "notes": "Good squat session. Bench felt a bit heavier than expected.",
      "readiness": { "cmjCm": 31.0, "subjectiveEnergy": 7 },
      "exercises": [
        {
          "name": "Back Squat",
          "plannedSets": 5, "plannedReps": "3", "plannedWeight": 120,
          "targetRpe": 7, "swappedFrom": null, "notes": "",
          "sets": [
            { "weight": 120, "reps": 3, "rpe": 7 },
            { "weight": 120, "reps": 3, "rpe": 7 },
            { "weight": 120, "reps": 3, "rpe": 8 },
            { "weight": 120, "reps": 3, "rpe": 8 },
            { "weight": 120, "reps": 3, "rpe": 8 }
          ]
        },
        {
          "name": "Bench Press",
          "plannedSets": 4, "plannedReps": "4", "plannedWeight": 65,
          "targetRpe": 7, "swappedFrom": null, "notes": "",
          "sets": [
            { "weight": 65, "reps": 4, "rpe": 8 },
            { "weight": 65, "reps": 4, "rpe": 8 },
            { "weight": 65, "reps": 4, "rpe": 8 },
            { "weight": 65, "reps": 4, "rpe": 9 }
          ]
        }
      ]
    }
  ]
}
```

### User Response to Phase 3 Questions

> 3 gym sessions next week. Cheer on Tuesday (stunting, 2.5 h) and Thursday (light conditioning, 1 h). Bike commute both days. No other constraints. Energy today 7/10, soreness 4/10. Nothing to flag from last week.

---

### Processing Path

**Phase 0 — Context**
- Phase training plan found: `Physical Training/phase2-training-plan.md` — flex model A → B → C → D; main lifts: Back Squat (progression scheme) and Bench Press.
- Physical constraint from memory: elbow flag on pressing and hinge movements.
- Readiness signals tracked: CMJ, subjective energy.

**Phase 1 — Ingestion**
- 3 sessions in the last 7 days: Day A (Mon Jun 22), Day B (Wed Jun 25), Day C (Sat Jun 27).
- Body weight: stable, 95.0–95.5 kg range.

**Phase 2 — Analysis**

*Adherence:* 3/3 planned sessions done → 100%. ✓

*Back Squat RPE (Day A):*
Last set RPE = 8, target = 7 → RPE escalation +1.0 at the borderline. Check VLA:
- Set 1 reps = 3, Set 5 reps = 3. VLA = 0/3 = 0. Stable.
- RPE crept from 7 to 8 across the set, but VLA is 0. Interpretation: neuromuscular output was maintained but the lifter had to work harder on the later sets. Treat as RPE > target by ~0.5 at the margin → hold weight (not reduce).

*Bench Press RPE (Day A):*
Sets 1–4 RPE = 8, 8, 8, 9. Target = 7. RPE > target by +1.0–+2.0 → this is above target. Action: hold weight or reduce. VLA = 0 (all sets at 4 reps). Hold weight at 65 kg; the last set at RPE 9 signals we are close to the ceiling at this rep scheme.

*Bench Press (Close-Grip) RPE (Day B):*
Sets at RPE 7, 6, 7, 7. Target = 7. RPE at target or 1 below. Action: same weight; can add reps toward upper end.

*Box Squat RPE (Day C):*
Sets at RPE 8, 8, 8, 8. Target = 8. Exactly on target. Action: hold weight.

*CMJ trend:* 31.0 → 31.5 → 32.1 cm. Trend = +1.1 cm (positive). No fatigue signal. ✓

*STaR scan:* No pain keywords in any session notes. ✓

*LAST WEEK block:*
▸ 3/3 sessions, 100% completion — clean adherence week
▸ CMJ climbed 31.0 → 32.1 cm across the week — positive neuromuscular trend
▸ Bench Press ran RPE 8–9 against a target of 7 — slightly over on Day A; hold at 65 kg next week
▸ Elbow: no pain flags logged — continue monitoring per session

**Phase 4 — Plan Generation**

*Day assignment (3 sessions):* A + B + C, strict priority order.
*Cheer:* Tuesday = stunting (high demand); Thursday = light conditioning (low demand).
*Constraints:* No heavy leg session within 24 h before Tuesday stunting or after it. Day C (leg-heavy) cannot go Monday or Wednesday.

Schedule:
- **Mon Jun 29** → Gym A (not adjacent to Tue stunt; 48h+ from Sat Day C) ✓
- **Tue Jul 1** → Cheer (stunting 2.5 h) + bike commute (Z2, free)
- **Wed Jul 2** → Gym B (upper-focused; no leg conflict) ✓
- **Thu Jul 3** → Cheer (light conditioning 1 h) + bike commute
- **Fri Jul 4** → Rest
- **Sat Jul 5** → Gym C (48h from Wed B; fresh legs for power)
- **Sun Jul 6** → Optional easy Z2

Spacing: A→B = 48h ✓, B→C = 72h ✓, Day C → Tue stunt = 5 days ✓

*Progression:*
- Back Squat: was RPE 7–8 at 120 kg. End-of-session RPE crept to 8, at the margin. Hold: **120 kg**. Target RPE 7 on first two sets; note if it drops to allow 2.5 kg jump next week.
- Bench Press (Day A): RPE 8–9 vs. target 7 → hold: **65 kg**.
- Bench Close-Grip (Day B): RPE 6–7 vs. target 7 → within range; **60 kg**, target 6 reps all sets cleanly.
- Box Squat (Day C): RPE exactly 8 on target → **120 kg**, same load.

---

### Output

```
WEEK OF 29 Jun – 5 Jul 2026

LAST WEEK SUMMARY
▸ 3/3 sessions complete — clean adherence, all sets logged
▸ CMJ 31.0 → 32.1 cm (+1.1 cm across the week) — positive neuromuscular trend
▸ Bench Press ran RPE 8–9 vs. target 7 on Day A — slightly overloaded; hold 65 kg next week
▸ Elbow: no pain flags logged this week ✓

NEXT WEEK PLAN
Mon 29 — Gym Day A (Lower + Bench)
  Back Squat: 5×3 @ 120 kg, RPE 7 target, 180s rest
  CMJ/Box Jump contrast: 3×3, BW, 90s rest
  Bench Press: 4×4 @ 65 kg, RPE 7–8, 150s rest  [hold — RPE was high last week]
  Trap Bar RDL: 3×8 @ 80 kg, RPE 7, 120s rest
  Lat Pulldown ⟂ Triceps + Curl: 3×8–12, 75–60s

Tue 1 — Cheer (stunting 2.5 h) + bike commute Z2

Wed 2 — Gym Day B (Upper + Power)
  Bench Press Close-Grip: 4×6 @ 60 kg, RPE 7, 120s rest
  Front/Pause Squat: 3×4 @ 70 kg, RPE 7, 150s rest
  Box/Broad Jump: 4×4 BW, quality over fatigue, 90s rest
  Landmine Press: 3×8 @ 30 kg, RPE 7, 90s rest
  Row + Face Pull ⟂ Triceps + Curl: 3×10–12, 75–60s

Thu 3 — Cheer (light conditioning 1 h) + bike commute Z2

Fri 4 — Rest

Sat 5 — Gym Day C (Power / French Contrast)
  Box Squat: 4×3 @ 120 kg, RPE 8, straight into contrast
  Depth Jump / Drop Jump: 4×4 BW
  Trap Bar Jump: 4×4 @ 53 kg
  Pogo Jumps: 4×6 BW, 2–3 min between complexes
  Hip Thrust: 3×10 @ 60 kg, 90s rest
  Calf Raise: 3×12 @ 90 kg, 60s rest
  Ab Wheel / Pallof: 3×10, 60s

Sun 6 — Optional easy Z2 / mobility

SPACING NOTES
▸ A→B: 48 h (Mon→Wed) ✓ B→C: 72 h (Wed→Sat) ✓
▸ Day A (Mon) is 5 days before Tuesday stunt — no leg conflict
▸ Day C (Sat) is 3 days after Thursday cheer — recovered for power quality

PROGRESSION NOTES
▸ Back Squat: hold 120 kg — late-set RPE crept to 8 vs. target 7; confirm first 2 sets feel like RPE 7 before adding weight next week
▸ Bench Press (Day A): hold 65 kg — RPE ran 8–9 vs. target 7; need a clean 4×4 at this weight before progressing
▸ Bench Close-Grip (Day B): hold 60 kg — RPE was on-target; add reps if sets 1–3 feel like RPE ≤ 6
▸ Box Squat (Day C): hold 120 kg — RPE exactly on target

WATCH LIST
▸ Bench Press (Day A): two weeks in a row above target RPE = progress signal stalled; if still RPE 8–9 next week, consider −2.5 kg and rebuild
▸ Elbow: continue logging pain/onset weight per press and hinge
```

---

## Example 2 — Deload trigger (2 of 4 triggers fired)

### Input Data (abbreviated)

```json
{
  "type": "workout-log",
  "unit": "kg",
  "bodyWeight": [
    { "date": "2026-07-05", "weight": 94.2 },
    { "date": "2026-07-04", "weight": 93.8 },
    { "date": "2026-07-02", "weight": 95.1 }
  ],
  "sessions": [
    {
      "date": "2026-07-04T11:00:00.000Z",
      "dayName": "Day C — Power / French Contrast",
      "durationMin": 71,
      "notes": "Legs felt dead. CMJ felt terrible.",
      "readiness": { "cmjCm": 27.5, "subjectiveEnergy": 3 },
      "exercises": [
        {
          "name": "Box Squat",
          "plannedSets": 4, "plannedReps": "3", "plannedWeight": 122,
          "targetRpe": 8, "swappedFrom": null, "notes": "Heavier than expected all sets",
          "sets": [
            { "weight": 122, "reps": 3, "rpe": 9 },
            { "weight": 122, "reps": 3, "rpe": 9 },
            { "weight": 122, "reps": 2, "rpe": 10 },
            { "weight": 122, "reps": 2, "rpe": 10 }
          ]
        }
      ]
    },
    {
      "date": "2026-07-01T09:00:00.000Z",
      "dayName": "Day A — Lower + Bench",
      "durationMin": 67,
      "notes": "Felt heavy and flat all session.",
      "readiness": { "cmjCm": 29.8, "subjectiveEnergy": 4 },
      "exercises": [
        {
          "name": "Back Squat",
          "plannedSets": 4, "plannedReps": "3", "plannedWeight": 122,
          "targetRpe": 8, "swappedFrom": null, "notes": "",
          "sets": [
            { "weight": 122, "reps": 3, "rpe": 9 },
            { "weight": 122, "reps": 3, "rpe": 9 },
            { "weight": 122, "reps": 2, "rpe": 10 },
            { "weight": 122, "reps": 2, "rpe": 10 }
          ]
        }
      ]
    }
  ]
}
```

*Note: Day B and Day D were planned but not done (2/4 sessions, 50% adherence).*

### User Response to Phase 3 Questions

> I can do 2–3 gym sessions next week. Cheer Tuesday and Thursday. I'm very fatigued and probably should take it easier. Energy 3/10 today, still 6/10 soreness.

---

### Processing Path

**Phase 2 — Analysis**

*Adherence:* 2/4 sessions → 50%. **Flag: adherence < 75%.**

*Back Squat VLA (Day A):*
- Set 1 reps = 3, Sets 3 & 4 reps = 2. VLA = (3−2)/3 = 0.33. **Flag: VLA > 0.20.**
- RPE escalated 9 → 9 → 10 → 10 against target 8. RPE escalation = +1.5. **Flag confirmed.**

*Box Squat VLA (Day C):*
- Same pattern: VLA = 0.33. RPE 9→9→10→10 vs. target 8. **Second consecutive session with VLA > 0.20.** This fires the deload trigger.

*CMJ trend:* 29.8 (Day A) → 27.5 (Day C). Delta = −2.3 cm. At or approaching the 3 cm threshold. Subjective energy: 4, then 3. Avg = 3.5/10. **Negative readiness trend.**

*Deload trigger check:*
1. VLA > 0.20 on a main lift in 2 consecutive sessions ✓ (Back Squat Day A + Box Squat Day C)
2. Session adherence < 50% ✓ (exactly 50% — meets threshold)

**Two triggers fired → recommend deload.**

*STaR scan:* "Felt heavy and flat" — Tier 3 descriptive only. "Heavier than expected" — load-tolerance language but self-managed (completed the session). No Tier 1 flags.

**Phase 4 — Plan Generation (Deload)**

*Sessions:* User says 2–3. Deload → 2 sessions (A + B). Drop C and D.
*Volume:* −40%. Day A normally has 5 sets Back Squat → 3 sets; 4 sets Bench → 3 sets; accessories same or −1.
*Weights:* unchanged (same loads, reduced sets).

---

### Output

```
WEEK OF 6–12 Jul 2026

LAST WEEK SUMMARY
▸ 2/4 planned sessions — Day B and Day D were missed
▸ VLA exceeded 0.20 on the squat pattern in both sessions (Back Squat + Box Squat) — high neuromuscular fatigue across two consecutive training days
▸ CMJ dropped 29.8 → 27.5 cm (−2.3 cm) and subjective energy averaged 3.5/10 — clear readiness decline
▸ Recommendation: deload week (2 triggers fired: consecutive VLA flags + adherence ≤ 50%)

NEXT WEEK PLAN — DELOAD (−40% volume, same weights)
Mon 6 — Gym Day A (Deload — Lower + Bench)
  Back Squat: 3×3 @ 122 kg [−2 sets], RPE 6–7 target, 180s rest
  CMJ: 2×3 BW — easy, not max-intent
  Bench Press: 3×4 @ 65 kg [−1 set], RPE 6–7, 150s rest
  Trap Bar RDL: 2×8 @ 80 kg [−1 set], 120s rest
  Lat Pulldown ⟂ Arm care: 2×8–10 [−1 set]

Tue 7 — Cheer + bike Z2

Wed 8 — Gym Day B (Deload — Upper + Power)
  Bench Close-Grip: 3×6 @ 60 kg [−1 set], RPE 6–7, 120s rest
  Front/Pause Squat: 2×4 @ 70 kg [−1 set], RPE 6–7, 150s rest
  Box Jump: 2×3 BW [−2 sets] — quality only, land soft
  Landmine Press: 2×8 @ 30 kg [−1 set]
  Row + Face Pull: 2×10 [−1 set]

Thu 9 — Cheer (light) + bike Z2
Fri 10 — Rest
Sat 11 — Rest
Sun 12 — Optional easy walk / mobility only

SPACING NOTES
▸ Only A + B this week — Day C and D dropped; no power complex, no conditioning
▸ A→B = 48 h (Mon→Wed) ✓

PROGRESSION NOTES
▸ All weights unchanged — deload reduces fatigue, not the load stimulus
▸ RPE target drops to 6–7: if sets feel harder than this at these weights, the deload is doing its job (fatigue is masking fitness); if they feel genuinely easy, reduce weight slightly
▸ After this week: re-test Day A at full volume and gauge RPE — expect to feel stronger

WATCH LIST
▸ DELOAD WEEK: do not add sessions or intensity, even if you feel good mid-week
▸ Adherence: the missed sessions last week were a signal, not a problem to make up for
▸ CMJ: log at the start of Monday session — if still below 29 cm, consider extending the deload or consulting if there's an underlying cause
```
