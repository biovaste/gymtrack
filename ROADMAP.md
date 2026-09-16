# GymTrack — Roadmap to Launch

> Updated: 2026-09-10. This roadmap describes planned work, not shipped functionality.

## Product direction

GymTrack will become an iOS/Android workout app where an athlete can follow a plan
written by themselves, a human coach or an AI assistant. All three sources use the
same exercise identities, prescriptions and workout history. AI use is optional.
A later coach interface will let human coaches review workouts from athletes who
have granted access and draft their next plans.

Prioritize reliable workout data and the mobile workout experience before built-in
AI chat. Start a small platform prototype now; begin the full conversion once the
shared data foundations are ready. The schema can keep evolving through explicit,
tested migrations.

## Current baseline

- Static English/Finnish PWA, hosted on Cloudflare Pages, with offline support.
- Workout plans, warm-ups, supersets, alternates, movement identities, equipment
  setups, custom load profiles, timed/distance exercises and reusable library entries.
- Local browser storage with Cloudflare Worker + KV backup/sync. UUID-based read
  sharing and separate write tokens are implemented; the Worker still permits
  writes without authentication when its write secret is unset.
- Manual plan editing, JSON plan import/export, external AI sharing and a desktop
  plan-push helper. Human-written JSON already fits the plan format, but a dedicated
  human-coach workflow and coach interface do not yet exist.
