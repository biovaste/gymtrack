# GymTrack — Roadmap to Launch

> Last updated: 2026-06-25

---

## Phase overview

| Phase | Who | Goal | Key blocker to exit |
|---|---|---|---|
| **Pre-alpha** | Henri only | Working personal tool | — |
| **Closed alpha** | 3–5 friends | Multi-user data isolation, no-friction LLM sharing | UUID sync live, Share URL working |
| **Closed beta** | Cheer community (~20–50) | Reliable accounts, data recovery, native app feel | Supabase auth + native wrapper |
| **Open beta** | App stores | Public-ready UX, cost-controlled Coach tab | Store approval, rate limiting |
| **Launch** | Everyone | Stable, monetisable if needed | Demand validated |

---

## Current state (pre-alpha)

- Static PWA hosted on GitHub Pages
- Cloud sync via GitHub Gist (requires user to create a GitHub token — not viable for friends)
- LLM sharing: paste coaching prompt + Gist URL into Claude chat (unreliable, technical)
- Plan push: `tools/push-plan.mjs` via GitHub CLI (Henri-only, dev tool)

---

## Phase 1 — Closed alpha

**Goal:** a few friends can install the app, track their own workouts, and share data with any LLM without touching a config screen.

### Architecture changes

**Replace GitHub Gist with Cloudflare Worker + KV**

- Worker runs on Cloudflare free tier (~100k requests/day, zero cost)
- Each app install generates a random UUID on first launch, stored in localStorage
- UUID serves as both the user identifier and the share key (upgraded to separate read/write keys before open beta)
- No GitHub token, no account, no setup screen

**Endpoints**

| Method | Path | Purpose |
|---|---|---|
| `GET /data/{uuid}` | — | Read user data (public, shareable with LLMs) |
| `POST /data/{uuid}` | — | Write user data (app only; UUID is the implicit secret) |
| `POST /data/{uuid}/plan` | — | Replace only the plan, preserve sessions + body weight |

**App changes**

- Remove GitHub token / Gist setup UI from Claude tab
- On first launch: generate UUID, store in localStorage
- Replace Gist sync with Worker sync (pull on launch, push after every session)
- Add **"Share with AI"** button → copies `https://gymtrack.workers.dev/data/{uuid}` to clipboard with a short instructional prefix
- Update `tools/push-plan.mjs` to POST to `/data/{uuid}/plan` instead of patching the Gist

**LLM flow for users**

Tap "Share with AI" → URL copied → open Claude / ChatGPT / Gemini → paste URL + ask question. The LLM fetches the data itself. No export, no file attachment.

### What's deferred to later phases

- Separate read/write keys (UUID is both for now — acceptable for closed alpha)
- Coach tab (built-in chat)
- Account / email auth
- Data recovery if localStorage is cleared (tell alpha testers to not clear browser data)

---

## Phase 2 — Coach tab

**Goal:** LLM chat is built into the app; no URL sharing required.

**Add to the same Cloudflare Worker:**

- `POST /chat/{uuid}` — accepts user message; Worker fetches their KV data, compresses context (last 4–6 weeks + PRs + current plan), prepends it, calls LLM API, streams response back
- Rate limiting: KV counter per UUID, e.g. 20 requests/day
- Model: Claude Haiku or GPT-4o-mini (~€1–5/month at moderate use)
- Context compression is critical — send last 4–6 weeks of sessions + PRs + current plan only, not full history

**App changes**

- Add "Coach" tab with a simple chat UI
- Each message hits `/chat/{uuid}`; user never sees the context injection
- "Share with AI" button stays as fallback for users who want a different LLM

**Option to bring your own API key** (deferred to open beta): store in localStorage, Worker uses it if present, falls back to owner key if not.

---

## Phase 3 — Closed beta + native

**Goal:** cheer community scale, data recovery, app store submission path.

### Account system

**Supabase Auth (magic link, no password)**

- User enters email → gets a login link → tapped = authenticated
- No password to forget, no OAuth dance
- Data moves from Cloudflare KV to Supabase Postgres (keyed by Supabase user ID)
- Cloudflare Worker becomes LLM proxy only — stateless, no data responsibility

**UUID → account migration**

When a user signs in for the first time on a device that already has a UUID:
1. Worker reads KV data for the UUID
2. Writes it into Supabase under the new user ID
3. Deletes the KV entry
4. App switches to JWT-authenticated requests

**Data recovery**

Signing in on a new phone automatically restores full history from Supabase. No QR codes, no recovery codes needed once accounts exist.

### Native wrapper

- React Native (Expo) wrapper around the same web app, or a true native rewrite
- Primary driver: background rest-timer notifications (iOS kills web audio when the app is backgrounded — this is the biggest UX gap vs. native)
- AsyncStorage replaces localStorage; Worker endpoints stay identical

---

## Phase 4 — Open beta

**Goal:** app store presence, cost controls, polished onboarding.

- Submit to App Store + Play Store
- Onboarding flow: email sign-up, plan selection or import, first session walkthrough
- Rate limiting visible to users ("15 Coach messages/day on free plan")
- Privacy policy and terms of service
- Optional paid tier if API costs become meaningful (€2–5/month covers most users on Haiku)

---

## Phase 5 — Launch

- Marketing to cheer + strength community
- Analytics (anonymised: session counts, plan types, retention)
- Feedback loop: in-app "report a bug" or "suggest a feature"
- Evaluate monetisation: free tier + optional supporter plan vs. fully free

---

## Architecture summary by phase

```
Pre-alpha   GitHub Gist ──────────────────────── LLM: paste URL manually
               │
Closed alpha   Cloudflare Worker + KV ─────────── LLM: Share URL button
               │         │
Coach tab      │         └── /chat proxy ──────── LLM: built-in Coach tab
               │
Closed beta    Supabase Auth + Postgres ────────── LLM: Coach tab (JWT auth)
               Cloudflare Worker = proxy only
               │
Launch         Same, + native app wrapper
```

---

## Key decisions already made

- No build step — app stays plain HTML/CSS/JS (native wrapper is a separate repo if needed)
- Owner pays LLM API costs; users get Coach tab free (review at scale)
- Email magic link, not OAuth or passwords
- Data stored server-side from closed beta onward (Supabase); device-only before that
- Separate read/write credentials before open beta (UUID-only is acceptable for closed alpha)
