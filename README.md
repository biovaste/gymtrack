# GymTrack 🏋️

A gym workout tracker built as an installable web app (PWA) for iPhone, designed to
exchange workout plans and training logs with Claude via JSON. No accounts, no
dependencies, no build step — your data lives on your device and syncs automatically
to the cloud.

## Features

- **Workout plans from Claude** — paste a JSON plan, the app shows planned sets ×
  reps @ weight, target RPE and rest time per exercise.
- **Edit & alternates** — change any target in the Plan tab; every exercise can carry
  alternate options (busy equipment? tap 🔁 to swap mid-workout, or type any exercise).
- **Logging** — actual weight, reps and RPE per set; check a set off to log it.
- **Rest timer with audio cue** — starts automatically when you complete a set, beeps
  and vibrates when time is up, with +15s and skip controls. Survives a reload —
  the countdown resumes at the correct time instead of resetting.
- **Plate calculator** — 🏋️ on any exercise shows the per-side plate breakdown for
  its planned weight.
- **Session length** — live timer in the header, duration saved with each session.
- **Exercise identities and setups** — reuse a movement key across plan days, track
  sides and machines independently, and save custom load increments or carriage offsets.
- **Timed and distance exercises** — log weighted holds, carries and treadmill work
  with seconds, metres and speed. Pace is calculated automatically.
- **Exercise explanations** — ℹ️ shows the plan's description, with a built-in
  fallback library of ~35 common lifts.
- **History & PRs** — per-exercise progression with estimated-1RM sparklines, PR
  detection, full session log.
- **Notes & body weight** — per-exercise and per-session notes plus a body-weight
  log, all included in the Claude export.
- **Claude exchange** — one button copies a coaching prompt + your last 15 sessions,
  body weight and current plan; paste Claude's reply back to import the next plan.
- **Automatic cloud sync** — works on first launch with no setup. The app pulls your
  latest data on launch and pushes after every workout. Share a link to let any AI
  read your training data directly.
- **Offline** — full offline support via a service worker once installed.

## Getting it on your iPhone

The app is plain static files, so any HTTPS static host works:

1. **GitHub Pages (recommended — updates with every push):** in the repo on GitHub,
   **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root**.
   Your app goes live at `https://<user>.github.io/<repo>/`.
2. **Or Netlify Drop:** go to <https://app.netlify.com/drop> and drag this whole
   folder onto the page for an instant `https://something.netlify.app` URL.
3. Open the URL in **Safari** on your iPhone → tap **Share** → **Add to Home
   Screen**. It now launches full-screen like a native app and works offline.

To test on this PC: `python -m http.server 8765` in this folder, then open
`http://localhost:8765`.

> **Updating after a deploy:** the service worker refreshes files in the background
> and shows a "New version available" banner as soon as the update is ready — tap
> **Update** to reload on the new version immediately.

## Using it with Claude

**Get your next plan:** AI Coach tab → **Copy coaching prompt + data** → paste into any
Claude chat. It contains your recent sessions (actual weights/reps/RPE), notes, body
weight, your current plan, and instructions telling Claude to reply with a
`workout-plan` JSON block.

**Load the new plan:** copy Claude's JSON block → AI Coach tab → paste into
**Import a plan** → Import. History is always kept.

### Automatic cloud sync — no setup required

Sync starts automatically on first launch. The app:
- Pulls your latest data when you open it
- Pushes after every saved workout
- Shows "✓ Synced …" in the status line
- Merges sessions and body-weight entries by id/date on pull, so a session logged
  offline on one device isn't lost if another device syncs first

### Sharing data with an AI

AI Coach tab → **Share with AI** → copies a URL you paste into any AI chat. Claude,
ChatGPT, and Gemini can all fetch the JSON from that link and reply with a new plan.

The share link is **read-only**. Anyone holding it can read your training data — that is
the point, and the UUID's unguessability is the only thing protecting it — but they
cannot write. Writing needs the separate write token below, which never appears in a
share link.

### Data recovery

