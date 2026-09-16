# GymTrack — bug-fix backlog

Known bugs and deferred cleanups, each verified present in `main` as of the commit that added it
here.

## Open — The sync API still accepts unauthenticated writes (2026-09-12)

**`GYMTRACK_WRITE_SECRET` is not set on the Worker, so `checkWrite()` is inert.** Any
`POST /data/<uuid>` succeeds with no token, for any UUID. The README describes this as the
rollout window that lets the API deploy ahead of the phone; that window is still open, and
the phone has been live for weeks. Until the secret is set, anyone who learns a share URL —
which is deliberately pasted into AI chats — can also overwrite that training history.

Found on 2026-09-12 while verifying demo mode: two accidental non-demo page loads against a
local server created a real KV entry with no write token presented.

Fix: `cd worker && wrangler secret put GYMTRACK_WRITE_SECRET`, then derive the token with
`node tools/write-token.mjs <uuid>` and paste it into Settings → **Write token** on the
phone, and set `GYMTRACK_WRITE_TOKEN` on the desktop. Do the phone and desktop first, or the
next sync fails with a 401 mid-workout. See README, "The write token".

### Stray KV entry — leave it alone for now

`ee88b033-af5d-427f-9200-dbc3faa33cdf` is junk, created by those same two page loads on
2026-09-12. It holds the default starter plan, 0 sessions, 0 body-weight entries,
`updatedAt: 0`. It is **not** Henri's data and nothing references it. Deliberately not
deleted — recorded here so a future session doesn't rediscover it and mistake it for a real
account, or delete something else by guessing. The sync API has no delete route; removing it
means `wrangler kv key delete` against the `GYMTRACK_DATA` namespace.

## Open — Narrow phone + larger text overflow in superset cards (2026-09-16)

At 320 px width with ~120% text (Finnish), the active-workout page scrolls sideways by ~13 px:
superset member rows (`.superset-member.ss-next` negative margin, and "+ Sarja / − Sarja /
Muistiinpano" row) are wider than the card. Reproduced identically on committed `HEAD`, so not
caused by the reorder/timer work. Found by `tools/device-checklist-emulated.mjs`; confirm on a
small phone (iPhone SE / Android with large font) before fixing.

## Open — Deferred from the 2026-09-16 feature block

- **Assisted bodyweight exercises** (band/machine assistance) are not representable. Negative
  `weight` is refused by the editor, import and `push-plan.mjs`. Needs its own design and history key.
- **Language preference `gym.language` is shared** between personal and alpha profiles on the same
  origin-less key (i18n.js). Harmless preference, but not isolated by the `gym_alpha.` prefix.
- **Web exercise timer cannot alarm while an iPhone is locked/suspended.** Stated in the UI; native
  notifications belong to the iOS workstream.

## Open — Exercise library entry paths (2026-09-08)

**Unknown exercises bypass the library choice on import and mid-workout entry.**
The plan picker offers custom-entry versus alias selection, but imported unknown
exercises remain standalone, and mid-session free-text entry (including Add to
plan) offers neither choice. This leaves reusable entries and identities
inconsistent depending on how an exercise enters the app.

Follow-up: suggest existing matches and offer an explicit choice to create a
custom library entry or link a library alias for unknown imported and mid-workout
exercises. Preserve prescriptions, plan order, supersets, side/setup separation,
custom load profiles, instructions and existing explicit IDs. Never infer legacy
history mappings or merge identities from similar names. Cover English/Finnish,
import cancellation, active-workout safety and all persistence paths with focused
tests. Entry points: normalizePlan/import-plan and sessionAddExerciseModal in app.js.

Deferred explicitly by Henri for the library v1 release; not fixed in this release.
Scheduled in `ROADMAP.md` Phase 2, before native exercise-entry screens are finalized.

## Resolved

All six items in the previous list were fixed as of 2026-08-14:

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
  `ROADMAP.md` Phase 1 prototype and Phase 3 delivery.
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
