# Demo mode — implementation plan

**Status:** reviewed 2026-09-12, decisions below folded in. Not yet implemented.

**Decisions taken at review:**
- §3 storage — **namespace** (`gymdemo.`), not clear-on-load.
- §4 service worker — skip registration under DEMO.
- The language switcher **stays visible** in the demo.
- Branch cut from committed `main` at `f39f226`. Update procedure in §11.
- Case-study URL still a placeholder; see §6.

**Goal:** a real, clickable GymTrack instance at `demo.gymtrack.hithitpull.fi` (Cloudflare
Pages branch preview off a `demo` branch) that starts from fabricated data, never touches
the sync Worker, and resets on reload. Linked from the portfolio case study and used for a
screen capture.

---

## 1. Shape of the DEMO layer

Two new files, both plain browser scripts, loaded from `index.html` **before** `app.js`:

| File | Contents | Size |
|---|---|---|
| `demo.js` | The `DEMO` flag, storage priming, the intro-card markup, the case-study URL constant. Exposes `window.GymDemo`. | ~120 lines |
| `demo-data.js` | Deterministic seed **generator** (seeded PRNG) producing plan / sessions / bodyWeight / aliases. Exposes `window.GymDemoData.build()`. | ~250 lines |

`demo.js` runs to completion before `app.js` evaluates, which matters: `app.js` initialises
all state at module top level (`let plan = store.get('plan', …)` at app.js:281–285), so the
seed must already be in storage by then. `demo.js` writes it directly to `localStorage`
under the demo namespace; `app.js` then reads it through its ordinary `store` calls with no
special-casing of load order.

**Why a generator rather than a literal dump:** 4–6 months at ~4 sessions/week is ~90
sessions and ~1500 set records. Literal JSON is 500 KB–1 MB of diff noise that no one can
review. A seeded generator is ~250 reviewable lines, produces byte-identical output every
run (so the `--check` validation and the tests are deterministic), and is honest about what
the data is. The fabrication lives in the code rather than in a blob.

### The app.js diff

Everything demo-specific in `app.js` is a guard on `DEMO`, and there are exactly seven
touch points:

1. **`const DEMO`** — defined near the top, next to `store`:
   `const DEMO = !!(window.GymDemo && window.GymDemo.active);`
   (`demo.js` owns the derivation: `?demo=1` in the query string **or** a hostname whose
   first label is `demo`.)
2. **`store` prefix** (app.js:7–11) — `const KP = DEMO ? 'gymdemo.' : 'gym.';` and the three
   methods use `KP` instead of the literal `'gym.'`. One line changed, three call sites.
3. **Sync identity** (app.js:288–299) — under DEMO, `gymUUID` is a fixed fake constant held
   in memory and `writeToken` is `''`; neither `gymtrack_uuid` nor `gymtrack_write_token` is
   read or written.
4. **`settings.autoSync`** (app.js:285) — forced `false` under DEMO after the merge, and
   forced `false` again in the two places that can turn it back on (`toggle-autosync`,
   `reset-all` at app.js:3350).
5. **`syncFetch`** (app.js:1129) — the hard stop; see §2.
6. **Views** — three conditionals: the cloud-sync card body in `viewSettings()`, the
   "Share with AI" card in `viewCoach()`, and the intro-card prefix in `render()`.
