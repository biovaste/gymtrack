# Coach interface for athlete alpha

Status: plan, decisions confirmed by Henri 2026-09-19 (see end). Nothing here is built. Alpha has no users yet and
`alpha.gymtrack.hithitpull.fi` is not wired up; that happens once a start date is confirmed.

## Goal

A coach picks one or more athletes and sends them a training program. Each athlete
sees it in the app, previews it, and accepts it. The coach can see who received,
accepted or declined it.

## Constraints from the current system

- One KV record per athlete UUID holds the whole backup (`worker/src/index.js`).
  Writes are gated by `HMAC(GYMTRACK_WRITE_SECRET, uuid)`, and that token is
  derived by hand with `tools/write-token.mjs`.
- `POST /data/:uuid/plan` overwrites the plan inside an athlete's backup. It is the
  CLI path for Henri's own plan, and it needs the athlete's write token.
- The alpha plan (`docs/plans/2026-09-11-athlete-alpha.md`) rules out giving
  coaches the athlete's write credential or using direct plan push for coaching.
  **This design keeps that rule:** a coach never writes an athlete's backup.
- Plan validation already exists on both sides (`WorkoutModel`,
  `ExerciseLibrary.importLibrary`, `validatePlanImport`, `showPlanImportPreview`).
  Reuse it; don't write a second validator.

## Design: inbox, not overwrite

```
coach page ──POST /coach/assign──▶ Worker ──▶ KV inbox:<athleteUuid>
athlete app ──GET /inbox/<uuid>──▶ preview ──accept──▶ applyImportedPlan() ──▶ normal sync
                                            └─POST /inbox/<uuid>/<id>/ack (accepted|declined)
coach page ──GET /coach/assignments──▶ delivery status per athlete
```

The athlete's own app applies the plan through the existing import path, so the
library merge, the sync, and the 409 conflict handling don't change. A plan the
athlete never accepts never touches their data.

## KV records (same namespace, prefixed keys)

| Key | Value |
|---|---|
| `coach:<coachId>` | `{ name, createdAt }` |
| `roster:<coachId>` | `[{ athleteUuid, displayName, linkedAt }]` |
| `invite:<code>` | `{ coachId, expiresAt }`, single use, 7-day TTL |
| `inbox:<athleteUuid>` | `[{ id, coachId, coachName, plan, sentAt, status }]`, capped at 10 |
| `assign:<coachId>:<id>` | `{ planName, athletes: { uuid: status }, sentAt }` |

## Credentials

- **Coach token:** `HMAC(secret, "coach:" + coachId)`. Henri creates coaches by hand
  with a new `tools/coach-token.mjs` (there are one or two coaches in alpha, so no
  sign-up flow).
- **Linking athletes:** the coach makes an invite code. The athlete types it in
  Settings, which calls `POST /link` with their UUID. Linking happens only with the
  athlete's consent, and the coach never sees the athlete's token.
- **Athlete write tokens (decided):** redeeming an invite code at `/link` issues the
  athlete's write token and links them in one step. It is issued only for a UUID with
  no existing record, so a code can't be used to take over someone else's data.
  Signing up and linking to the coach become the same step.
- **Inbox access:** reading and acking the inbox require the athlete's write token.
  Unlike `/data`, the inbox is not open to anyone who knows the UUID.

## Worker endpoints

| Method | Path | Auth | Does |
|---|---|---|---|
| POST | `/coach/invite` | coach | create an invite code |
| POST | `/link` | invite code | issue the athlete's write token, add the athlete to the roster |
| GET | `/coach/roster` | coach | list linked athletes |
| DELETE | `/coach/roster/:uuid` | coach or athlete | unlink the athlete |
| POST | `/coach/assign` | coach | `{ plan, athletes: [uuid] }`: validate once, write each inbox |
| GET | `/coach/assignments` | coach | delivery and accept status |
| GET | `/inbox/:uuid` | athlete | pending plans |
| POST | `/inbox/:uuid/:id/ack` | athlete | `accepted` or `declined` |

`assign` rejects any athlete who isn't on the coach's roster, and rejects a plan that
fails `WorkoutModel` validation (the same checks as `/data/:uuid/plan`). KV has no
transactions. Each inbox write is its own read-modify-write, and a failure shows up
in the response for each athlete rather than silently.

