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