7. **Action guards** — `share-ai`, `restore-uuid`, `save-write-token`, `toggle-autosync`
   return early under DEMO (the controls are hidden, but the dispatcher is keyed on
   `data-action` strings and shouldn't rely on the markup alone).

No demo logic anywhere else. `git diff main..demo -- app.js` should be ~40 lines.

---

## 2. Guaranteeing requirement 3 (zero Worker traffic)

Three layers, in order of how much I trust them:

**Layer 1 — the choke point.** Every request to `WORKER_URL` in the codebase goes through
`syncFetch()` (app.js:1129). `workerPush` and `workerFetch` are its only callers, and they
are the only functions that reference `WORKER_URL` at all. So:

```js
async function syncFetch(url, options = {}) {
  if (DEMO) throw new Error('demo mode: cloud sync is disabled');
  …
}
```

This is a proof by construction: no code path can reach the Worker without passing here.
A test asserts that `WORKER_URL` appears in `app.js` only inside functions reachable through
`syncFetch`, so a future call site added outside it fails the suite rather than silently
shipping.

**Layer 2 — nothing tries.** `settings.autoSync = false` already short-circuits everything
upstream: `scheduleSync()` returns early (app.js:1099), so `touch()` never schedules a push;
`autoSyncOnLoad()` returns early and just sets `syncReady = true` (app.js:1181), so the
launch reconcile never runs. Layer 1 therefore never actually fires — it exists so that it
*can't* fire. Without layer 2 the demo would throw on load and show a red sync error; with
it, the UI is simply quiet.

**Layer 3 — nothing offers.** The controls that call `workerPush` directly (`save-write-token`
at app.js:1217, `toggle-autosync` at app.js:3312) are hidden and their actions guarded.

**Verification:** a Node test (vm-sliced, following `tools/pure.test.mjs`) that stubs a
counting `fetch`, runs a boot + seed + log-a-set + finish-session sequence under DEMO, and
asserts the counter is 0 and that no string containing `api.gymtrack.hithitpull.fi` was ever
passed to it. Plus a live check against `python -m http.server 8765` with the browser network
panel filtered on `api.gymtrack`, expecting an empty list.

---

## 3. Storage: a deviation from requirement 2 I want to flag

**Requirement 2 as written says: clear the `gym.*` keys on load.** I don't think that is
safe, and I'd rather namespace than clear.

The problem is `?demo=1`. The hostname form is fine — `demo.gymtrack.hithitpull.fi` is a
different origin from `gymtrack.hithitpull.fi`, so its `localStorage`, Cache Storage and
service-worker registration are already isolated by the browser. But `?demo=1` on the
**production** origin shares storage with the real app. With clear-on-load:

1. You open `gymtrack.hithitpull.fi/?demo=1` on your phone to check something.
2. Your real plan, sessions and body weight are deleted from the device.
3. Demo writes bump `gym.updatedAt` to now.
4. You reload without the flag. `autoSyncOnLoad()` sees local `updatedAt` newer than the
   cloud copy, so it **pushes** — and the fabricated demo history overwrites your real
   training history in KV.

That is the one hard failure you named, reached by a delayed path the `syncFetch` guard does
not cover, because by then it isn't demo mode any more.

**Proposal:** the demo uses a separate `gymdemo.` key namespace and never touches `gym.*`.
`demo.js` clears `gymdemo.*` on every load and reseeds — so the observable behaviour is
identical (fresh generated state on every reload, subsequent writes persist within the
session), the diff is *smaller* (one prefix constant instead of a key-clearing routine), and
`?demo=1` on any origin is harmless. Note `gym.language` (i18n, written outside `store`)
stays untouched, so the demo inherits the visitor's language choice rather than resetting it.

**Decided: namespace.**

---

## 4. Service worker — recommendation: skip registration under DEMO

`initServiceWorkerUpdates()` (app.js:1301) gets `if (DEMO) return;`. No registration, no
unregistration, no cache-name change.

Reasoning:

- **A distinct cache name buys nothing.** The demo host is a separate origin, so its Cache
  Storage cannot collide with production's regardless of naming. The only sharing case is
  `?demo=1` on the production origin — and there a *renamed* cache is worse than none: it
  would install a second worker on your real app's origin and leave a stray cache behind.
- **Staleness is a real risk and offline is not part of the demo story.** The worker is
  cache-first on the shell (sw.js:44–54) and deliberately does not `skipWaiting`. A visitor
  who opened the demo in March and returns in June gets the March build plus a "New version
  available" banner — in a portfolio piece that reads as a bug. Skipping registration makes
  every demo load a clean fetch of the current deploy, which is exactly the reset semantics
  requirement 2 asks for.
- **It removes the update banner from the capture.** One fewer thing that can pop up
  mid-recording.

Cost: the demo doesn't demonstrate offline support. That's a line in the case-study text,
not something the live demo needs to prove.

**`sw.js` itself still changes**, on both branches: `demo.js` and `demo-data.js` go into
`ASSETS`, because `tools/i18n/cli.mjs build` derives the `CACHE` name from a hard-coded file
list (cli.mjs:13) and `cli.mjs check` fails the release if `sw.js` is stale. Adding files
means editing that list in the same commit.

---

## 5. Seed data (`demo-data.js`)

Deterministic, seeded PRNG (small xorshift, ~8 lines). Output:

- **Plan** — a 3-day upper/lower/full split, all names from the curated library in
  `exercise-library.js` (Bench Press, Barbell Row, Overhead Press, Squat, Romanian Deadlift,
  Bulgarian Split Squat, Lat Pulldown, Leg Curl, Lateral Raise, Triceps Pushdown, Face Pull,
  Plank, Farmer Carry, Bike). Correct `equipment` on every entry, weights snapped to the
  ladder in `CLAUDE.md`, `warmupSets` on the compounds, one `superset` pair, one `duration`
  and one `distance` exercise so the measurement types are visible, `days[].warmup`
  checklists, and `alternates` on the main lifts.
- **Sessions** — ~90 sessions, 2026-03-16 → 2026-09-08, four blocks of five weeks: linear
  progression inside a block, RPE drifting 7 → 9 across it, a **deload week** (week 4 of
  block 2, ~65% load, RPE back to 6), **two missed weeks** (one mid-block travel gap, one
  single missed session), and **two stalls** where a lift repeats the same weight for three
  sessions with rising RPE before breaking through. Set-level noise on reps and RPE.
  Occasional session and per-exercise notes. A handful of readiness blocks with CMJ values.
- **PRs** — placed deliberately: an early one so the history sparkline has an anchor, a
  cluster after the deload (the classic post-deload rebound), and a recent one within the
  last two weeks so the PR badges aren't all ancient. Estimated-1RM curves rise ~12% over the
  span with visible flat spots.
- **Body weight** — ~50 entries, 78.4 → 81.6 kg, gentle upward drift with ±0.4 kg day noise.
- **Aliases** — two entries, to show the rename-keeps-history mechanism.
- **`onboarded: 1`** — so the first-run modal (app.js:1228) doesn't fire over the intro card.
- No active session, so the demo opens on "Start a workout" — the right first frame for the
  capture.

**Validation:** `tools/demo-plan.mjs` evaluates `demo-data.js` in a vm (same technique as
`tools/pure.test.mjs`) and writes the plan half to a JSON file; `node tools/push-plan.mjs
--check` runs against it. Wired into `tools/demo.test.mjs` so it runs in the suite, not just
once by hand. `--check` takes no UUID and makes no network call, so this is safe to automate.

Every number is fabricated. Nothing is derived from your training data, and no real UUID,
write token, or Worker write path is referenced anywhere in either new file.

---

## 6. Intro card (requirement 5)

Prefixed onto the workout tab in `render()` (app.js:1325) — it shows above both the start
screen and an active session. Dismissible via an in-memory flag, so it returns on reload,
consistent with everything else in demo mode.

Content: what GymTrack is in one line; "this is a live demo — the data is generated, and
everything resets when you reload"; a link to the case study.

**The placeholder URL you need to change:** `DEMO_CASE_STUDY_URL` at the top of `demo.js`.
It ships as `https://example.com/case-study/gymtrack` and is the only place the URL appears.

---

## 7. Things in the current code that make this harder than it looks

1. **Storage is shared under `?demo=1`.** §3 — the real hazard, and the reason I want the
   namespace deviation.
2. **State initialises at module top level.** `plan`/`sessions`/`bodyWeight`/`settings` are
   assigned during `app.js` evaluation (app.js:281–285), so seeding must happen in a script
   tag before it. Hence a separate `demo.js` rather than a function called from app.js boot.
3. **The SW cache name is derived, not hand-written.** `cli.mjs build` hashes a hard-coded
   file list (cli.mjs:13) and `cli.mjs check` fails the release if `sw.js` is stale. Adding
   files means editing that list too, in the same commit.
4. **The i18n scanner enforces registered keys.** `tools/i18n/scan.mjs` only scans `app.js`,
   `index.html` and `exercises.js`, so prose living in `demo.js` is outside the pipeline.
   I plan to keep demo prose in `demo.js` as a small local `{en, fi}` map read off
   `I18n.locale()` — it keeps the demo layer out of the translation workflow, and the
   surrounding app UI still switches language properly, which is worth showing.
   **This is an assumption**; the alternative is registering the keys in
   `locales/source/ui.json` and rebuilding the catalog, which is more churn in product files
   for a non-product feature. Tell me if you'd rather have that.
5. **`reset-all` resets `autoSync` to `true`** (app.js:3350). A visitor clicking "Reset
   everything" in the demo would re-arm sync if it weren't guarded. Covered by touch point 4;
   flagged because it is easy to miss.
6. **Two extra files load in production.** `demo.js` and `demo-data.js` are in `index.html`
   on both branches so one shell serves both and `?demo=1` works locally. Both exit
   immediately when not in demo mode; the cost is ~15 KB cached once. The alternative —
   script tags only on the `demo` branch — makes `index.html` a permanent merge conflict and
   breaks local demo testing. **Assumption:** the 15 KB is acceptable.
7. **Auth is coming.** The flag is a single boolean available before `app.js` evaluates, so
   the future gate is `if (!DEMO && !session) return showLogin();` — one condition, no
   rewrite. Stated here so the auth work doesn't re-derive it.

---

## 8. Commits (after approval)

1. `demo-data.js` + `tools/demo-plan.mjs`, with `--check` passing. Data only, no app changes.
2. `demo.js` + the `index.html` script tags + `sw.js` ASSETS + the cli.mjs asset list.
3. The seven `app.js` touch points.
4. `tools/demo.test.mjs` (zero-fetch assertion, namespace isolation, plan validation).
5. README / CLAUDE.md note on the demo branch and the deploy story.

## 9. Verification before I call it done

- The existing suite (`pure`, `weights`, `validate`, `workout-model`, `exercise-library`,
  i18n) with unchanged expectations, plus the new test.
- `node tools/push-plan.mjs --check` on the generated plan.
- `node tools/i18n/cli.mjs build && node tools/i18n/cli.mjs check`.
- Local server, demo mode: network panel filtered on `api.gymtrack` is empty across a full
  log-a-set-and-finish flow; reload restores the seed; `localStorage` shows no `gym.*` keys
  written.
- Local server, **non-demo** mode: sync status reaches "Synced", settings and coach tabs
  unchanged, and the render-path diff reviewed for behaviour change.

---

## 10. Cloudflare — what I verified directly

Checked with the authenticated `wrangler` CLI and DNS, 2026-09-12:

| Fact | Value |
|---|---|
| Pages project | `gymtrack` (account `81cbc554…`) |
| Domains on it | `gymtrack-7wz.pages.dev`, `gymtrack.hithitpull.fi` |
| Deployments so far | all `Production` / `main` — no preview deployment has ever run |
| Branch alias the demo will get | `https://demo.gymtrack-7wz.pages.dev` — currently **404** (routes, nothing deployed) |
| `demo.gymtrack.hithitpull.fi` | **does not exist in DNS** — has to be created |

What the CLI cannot show is the project's *preview build* setting (build all non-production
branches vs. none). For a Git-connected project that defaults to on, and pushing the branch
settles it empirically: if `wrangler pages deployment list --project-name gymtrack` shows a
`Preview` / `demo` row afterwards, it's enabled. If it doesn't, it's one toggle in
**Workers & Pages → gymtrack → Settings → Builds → Branch control**, which needs your
dashboard — I have API access but not the UI, and this setting isn't exposed to the CLI.

