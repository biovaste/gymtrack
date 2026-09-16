# GymTrack native prototype

React Native + Expo SDK 57, isolated from production sync and the root PWA.

## Run

From this directory, install the locked dependencies with `npm ci`, then:

- `npm start` starts the development server.
- `npm run android` builds/runs with an installed Android SDK/JDK and a device/emulator.
- `npm run ios` builds/runs on a Mac with Xcode and appropriate signing.
- `npm run typecheck` checks TypeScript.
- `npm run bundle` compiles both native JavaScript/Hermes bundles. This is not an APK/IPA or a device test.

On restricted Windows environments point TEMP and TMP at the repository's ignored
`tmp` directory before running Expo. Native compiler processes must be permitted.
Use a development build for acceptance tests. No Expo account, signing identity or
production credential is included. Cloud builds have not been configured or run.

Start with **Try sample workout**, or import a synthetic plan/backup file. The
prototype deliberately accepts one initial backup per local database; replacing
an occupied database is refused. Export before any manual app-data reset. Backup
export contains completed sessions, not an in-progress workout; active work is
retained in local SQLite across restart.

All sync outcomes are simulated locally. “Synced to test receiver” never means
production cloud backup. A separate local test receiver stores operation IDs to
exercise retries. No network endpoint or real athlete UUID is used.

## Checks and boundaries

Run `node --test --test-isolation=none tools/native-prototype.test.mjs` from the
repository root. It uses Node's SQLite implementation against the same repository
SQL/interface as Expo; it cannot establish device-specific SQLite behavior.

See [results and remaining gates](../docs/native-prototype-results.md). The mobile
screens are a first implementation, not visual/device-verified. The broader
schema migration, production sync, coach UI and complete PWA feature parity belong
to later work. Imported exercise text is retained as written. New bilingual
prototype copy currently lives in App.tsx; integration with the durable translation
review workflow remains a Phase 2 task.
## Windows Android setup

Android Studio and the Pixel_10a AVD are installed. The original C: data partition
could not be created because it needed 12 GB and the drive had only about 10 GB
free. Use the project-drive launcher below instead (do not start a second instance
of the same AVD while one is running):

```powershell
# From mobile/, in a separate terminal:
.\tools\start-emulator.ps1

# In the app terminal:
. .\tools\android-env.ps1
npm run android
```

The launcher places writable emulator data under the ignored repository `tmp`
folder and uses software graphics. Pass `-Headless` for automated checks. It does
not move or delete the original Android Studio AVD. Do not delete `tmp/pixel-data`
if you want to keep prototype workouts stored in that emulator.

The environment helper uses the local Temurin JDK 17 under `tmp/jdk17`, or an
existing JDK 17 selected by `JAVA_HOME`. Android Studio's bundled Java 25 failed
native configuration in this setup. Keep the downloaded NDK under
`tmp/android-ndk-r27b` while the generated `android/local.properties` points to it.
Metro excludes temporary toolchains and native build outputs from file watching.

After the debug APK is installed, use `./tools/start-dev.ps1` from `mobile/`.
It starts Metro on IPv4 localhost and forwards the emulator's port, keeping the
server off the LAN. Open GymTrack Prototype in the emulator and select the local
server. The first Expo developer menu can be dismissed with Continue then Close.
Android emulator smoke results are recorded in `docs/native-prototype-results.md`.

If `tmp/android-avd/Pixel_10a.ini` exists, the emulator launcher uses that project-drive
configuration copy to avoid C: free-space startup checks. The original Android Studio
configuration remains separate. Switching AVD configurations can create fresh app
state; export any data you want to retain first.

The latest Android checks cover file-picker import, focused decimal/note edits,
offline save/export, denied notifications, locked-screen posting, rest cancellation,
and Finnish controls at larger text size. The full acceptance matrix is still pending.

For a standalone emulator build, run `./tools/build-release-test.ps1`. Its x86_64
release-mode APK includes JavaScript and runs without Metro, but uses the generated
debug signing key. It is not a store build or a package for the athlete cohort.
Basic offline cold-start/recovery/completion/export checks passed in this build.
Supersets now display warm-ups followed by alternating rounds.
