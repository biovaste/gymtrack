# GymTrack — Next Session Brief
_Last updated: 2026-08-03_

## Saved
- **ROADMAP.md** — phased plan pre-alpha → launch, with architecture decisions at each gate. `Tracking app/ROADMAP.md`
- **claude-code-next-steps.md** — self-contained Claude Code handoff prompt for closed alpha build (Cloudflare Worker + KV, UUID sync, Share with AI, data recovery). `Tracking app/claude-code-next-steps.md`

## Incomplete — what each item needs
- **Closed alpha build** — not started yet. Everything is specified in `claude-code-next-steps.md`. Needs: Cloudflare account + Wrangler setup, Worker deployed, `app.js` Gist sync replaced with Worker sync, `push-plan.mjs` updated, README updated.
- **ROADMAP.md data recovery note** — agreed to update the roadmap to reflect UUID-as-recovery-key moving from Phase 3 → Phase 1. File was produced before that decision landed; the `claude-code-next-steps.md` already reflects it but ROADMAP.md Phase 1 section still says "data recovery deferred" (acceptable now but worth fixing before sharing).
- **Schema gap flagged by Henri (2026-08-03): a single set can't carry differing weight/reps.** Checked `.claude/skills/shared/schema-reference.md` — confirmed the gap is real. Each `sets[]` entry is currently one flat `{ weight, reps, rpe }` triple, so there's no way to log a set where the load or rep count changes mid-set (drop sets, mixed-load cluster sets, myo-reps, etc. all performed as one continuous set rather than as separate sets). Needs a schema addition — e.g. an optional `components`/`segments` array inside a `sets[]` entry, each with its own `{ weight, reps, rpe }`, with the existing flat shape staying valid for the plain case (backward compatible). Touches: `schema-reference.md` (both the session-record and generic-data sections), `app.js` (set entry UI + storage), the derived-metrics formulas that assume one weight/reps per set (`velocityLossAnalogue`, `rpeEscalation`, volume calcs), and `tools/push-plan.mjs`/`weights.test.mjs` if a plan ever needs to prescribe a compound set.

## Start with
Open `claude-code-next-steps.md` in a Claude Code session inside `Tracking app/` — it contains the full build spec, nothing else needed to start.

## Architecture decisions made this session (for reference)
- **LLM data transfer:** Option 3 (shareable URL) now; Option 2 (built-in Coach tab) at closed beta
- **Storage:** Cloudflare Worker + KV replaces GitHub Gist
- **Identity:** UUID auto-generated on first launch, stored in localStorage — no accounts until closed beta
- **Data recovery (Phase 1):** UUID visible as "backup code" in settings; Restore input accepts UUID or full share URL
- **Closed beta stack:** Supabase Auth (magic link) + Postgres; Worker becomes LLM proxy only
- **Security:** Secret read URL acceptable for workout data; write stays on separate credential (UUID in localStorage for now, proper key split before open beta)
