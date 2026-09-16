# Phase 1 physical-device handoff

Use synthetic data first. Record build, phone model, OS, language and whether the
test was a native build, Safari browser, Home Screen webapp or Chrome browser.
Native and PWA results are separate; passing one does not certify the other.

## Before inviting athletes

For the expected 80/20 Apple/Android alpha, prioritize an iPhone Safari/Home Screen
rehearsal and one Android Chrome rehearsal. The native prototype also needs an
iPhone signed build, which cannot be established by the Windows emulator.

### Web Alpha Physical-Device Checklist (Immediate Priority)

> Emulated pre-run 2026-09-16 (`node tools/device-checklist-emulated.mjs`, report in
> `tmp/checklist-emulated/report.md`): Edge/Chromium, iPhone-size viewport, CDP touch, real
> service worker, synthetic data. 28 rows passed in emulation, 1 failed (Finnish at 320 px with
> larger text: superset member rows overflow ~13 px, present in `HEAD` before this work),
> 3 device-only. **Emulation is not WebKit or a phone. The Pass/fail column below stays empty
> until each row is done on a physical device.**

| Step | Expected result | Pass/fail and evidence |
|---|---|---|
| Install/open exact alpha build | Version identifiable (e.g. `GymTrack Athlete Alpha 0.1.0-alpha`), badge visible, clear plan onboarding | |
| Coach plan-only handoff | Athlete sees their imported plan; coach's history, weight, and cloud credentials completely absent | |
| Invalid/future plan import | Clear error, preview cancelled, previously saved plan & active workout unchanged | |
| Legacy backup restore | History, setup/side identities and notes retained; active workout unaffected | |
| Start superset | Warm-up separate; rounds alternate the grouped movements | |
| Edit load/reps/RPE, then Log | Latest values retained, including comma decimals in Finnish | |
| Log height/time/distance/cardio | Correct units/fields; no measurements written as reps | |
| Alternate before logging | New metric/identity fields correct; sides remain separate | |
| Invalid input, correction and discard | No false saved state; user can recover or discard | |
| Notes with keyboard open, then Save | Save reachable and latest note retained | |
| Deny notifications | Workout usable, limitation clear | |
| Grant notifications, lock during rest | Deadline correct on resume; record actual posting and sound separately | |
| Extend/skip/end rest | Old scheduled alert cancelled; at most one current alert | |
| Silent/Focus and force-stop | Record observed OS restrictions; no universal sound promise | |
| Turn off network; finish workout | Exactly one local session saved; zero network push attempts | |
| Close app/browser and reopen offline | Confirmed sets/history recover; active workout intact; service worker serves app offline | |
| Export and restore in clean profile | Same session count, values and identities; local storage prefix isolated (`gym_alpha.`) | |
| Fail a storage write (quota/simulated) | Active workout kept safe; retry or emergency backup offered; no false completion | |
| Update old installed/cached build | Active/finished workouts retained; update banner shown; no mid-workout forced reload | |
| Larger text and Finnish | Controls reachable; no clipped essential labels | |
| Drag exercise card (Home Screen, touch) | Hold grip ~0.35 s, drag: preview follows finger, blue insertion line; normal swipe on the card scrolls; swipe starting on grip before the hold does nothing; keyboard/typing in a set field never starts a drag | |
| Drag superset + completed exercise | Superset moves as one block, member order kept; completed card keeps its ✓ sets, note and expanded/collapsed state after moving | |
| ↑/↓ reorder with VoiceOver/TalkBack | Buttons announce "Move … up/down"; move is announced; focus stays on the control | |
| Plan-editor reorder vs active workout | Plan reorder changes the next workout only; workout reorder leaves the plan unchanged; order survives app close/reopen | |
| Timed set: start, lock, return | Countdown correct after unlocking (not reset or stretched); if expired while locked: "Time's up" shown, no late alarm, set NOT logged | |
| Timed set: foreground expiry | One audible cue (with sound on, not silent switch) + vibration on Android; record iPhone silent/Focus behaviour separately | |
| Timed set: pause, reset, cancel, Log | Pause holds time; Reset returns to target paused; ✕ removes timer; Log writes elapsed seconds (editable) and only then starts rest | |
| Timed set vs rest timer | Starting the exercise timer ends a running rest; logging another set ends the exercise timer; never two alarms | |
| Weighted pull-up/dip | Plan editor: Bodyweight → "Log added weight" → field reads "Added weight (kg)"; stepper ±1.25 kg; 0 allowed; history shows "+x kg", no e1RM, separate from old bodyweight-only history | |
| Cloud isolation verification | Cloud sync toggle absent in alpha; syncFetch throws; no share link or write token leaks | |

### Native iOS Signed Build & Offline Workout Follow-up Checklist

> [!NOTE]
> Native iOS evaluation requires a macOS host with Xcode and an Apple Developer Team account for codesigning. This must not block the web-alpha release.

| Step | Environment & Pre-requisite | Expected result | Pass/fail and evidence |
|---|---|---|---|
| Xcode signed build provisioning | macOS + Xcode + Apple ID / Developer Team | Clean build of `mobile/` project; provisions to connected physical iPhone | |
| Metro-less standalone launch | iPhone disconnected from host machine | Native app launches completely standalone without Metro bundler server | |
| SQLite local database migration | Physical iPhone clean install | Schema versioned; tables created (`sessions`, `plans`, `drafts`, `kv`) without errors | |
| Offline workout execution | Airplane mode enabled on iPhone | Active session records sets, transitions, and superset rounds without network | |
| Background audio / haptics | iPhone locked or screen dim during rest timer | Audio cues and haptics trigger on timer expiration according to iOS silent mode policy | |
| Interrupted workout crash recovery | Force quit native app during active workout | App re-launches into active workout without duplicated or dropped sets | |
| Idempotent completion | Finish workout with simulated storage delay/interrupt | Workout committed once to SQLite; active draft removed cleanly | |
| Data handoff to web alpha | Export JSON from iOS native app -> import in web alpha | Full schema compatibility; records import cleanly into web app | |

Report a problem with the step, expected/actual result, version and device. Attach
a redacted screenshot if useful; do not send access credentials or personal workout
backups by default. Stop a trial for confirmed data loss or cross-athlete exposure.