- Completion sync feedback (#10) now has live success/error/retry states in the local
  code. The calculated effort value is labeled as a set-RPE estimate; an actual
  whole-session RPE rating (#3) still needs implementing.
- Model, validator, localization and browser tests provide a baseline for conversion.
  They do not yet establish native-device readiness.
- The September consistency fixes are prepared locally. Backend changes need a
  Worker release when shipping; do not assume they are already deployed.

See [the codebase review](docs/2026-09-10-codebase-review.md) for remaining
validation/sync limitations and [the backlog](BACKLOG.md) for detailed bug tracking.

## Delivery sequence

### Early web alpha — 5 to 30 athletes

Run an invite-only PWA alpha alongside native Phase 1 after its own storage,
recovery, privacy/access and physical-device gates pass. Start with five athletes
using coach-provided plans (coach participation to be confirmed). The expected
80% iPhone / 20% Android split makes iPhone Safari/Home Screen rehearsal the priority;
aim for four iPhones and one Android in the first cohort. Native iOS completion and
the full coach dashboard are not prerequisites for this web trial.

Implementation block completed in working tree:
- **Local-only fail-closed alpha mode**: isolated prefix `gym_alpha.`, cloud requests disabled and choked via `syncFetch`, share URL/UUID restore/write token hidden in UI.
- **Preview ports**: port `8765` for personal deployment preview; port `8766` for athlete-alpha preview.
- **Storage dependability**: detect and preserve corrupted records without overwrite; structured save failure handling with rollback; crash-safe completion idempotency; staged-commit backup restore.
- **Coach-to-athlete handoff**: clean plan export without personal history or credentials; athlete import preview preserving workout history.

Expand to 10–15 and then 30 only after reliable saves/recovery and a supported
release process are demonstrated on physical devices.
See [the alpha launch plan](docs/plans/2026-09-11-athlete-alpha.md) and [phase-1-device-checklist.md](docs/phase-1-device-checklist.md).

| Phase | Outcome | Exit condition |
|---|---|---|
| 1 — Platform prototype | One complete workout on iOS and Android | Import, log, lock/resume, save offline, restart and export work on both |
| 2 — Shared foundations | Reliable data contract and portable workout logic | Existing backups survive migration and a complete workout round trip |
| 3 — Athlete app and closed beta | Full mobile workflow, including human-authored plans | Recovery, sync conflicts and device interruption tests pass with beta users |
| 4 — Human coach pilot | Coaches can review consenting athletes and draft plans | Access boundaries, plan revisions and athlete acceptance work end to end |
| 5 — Public release | Store-ready athlete app | Reliable onboarding, privacy controls, support and release checks |
| Later — Optional expansion | Built-in AI coaching and broader coach tools | Demand and operating costs justify each addition |

Phases 1 and 2 can overlap. Phase 4 can follow the athlete beta or public release;
its full feature set is not a prerequisite for launching the athlete app.

## Phase 1 — Prove the mobile workflow

Implementation started: the native prototype and automated checks are in place.
iOS/Android bundles compile. The Android debug APK builds and initial emulator
checks pass for workout recovery, completion, simulated sync retry and export.
Physical-device checks, iOS installation and full acceptance remain pending. See [prototype results](docs/native-prototype-results.md).

Android continuation verified native file import, comma-decimal logging, focused-note
save with the keyboard open, network-off completion/export, notification denial,
locked-screen notification posting, Skip cancellation and Finnish larger-text controls.
Input ordering, keyboard layout and development database lifecycle fixes are in place.
Grouped superset rounds are now implemented and tested without changing stored
identities/order. A locally signed Android release-mode build passed cold launch,
saved-set recovery, completion, restart and export with network and Metro forwarding
disabled. Full device measurement/editing coverage, release notification/storage-failure
tests and physical-device acceptance remain before Phase 1 can close.

Prototype one complete workout on each platform before porting every screen:

1. Import an existing plan and start a workout.
2. Log sets, including a timed/distance exercise and a custom equipment setup.
3. Lock the phone during rest; test notification permission granted and denied.
4. Resume the workout and confirm the remaining rest time is correct.
5. Save offline, terminate/restart the app, then export and reconcile with sync.

Use React Native + Expo development builds as the recommended prototype direction
for native-rendered athlete screens on iOS and Android. This recommendation is
subject to the Phase 1 device results, not a claim that Apple requires React Native.
Capacitor also supports native APIs/plugins and remains a fallback if interface
reuse proves more valuable than rebuilding the screens. Neither framework removes
OS background-execution or notification restrictions.

Follow [the Phase 1 implementation plan](docs/plans/2026-09-10-phase-1-native-prototype.md).
It defines the first workout, proposed modules, storage and notification behavior,
fixtures, implementation order and acceptance gates.

Test rest notifications, keyboard behavior, navigation, file import/export, sharing,
haptics and interrupted workouts on real devices. Packaging alone does not resolve
background timer behavior. Plan access to the iOS build/test environment alongside
Android development.

**Exit:** choose the platform approach from a working workout prototype. Do not
wait for built-in AI chat, more charts or complete visual polish.

## Phase 2 — Shared foundations before the full conversion

### Data contract and migrations

- Establish shared schemas and validation for plans, sessions, backups, library
  entries and measurement/setup metadata. Document the intentional differences
  between legacy normalization and stricter authoring checks.
- Add explicit version handling and migrations, using real legacy fixtures and
  representative current records. Do not rewrite identities from similar names.
- Test import → workout → save → restart → export, preserving historical values,
  descriptions, sides, setups, library snapshots, warm-ups and aliases.
- Reject unsupported future formats clearly rather than silently dropping fields.
- Design plan provenance and revision metadata for self, human-coach and AI authors.
  Older plans may have unknown authorship; do not invent or backfill an author.

### Portable logic and durable storage

- Extract plan operations, workout state changes, calculations, validation and sync
  from the screen/event code in `app.js`. Extend the existing model/library modules.
- Put storage behind an interface. Select transactional native storage for workout
  records and appropriate secure storage for credentials; keep web support usable.
- Define interruption recovery, failed-write handling and a durable sync queue.
- Provide a verified transfer from the web app to native storage. Keep the source
  backup recoverable until transfer is verified; do not delete it on first login.

### Complete the open exercise-library work

Unknown imported and mid-workout exercises currently bypass the library choice.
Offer explicit custom-entry versus existing-entry/alias selection across these
paths, including “Add to plan.” Preserve targets, order, supersets, sides, setups,
load profiles and existing IDs. Never merge historical identities automatically.
Cover English/Finnish, cancellation, active-workout safety and persistence.

**Exit:** shared logic runs independently of the UI, migration fixtures pass, and
an existing backup survives a complete workout round trip without data loss.
Start the full platform conversion at this point, even if later features are open.

## Phase 3 — Athlete app and closed beta

### Mobile reliability and sync

- Complete plan editing, workout logging, history, library, translations and
  import/export on the chosen platform approach.
- Implement native rest notifications and lifecycle recovery. Replace web-only
  service-worker/update behavior appropriately in packaged apps.
- Resolve concurrent-write risks before multi-device beta. Define conflict rules
  for plan changes, workout edits, deletions and offline retries; timestamp checks
  over whole-backup KV writes are not sufficient protection.
- Introduce user/device authentication, recovery and credential revocation before
  broader testing. Remove reliance on manually distributing write tokens and close
  the unauthenticated-write rollout path for that release.
- Separate revocable AI-sharing access from account recovery and coach access.
- Choose the backend/account implementation against these requirements. Supabase
  Auth/Postgres remains an option from the earlier roadmap, not a mandatory migration.

### Plans can come from a human coach

- Make plan onboarding and import source-neutral: write your own, receive from a
  human coach, or use an AI assistant. No AI account or prompt is required.
- Support a human coach preparing a plan through an accessible editor and sending
  an importable plan to the athlete. The athlete reviews and applies it without
  granting the coach access to historical workouts.
- Preserve author/source and plan revision metadata through import, export and sync.
- Apply the same validation and exercise identity rules to every authoring source.
- Define when a replacement plan takes effect. Preserve active-workout snapshots
  and past sessions; do not overwrite completed work when a new plan arrives.
- Keep AI-specific actions clearly labeled within the broader coaching workflow.

### Beta validation

Run real workouts on iOS and Android, including offline use, permission denial,
app termination, interrupted saves, reinstall/recovery, simultaneous device edits
and human-authored plan import. Collect feedback from a small athlete group before
expanding. Core tracking must remain useful without AI or an assigned coach.

## Phase 4 — Human coach interface pilot

**Goal:** a coach can see their athletes’ workouts and prepare subsequent plans.
A web/tablet-friendly coach interface is a candidate; it does not need to duplicate
the athlete’s mobile UI or ship as a separate native app.

### Athlete–coach relationship

- Invite and explicitly accept a coach relationship. Athletes can revoke access.
- Define visibility separately for workout records, notes, body weight and other
  sensitive fields. Do not grant full access simply because a coach sent a plan.
- Enforce athlete ownership and coach permissions on the server for every request.
  Coaches must never gain access to unrelated athletes through identifiers or links.
- Keep workout viewing, plan drafting and modification of completed logs separate.
  Start with viewing and drafting; completed athlete records remain protected.

### Initial coach workspace

- Athlete list with recent activity and current plan.
- Per-athlete workout history: planned versus completed work, actual measurements,
  notes within the allowed scope, and exercise progression.
- Draft/edit a plan using the same library, setups, measurements and validation as
  the athlete app; deliver a revision for the athlete to review and accept.
- Track draft, delivered and accepted plan states. Show who authored each revision.
- Handle athlete/coach concurrent edits and revoked access without silently
  replacing the athlete’s plan or losing work.

**Exit:** test invite → accept → view authorized workouts → draft → deliver →
athlete accepts, plus revocation and cross-athlete access-denial tests. Pilot with
a small number of coaches and athletes before adding team-scale tools.

## Phase 5 — Public release

- Prepare App Store and Play Store releases after device reliability is established.
- Finish onboarding, account/data deletion, privacy disclosures and sharing controls.
- Add support/feedback channels and operational monitoring for failed saves/sync.
- Verify upgrades from earlier app/data versions and rollback/recovery procedures.
- Confirm supported units/equipment. Implement and test an lb load ladder before
  advertising equivalent lb support, or state the limitation clearly.
- Evaluate accessibility, larger text, screen readers and both supported languages.
- Validate demand before committing to subscriptions or paid coach accounts.

## Later — Optional expansion

- Built-in AI coaching with server-held provider credentials, scoped data access,
  usage limits and cost controls. Keep external AI sharing available. Pricing,
  provider and whether the owner pays are decisions to revisit using actual usage.
- Coach conveniences such as reusable templates, groups, comments/messaging and
  summaries, prioritized from pilot feedback.
- Additional charts, health integrations and monetization when justified by demand.

## Training-feature sequence and original idea coverage

The original idea numbers below are stable references, not roadmap phase numbers.
These features remain in scope alongside platform work. The native prototype does
not wait for them all. Add schemas with migrations as features are delivered;
never invent values in historical records.

| Idea | Current status | Next delivery point |
|---|---|---|
| #10 Live completion sync status | Fixed locally and browser-tested; verify release status | Retain as Phase 1/3 regression requirement |
| #4 Exercise identity and equipment | Core movement/side/setup identities and custom ladders implemented | Phase 2 compatibility work; assess explicit grip/assistance variants without guessing old metadata |
| #8 Time, distance, pace and load | Core measurement types implemented | Phase 1 round-trip tests and Phase 2 migrations |
| #11 Exercise library | V1 implemented; entry paths incomplete | Phase 2 import/mid-workout custom-entry and alias choices; grow catalogue incrementally |
| #3 True whole-session RPE | Old proxy relabeled; actual rating not implemented | First session-feedback increment in Phase 3, after foundations |
| #1 Energy and soreness | Readiness exists; requested paired inputs still need explicit delivery | With #3 in Phase 3 |
| #2 Symptoms and next-day response | Planned | After session feedback in Phase 3; optional workflow |
| #12 Injury-recovery mode | Planned | After #2, over the same records; may follow initial beta |
| #7 Weight suggestions | Planned | After comparable-history and load-ladder validation; beta follow-up |
| #9 Snooze update banner | Planned | Web polish alongside Phase 2/3; native update behavior handled separately |
| #5 External activity context | Planned | Later expansion; manual entry/weekly attachment first |
| #6 Upper-body readiness | Research only | Define the test and decision it informs before implementation |

### Session feedback: #3 and #1

Ask an optional whole-session RPE at completion, stored separately from set ratings
with sessionRpeRecordedAt. Calculate whole-session-derived load only when that
rating exists; retain the old set-RPE proxy under its own label. Never backfill an
actual rating from a set average. Skipped ratings remain absent.

Use energy 1–10 (very low to excellent) and soreness 1–10 (none/minimal to extreme),
with optional soreness location. Keep existing CMJ measurements intact. Preserve
these fields in backup/export/sync and show only authorized data to coaches.

### Symptom workflow: #2, then #12

Distinguish not assessed, explicitly none, and symptoms reported. Capture optional
location/side, related exercise, onset load/repetition/duration/position,
end-of-session state, next-day same/better/worse, and swelling/catching flags.
Unknown remains unknown. Injury-recovery mode makes this same workflow more
prominent for selected areas or movements; it creates no parallel symptom system.
Use symptom-tracking language without diagnostic claims. Define appropriate help
wording and privacy scopes before releasing this optional workflow.

### Suggestions, context and polish: #7, #9, #5 and #6

- Suggest the next load; never silently change a prescription. Require sufficient
  comparable recent sets, a known load ladder and a visible explanation. Suppress
  suggestions when identity, equipment or measurement comparability is uncertain.
- Add “Later” to the web update banner with a defined reappearance rule (proposed:
  next launch) and Update in Settings. Never interrupt an active workout to update.
- Start external activity with manually recorded completed sessions or a weekly
  attachment. Keep it separate from prescribed gym work and derive pace from time
  and distance. Vendor integrations are later work.
- Research upper-body readiness by defining what decision it would change, the
  measurement method, equipment and repeatability. Do not add an undefined score.

## Backlog disposition

| Existing item | Planned handling |
|---|---|
| Unknown exercises bypass library selection | Phase 2; resolve before finalizing native exercise-entry screens |
| Locked-screen rest audio | Prototype in Phase 1; deliver/test native scheduling in Phase 3 |
| Duplicated load ladder | Keep parity tests; consider sharing during logic extraction, without adding a web build step solely for this cleanup |
| Undeclared equipment becomes `barbell` | Phase 2 compatibility decision: represent unknown equipment safely for new data; migrate only with evidence, never guess old equipment |
| No lb-specific load ladder | Phase 5 release-scope decision; implement before claiming equivalent unit support |
| Warm-ups count toward session progress | Retain intentional behavior; statistics continue to exclude warm-ups |

Resolved backlog bugs remain resolved and are not new platform prerequisites.
Keep detailed defects in `BACKLOG.md`; use this roadmap for sequencing and exit
conditions. Updating this document does not authorize deployment or mark planned
features as implemented.