**The custom subdomain is the one open mechanic.** Pages custom domains bind to the
*production* deployment, so `demo.gymtrack.hithitpull.fi` does not simply attach to a
preview branch. Two routes, both leaving the code identical:

- **A — CNAME to the branch alias.** `demo.gymtrack.hithitpull.fi` → `demo.gymtrack-7wz.pages.dev`,
  proxied. Keeps one repo, one Pages project, one branch. I'll confirm it actually serves
  once the branch is pushed rather than assert it here.
- **B — a second Pages project.** `gymtrack-demo`, same repo, with `demo` as *its* production
  branch. Then `demo.gymtrack.hithitpull.fi` is an ordinary custom domain on a production
  deployment — fully supported, no branch-alias uncertainty. Still a separate origin, so
  every isolation argument in §3 and §4 holds unchanged.

Plan: try A, fall back to B. Nothing in `demo.js`/`app.js` changes either way.

---

## 11. Keeping the demo current

The `demo` branch is `main` plus two new files and a ~40-line `app.js` diff, so it stays a
fast-forward-friendly descendant. Updating it after any production release:

```bash
git checkout demo
git merge main
node --test tools/demo.test.mjs
git push
```

Cloudflare redeploys the preview on push, same as production does on `main`. Conflicts are
only possible in the seven `app.js` touch points and the `sw.js` asset list; everything else
is additive. If a merge does conflict in `app.js`, the demo side is always the `if (DEMO)`
guard — keep both sides.

