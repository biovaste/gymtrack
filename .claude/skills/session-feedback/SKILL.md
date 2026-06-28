---
name: session-feedback
description: Use when a user pastes a GymTrack workout export (type "workout-log"), a Cloudflare share URL, a UUID from their GymTrack app, or any gym session data and asks for post-workout feedback, coaching analysis, or session review
---

# GymTrack Session Feedback

Analyse a completed workout and produce concise, evidence-based coaching feedback. One takeaway. No overcoaching.

**Scope:** Single-session analysis. Does not create programs, modify periodization, or diagnose injuries. See companion skills for weekly planning and program creation.

---

## Setup

**Before analysing:** Read `../shared/schema-reference.md` and `../shared/science-reference.md`. These contain the field definitions, confidence tiers, derived metric formulas, STaR framework, VLA thresholds, and external focus rule that this skill depends on.

---

## Invocation

The user provides data in one of three ways:

1. **Paste export JSON** — `type: "workout-log"` from the app's Claude tab, or raw JSON
2. **Share URL** — fetch `https://api.gymtrack.hithitpull.fi/data/{uuid}` and parse the backup as a `gymtrack-backup` (use `sessions` + `currentPlan` + `bodyWeight`)
3. **Plain text session** — any structured gym session text; apply graceful degradation (see `schema-reference.md`)

Identify the most recent session and analyse it against the session immediately before it (for trend signals).

---

## Processing Order

Run these steps in sequence. Stop at the first Priority 1 or 2 flag — do not continue to lower-priority analysis.

```dot
digraph session_feedback {
    "1. STaR Pain Check\n(all notes strings)" [shape=box];
    "Mechanical flag?" [shape=diamond];
    "STOP → Safety output only" [shape=box, style=filled, fillcolor=lightcoral];
    "2. Completeness → Confidence tier" [shape=box];
    "3. Completion rate\n(if plannedSets present)" [shape=box];
    "4. Velocity Loss Analogue\n+ RPE Escalation" [shape=box];
    "High fatigue?" [shape=diamond];
    "STOP → Fatigue output" [shape=box, style=filled, fillcolor=lightyellow];
    "5. Unmanaged load-tolerance check\n(swappedFrom + notes)" [shape=box];
    "Unmanaged?" [shape=diamond];
    "STOP → Load management output" [shape=box, style=filled, fillcolor=lightyellow];
    "6. CMJ / readiness delta\n(structured or text-parsed)" [shape=box];
    "7. Progression opportunity\n(Zone of Proximal Overload)" [shape=box];
    "8. BW trend modifier\n(context only)" [shape=box];
    "Generate output" [shape=doublecircle];

    "1. STaR Pain Check\n(all notes strings)" -> "Mechanical flag?";
    "Mechanical flag?" -> "STOP → Safety output only" [label="yes"];
    "Mechanical flag?" -> "2. Completeness → Confidence tier" [label="no"];
    "2. Completeness → Confidence tier" -> "3. Completion rate\n(if plannedSets present)";
    "3. Completion rate\n(if plannedSets present)" -> "4. Velocity Loss Analogue\n+ RPE Escalation";
    "4. Velocity Loss Analogue\n+ RPE Escalation" -> "High fatigue?";
    "High fatigue?" -> "STOP → Fatigue output" [label="yes"];
    "High fatigue?" -> "5. Unmanaged load-tolerance check\n(swappedFrom + notes)" [label="no"];
    "5. Unmanaged load-tolerance check\n(swappedFrom + notes)" -> "Unmanaged?";
    "Unmanaged?" -> "STOP → Load management output" [label="yes"];
    "Unmanaged?" -> "6. CMJ / readiness delta\n(structured or text-parsed)" [label="no"];
    "6. CMJ / readiness delta\n(structured or text-parsed)" -> "7. Progression opportunity\n(Zone of Proximal Overload)";
    "7. Progression opportunity\n(Zone of Proximal Overload)" -> "8. BW trend modifier\n(context only)";
    "8. BW trend modifier\n(context only)" -> "Generate output";
}
```

For detailed signal definitions and thresholds, see `science-reference.md`.
For field names and derived metric formulas, see `schema-reference.md`.

---

## Special Cases

**Partial session** (`completionRate < 60%`): Run STaR pain check first. If a pain or mechanical flag is found, it explains the cutoff — stop there. If no flag: check session notes for an explicit reason. If ambiguous: reflect partial execution in output and flag Low confidence. Do not guess the cause.

**Generic / non-app data**: Accept any structured gym session text. Confidence is Low unless RPE is present (Medium) or RPE + notes + comparison session are present (High). See `examples.md` for a worked generic-data example.

---

## Output Format

```
SESSION RESULT: [One sentence — execution against intent]

KEY POSITIVE: [Single highest-ranking positive signal]

KEY LIMITER: [Single highest-ranking limiting signal — or "None detected" if none]

NEXT ACTION: [One actionable recommendation, external focus language only]

CONFIDENCE: High / Medium / Low
```

**Length:** 50–100 words. Absolute maximum: 120 words.

**External focus rule (mandatory):** All NEXT ACTION language must target the implement or environment — never internal anatomy. "Push the floor away" not "contract your quads." See `science-reference.md §C` for the full constraint and examples.

**Do not:**
- Surface more than one positive and one limiter
- Diagnose structural injuries ("you have tendinitis")
- Create programs or prescribe future sessions
- Invent metrics that are not in the data
- Output anything beyond the five-field structure above

---

## Reference Files

| File | Contents |
|------|----------|
| `../shared/science-reference.md` | STaR framework, VLA formula + thresholds, external focus rule, BW modifier, citations |
| `../shared/schema-reference.md` | GymTrack JSON field definitions, confidence tiers, derived metric formulas, generic data guidance |
| `examples.md` | Three worked examples: power session (High confidence), mechanical pain cutoff, generic text input |
