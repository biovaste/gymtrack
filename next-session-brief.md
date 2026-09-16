# Next Session Brief — GymTrack (Tracking app)
_State as of 2026-09-12. Live state only. History: `..\..\..\session-log.md` · Rules: `..\lessons-learned.md` · Bugs: `BACKLOG.md`_

## Where things stand

Two things shipped since this brief was last written. **Exercise library v1** released and
deployed 2026-09-08 (`5803407`) — 30 curated entries, bilingual search, custom-entry versus
library-alias selection; the deferred import/mid-workout entry gap is in `BACKLOG.md`.
**Demo mode** shipped 2026-09-12 on branch `demo`, live at
<https://demo.gymtrack.hithitpull.fi>. `main` and production are untouched by it.

**The working tree on `main` is dirty with in-flight work from other sessions** — a native
mobile prototype (`mobile/`, Expo/React Native), `shared/`, modifications to `app.js`,
`sw.js`, `worker/src/index.js`, the coaching skills and the locales, plus untracked
`docs/2026-09-10-codebase-review.md`, `docs/native-prototype-results.md`,
`docs/phase-1-device-checklist.md` and `docs/plans/2026-09-11-athlete-alpha.md`. None of it
is committed and none of it came from the demo session. Establish what it is before building
on it.

## Live threads

- **Portfolio link to the demo** — handed to a separate portfolio session with a written
  prompt. The loop is currently half-open: the demo links to the portfolio, the portfolio
  does not link to the demo. Nothing needed from this repo.
- **Athlete Web Alpha implementation block completed** (uncommitted in working tree for Codex review):
  - Local-only fail-closed alpha mode via `app-config.js` and `app.js` (`APP_CONFIG` detects origin/port/config; cloud sync disabled, share/UUID/write token hidden; `gym_alpha.` prefix).
  - Storage dependability: corrupt data preserved without overwrite; structured write failure returns with UI rollbacks; crash-safe completion idempotency; staged-commit backup restore.
  - Plan handoff: clean plan export (`buildPlanExport`) without personal history/credentials; athlete import preview with history preservation.
  - Regression test suites added: `tools/athlete-alpha.test.mjs` and `tools/athlete-alpha-browser.test.mjs`. All 90 unit tests pass.
  - Separate preview ports: `8765` for personal deployment preview; `8766` for athlete alpha preview.
  - Follow-up physical device checklist in `docs/phase-1-device-checklist.md` updated with native iOS signed build follow-up and web-alpha checks.

## Open actions

- **Set `GYMTRACK_WRITE_SECRET` on the Worker.** Top item in `BACKLOG.md`. Until then any
  `POST /data/<uuid>` succeeds with no token, for any UUID — and share URLs are deliberately
  pasted into AI chats. **Order matters:** put the token on the phone (Settings → Write
  token) and in `GYMTRACK_WRITE_TOKEN` on the desktop *first*, or the next sync 401s
  mid-workout.
- **Commit or discard two uncommitted doc edits** — `BACKLOG.md` (the write-secret and stray
  KV entries) and this brief. Left uncommitted deliberately because `main`'s tree holds
  unrelated in-flight work; fold them into whatever commit that becomes.
- **Stray KV key `ee88b033-af5d-427f-9200-dbc3faa33cdf`** — junk, deliberately left in place,
  documented in `BACKLOG.md`. Do not delete it as a tidy-up without reading that entry.
- **Optional, cosmetic:** the demo intro card's link renders in default browser blue rather
  than the app accent (`--accent`, `#4f8cff`). Visible in a screen capture.
- **`DEMO_CASE_STUDY_URL`** in `demo.js` points at `https://henri.hithitpull.fi/#projects` —
  the project card, since no dedicated case-study page exists. One string to change if one
  is written.

## Carrying from this session

- **`demo` is a permanent downstream leaf.** Never merge it into `main`. Refresh after a
  release: `git checkout demo && git merge main && node --test tools/demo.test.mjs && git push`.
- Demo isolation rests on one `DEMO` flag and seven guards in `app.js`; `syncFetch()` is the
  single choke point every Worker request passes through. `tools/demo.test.mjs` fails if a
  `fetch` to `WORKER_URL` is ever added outside it.
- Body-weight entries are `{ date, weight }` — writing `kg` renders the chart as `NaN`.
- The demo seed anchors its history to the **current week**, so it never looks abandoned;
  only the calendar slides, the progression shape is fixed.

## Where to look

| File | What it holds |
|---|---|
| `BACKLOG.md` | Open bugs, newest first. The write-secret gap and the stray KV key are at the top |
| `README.md` § Demo mode | What demo mode changes, how to run it locally, the deploy and custom-domain procedure |
| `docs/plans/demo-mode.md` | The demo plan, the rejected alternatives, and the full verification record |
| `..\CLAUDE.md` | Deploy commands, the plan schema, the loadable-weight ladder, the UTC rule |
| `..\PROJECT.md` | Infrastructure IDs and URLs — read before asking Henri for any of them |
