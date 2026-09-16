# Next Session Brief — GymTrack (Tracking app)
_State as of 2026-09-16. Live state only. History: `..\..\..\session-log.md` · Rules: `..\lessons-learned.md` · Bugs: `BACKLOG.md`_

## Where things stand

- **Alpha/WAL work is committed** (`8113f59`, 2026-09-16) — not uncommitted as earlier notes said.
  Demo mode lives on branch `demo` (<https://demo.gymtrack.hithitpull.fi>).
- **Uncommitted on `main`, for review (2026-09-16 session):** three shared PWA features, both modes.
  1. *Drag to reorder* exercise cards in plan editor and active workout (grip handle; mouse drag,
     touch press-and-hold; ↑/↓ + arrow keys; supersets move as a block; failed save restores order).
  2. *Exercise timer* for duration/cardio sets: Start → pause/resume/reset/cancel → "Log m:ss".
     Deadline persisted on the set row; expiry never logs; stale expiry is silent; one timer, never
     overlapping rest.
  3. *Added weight* for bodyweight lifts: `addedLoad: true` (weight = external load, 0 = BW only),
     separate history key, no e1RM/tonnage, PR = heaviest added load, validator + import checks.
  Tests: `tools/workout-features-browser.test.mjs` (alpha + personal, zero external requests),
  new model tests, validator cases; i18n smoke harness fixed to run in personal mode.
- **Review + emulated checklist run (same day):** fixed timer expiry stealing input focus (full
  re-render → targeted update), Restore sheet staying open after a successful restore (existing
  bug), superset header overflow, Finnish day-action row clipping. `tools/device-checklist-emulated.mjs`:
  28 emulated pass, 3 device-only, 1 existing overflow (BACKLOG).
- **Not done:** physical-device checks (checklist updated), native parity, assisted bodyweight
  (negative load) design, deployment.

## Open actions

- **Set `GYMTRACK_WRITE_SECRET` on the Worker.** Top item in `BACKLOG.md`. Until then any
  `POST /data/<uuid>` succeeds with no token, for any UUID — and share URLs are deliberately
  pasted into AI chats. **Order matters:** put the token on the phone (Settings → Write
  token) and in `GYMTRACK_WRITE_TOKEN` on the desktop *first*, or the next sync 401s
  mid-workout.
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