Settings (gear icon, top right) → **Your backup code** shows your unique UUID. Save it
somewhere safe (notes app, password manager). On a new device, open the app → Settings →
**Restore from backup code** → paste your UUID — your full history is restored.

### The write token

Every write to the sync API needs a token derived from a secret held by the Worker. Set
the secret once:

```bash
cd worker
wrangler secret put GYMTRACK_WRITE_SECRET
```

Then derive the token for your UUID and move it out-of-band to each device — it is
deliberately not fetchable over the API, since an endpoint that handed it out would make
it exactly as guessable as the UUID it protects:

```bash
set GYMTRACK_WRITE_SECRET=<the same secret>
node tools/write-token.mjs <your-uuid>
```

Paste the 64-character result into Settings → **Write token** on each device that logs
workouts, and set it as `GYMTRACK_WRITE_TOKEN` on any desktop that pushes plans.

While `GYMTRACK_WRITE_SECRET` is unset the Worker accepts unauthenticated writes — that
is the rollout window that lets the API deploy before the phone holds a token. Set it
once the app side is live.

### Desktop → phone: push a plan with no copy-paste

Claude can push a plan from your desktop directly to your phone — the phone picks it
up automatically on next launch.

```bash
# set your UUID once (copy it from Settings → "Your backup code"):
set GYMTRACK_UUID=<your-uuid>
# and the write token (see "The write token" above):
set GYMTRACK_WRITE_TOKEN=<your-token>

# then push a plan:
node tools/push-plan.mjs path/to/plan.json      # or pipe the JSON via stdin
```

To check a plan without sending it anywhere — no UUID, no network:

```bash
node tools/push-plan.mjs --check path/to/plan.json
```

The script does a safe read-modify-write — only the plan changes, your logged sessions
and body weight are kept — and bumps the sync timestamp so the app pulls it on launch.

It also **validates before pushing** and refuses a plan that would corrupt your history
or send you an impossible weight:

- **Duplicate exercise names** anywhere in the plan. Exercise history is keyed on name
  across all days, so two different movements sharing a name merge into one progression
  history. Legacy exercises still need distinct names (`… — Single-Arm` / `… — Two-Arm`).
  Exercises with explicit `movementId` may repeat across days; side, equipment,
  setup and measurement identify comparable history.
- **Weights that aren't loadable** on the declared `equipment` — a 22.5 kg dumbbell when
  they go in 2 kg steps, or 85 kg on a 23 kg trap bar (83 and 85.5 are the real rungs).
  Set `equipment` accurately or this check can't work.

Alternate-exercise weights and non-kg units warn but don't block. `--force` pushes anyway.

### Plan JSON schema

```json
{
  "type": "workout-plan",
  "version": 1,
  "name": "Block 2 — Strength",
  "days": [
    {
      "name": "Day A — Push",
      "warmup": [
        { "name": "Bike", "detail": "5 min easy" },
        "Band pull-apart × 20"
      ],
      "exercises": [
        {
          "name": "Bench Press",
          "sets": 4,
          "warmupSets": 2,
          "reps": "6-8",
          "weight": 60,
          "targetRpe": 8,
          "restSeconds": 150,
          "metric": "load",
          "superset": null,
          "description": "1-2 sentence how-to",
          "alternates": [
            { "name": "Dumbbell Bench Press", "weight": 22, "description": "…" }
          ]
        }
      ]
    }
  ]
}
```

**Warm-ups.** `warmupSets` (optional, default 0) adds that many ramp rows ahead of
the working sets — `sets` still means *working* sets, so adding warm-ups never
changes the prescription. Each rung is seeded from the working weight and rounded
down onto a weight the gym can actually load; all of it stays editable, and any
row can be flipped between warm-up and working by tapping its number during the
session. Completing a warm-up set starts no rest timer, and warm-up sets are
excluded from volume, PRs and every progress chart.

`days[].warmup` (optional) is the day's general prep — a checklist shown at the
top of the session, not logged sets. Bare strings work; `{ name, detail }` gives
you a note underneath.

