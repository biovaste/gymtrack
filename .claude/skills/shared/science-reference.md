# Science Reference — GymTrack Skills (Shared)

## A. STaR Framework for Pain Classification

All pain/discomfort signals must be classified before any performance signal is surfaced.

### Tier 1 — Mechanical/Acute (Highest Priority)
**Keywords:** sharp, locking, catching, pop, gave way, electric, stabbing, numb

**Action:** Suppress all positive performance output. Output a single mandatory safety note — do not analyse volume, RPE, or progression.

### Tier 2 — Load-Tolerance / Positional
**Keywords:** too much in [position], irritation, couldn't load, had to stop, joint discomfort at depth, ached under load

**Action:** Check whether the athlete self-regulated (swapped to an alternate, reduced load, modified ROM).
- If self-regulated → mark as **Managed**. Allow performance metrics to surface below this in the hierarchy.
- If not self-regulated → treat as unmanaged flag. Suppress performance positives and output a load-management note.

### Tier 3 — Transient / Descriptive (Lowest Priority)
**Keywords:** stiff, tight, achy during warm-up, pumped, sore from last session, DOMS

**Action:** Acknowledge in log parsing only. Do not let it override performance or progression signals.

---

## B. Velocity Loss Analogue (VLA)

High-performance settings use linear transducers to measure rep velocity loss (González-Badillo et al., 2017). GymTrack's data allows a rep-count analogue.

### Formula
```
VLA = (First Set Reps − Last Set Reps) / First Set Reps
```
Computed **at matched intensity** (same planned weight across sets). When weight varies between sets, compare only sets at identical weight.

### Thresholds
| VLA | Interpretation |
|-----|---------------|
| > 0.20 (>20% drop) | High neuromuscular fatigue — Priority 2 flag |
| 0.10–0.20 | Moderate fatigue — context note only, no flag |
| < 0.10 | Stable output |

### RPE Escalation Check (companion signal)
When VLA cannot be computed (weight varied every set, only one set logged):
- If RPE increased ≥ 1.5 points across identical or increasing loads → treat as equivalent to VLA > 20%.

### Rep Range Parsing Rule
Planned reps are stored as range strings (e.g., `"6-8"`). Use the **lower bound** for all threshold comparisons. Completing 6 reps when the plan says `"6-8"` is on-target, not a failure.

---

## C. Attentional Focus — External Cues Only

All NEXT ACTION language in skill output must target the environment or implement (external focus), never internal biomechanics (internal focus). This is a mandatory output constraint, not a derived metric.

**Research basis:** Wulf, G. (2013). Attentional focus and motor learning: A review of 15 years. International Review of Sport and Exercise Psychology, 6(1), 77–104.

| Internal (Forbidden) | External (Required) |
|---------------------|---------------------|
| Keep your chest up and drive through your quads | Push the floor away on each rep |
| Squeeze your glutes at the top | Drive your hips into the bar |
| Contract your lats and pull with your elbows | Pull the bar apart / pull the bar to your sternum |
| Brace your core and keep a neutral spine | Push out against your belt |

---

## D. Body Weight as Context Modifier

BW data does not trigger a primary signal. It modifies interpretation of RPE escalation and fatigue signals.

**Rule:** If the 3-to-5 most recent BW entries show a decline > 1% from the 7-day average **and** an RPE escalation or VLA flag is also present → reframe the limiting signal as likely energy-availability deficit rather than neuromuscular fatigue.

Surface the reframe as a note on the relevant output line. Do not add a separate output section.

---

## E. References

- González-Badillo, J.J., Yañez-Garcia, J.M., Mora-Custodio, R., & Rodriguez-Rosell, D. (2017). Velocity loss as a variable for monitoring resistance exercise. International Journal of Sports Medicine, 38(3), 217–225.
- Wulf, G. (2013). Attentional focus and motor learning: A review of 15 years. International Review of Sport and Exercise Psychology, 6(1), 77–104.
- Kenttä, G., & Hassmén, P. (1998). Overtraining and recovery. Sports Medicine, 26(1), 1–16. [energy availability + performance context]
