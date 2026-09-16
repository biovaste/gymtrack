# Native prototype results — 2026-09-10

Status: Android debug APK built and emulator smoke tests completed;
Phase 1 acceptance is **not complete**.

## Implemented locally

- Separate `mobile/` Expo TypeScript app using SDK 57, React Native 0.86.3 and React
  19.2.3, with compatible native packages and a lockfile.
- Plan import/preview, workout and history screens with English/Finnish controls.
  Human-authored JSON uses the same import path; there is no AI requirement.
- Synthetic legacy/current fixtures covering all metrics, custom stacks, sides,
  snapshots, warm-ups, supersets and an alternate.
- DOM-free prototype workout operations reusing the existing model/library modules.
  The legacy kg ladder is extracted with an executable parity test against the PWA.
- Versioned SQLite storage with an atomic completion transaction, active-workout
  recovery, preserved input backup and a persistent test-sync outbox.
- Deadline-based rest scheduling, cancellation/reconciliation, permission handling,
  file import/export, and optional haptics adapters.
- Local-only sync simulation for success, offline, timeout, authorization error,
  server error and conflict. Stable IDs prevent duplicate test receiver writes.

## Evidence

| Check | Result |
|---|---|
| Existing 10 test files, run separately | Pass |
| New native regression tests | 10 pass |
| Localization check | Pass, 697 existing catalogue entries |
| TypeScript | Pass |
| iOS Hermes/JavaScript bundle | Compiles |
| Android Hermes/JavaScript bundle | Compiles |
| iOS signed development/release-like build | Pending |
| Android APK/development build | Pass: x86_64 debug APK, JDK 17, installed on Pixel_10a |
| Android release-mode APK | Pass: bundled JavaScript, local debug signing key, emulator only; not an athlete/store distribution build |
| Android emulator launch | Pass: Android 17 / API 37.1, 16 KB x86_64 |
| Physical Android / iPhone launch | Pending |
| Android emulator keyboard, focused-note save and comma-decimal entry | Pass after fixes; physical devices pending |
| Android emulator notification denial, locked delivery and Skip cancellation | Pass; audible/silent/Focus and release-build behavior pending |

New tests cover metric fields, side isolation, snapshots, warm-up load rounding,
legacy extension preservation, rejection of future plan versions, ladder parity,
SQLite rollback on an injected failed outbox write, duplicate completion, database
reopen, retry outcomes, duplicate delivery, and rest cancellation/transitions.
Node SQLite tests use the same repository SQL but are not native integration tests.

## Environment and remaining work

- Workstation: Windows, Node 24.16.0. Android SDK/JDK/adb were not detected during
  initial setup; the Android emulator checks below were completed later. iOS requires access
  to a Mac/Xcode or a suitable cloud build/signing path and a real iPhone.
- Complete Phase 1 device gates before confirming the framework decision. Produce
  installable development builds, run the plan's acceptance matrix, and record
  actual OS/device/build versions and screenshots.
- Inspect rapid numeric edits, keyboard dismissal followed by Log/Save, navigation
  while editing notes, and interrupted notification scheduling on device. These
  interaction paths have not been validated by the Node tests.
- Superset tags/rest transitions are retained, but the prototype renders individual
  exercise cards rather than the PWA's full grouped round-robin interface. Cardio rows display pace derived from actual time/distance or speed.
- Prototype import is intentionally stricter than legacy browser normalization and
  refuses a second backup in an occupied database. Broader migration/replacement
  compatibility belongs to Phase 2. Validate imported units before broad lb use;
  the inherited standard equipment ladder remains kg-only.
- New screen copy uses inline bilingual pairs plus an existing catalogue lookup.
  Consolidate it into the translation reviewer workflow before mobile feature growth.
- No production sync, authentication, account migration, coach interface or store
  submission is implemented. Simulated sync does not fix KV concurrent-write risks.
- Dependency installation reported 11 moderate advisories. Review the dependency
  paths before distribution; no breaking automatic dependency upgrade was applied.

## Next implementation session

1. Arrange iOS build/signing and physical-device access; Android emulator setup is ready.
2. Run TypeScript and both bundle checks, then build/install development apps.
3. Exercise import → workout → lock/resume → offline completion → restart → export.
4. Fix any device findings, complete grouped-workout presentation, and move new
   mobile strings into the existing translation workflow.
