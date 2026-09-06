# GymTrack — Next Session Brief
_Last updated: 2026-09-06_

## Implemented locally

Context-specific English/Finnish localization is implemented, following Henri's amendments: automated drafts are visible before human review, and exercise names also translate. There are 621 active bilingual catalogue entries: 441 app messages and 180 exercise entries. Stable actions, form labels and controlled equipment names share entries when their meaning and grammatical role are identical; context-sensitive states remain separate. Previously split sentence fragments were recomposed as complete messages. The app has a Settings language selector, translated screens/dialogs/coaching instructions, and display-only exercise translation that preserves history identity. Supported Finnish exercise names also display in English when English is selected.

The local review UI supports context/search/status filters, sample previews, editing, approval, history/undo, conflict detection, export/import and imported exercise queues. Start `Review Finnish.cmd` or `node tools/i18n/cli.mjs review`; normal address is `http://127.0.0.1:4178`. Review saves update the generated local catalogue; users receive edits through a normal app release.

Source of truth and operations: `docs/localization.md`, `tools/i18n/README.md`, `locales/source/*.json`, `locales/fi.review.json`. Runtime assets: `locales/catalog.js`, `i18n.js`, `exercises.js`. Rebuild/check after app or translation changes; build updates the offline version automatically. Temporary migration artifacts were removed.

## Catalogue consolidation — 2026-09-06

After the first review pass, repeated universal controls and identical controlled vocabulary were consolidated without merging context-sensitive labels. Mid-sentence pieces used for errors, plan/day names, history summaries, CMJ guidance, plate instructions and other dynamic messages were replaced by complete placeholder-based entries. The unclear `cmj_video_modal.text.in` fragment is retired and its meaning now appears in the complete slow-motion recording instruction. All prior approvals remain recorded in history; 580 unchanged active approvals, including all 180 exercise approvals, were preserved by exact revision match. The 41 newly composed messages remain drafts for focused review; 198 obsolete keys remain as retired history.

## Reviewer recovery — 2026-09-06

The local reviewer process had stopped, leaving a stale `locales/.review.lock`. Confirmed its PID was absent and the port refused connections, removed only that lock, and restarted the reviewer as a hidden background process. After catalogue consolidation it was restarted again and its page and state endpoint returned HTTP 200 with 621 active entries, 580 approved and 41 awaiting review. Reload the reviewer after a restart to obtain the new session token.

## Checks and scheduling

- 56 pure/runtime/exercise/offline/tooling tests passed. Weight and plan-validation scripts passed separately (they exit the process, so do not combine them with the in-process test runner).
- Final isolated browser checks passed for English and Finnish screens, exercise dialogs, RPE picker, plan editor, language persistence, workout/rest preservation, offline reload, and durable review edits/approval.
- Catalogue check reports 621 active bilingual entries. The reviewer currently has 580 approved entries and 41 new complete-message drafts.
- Active Codex heartbeat: `gymtrack-finnish-translation-check`, Mondays 09:30 Europe/Helsinki. Checks first, reads only changed/missing text, can generate drafts without a separate API key, and notifies only about new work/failures. Never approves, pushes or deploys automatically.
- `.github/workflows/localization.yml` provides change checks and weekly reconciliation after it is pushed to the default branch. Provider-based generation is optional and needs environment/repository credentials, model and cost limits. None were configured here. API-free generation uses `pending` / `apply-drafts` commands.

## Next action and practical limits

Open the reviewer and try the Finnish wording. Implementation is local and uncommitted; nothing was deployed or pushed. Before a production release, try the installed PWA on an actual iPhone for keyboard, accessibility and update behavior, and enable the repository workflow/required check as desired.

Unknown custom exercise names and custom instructions retain their original text until translated. Settings exports their deduplicated queue; import it into the reviewer, then draft manually, through the scheduled Codex check, or through a configured provider. Arbitrary imported plan/day names and user notes remain unchanged. Existing standard names/instructions work offline.

## Earlier open work retained

- Compound sets with differing weight/reps within one continuous set were flagged on 2026-08-03. Proposed optional components/segments must preserve the flat set shape and account for UI, storage, derived metrics, schema reference and validation. Not changed here.
- Roadmap recovery, identity and hosting descriptions need reconciliation against implemented code before sharing as current. Worker sync, recovery and separate write tokens already exist in the checkout; live deployment was not inspected.
- Historical future direction: built-in Coach tab, account-based recovery and native wrapper remain in the roadmap.

## Workspace note

The pre-existing change to `.claude/skills/weekly-review/SKILL.md` was left untouched.