### Movement, equipment and measurement fields

In the exercise editor, choose a measurement and expand **Movement history and
equipment setup**. A movement key can be a readable name such as
`seated-dumbbell-press`; use it again on another day even if the display name differs.
Use separate keys for meaningful movement variants. `side` is `unspecified`,
`left`, `right` or `bilateral`. `setupId` names a particular machine/setup.
Selecting an existing setup copies its equipment and load profile. Profiles are
snapshotted with workouts so editing a future prescription does not rewrite old logs.
Use a new setup name when the load convention or machine changes.

`loadProfile` overrides the standard equipment ladder:

```json
{"unit":"kg","offset":0,"increment":7}
```

A 53 kg carriage with 10 kg increments uses `{"unit":"kg","offset":53,"increment":10}`.
For irregular equipment, replace `increment` with `loads`, an ascending list of
available **total** loads including the offset, e.g. `[53,63,78]`.

| Metric | Planned fields | Actual set fields |
|---|---|---|
| `load` (legacy default) | `weight`, `reps` | `weight`, `reps`, `rpe` |
| `height` | Number of attempts in `sets` | `heightCm` |
| `duration` | `durationSeconds`, optional `weight` | `durationSeconds`, `weight`, `rpe` |
| `distance` | `distanceMeters`, optional `weight` | `distanceMeters`, `weight`, `rpe` |
| `cardio` | `durationSeconds`, `distanceMeters`, `speedKph` (optional targets) | Same actual measurements plus `weight`, `rpe` |

A weighted plank can use `metric: "duration", weight: 10, durationSeconds: 30`.
A treadmill can use `metric: "cardio", durationSeconds: 600, speedKph: 12`.
Enter pace as `min:sec/km` in the editor to convert it to speed. Actual distance
and time take precedence for calculated pace when both are recorded.
Timed/distance sets never contribute repetitions, lifting volume, estimated 1RM,
or the legacy set-RPE load estimate. They do count as completed sets. Ramp warm-up
prescriptions apply to `load`; individual attempts can still be marked warm-up.
Alternates can carry the same identity/setup/measurement fields. Swap before
logging any sets so completed work stays attached to its original movement.

Old records keep their names and original values. Adding an explicit movement key
starts an explicit-identity history; the app does not guess how to reassign legacy
records. Existing name aliases continue to work for legacy records.

The displayed **Set-RPE average / estimated load** is a rep-weighted average of
set ratings multiplied by session minutes. It is a proxy, not a whole-session RPE
rating. No whole-session score is inferred or backfilled. Completion confirms local
saving independently of cloud sync, then shows success or an error with Retry sync.

## Exercise library v1

In Plan, expand a day and use **+ Exercise** to search the library. The initial
30 entries cover practical presses, pulls, squats, hinges, isolation, core, carries
and cardio. Search includes the existing English/Finnish names and dictionary
aliases. Filter by movement category or target muscle. Variant details show base
movement → equipment → position → execution. A one-arm variant does not choose
left or right: set the side and machine/setup in the existing plan editor.

Select an entry to review the usual prescription before saving. New exercises
append to the day; existing ordering and supersets are unchanged. For an unfamiliar
name, use **Create custom entry**: create a separate UUID identity, or explicitly
select an existing entry to register the name as a library alias. Suggestions are
only discovery; they never merge identities or rewrite old logs. Existing history
aliases remain separate. A renamed plan exercise is a display label, not an
implicit alias registration or historical migration.

### Data and portability

- `plan.library` is an array of saved reusable entries. An entry contains `id`,
  `name`, `movement`, `category`, `muscles` (array), `equipment`, `position`,
  `execution`, `metric`, `description` and `aliases` (array). Curated IDs use the
  `library:` namespace; custom IDs use `custom:` plus a UUID. Treat published IDs
  as permanent, even if a catalogue name changes later.
- Each selection stores a deep `libraryEntry` snapshot on the exercise, with
  `movementId === libraryEntry.id`. Include both when constructing an imported
  library exercise. Standalone `movementId` values still retain the existing
  explicit-identity behavior; they are not guessed to be library references.