5. Confirm the platform decision and proceed to Phase 2 shared migration foundations.

No production data was used, no cloud build was uploaded, and nothing was deployed
or committed. Existing unrelated local edits were retained.

## Android setup continuation

Android Studio is installed at `E:\Program Files\Android\Android Studio`, with
its bundled Java runtime. SDK is at `%LOCALAPPDATA%\Android\Sdk`; AVD is
`Pixel_10a`, running an Android 17 / API 37.1 x86_64 image with 16 KB pages.
The emulator's original startup failure was insufficient C: free space for its
12 GB data partition. Launching with writable data under `tmp/pixel-data` on E:
succeeded; Android boot completion was verified over adb. The Android debug APK now builds and installs; initial app-flow checks passed. No Mac is available; iOS build
and device checks remain pending a cloud build/signing path and physical iPhone.

## Android emulator smoke tests — 2026-09-11

- Built `mobile/android/app/build/outputs/apk/debug/app-debug.apk` with Temurin
  JDK 17; Java 25 and stale generated Gradle/C++ outputs caused earlier failures.
- Loaded the synthetic sample, started a workout, granted notification permission,
  logged a warm-up, confirmed the saved state, force-stopped/reopened the app and
  observed the completed set still present. Logged a working set and saved the
  workout; History showed two sets and the local-save message.
- Simulated offline sync retained the workout; successful retry changed the outbox
  display to “Synced to test receiver”. This is local simulation, not cloud sync.
- Export opened Android's share sheet. Read back the generated JSON: one session,
  two logged sets and the original sample plan. No file was sent externally.
- Fixed missing keys on alternative-exercise buttons and removed the explicit
  Android channel sound string that this SDK mistook for a custom asset.
- Verified Metro exclusions keep native outputs/toolchains out of the watcher while
  retaining app/package JavaScript. Added a localhost-only IPv4 launcher for adb.
- Seven regression tests and TypeScript checks pass after the changes.

Still pending: full measurement/editing matrix, rapid edit then Log/Save, file-picker
import, actual network-off operation, lock-screen delivery/audio, permission denial,
physical devices, iOS, and all Phase 1 acceptance gates. The emulator debugging
connection stalled during later checks; do not infer physical-device reliability
from this smoke test. The first app termination immediately after a tap occurred
before save confirmation; recovery was verified separately after the UI confirmed
completion. Killing the process before a write completes is not a successful save.
Final recovery check: rebooted the stalled emulator with the same data image,
reopened the app with the updated JavaScript, and confirmed History still shows
“Press left: 2 sets” and “Synced to test receiver”. Screenshot:
`tmp/android-history.png`. The localhost development server remains running.

## Android acceptance continuation — 2026-09-11

This section supersedes the earlier pending status for the specific checks below.
All data used was synthetic. No production sync, accounts or deployment were used.

### Fixes

- Numeric fields and workout notes now buffer their latest text. Log/Save applies
  and validates the whole buffer before writing, rather than relying on blur order.
  Navigation and app-state changes also flush edits. Invalid input blocks logging;
  confirmed Discard remains available even when a draft is invalid.
- Android keyboard avoidance now reduces the content area. Save can be scrolled
  above the keyboard while the note field remains focused.
- An `expo-sqlite` native null-pointer error appeared after development reloads.
  A clean launch recovered confirmed sets. Initialization now requests a separate
  connection and closes it after queued repository work on effect cleanup. Subsequent
  preference, workout and timer writes passed. Repeat this in a release-like build;
  the observed development error must not be treated as evidence of release safety.
- Emulator startup again hit low C: space (about 1.1 GB). Copied its configuration
  into `tmp/android-avd` on E: and taught the launcher to use that copy. The original
  Android Studio AVD configuration was retained. The relocated configuration opened
  with fresh application state and the prototype was reinstalled; do not assume
  AVD configuration copies preserve application state. Previous exported evidence
  remains in `tmp/emulator-export.json`.

### Verified on the Android emulator

