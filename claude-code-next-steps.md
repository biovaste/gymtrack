# Claude Code handoff — GymTrack closed alpha

## What this is

GymTrack is a no-build static PWA (plain HTML/CSS/JS, no framework, no bundler). It's a gym workout tracker designed to exchange data with LLMs. It's hosted on GitHub Pages; push to `main` = deploy. Service worker means updates land on the *second* app open after deploy.

Local preview: `python -m http.server 8765` then open `http://localhost:8765`.

**Files:**
- `index.html` — app shell and tab bar
- `app.js` — all logic: state, session tracking, rest timer, plan editing, history, Claude import/export, sync
- `styles.css` — dark, mobile-first
- `sw.js` — offline cache (stale-while-revalidate)
- `tools/push-plan.mjs` — Node script to push a plan from desktop to the cloud so the phone picks it up on next launch

---

## Current state — what exists

Cloud sync uses a **GitHub Gist**. In `app.js`, search for `gist`, `GIST_ID`, `github` to find all sync code. The user has to create a GitHub token and paste it into the app to enable sync — too technical for general users.

`tools/push-plan.mjs` uses the GitHub CLI (`gh`) to do a safe read-modify-write into the Gist: reads current data, replaces only the `plan` field (preserving `sessions` and `bodyWeight`), writes back.

---

## What to build

Replace the GitHub Gist with a **Cloudflare Worker + KV** backend. The goals:

- Zero setup for users — sync works on first launch automatically
- Each user's data is isolated by a UUID generated client-side
- LLMs can read any user's data via a shareable URL (no auth on reads)
- Users can recover their data on a new phone by pasting their UUID or share URL

---

## 1. Cloudflare Worker (`worker/`)

Create a `worker/` directory with a Cloudflare Worker project.

**KV namespace:** `GYMTRACK_DATA`

**Endpoints:**

| Method | Path | Behaviour |
|---|---|---|
| `GET /data/:uuid` | Read | Return stored JSON; 404 if none |
| `POST /data/:uuid` | Write | Store request body as the user's full backup |
| `POST /data/:uuid/plan` | Plan push | Read existing KV entry, replace only `plan`, preserve `sessions` + `bodyWeight` + `exportedAt`, bump `updatedAt` to `Date.now()`, write back |
| `OPTIONS *` | Preflight | CORS preflight response |

All responses:
- `Content-Type: application/json`
- `Access-Control-Allow-Origin: *` (app is static; LLMs fetch from anywhere)

No authentication for this phase. UUID is the implicit secret. Reject POST bodies over 2MB.

**`wrangler.toml`:**
```toml
name = "gymtrack"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "GYMTRACK_DATA"
id = "REPLACE_AFTER_CREATION"
preview_id = "REPLACE_AFTER_CREATION"
```

After creating the KV namespace (`wrangler kv namespace create GYMTRACK_DATA`), fill in the IDs.

---

## 2. Update `app.js`

### UUID

On first launch, if `localStorage.getItem('gymtrack_uuid')` is empty, generate one:
```js
const uuid = crypto.randomUUID();
localStorage.setItem('gymtrack_uuid', uuid);
```

Add a constant at the top:
```js
const WORKER_URL = 'https://gymtrack.YOUR_SUBDOMAIN.workers.dev';
```

### Replace Gist sync

Remove all GitHub token / Gist ID logic. Replace with Worker calls that mirror the current behaviour:

- **On launch:** `GET /data/{uuid}` → if response has newer `updatedAt` than local data, load it
- **After every saved session:** `POST /data/{uuid}` with the full backup JSON

Keep the sync status line ("✓ Synced …") — just point it at the Worker.

### Claude tab UI changes

Remove: GitHub token input, Gist ID input, their labels and save buttons.

Add **"Share with AI"** button:
- On tap: copies `${WORKER_URL}/data/${uuid}` to clipboard
- Brief confirmation toast: "Link copied — paste into any AI chat"
- Instructional note below: "Paste this link into Claude, ChatGPT, or Gemini and ask anything about your training. The AI fetches your data automatically."

Add **backup code display** in a settings or sync section:
- Show the UUID as a copyable string, labelled "Your backup code"
- Note: "Save this somewhere safe. If you lose your phone or clear the app, paste it into Restore to get your data back."

Add **"Restore from backup code"** input:
- Accepts either the full share URL (`https://gymtrack…/data/SOME-UUID`) or a bare UUID
- On submit: parse out the UUID, write it to `gymtrack_uuid` in localStorage, immediately pull from Worker, reload state
- This is the entire data recovery mechanism — no accounts needed

### Remove from `app.js`

- All GitHub API fetch calls
- `gymtrack_github_token` and `gymtrack_gist_id` localStorage keys (migrate: on first run after update, if those keys exist, clear them)
- Any UI that references GitHub, tokens, or Gist IDs

---

## 3. Update `tools/push-plan.mjs`

Replace GitHub CLI logic with plain `fetch`.

The script needs a UUID to know which user's data to update. Accept it in priority order:
1. `GYMTRACK_UUID` environment variable
2. `--uuid` CLI argument
3. Read from a `.gymtrack-uuid` file in the project root

New flow:
1. Resolve UUID (error with clear message if not found)
2. `GET ${WORKER_URL}/data/${uuid}` — fetch current backup
3. Parse, validate it's a `gymtrack-backup`, replace `plan`, bump `updatedAt`
4. `POST ${WORKER_URL}/data/${uuid}` with updated backup
5. Same console output format as current script

Add a comment at the top explaining how to find the UUID:
- From the app: Claude tab → copy the "Your backup code" value
- Or: `localStorage.getItem('gymtrack_uuid')` in browser devtools on the installed app

---

## 4. Update `README.md`

- Remove the GitHub token / Gist setup section entirely
- "No setup required — sync starts automatically" replaces it
- Update "Using it with Claude": describe the Share URL flow (tap Share → paste into any LLM)
- Update `tools/push-plan.mjs` docs to reflect UUID-based auth
- Add a "Data recovery" section: save your backup code; paste it into Restore on a new device

---

## What NOT to change

- Session tracking, rest timer, plan editing, exercise library, PRs, history — all untouched
- `sw.js`, `manifest.webmanifest`, icons
- `index.html` structure (add UI elements, don't restructure)
- Deployment (still GitHub Pages)
- The workout plan JSON schema

---

## Deployment order

1. Create Cloudflare account (free), install Wrangler
2. `wrangler kv namespace create GYMTRACK_DATA` — copy the IDs into `wrangler.toml`
3. `wrangler deploy` from `worker/` — note the `*.workers.dev` URL
4. Update `WORKER_URL` constant in `app.js`
5. `git add -A && git commit -m "Replace Gist sync with Cloudflare Worker" && git push`
6. Test: install on phone, log a session, check sync, tap Share, paste URL into Claude

---

## Context: why these decisions were made

- **No build step** — the app stays plain HTML/CSS/JS so non-developers can understand and contribute
- **UUID as recovery key** — anyone who has ever used "Share with AI" already has their UUID in their LLM chat history; the backup code display makes this explicit
- **No auth on reads** — UUID is unguessable (122 bits of entropy); acceptable for workout data at this scale
- **Cloudflare free tier** — 100k requests/day, KV included, zero cost for closed alpha
- **Owner pays LLM costs** — Coach tab (built-in LLM chat) comes in the next phase; this phase is just data infrastructure
