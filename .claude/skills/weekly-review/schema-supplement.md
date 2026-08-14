# Schema Supplement — Weekly Review Skill

Extends `../shared/schema-reference.md` with weekly-specific aggregates, derived metrics, and plan mutation rules.

---

## Weekly Aggregate Fields

Computed from a `workout-log` (or `gymtrack-backup`) over the trailing 7 days. Never stored in the JSON — derived at analysis time.

| Field | Derived From | Formula |
|-------|-------------|---------|
| `adherenceRate` | sessions done / sessions planned | Count sessions with a `date` in [today−7d, today] against the number of distinct `day.name` entries in `currentPlan` (or the user's stated plan) |
| `avgRpePerLift` | all sets for a named exercise across the week | `mean(set.rpe)` for each exercise; compute separately per main lift |
| `cmjWeeklyDelta` | `readiness.cmjCm` across all sessions in the window | `last_session_cmj − first_session_cmj`; flag if < −3 cm |
| `bwWeeklyTrend` | `bodyWeight[]` entries | `mean(last 3 entries) − mean(first 3 entries)` in the 7-day window |
| `subjectiveEnergyAvg` | `readiness.subjectiveEnergy` per session | `mean()` across sessions that logged it |
| `sessionVlaMap` | VLA per exercise per session | Map of `{exerciseName → VLA}` for the main lifts |
| `jumpBestWeekly` | `heightCm` on `metric: "height"` exercises | `max(heightCm)` across the window, per exercise. Kept **separate** from `cmjWeeklyDelta` — different measurement conditions |

### Edge Cases

- **Warm-up sets:** filter `sets` to `!s.warmup` **before** computing any aggregate in this table. A `warmup: true` set is a ramp-up on the way to the working weight — counting it deflates `avgRpePerLift` (warm-up rows usually carry `rpe: null`), inflates weekly tonnage and set counts, and breaks `sessionVlaMap`, whose first-vs-last comparison would otherwise start from the ramp and read the whole exercise as getting *stronger* across the session. See the warm-up section in `../shared/schema-reference.md`.
- **Missing readiness fields:** Skip that session's contribution to the trend — do not impute.
- **Partial sessions** (`completionRate < 60%`): Include in adherence count as "done"; note the partial completion in the LAST WEEK block; exclude from RPE and VLA calculations for affected exercises.
- **Swapped exercises:** Use the swapped-to name for VLA and RPE computation; note the swap in PROGRESSION NOTES if the swap affected load selection.
- **No data at all (standalone mode):** Flag Low confidence; rely on user's verbal description for Phase 2.

---

## Readiness Trend — Available Signals

Use whichever signals were actually logged. Combine multiple signals for higher confidence.

| Signal | Source | Negative threshold | Notes |
|--------|--------|-------------------|-------|
| CMJ weekly delta | `readiness.cmjCm` | < −3 cm | Adapt threshold to user's baseline range |
| Broad jump delta | `readiness.broadJumpCm` | < −5 cm | Less sensitive than CMJ for weekly trends |
| Subjective energy avg | `readiness.subjectiveEnergy` | avg ≤ 4 | Self-report only; pair with objective signal when possible |
| HRV trend | external (not in app) | > 10% below baseline | User-reported; note source |
| RHR elevation | external (not in app) | > 5 bpm above rolling avg | User-reported; note source |
| Readiness bot score | external (not in app) | Consistently "Low" verdict | Any structured daily score system |

**Confidence note:** ≥ 2 negative signals of any type → flag readiness trend as negative. A single signal is context only.

---

## Plan Mutation Contract

What the weekly-review skill is allowed to change in the workout plan, and what requires explicit user confirmation.

| Change | Allowed by default | Requires explicit confirmation |
|--------|-------------------|-------------------------------|
| Exercise weights (**± 1 rung on that equipment's ladder**) | ✓ | — |
| Attempt count on a `metric: "height"` exercise | ✓ | — |
| Sets (−1 for fatigue, −40% for deload) | ✓ | — |
| Rep scheme (progress to next range in the plan's scheme) | ✓ | — |
| Day order / which days to do | ✓ | — |
| Exercise substitution (to an `alternate`) | ✓ with note | — |
| Exercise substitution (to something not in `alternates`) | — | ✓ must confirm |
| Adding new exercises | — | ✓ must confirm |
| Removing exercises | — | ✓ must confirm |
| Restructuring day splits | — | ✓ must confirm |
| Changing an exercise's `equipment` | — | ✓ must confirm |
| Changing an exercise's `metric` | — | ✓ must confirm |
| Creating or dissolving a superset | — | ✓ must confirm |

**Why `equipment` needs confirmation:** it silently changes which ladder the weight is checked against, whether the plate calculator appears, and the stepper's increments. Changing it to make a weight "valid" inverts the check — fix the weight instead.

**Why a superset needs confirmation:** it is a restructuring, and it changes the meaning of both members' `restSeconds`.

**Immutable fields during a weekly update:** `type`, `version`, `name` (keep block name). Day `id` and exercise `id` fields must be preserved exactly — the app uses them for session matching.

---

## Push Contract

The weekly-review skill uses the **plan-only update** endpoint to avoid overwriting session history.

```
POST https://api.gymtrack.hithitpull.fi/data/{uuid}/plan
Content-Type: application/json
Body: { "type": "workout-plan", "version": 1, ... }
```

**What this endpoint does:**
1. Fetches the existing `gymtrack-backup` from KV
2. Replaces only `backup.plan` with the new plan
3. Updates `backup.updatedAt` and `backup.exportedAt`
4. Writes the full backup back to KV

**Sessions and body weight are never touched.** This is the safe default.

**Tool invocation (Claude Code):**
```bash
node tools/push-plan.mjs <path-to-plan.json>
```
The script resolves the UUID from the `GYMTRACK_UUID` environment variable, `.gymtrack-uuid` file, or `--uuid` flag. Write the JSON to the scratchpad directory before running.

**After push:** The phone pulls the new plan automatically on next app launch via `workerReconcile()` (last-write-wins by `updatedAt` timestamp).

---

## Weekly Plan Markdown Format

When creating `Physical Training/week-YYYY-MM-DD.md` (Monday date), follow this structure:

```markdown
# Next week — [Mon date] – [Sun date]

> [Phase name], [Week N] of the [block link]. [One-sentence context: cheer load, key focus.]

## The week at a glance

| Day | Other activity | Training | Why here |
|-----|---------------|----------|----------|
| **[Day date]** | [sport / life] | **[Training]** | [Reason for this placement] |
| ... | ... | ... | ... |

[Spacing check: key rest gaps noted in prose, 1-2 sentences.]

## [Section for any significant focus area — e.g. conditioning, technique note, constraint]

[1-3 paragraphs of detail for the most important non-obvious element of the week.]

## If the week shrinks

[2-4 sentences: which session(s) to drop first, what is preserved, fallback rule.]
```