| Scenario | Evidence |
|---|---|
| Native file-picker import | Pushed synthetic `current-plan.json` as Downloads/coach-plan.json; selected it through Android Documents and started the imported workout |
| Decimal edit then Log | Entered `35,5` in a focused load field; logged row and exported JSON contain numeric `35.5` |
| Keyboard-open note then Save | `tmp/phase1-focused-save.png` shows focused note and accessible Save above the keyboard; clean-launch save succeeded |
| Actual network-off completion/export | Emulator Wi-Fi and mobile data disabled; save and native share-sheet export worked; Metro remained reachable through adb forwarding |
| Persisted values | `tmp/phase1-offline-export.json` contains `Offline_note_just_typed`, warm-up load 35.5, and working load 28 in one session |
| Permission denial | Denied Android notification prompt; working set saved and timer remained usable with an explicit disabled-notifications message (`tmp/phase1-denied.png`) |
| Locked-screen notification | Enabled permission, extended rest, locked screen; Android notification service recorded one `Rest complete` notification with default system sound configured |
| Rest Skip cancellation | Native scheduled-notification preference contained the rest request before Skip and no request afterward (`tmp/phase1-notification-before.xml`, `tmp/phase1-notification-after.xml`) |
| Finnish / larger text | Finnish Plan controls visually inspected at font scale 1.3; user-authored exercise names retained (`tmp/phase1-finnish-large.png`) |
| Regressions | All 11 test files pass, including eight native tests; TypeScript passes |

Network connections and font scale were restored after testing. No export was
sent to a third party. Notification posting was verified, not audible output.

### Remaining work

- Full on-emulator measurement-editing matrix, invalid/legacy file-picker imports,
  invalid-draft recovery, grouped superset presentation and broader accessibility.
- Repeat lifecycle/storage failure and notification checks in a release-like build,
  including cold launch without Metro, foreground/background transitions and force-stop.
- Physical Android and iPhone acceptance, silent/Focus/audio and iOS signing/build.
- Translation-review integration and broader migration/sync foundations remain in
  the roadmap. Phase 1 acceptance is still incomplete.

## Supersets, release mode and alpha preparation — 2026-09-11

Implemented grouped superset presentation using `shared/workout-groups.js`.
Adjacent matching groups render warm-ups separately followed by alternating work
rounds. Original exercise/set indices, side/setup identities and persisted order
remain unchanged. Unequal set counts and nonadjacent same-name groups have tests.
Plan-preview measurement names now use existing translated catalogue labels.

Added edited-measurement round-trip coverage for load/reps/RPE, height, duration,
distance and cardio, including decimals and invalid values. Ten native tests,
all eleven test files and TypeScript pass. These are portable contract checks;
they do not replace interacting with every field on physical phones.

Built `mobile/android/app/build/outputs/apk/release/app-release.apk` successfully
with JDK 17 (`tmp/phase1-release-build.log`, 542 Gradle tasks). This is x86_64 release
mode with the generated debug signing key, intended only for local emulator tests.
`mobile/tools/build-release-test.ps1` documents the reproducible command.

Installed over the isolated prototype; removed all adb reverse forwarding and
disabled emulator Wi-Fi/mobile data. Verified:

- Cold launch independently of Metro; existing active workout recovered.
- Superset presentation in the running release build; screenshot
  `tmp/phase1-release-groups.png`.
- Logged a warm-up, allowed persistence to complete, force-stopped and reopened:
  the row remained completed (`Undo set`).
- Saved offline, force-stopped and reopened: the completed session remained in
  History alongside the prior synthetic session; both outbox entries were pending.
  Screenshot `tmp/phase1-release-history.png`.
- Native export opened the share sheet with `gymtrack-prototype-backup.json` while
  still offline. No file was sent externally. Network settings were restored.

Grouped presentation and basic release cold-start/completion/recovery/export gates
are now exercised. Still pending: the full on-device editing/invalid-import matrix,
release notification/silent/Focus and injected native storage-failure checks,
physical Android and signed iPhone acceptance. Use the
[device checklist](phase-1-device-checklist.md); Phase 1 is not yet complete.

The [5–30 athlete web-alpha plan](plans/2026-09-11-athlete-alpha.md) can proceed on
its own launch gates while native validation continues. Coach-provided plans and
an estimated 80/20 iPhone/Android cohort are the current assumptions; the coach's
participation is not confirmed. No hosting release or invitations were performed.
