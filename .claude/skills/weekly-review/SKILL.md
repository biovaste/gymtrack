---
name: weekly-review
description: Use when the user asks for a weekly training review, wants to plan next week's workouts, says "let's plan the week", "weekly check-in", "what should I train next week", or wants to review last week's data and create a training plan for the coming week
---

# Weekly Training Review & Planning

Review last week's training data, gather next week's schedule constraints, generate an adapted training plan, and optionally push the updated plan to the GymTrack app and/or create a markdown week plan file.

**Scope:** Weekly planning cycle. Works with GymTrack app data or standalone (pasted/verbal). User-agnostic — physical constraints, sport type, and program structure are read from context, not hardcoded.

---

## Setup

**Before starting:** Read these four files:
1. `../shared/schema-reference.md` — field definitions, JSON schemas, Worker API endpoints
2. `../shared/science-reference.md` — STaR framework, VLA, external focus rule, BW modifier
3. `schema-supplement.md` — weekly aggregate metrics, plan mutation contract
4. `periodization.md` — auto-regulation, volume landmarks, deload thresholds, concurrent training rules

---

## Phase 0 — Load Context

Before any interaction with the user, gather the following from available sources:

**From memory / CLAUDE.md:**
- User's sport(s) and other regular physical activities beyond the gym
- Physical constraints or injury flags (generic — whatever is noted, not hardcoded)
- Current training phase/block name and its primary goals
- Program structure: priority-ordered flex model (A → B → C → D) or named split days (push/pull/legs, etc.)
- Which readiness signals the user tracks (CMJ, HRV, RHR, Telegram readiness scores, subjective energy)

**From the file system (Claude Code only):**
- Search for a phase-level training plan file (e.g. `phase2-training-plan.md`, `training-plan.md`, or similar in `Physical Training/` or the project root)
- If found: read it — it is the **source of truth** for exercises, starting weights, progression scheme, and any movement restrictions
- If not found: note this; you will rely on `currentPlan` from the workout-log data instead

**Note which readiness signals are actually available** — only analyse what was logged; never infer a missing signal.

---

## Phase 1 — Data Ingestion

Accept any of:

| Source | How to access |
|--------|--------------|
| `workout-log` JSON block | User pastes it — parse directly |
| Cloudflare share URL | Fetch via shell: `curl "https://api.gymtrack.hithitpull.fi/data/{uuid}"` (Claude Code only) |
| Plain UUID | Fetch from `https://api.gymtrack.hithitpull.fi/data/{uuid}` |
| Verbal or text description | Standalone mode — flag **Low confidence** explicitly in output |

Extract from the data:
- All sessions in the last 7 days
- Body weight entries for the last 7 days
- Readiness blocks (any: `cmjCm`, `broadJumpCm`, `subjectiveEnergy`) per session
- `currentPlan` (fallback if no phase training plan file was found)

---

## Phase 2 — Last Week Analysis

Compute only from signals that were actually logged. **Never infer a missing signal.**

| Signal | How to compute | Flag threshold |
|--------|----------------|----------------|
| Session adherence | sessions done ÷ sessions planned (from plan days or program structure) | < 75% |
| RPE vs target | actual RPE − `targetRpe` per main lift (as defined in the plan) | > +1.0 |
| VLA per main lift | `(first_set_reps − last_set_reps) / first_set_reps` at matched weight | > 0.20 |
| Readiness trend | any available signal — CMJ delta, HRV trend, RHR elevation, subjective energy avg | ≥ 2 negative signals |
| Physical constraint notes | scan all session notes for injury/pain keywords from user context (STaR Tier 1+2) | Always surface |
| BW trend | avg last 3 days − avg first 3 days of week | Context only |

**Output: compact LAST WEEK block** — ≤ 5 bullets covering: adherence, one positive, one limiter, one watch item, readiness verdict.

---

## Phase 3 — Context Gathering

Ask all questions in **one message**, then wait for the response before proceeding.

Adapt phrasing to the user's sport and context (from Phase 0), but always cover:

```
To plan next week well, I need a few quick answers:

1. How many gym/training sessions can you fit? (1–N)
2. Other physical activity: which days, and what type/intensity?
   (e.g. sport practice, matches, bike commutes, hikes — whatever competes for recovery)
3. Any schedule constraints? (travel, early mornings off, social commitments, etc.)
4. How are you feeling today — energy (1–10) and soreness (1–10)?
5. Anything from last week worth flagging? (niggles, a session you skipped for a reason, etc.)
```

Do not proceed to Phase 4 until the user has responded.

---

## Phase 4 — Week Plan Generation

### Day Assignment

