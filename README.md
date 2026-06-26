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
  and vibrates when time is up, with +15s and skip controls.
- **Session length** — live timer in the header, duration saved with each session.
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

> **Updating after a deploy:** the service worker refreshes files in the background;
> an update is picked up the *second* time you open the app.

## Using it with Claude

**Get your next plan:** Claude tab → **Copy coaching prompt + data** → paste into any
Claude chat. It contains your recent sessions (actual weights/reps/RPE), notes, body
weight, your current plan, and instructions telling Claude to reply with a
`workout-plan` JSON block.

**Load the new plan:** copy Claude's JSON block → Claude tab → paste into
**Import a plan from Claude** → Import. History is always kept.

### Automatic cloud sync — no setup required

Sync starts automatically on first launch. The app:
- Pulls your latest data when you open it
- Pushes after every saved workout
- Shows "✓ Synced …" in the status line

### Sharing data with an AI

Claude tab → **Share with AI** → copies a URL you paste into any AI chat. Claude,
ChatGPT, and Gemini can all fetch the JSON from that link and reply with a new plan.

### Data recovery

Claude tab → **Your backup code** shows your unique UUID. Save it somewhere safe
(notes app, password manager). On a new device, open the app → Claude tab →
**Restore from backup code** → paste your UUID — your full history is restored.

### Desktop → phone: push a plan with no copy-paste

Claude can push a plan from your desktop directly to your phone — the phone picks it
up automatically on next launch.

```bash
# set your UUID once (copy it from Claude tab → "Your backup code"):
set GYMTRACK_UUID=<your-uuid>

# then push a plan:
node tools/push-plan.mjs path/to/plan.json      # or pipe the JSON via stdin
```

The script does a safe read-modify-write — only the plan changes, your logged sessions
and body weight are kept — and bumps the sync timestamp so the app pulls it on launch.

### Plan JSON schema

```json
{
  "type": "workout-plan",
  "version": 1,
  "name": "Block 2 — Strength",
  "days": [
    {
      "name": "Day A — Push",
      "exercises": [
        {
          "name": "Bench Press",
          "sets": 4,
          "reps": "6-8",
          "weight": 60,
          "targetRpe": 8,
          "restSeconds": 150,
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

This repo is hosted on GitHub. To ship a change:

```bash
git add -A
git commit -m "Describe the change"
git push
```

If the app is served from **GitHub Pages**, the push is the deploy — Pages rebuilds
automatically. Because of the service worker, an update lands the *second* time the
app is opened after deploy (first open refreshes the cache in the background).

Local preview: `python -m http.server 8765` then open `http://localhost:8765`.
There is no build step — it's plain HTML/CSS/JS.

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell, tab bar, service-worker registration |
| `app.js` | All logic: state, session tracking, rest timer, plan editing, history, Claude import/export, Worker sync |
| `styles.css` | Dark, mobile-first UI |
| `sw.js` | Offline cache (stale-while-revalidate) |
| `manifest.webmanifest` | PWA install metadata |
| `icon-180.png` / `icon-512.png` | Home-screen icons |
| `tools/push-plan.mjs` | Desktop helper: pushes a new plan to the cloud (keeps history) so the phone auto-loads it |
| `worker/` | Cloudflare Worker backend (KV storage, sync API) |
