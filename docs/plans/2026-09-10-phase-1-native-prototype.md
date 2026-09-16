# Phase 1 implementation plan — Native workout prototype

Date: 2026-09-10
Status: implementation started; native scaffold, workout flow and automated checks exist.
Device acceptance remains pending. See [prototype results](../native-prototype-results.md).
Parent: [Roadmap Phase 1](../../ROADMAP.md#phase-1--prove-the-mobile-workflow).

## Objective and boundary

Prove one complete workout on iOS and Android using React Native + Expo development
builds. Import an existing plan, log sets, lock/resume during rest, save offline,
restart, export and exercise sync feedback with isolated test data. Use the result
to confirm the platform approach before the full conversion.

This is roadmap Phase 1, not a restart of the older feature list's reliability
patch. Completion sync feedback and honest set-RPE labeling are already present
locally; preserve them as regression requirements. Full migration infrastructure,
accounts, coach workspace, readiness/symptom features and AI chat belong to later
phases. Phase 1 may extract only the shared logic needed for this workout.

## Platform decision and capability checks

React Native + Expo is the proposed implementation choice because the intended
athlete app should have native-rendered screens and a shared iOS/Android codebase.
It requires rebuilding screens rather than importing existing HTML/CSS. Reuse
pure model logic, library data, translations and regression fixtures.

Apple does not require React Native. Capacitor offers native plugins and custom
Swift integrations while retaining a web interface. Both approaches can integrate
storage, local notifications and sharing; both remain subject to OS permissions
and background restrictions. If the prototype exposes excessive UI rebuild cost,
record a bounded Capacitor comparison before reconsidering the choice.

| Capability | Prototype approach | What must be proved |
|---|---|---|
| Workout UI/navigation | React Native components and Expo navigation | Keyboard, back navigation, safe areas, larger text and set-entry usability |
| Rest notification | expo-notifications, scheduled locally | Lock-screen delivery, permission denial, cancel/reschedule and duplicate prevention |
| Local workout persistence | expo-sqlite | Transactions, interrupted save recovery and restart survival |
| File import/export | Expo document/file/sharing modules | Existing JSON imports and recoverable exported files |
| Haptics | Expo haptics | Graceful fallback when unavailable or disabled |
| Future health/watch/live activity features | Separate native-module investigation if adopted | Not implied by React Native or included in this prototype |

Use development builds on real devices for the acceptance gate, rather than
relying only on Expo Go or simulators. Select and pin mutually compatible current
package versions when scaffolding; record the lockfile and chosen SDK version.
Local iOS compilation/simulator work requires a Mac with Xcode. On the current
Windows workstation, Android and shared-code work can proceed; arrange access to
a Mac or an iOS cloud build/signing path plus a real iPhone. Do not mark the iOS
gate passed if build access or device testing remains unavailable.

## Proposed implementation layout

Keep the PWA at the repository root and create a separately built mobile project
under `mobile/`. No change to the root static-host deployment is required.

| Proposed location | Responsibility |
|---|---|
| `mobile/app/` | Import/plan preview, workout and completion/history screens |
| `mobile/src/storage/` | SQLite migrations and repository operations |
| `mobile/src/platform/` | Notifications, lifecycle, file sharing and haptics adapters |
| `mobile/src/sync/` | Test transport and persistent retry queue |
| `shared/` | Only newly extracted DOM-free workout/import operations needed here |
| `tools/fixtures/native/` | Synthetic legacy/current plans and expected record semantics |
| `docs/native-prototype-results.md` | Build/device versions, test evidence, gaps and decision |

These paths are proposed outputs, not existing modules. Adapt the existing
`workout-model.js` and `exercise-library.js` exports for reuse without copying a
second independent rule set. If loading changes are necessary, keep browser/Node
compatibility and the PWA offline asset list working. Adapt translation lookup so
mobile imports do not depend on browser storage or DOM globals. Do not rewrite
all of `app.js` or introduce a web build solely for the prototype.

## Ordered implementation tasks

### 1. Capture the contract and establish fixtures

- Read the current normalization, session creation/completion, export and sync
  code plus model/library tests before extracting functions.
- Build synthetic fixtures for: a legacy name-only plan; a library exercise with
  explicit identity; separate left/right variants; a custom load profile; all five
  metrics; warm-ups; a superset and an alternate.
- Record expected fields/units, history keys, snapshots and warm-up exclusions.
- Preserve unedited historical records and fields the prototype does not display.
  Reject unsupported input clearly; never silently coerce it into another format.
- Run the existing test files separately and localization checks as a baseline.

Deliverable: fixtures and meaningful contract tests. No production backup or
credential is committed or sent to a build service.

### 2. Scaffold and run on both platforms

- Create the Expo/React Native TypeScript project under `mobile/`, with isolated
  application identifiers and a lockfile. Select compatible native packages.
- Add three small screens: plan import/preview, active workout, completion/history.
- Implement English/Finnish lookup using current catalogues, with user text intact.
- Produce development builds and record first launch on iOS and Android.

Deliverable: runnable native shell; no production sync connection by default.

### 3. Extract the minimal workout core

- Move only required normalization and workout operations behind DOM-free APIs:
  import/validate plan, start workout, update/complete set, finish workout, export.
- Reuse identity, measurement and load-profile rules from the current model.
- Snapshot plan prescriptions when starting a session. New plan imports cannot
  rewrite an active workout or completed history.
- Support load, height, duration, distance and cardio rows; retain side/setup and
  library snapshots. Exercise at least one superset and safe alternate swap.
- Match existing warm-up and metric exclusions in calculations. Keep the set-RPE
  proxy label; do not implement or infer whole-session RPE in this phase.

Deliverable: model tests plus one usable workout screen with existing semantics.

### 4. Add transactional persistence and restore

- Start with a small versioned SQLite schema for plan documents, active workout,
  completed sessions, rest state and an outbox. JSON payload columns are acceptable
  for the prototype if IDs, transactions and schema versions are explicit.
- Persist meaningful edits promptly; do not rely on a background callback to save.
- Finish a workout in one transaction: insert the completed session, remove active
  state and enqueue sync. Repeated completion must not duplicate the session.
- Show local save success only after commit; failed storage writes retain a
  recoverable active workout and an actionable error.
- On restart restore the active workout or committed history. Keep a backup of
  imported input; do not replace real web storage or migrate a production account.
- Import through a document or pasted JSON, validate before committing and export
  compatible JSON through the share sheet. Compare semantic content, allowing only
  intentional generated IDs/timestamps and documented normalization differences.

Deliverable: import → workout → commit → restart → export passes without network.

### 5. Implement rest and app lifecycle behavior

- Persist an absolute rest deadline and notification identifier. Calculate remaining
  time from the deadline on resume, rather than running a background JS countdown.
- Ask for notification permission in context. Workout logging must work when denied.
- Schedule a local notification; cancel/replace it on rest adjustment, skip, workout
  end or discard. Reconcile stale scheduled notifications after restart.
- Reconcile persistence/scheduler interruptions so a crash between those operations
  does not leave duplicate or obsolete alerts. Treat scheduling errors separately
  from successful workout saves.
- Test foreground, lock, background, resume and process termination separately.
  Record OS/device notification restrictions and denied-permission behavior; do not
  promise audible alerts under every silent/Focus/force-stop configuration.

Deliverable: correct resumed deadline, no obsolete alert after skip/end, and a
clear visible fallback when notification delivery is unavailable.

### 6. Exercise sync feedback safely

- Use a local/fake transport with success, offline, timeout, authorization failure,
  server failure and conflict responses. Never target the athlete's production UUID.
- Retain pending outbox entries across restart and retries. Preserve stable operation
  IDs and test duplicate delivery; distinguish client retry safety from server-side
  idempotency, which needs the Phase 3 backend work.
- Display distinct locally saved, sync pending, synced and sync failed/retry states.
- A conflict must retain local work and stop destructive overwrite; Phase 1 does
  not solve the current backend's concurrent-write limitations.

Deliverable: durable retry and honest status feedback using intercepted test sync.
Live multi-device reconciliation remains a Phase 3 gate.

### 7. Run acceptance tests and record the platform decision

| Scenario | Required evidence |
|---|---|
| Existing plan and backup import | Legacy and explicit identities preserved; invalid input does not replace valid data |
| Measurement coverage | Correct units/fields for all metrics; no seconds/metres stored as reps |
| Side/setup/library identity | No cross-side merging; instructions and snapshots survive export |
| Offline interruption | Completed sets survive termination; completion produces exactly one session |
| Storage failure | No false saved confirmation; active work remains recoverable |
| Rest lifecycle | Correct time on resume; cancel/adjust works; no duplicate obsolete notifications |
| Permission denial | Workout remains usable with clear rest-notification limitations |
| Sync retry/conflict | Pending state survives restart; retries do not erase or duplicate test history |
| Language and input | English/Finnish, decimal entry, keyboard dismissal and larger text usable |
| Human-authored plan | Same import path works with no AI prompt or account |
| PWA regression | Existing model/browser/localization checks still pass after shared extraction |

Automate contract, transaction and retry tests; run device checks on an iPhone and
an Android phone, recording OS/build versions and pass/fail evidence. Repeat
notification/lifecycle checks in a release-like build before declaring readiness.
Device tests may be pending while other work progresses; pending is not passed.

## Completion gate and handoff

Phase 1 is complete when the full workout flow passes on both platforms, data
round trips preserve semantics, and remaining limitations are recorded with their
next-phase owner. Confirm React Native + Expo or document the specific reason to
compare Capacitor. Proceed with Phase 2 foundations before porting every screen.

Produce a short results document with test evidence, reusable code, migration gaps,
notification constraints and the next implementation tasks. No store submission,
production data migration or backend deployment is part of this phase.

## Technical references

Checked when preparing this plan; recheck package compatibility during implementation.

- [React Native native platform integration](https://reactnative.dev/docs/native-platform)
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [Expo notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Apple local notification scheduling](https://developer.apple.com/documentation/usernotifications/scheduling-a-notification-locally-from-your-app)
- [Capacitor native runtime and plugin support](https://capacitorjs.com/docs)