- Nonempty exercise `description` is a plan-specific override. Blank inherits the
  selected entry's instructions. Snapshots preserve the selected defaults and
  workout instructions when another plan or catalogue changes. New completed
  sessions also preserve the override; old sessions are never backfilled.
- Side, setup, load profile, targets, sets and supersets remain prescription data,
  separate from library variants. Equipment/side/setup/metric still participate in
  the existing comparison key. Custom load ladders are not library-wide defaults.
- App plan imports, the desktop push helper, and the Worker plan-only endpoint
  retain saved entries and union aliases by explicit ID. Incoming entry metadata
  wins a same-ID conflict; no similar-name reconciliation occurs. Cloud pulls
  retain local-only library entries and aliases while keeping the existing plan
  conflict policy. Full backup restore intentionally replaces the whole backup.
- Full backups, AI exports (`currentPlan`), cloud sync and offline storage include
  the library and snapshots. Removing an exercise from a day does not delete its
  saved library entry. Snapshot-only entries can be discovered and retained too.

Names and standard instructions reuse `exercises.js` and `locales/source/exercises.json`;
new UI text is in `locales/source/library.json`. Custom text remains as written
until translated through the established pending-exercise/reviewer workflow.
There is no external exercise database, library-wide editor or alias-removal UI in
v1. New variants can be created through the custom-entry form. Mid-session free-text
adding remains the existing workflow; the library picker is for plan authoring.

### Verification and release

Run `node --test --test-isolation=none tools/exercise-library.test.mjs` plus the
existing model, pure, localization, weight and validator checks. The existing
`tools/i18n-browser-smoke.mjs` now includes `tools/exercise-library-browser-checks.mjs`,
using isolated data and intercepted sync. On Windows use the ignored repository
`tmp` directory for TEMP/TMP and the bundled Playwright with installed Edge.
Run `node tools/i18n/cli.mjs build` and `node tools/i18n/cli.mjs check` before release.
The library asset participates in offline cache versioning and installation.

This release includes a Worker change for retaining entries on plan-only updates:
release both the static app and Worker when authorized. No deployment is performed
as part of preparing these local changes.

## Demo mode

A public, clickable instance of the app that starts from fabricated data and resets on
reload — for linking from a portfolio case study, and for screen captures.

Turn it on with **`?demo=1`**, or by serving the app from a host whose first label is
`demo` (`demo.gymtrack.hithitpull.fi`). Locally:

```bash
python -m http.server 8765
# open http://localhost:8765/?demo=1
```

What changes, and nothing else:

- **Storage** — the demo reads and writes `gymdemo.*` keys instead of `gym.*`, and wipes
  and reseeds them on every load. It never touches the real app's data, which matters
  because `?demo=1` shares an origin with production.
- **Cloud sync is off entirely.** `settings.autoSync` is forced false, so no push is ever
  scheduled and the launch reconcile never runs; `syncFetch()` — the single function every
  Worker request passes through — throws under DEMO as a backstop.
- **Hidden:** the backup code, restore-from-code, write token, auto-sync toggle, "Share
  with AI", and the update check. **Kept:** "Copy coaching prompt + data", which is the
  headline feature and runs entirely client-side, and the language switcher.
- **No service worker is registered**, so a reload always fetches the current build. A
  demo served under `?demo=1` on a host that already installed the worker will still be
  served through that existing cache — nothing is unregistered, because on the production
  origin that would kill the real app's offline support.
- An intro card on the workout tab explains what the app is and that the data is generated.

The seed lives in `demo-data.js`: a fixed-seed generator producing ~6 months of training
with progressive overload, ladder-snapped plateaus, a deload week, missed weeks, stalls and
PRs, ending in the current week so the demo never looks abandoned. Validate it the same way
as any plan:

```bash
node tools/demo-plan.mjs tmp/demo-plan.json
node tools/push-plan.mjs --check tmp/demo-plan.json
node --test tools/demo.test.mjs
```