## Coach UI

`coach.html` is a separate page in the alpha deployment. It shares `workout-model.js`,
`exercise-library.js`, `i18n.js` and the styles, and defaults to Finnish like the
rest of alpha.

1. **Sign in:** paste the coach token and store it locally, the same pattern as the
   athlete write token.
2. **Roster:** linked athletes, a "create invite code" button, and unlink.
3. **Program:** load a plan from JSON (a file or a paste), or start from a copy of
   an earlier assignment. Show the same preview athletes see. **v1 has no in-page
   plan editor.** The athlete app already has one, and building a second is the
   largest cost in this plan. The coach builds the plan in their own GymTrack (or
   with Claude) and uses the existing plan-only export (`buildPlanExport`).
4. **Send:** checkboxes for athletes, an optional note, then send. Show a result
   for each athlete.
5. **Status:** a table of assignments against athletes: sent, seen, accepted or
   declined.

## Athlete app changes (alpha only)

- On launch and on resume, `GET /inbox`. If a plan is pending, show a banner:
  "Coach X sent 'Block name'."
- Tapping the banner opens `showPlanImportPreview`. Accepting it runs
  `applyImportedPlan` and acks. Declining it acks.
- **Never interrupt an active workout.** Show the banner only on the day list.
- Settings: "Coach" section with an invite-code field, the linked coach's name,
  and an unlink button.
- **Merge, don't replace (decided):** every plan day gets an owner. Days from a coach
  carry `day.source = { coachId, assignmentId }`; days the athlete makes have no
  `source`. Accepting a coach program replaces **only that coach's days** and keeps the
  athlete's own days in their current position. Example: the team has 2 gym days and an
  athlete adds a third of their own; the coach updates the 2 team days and the third is
  untouched. A merge helper `mergeCoachPlan(plan, coachId, incoming)` goes in
  `workout-model.js` so the app and tests share it. The preview shows which days will
  be replaced, added and kept.
- An athlete editing a coach day turns it into a local edit that the next coach
  update overwrites. The editor labels coach days ("From coach X") and the import
  preview warns when a local edit is about to be overwritten. Recording who changed
  what is not in v1.

## Phases

1. **Worker:** records, endpoints, coach token tool and Worker tests. Deploy
   behind the existing secret. Personal routes stay unchanged.
2. **Athlete inbox:** banner, preview, accept and decline, plus the Settings
   linking section. Test this with two alpha profiles on localhost:8766.
3. **Coach page:** roster, send and status.
4. **Dry run:** Henri as the coach and two test profiles, on real phones, before
   inviting anyone.

**Coach reads logs (decided: in v1, it's cheap).** Linking already records the coach
on the athlete's roster entry, so the Worker can serve `GET /coach/athlete/:uuid`
(coach token + roster check) straight from the athlete's existing backup record. No
new storage is needed. The coach page gets a per-athlete view: recent sessions, sets,
RPE and notes, reusing the history rendering where practical. Unlinking cuts access
immediately because the roster check fails. This goes in phase 3, and the invite
screen tells the athlete the coach will see their logs.

**Later: PDF translator.** Coaches often write programs as PDFs. A future
tool turns a PDF plan into GymTrack plan JSON (Claude extraction → `push-plan.mjs
--check` validation → coach reviews the preview before sending). Not in v1; Henri
converts by hand when needed.

## Tests

- Worker: an athlete not on the roster is rejected; an invalid plan is rejected
  before any inbox write; a wrong or missing coach token returns 401; an invite
  code is single use and expires; a coach token can't call `/data` writes.
- App: the banner is suppressed during an active workout; accepting keeps sessions
  and the library; declining changes nothing; an inbox fetch that fails offline
  is silent.
- End to end, in the style of `athlete-alpha-browser.test.mjs` with a stubbed API:
  send → accept → the plan appears → a sync push contains it.

## Decisions (Henri, 2026-09-19)

1. No plan editor on the coach page. A PDF → JSON translator comes later; manual
   conversion until then.
2. Redeeming the invite code issues the athlete's write token.
3. The coach can see athletes' logged sessions in v1.
4. A coach update replaces only that coach's days; the athlete's own days are kept.
