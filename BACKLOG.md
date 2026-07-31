# GymTrack — bug-fix backlog

Known bugs and deferred cleanups, each verified present in `main` as of the commit that added it
here. Most came out of code review and are invisible in normal use; item 1 was hit on the phone
and is the only one a user actually sees.

Ordered by value, highest first.

---

## 1. Discarding a session leaves the confirm modal on screen

**Reported from the phone, 2026-07-31.** Tapping **Discard session** → **Discard** clears the
session but leaves the confirmation modal covering the screen; the app looks stuck on the discard
view. The home view *is* rebuilt correctly underneath — it's the overlay that never goes away.

**Where:** `app.js` — the `confirm-discard` case, the `Discard` button's `fn`.

**Cause:** the handler runs `active = null; saveActive(); stopRest(); syncWakeLock(); render();`
and never calls `closeModal()`. The `modal-btn` dispatcher only auto-closes a modal when the
button has **no** handler (`if (fn) fn(); else closeModal();`), so any button with a handler is
responsible for closing itself. `finishSession` does; this one doesn't.

It also skips `exExpanded = new Set(); readinessOpen = null;`, which `finishSession` does reset —
so collapsed-card and readiness-panel state from the discarded session leaks into the next one.

**Fix:** make the discard teardown match `finishSession`'s:

```js
fn: () => {
  active = null; saveActive(); stopRest(); syncWakeLock();
  exExpanded = new Set(); readinessOpen = null;
  closeModal(); render();
}
```

Better still, extract the shared teardown both paths need into one function so they cannot drift
again — this is the second time these two paths have diverged (`reset-all` was missing
`syncWakeLock()` for the same reason).

**Verify:** start a session, log a set, expand/collapse a card, discard → the modal closes and the
Workout tab shows the day list. Start another session → no card is pre-collapsed.

---

## 2. `push-plan.mjs` can't validate a plan without the network

**Where:** `tools/push-plan.mjs` — `main()` calls `resolveUUID()` then fetches the backup, and
only reaches `validatePlan(newPlan, …)` afterwards. `validatePlan` is not exported.

**Why it matters:** there is no way to check a plan before pushing it. Anyone writing a plan has
to either push it for real or hand-roll a copy of the module to reach the validator. Three
separate agents did exactly that during the equipment/supersets/jumps work, each writing a
throwaway script to test the same function. It also means the validator can't be unit-tested,
so the duplicate-name, loadable-weight, superset-adjacency and metric checks have no coverage
of their own — only the ladder underneath them does.

**Fix:** export `validatePlan`, and add a `--check` flag that reads the plan, validates, prints
the result and exits without touching `resolveUUID` or the network. Roughly ten lines. Then add
validator cases to `tools/weights.test.mjs` (or a sibling `tools/validate.test.mjs`): duplicate
names, a split superset run, an unloadable weight per equipment type, a height exercise carrying
a weight.

**Verify:** `node tools/push-plan.mjs --check <plan.json>` reports problems with no network access
and no `GYMTRACK_UUID` set.

---

## 3. The plan editor can build supersets the validator would reject

**Where:** `app.js` — the `f-superset` select (~line 1623) and the `ex-move` action.

Three related gaps, all in-app only. `tools/push-plan.mjs` catches the first on push; the editor
does not catch any of them at the point of editing:

- Tagging two **non-adjacent** exercises with the same letter renders them as two separate cards,
  both headed "Superset A", each with its own rest cycle. They also share a collapse key
  (`'ss:' + tag`), so collapsing one collapses both.
- A group of **one member** is allowed, producing a superset card wrapping a single exercise.
- **`ex-move`** can move an exercise into or out of the middle of a group, silently splitting or
  merging it, with no warning.

**Why it matters:** low, because plans normally arrive via `push-plan.mjs`, which refuses a split
run. This only bites when editing on the phone.

**Fix:** validate on save in `exEditModal` — refuse a tag that would create a non-adjacent run and
say why. Either reject a one-member group or render it as a normal exercise. For `ex-move`, either
move the whole group together or warn before splitting one.

---

## 4. Swapping a jump exercise to a load alternate keeps the cm grid

**Where:** `app.js` — the alternates sanitiser (~line 556) keeps `name`, `weight`, `description`,
`equipment`, `barWeight`. There is no `metric`.

**Why it matters:** `doSessionSwap` copies the alternate's equipment onto the live exercise but
has no metric to copy, so `e.metric` stays `'height'`. Swapping Box Jump for a loaded alternate
leaves a `# | cm | ✓` grid with nowhere to record weight or reps. Rare — jump exercises rarely
carry alternates — but the data it produces is wrong, not just ugly.

**Fix:** add optional `metric` to the alternate schema (omitted = inherit the parent's, same rule
as `equipment`), carry it through the sanitiser and both swap paths, and rebuild the set rows when
the metric changes. Decide what happens to already-logged sets on that exercise — probably refuse
the swap once any set is done, rather than silently discarding them.

---

## 5. `exInfoModal` shows "@ 0kg · RPE" for a jump exercise

**Where:** `app.js` — `exInfoModal`, the `Target:` line.

The line is built unconditionally as `plannedSets × plannedReps @ plannedWeight`, so tapping
**Explain** on a jump exercise reads `Target: 3×1 @ 0kg`. Cosmetic — every other jump surface
(card, history, collapsed summary, "Last:") already branches on the metric; this one was missed.

**Fix:** branch on `isJump(e)` and show `3 attempts` instead.

---

## 6. Dead branch in `adjustRest`

**Where:** `app.js` — `adjustRest(delta)`, the `if (remain > 0)` guard.

`adjustRest` is only ever called from `rest-add` with `delta = 15`, so remaining time can never go
to zero or below and the else-path is unreachable. Harmless, but it reads as though a "−15s"
control exists somewhere.

**Fix:** either add the "−15s" control the branch implies, or drop the branch. Prefer adding the
control — shortening a rest is a real thing to want mid-session.

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