**The case-study link** the intro card points at is `DEMO_CASE_STUDY_URL`, at the top of
`demo.js`. That is the only place it appears.

### Deploying it

The demo lives on the `demo` branch, which is `main` plus `demo.js`, `demo-data.js` and a
small set of guards in `app.js`. Cloudflare Pages builds it as a preview deployment, live at
<https://demo.gymtrack-7wz.pages.dev>. Refresh it after any release:

```bash
git checkout demo
git merge main
node --test tools/demo.test.mjs
git push
```

Never merge `demo` back into `main` — it is a permanent downstream leaf.

#### Pointing `demo.gymtrack.hithitpull.fi` at the branch

There is **no branch selector in the custom-domain dialog** — that is not where the branch is
chosen, which is why looking for it there comes up empty. Pages always attaches a new custom
domain to the *production* deployment, and you repoint it at a branch afterwards, in DNS:

1. **Workers & Pages → gymtrack → Custom domains → Set up a custom domain**, enter
   `demo.gymtrack.hithitpull.fi`, **Continue**, **Activate domain**. This creates a proxied
   CNAME in the `hithitpull.fi` zone pointing at `gymtrack-7wz.pages.dev` — production.
2. **DNS → hithitpull.fi**, find the new `demo.gymtrack` CNAME and change its target from
   `gymtrack-7wz.pages.dev` to **`demo.gymtrack-7wz.pages.dev`** — the branch alias. Leave it
   **proxied** (orange cloud).

Requirements: the branch needs a successful deployment first (it has one), and the record must
be a proxied Cloudflare record. An external DNS provider silently serves production instead.

## iOS limitations worth knowing

- The rest-timer **audio cue plays while the app is open on screen**. The app
  requests a screen wake lock during a session so your phone doesn't auto-lock,
  but if you lock it manually or switch apps, iOS suspends web audio (a true
  background notification would require a native app).
- Vibration depends on iOS version/settings; the beep is the primary cue.
- Data lives in browser storage for the installed app. iOS can purge storage of
  apps unused for many weeks — cloud sync protects against this since your data
  is restored from the cloud on next launch.

## Development & updates

### English and Finnish

Choose English or Suomi in Settings. Finnish drafts are available before review;
exercise display names are translated without changing stored history identities.
Run `node tools/i18n/cli.mjs review` to edit and approve wording in the local browser
reviewer. After app or translation changes, run `node tools/i18n/cli.mjs build`
and `node tools/i18n/cli.mjs check` before releasing. See
[the localization guide](docs/localization.md) for the workflow and recurring checks.

The app is hosted on **Cloudflare Pages** at `https://gymtrack.hithitpull.fi`.
The sync API runs as a **Cloudflare Worker** at `https://api.gymtrack.hithitpull.fi`.

To ship a change to the static app:

```bash
git add -A
git commit -m "Describe the change"
git push   # Cloudflare Pages auto-deploys on push to main
```

To update the Worker (sync API):

```bash
cd worker
wrangler deploy
```

The service worker refreshes the cache in the background and shows an in-app
"New version available" banner as soon as the new version is ready — tapping
**Update** activates it and reloads immediately (no need to reopen the app).

Local preview: `python -m http.server 8765` then open `http://localhost:8765`.
There is no build step — it's plain HTML/CSS/JS.

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell, tab bar |
| `app.js` | All logic: state, session tracking, rest timer, plan editing, history, Claude import/export, Worker sync, service-worker registration & update banner |
| `workout-model.js` | Shared browser/Node identity, measurement and custom-load rules |
| `styles.css` | Dark, mobile-first UI |
| `sw.js` | Offline cache (stale-while-revalidate); waits for user confirmation before activating a new version |
| `manifest.webmanifest` | PWA install metadata |
| `icon-180.png` / `icon-512.png` | Home-screen icons |
| `tools/push-plan.mjs` | Desktop helper: pushes a new plan to the cloud (keeps history) so the phone auto-loads it |
| `worker/` | Cloudflare Worker backend (KV storage, sync API) |
