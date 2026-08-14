# GymTrack — bug-fix backlog

Known bugs and deferred cleanups, each verified present in `main` as of the commit that added it
here.

**Empty as of 2026-08-14.** All six items in the previous list have been fixed:

| # | What it was | Fixed by |
|---|---|---|
| 1 | Discarding a session left the confirm modal on screen | `endSession()` — one teardown for save/discard/reset |
| 2 | `push-plan.mjs` couldn't validate a plan without the network | `validatePlan` exported, `--check` flag, `tools/validate.test.mjs` |
| 3 | The plan editor could build supersets the validator rejects | Adjacency check on save; ↑↓ move whole groups; a one-member group renders as a normal card |
| 4 | Swapping a jump exercise to a load alternate kept the cm grid | `metric` on alternates (inherit when omitted); a metric-changing swap rebuilds the rows and is refused once sets are logged |
| 5 | `exInfoModal` showed "@ 0kg · RPE" for a jump | Branches on `isJump` — "Target: 3 attempts" |
| 6 | Dead branch in `adjustRest` | Added the −15s control it implied, with `endsAt` clamped to now |

Add new items here as they're found. Keep them ordered by value, highest first, and say where the
bug is and what it costs — not just what to change.

---

## Not bugs — known and accepted

- **Locked-screen rest audio.** iOS suspends Web Audio when the screen locks. The current fix
  covers foreground/screen-on only. The real answer is a notification or the native wrapper in
  `ROADMAP.md` Phase 3.
- **The weight ladder is duplicated** in `app.js` and `tools/push-plan.mjs`. A classic browser
  script and a Node ESM module with no build step between them cannot share a module.
  `tools/weights.test.mjs` sweeps both copies and fails on any disagreement — that is the
  mitigation, and it works. Do not "fix" this by adding a build step.
- **`equipment` defaults to `'barbell'` when undeclared**, in both `normalizePlan` and
  `defaultPlan`. Changing it to `null` now would mean migrating existing plans and session
  records. `.claude/skills/shared/schema-reference.md` documents the consequence for the coaching
  AI: a `barbell` label on a sub-20 kg weight is almost certainly an undeclared dumbbell or cable.
- **`lb` mode has no ladder.** The stepper falls back to a flat 2.5 and loadability is not
  validated. Kg-only is fine for the current user.
- **The session progress bar counts warm-up sets** while every statistic excludes them. Deliberate:
  the bar answers "how far through this session am I", and a warm-up set is work you did.