Never merge `demo` back into `main`. The demo branch is a permanent downstream leaf; the
only direction is `main` → `demo`.

---

## 12. Verification record (2026-09-12)

Implemented on branch `demo`, cut from `main` at `f39f226`. Diff against `main`:
`app.js` +48/−9, plus `demo.js`, `demo-data.js`, `tools/demo-plan.mjs`,
`tools/demo.test.mjs`, and 4 lines across `index.html` / `sw.js` / `tools/i18n/cli.mjs`.

- **Full test suite passes** — `pure`, `weights`, `validate`, `workout-model`,
  `exercise-library`, the four i18n suites, plus the new `tools/demo.test.mjs` (14 tests).
- **`node tools/push-plan.mjs --check`** passes on the generated plan (3 days, 18
  exercises), and every logged session weight is run through the real `isLoadable` ladder.
- **`node tools/i18n/cli.mjs build && … check`** clean, with `demo.js`/`demo-data.js` in
  both the `sw.js` ASSETS list and the derived cache hash.
- **Zero Worker traffic, measured.** `performance.getEntriesByType('resource')` filtered on
  `api.gymtrack` after a full start-session → log a set → finish flow:
  - demo mode: **0 entries**, 9 resources total, `syncState` never leaves `idle`.
  - non-demo mode on the same origin: **1 entry** (the launch reconcile), `syncState` `ok`.
  That pair is the positive/negative control. Note the browser network panel does not
  record cross-origin fetches, so it alone would have been weak evidence.
- **Storage isolation, measured.** After finishing a session in demo mode:
  `gymdemo.sessions` = 91, `gym.sessions` = 0, `gym.updatedAt` unchanged from before the
  demo visit. A pre-existing `gym.*` payload comes back byte-identical in the unit test.
- **Reload resets.** 91 sessions → reload → 90, no `gymdemo.active`, `gym.*` untouched.
- **Non-demo unchanged.** `DEMO` false, prefix `gym.`, auto-sync on, "✓ Synced just now",
  backup code / restore / write token / update check all present.
- **UI checked in the browser** in both languages: intro card, seeded plan, "Last:" lookups
  from history, rest timer, weekly-training bars, body-weight chart, and the Bench Press
  e1RM chart with a PR badge (best e1RM 114 kg).

Two things found by running it that the plan had not predicted:

1. **Body weight was written as `{date, kg}`** where the app reads `{date, weight}` — the
   chart rendered as `NaN`. Fixed, and pinned by a test.
2. **A fixed start date ages badly.** The seed now ends in the current week, so the demo
   never opens on a stale log. Only the calendar slides; the progression shape is unchanged.