**Priority-ordered flex model** (if user's program uses one):
- Map available gym sessions strictly to the priority order (A → B → C → D or equivalent)
- Never skip a higher-priority session to do a lower-priority one
- Drop from the lowest priority first when sessions shrink
- Aerobic/conditioning day is always the first to drop

**Named split days** (if user's program uses push/pull/legs, upper/lower, etc.):
- If available sessions ≥ split days: assign normally
- If available sessions < split days: propose combining two compatible sessions (e.g. push + pull → full upper, or legs A + legs B → one leg day covering the most important exercises from each) and show what gets dropped — ask for confirmation before finalising the combined session

**Reference for exercises and weights:** Use the phase training plan (Phase 0) if found; otherwise use `currentPlan` from the workout-log.

### Scheduling Rules

- **48 h minimum** between sessions that share a primary mover (e.g. two heavy leg sessions)
- **High-CNS sessions** (heavy compound lifts, plyometrics, explosive sport) should not fall within 24 h either side of a high-demand sport session (characterised by the user in Phase 3)
- **Aerobic/endurance sessions** can share a day with or follow sport practice without meaningful interference
- **Aerobic-only day** is always the first to drop when sessions shrink

### Weight Progression (Auto-Regulation per Lift)

| Last week's result | Adjustment |
|-------------------|------------|
| Actual RPE < target by ≥ 0.5 | +2.5 kg (or +5 lb) |
| Actual RPE within ±0.5 of target | Same weight — target upper end of rep range |
| Actual RPE > target by ≥ 0.5 | Same weight, or −2.5 kg; consider −1 set |
| Session skipped entirely | Repeat same weight; note the repeat |
| Physical constraint flag on a lift | Freeze weight; add a note from user context |

If no RPE data from last week (standalone mode): hold current weights; note the limitation.

### Volume Regulation

- Negative readiness trend (≥ 2 signals flagged in Phase 2) → −1 set on all compound lifts
- Session adherence < 50% → carry forward last week's volume rather than adding

### Deload Trigger

If **any 2 of the following** are true → recommend a deload week and explain why:

- VLA > 0.20 on a main lift in 2 consecutive sessions
- Readiness signal drop ≥ meaningful threshold (CMJ ≥ 3 cm below 7-day avg; HRV > 10% below baseline; subjective energy avg ≤ 4)
- Session adherence < 50%
- User explicitly reports high fatigue, illness, or significant life stress

**Deload format:** −40% volume, same weights, drop lowest-priority sessions. Present the deload as a recommendation with clear reasoning, not a diagnosis.

### Physical Constraints

- Read from user context (memory / CLAUDE.md / session notes) — never hardcode specific joint names or movements
- Apply as movement substitution notes (use available `alternates` from the plan where possible) and weight freeze flags
- Remind the user to log pain/onset point per session if they are tracking pre-intervention baseline data

---

## Phase 5 — Output, Confirmation, and Deliverables

### Plan Output Format

```
WEEK OF [Mon date] – [Sun date]

LAST WEEK SUMMARY
▸ [Adherence + volume — e.g. "3 of 4 planned sessions, all sets completed"]
▸ [One positive — strongest signal from Phase 2]
▸ [One limiter — highest-priority flag from Phase 2]
▸ [Watch item / readiness verdict — deload signal, fatigue trend, physical constraint]

NEXT WEEK PLAN
[Day, date] — [Activity or Rest]: [Brief description]
  [Exercise: sets × reps @ weight, target RPE, rest]
  ...
[Day, date] — [Activity or Rest]: ...
...

SPACING NOTES
▸ [Key gaps — why sessions are placed where they are]

PROGRESSION NOTES
▸ [Per main lift: what changed, what stayed, why]

WATCH LIST
▸ [Any active flags: deload signal, physical constraint reminder, fatigue note]
```

### After User Confirms

Present **two optional follow-up actions** sequentially:

**1. Push to app?**

Generate the complete updated `workout-plan` JSON in a code fence:
```json
{
  "type": "workout-plan",
  "version": 1,
  "name": "...",
  ...
}
```

- **Claude Code:** Offer to push automatically:
  ```bash
  node tools/push-plan.mjs <path-to-json>
  ```
  Write the JSON to the scratchpad directory first, then run the push. The plan-only Worker endpoint (`POST /data/:uuid/plan`) preserves all sessions and body weight.
- **Standalone / Cowork:** Instruct the user to paste the JSON block into the app's Claude tab → "Import a plan from Claude".
- Always show the JSON regardless of mode (transparency + manual fallback).

**2. Create a weekly plan file?**

Offer to create `Physical Training/week-YYYY-MM-DD.md` (using the Monday date) with:
- A **week-at-a-glance table**: day × other activity × training × reasoning
- Progression notes
- Watch list / constraint reminders
- A short "If the week shrinks" fallback section

---

## Reference Files

| File | Contents |
|------|----------|
| `../shared/schema-reference.md` | GymTrack JSON field definitions, confidence tiers, derived metric formulas, Worker API |
| `../shared/science-reference.md` | STaR framework, VLA formula + thresholds, external focus rule, BW modifier, citations |
| `schema-supplement.md` | Weekly aggregate fields, derived weekly metrics, plan mutation contract |
| `periodization.md` | Auto-regulation, volume landmarks, deload evidence, concurrent training, polarized aerobic |
| `examples.md` | Two worked examples: typical progression week, deload trigger |
