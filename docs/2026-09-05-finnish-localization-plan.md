# GymTrack: context-specific translations and Finnish review

Approved project plan · 2026-09-05 · Implementation authorized, with the amendments below.

Henri amended the plan: automated Finnish drafts must be visible before review so both languages remain usable, and exercises must also be translated. Human review improves published drafts; it does not gate their use. See `docs/localization.md` for the implementation and operating instructions.

## Outcome and scope

Give every distinct use of app text a stable translation key, generate Finnish drafts with enough context to translate naturally, and let Henri edit and approve them in a simple browser UI. Future app changes automatically feed a review queue. Both automated drafts and reviewed translations reach the normal app; current human edits take precedence.

The current checkout is plain HTML/CSS/JavaScript with no app build step. English text is embedded in `app.js` and `index.html`. Settings can house a language selector. Dates currently follow the browser locale, and some messages construct English plurals directly. `sw.js` caches the app for offline use and must include translation assets.

Version one covers app-owned navigation, settings, workout and plan controls, history, timer, dialogs, notifications, validation errors, accessibility labels, placeholders, built-in exercise explanations, and app-owned coaching instructions. Inventory installation metadata too; keep the GymTrack brand unchanged. Map known service errors to localizable messages, with a translated generic message for unexpected errors and technical details kept separately.

User-written notes, imported plan names/descriptions and AI responses are content, not catalogue entries. Exercise names currently participate in history matching: never translate stored names or schema values. Built-in exercise names can receive display labels keyed by canonical identity; built-in explanations retain their lookup identity. Cover built-in and common imported exercise names, with independent display translations that retain canonical identity. Collect unfamiliar names and custom descriptions for translation without guessing away meaningful qualifiers.

## 1. Context-specific catalogue

Use readable keys in the form `screen.component.purpose`. Keys identify meaning and placement, not English text or source line numbers.

| Key | English | Illustrative Finnish draft | Context |
|---|---|---|---|
| `settings.restSound.enabled` | On | Käytössä | Rest-timer sound is enabled |
| `settings.vibration.enabled` | On | Käytössä | Vibration is enabled |
| `settings.autoSync.enabled` | On | Käytössä | Automatic cloud sync is enabled |
| `workout.restTimer.heading` | Rest | Lepo | Active rest countdown heading |
| `plan.exercise.rest.label` | Rest | Palautusaika | Rest duration prescribed in a plan |

Identical English and Finnish text stays in separate entries when context can affect wording. Reuse is allowed for one stable semantic component across screens when its meaning and grammatical role remain the same, such as Cancel, Save or controlled equipment names. Keep context-sensitive state labels such as `On` separate. Similar approved entries can inform suggestions, but approval is always per independently keyed context.

Each source entry records its key, English message, screen/component, context description, UI role, source locations, preview fixture, length guidance and terminology notes. Named placeholders include types and sample values. Messages that vary by count include plural forms.

A source revision covers English text, semantic context and placeholder contract. Moving a source file alone does not invalidate approval. Each Finnish record stores a candidate, review status, the source revision it translates, prior approved revisions, and edit/approval history. Statuses: Missing, Draft, Needs review, Approved and Retired. Keep generation provenance: model, prompt/glossary version and date.

Translate complete messages rather than concatenated fragments. For session counts, provide full sentence variants and interpolate `{count}`. Use locale-aware plural selection, dates and numbers. `Intl.PluralRules` selects a grammatical category; the catalogue must supply the Finnish wording. See [MDN internationalization guidance](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Internationalization).

## 2. Finnish generation and app integration

Create a short Finnish glossary and voice guide first: concise gym language and consistent terms for sets, reps, warm-ups, working sets, rest and personal records. The example translations above remain drafts for Henri's review.

The generator receives English, context, placeholder examples, relevant glossary terms and approved examples, and returns structured candidates per key. Validate returned keys, placeholder names/types, plural forms, empty text and unexpected markup. Retry failures in bounded batches; preserve human drafts and approvals. A new suggestion is a separate candidate, never an overwrite of a manual edit.

Add a small browser translation helper and an English/Suomi selector in Settings. Use the selected locale for messages and formatting and update the document language. Initially select Finnish for a Finnish browser preference, otherwise English; persist the explicit choice. Language switching must preserve the active workout, entered values and timer. Stored numbers remain numeric; verify Finnish decimal entry on iPhone separately from display formatting.

Normal app lookup uses a current reviewed/manual Finnish translation when available, otherwise the current automated Finnish draft. Changed text/context reopens review and requires a fresh draft before release; previous edits remain in history. Missing Finnish is a release-check failure, rather than a reason to wait for human approval.

Treat translated strings and substituted values as text; escape them at HTML insertion boundaries. Keep layout markup in UI code. Version the catalogue with the app and cache it offline. Ensure the current stale-while-revalidate behavior cannot mix incompatible code and catalogue versions. Translation-only releases must trigger the existing app update banner too.

## 3. Simple approval UI

Recommended first version: an owner tool served locally on Henri's computer by a small development helper. It reads/writes project catalogue files through a localhost-only service, with origin/session checks and writes restricted to those files. This provides durable saving without accounts or a production database. Keep it out of the deployed PWA. Phone-based or shared remote review is a later extension requiring authentication and shared storage.

Layout: searchable entry list on the left, one editor on the right, adapting to a single column on narrow windows.

- Open on items needing attention. Filter by screen, status and new/changed text; show pending counts and approval coverage.
- Show English, Finnish candidate, context and a UI preview with sample data; keep technical key/source details expandable.
- For changed entries, show previous/current English and context alongside the last approved Finnish.
- Actions: Save draft, Approve and next, Request new suggestion, Skip. Include keyboard navigation, clear saved/unsaved state and undo/history.
- Any bulk approval operates only on explicitly selected entries.
- Validate before approval and recheck the source revision when saving. If a scan changed an open entry, show a conflict while preserving the editor's work.

Approval saves a reviewed catalogue revision; publishing happens through a separate normal app release. Make that distinction visible. Export/import offers backup and transfer, but browser storage is not the authoritative review database.

## 4. Checks after updates

Proposed process, to implement after the initial migration:

1. On proposed app changes and releases, check referenced keys, required context, source revisions, placeholders and consistency of generated runtime assets.
2. Scan JavaScript templates, HTML text/attributes and known message-producing functions for new hardcoded UI text. Use a syntax-aware development tool plus a reviewed allowlist for data, brand names and protocol constants. Static detection cannot prove semantic coverage: retain a screen walk-through and a developer checklist for new contexts.
3. New hardcoded strings receive candidate key/context suggestions for developer review before integration. New registered keys and changed source/context create Finnish draft work. Matching English is never sufficient evidence for a shared context.
4. Generate only missing or changed candidates. Repeated runs for the same key/revision do nothing; never overwrite manual drafts or approvals. Removed keys become Retired, retaining history.
5. Persist generated changes in a dedicated review branch/change proposal that the local review helper can load with revision checks. Maintain one updateable proposal per batch, avoiding duplicate jobs and races with manual editing. Credentials stay in trusted development/automation environments, outside the app and untrusted change requests.
6. Run reconciliation weekly on the default branch as a safety net; add a manual Check now action. Record last successful scan, covered app revision, pending count and errors. Notify only on new review items or failures. Unchanged pending work stays visible without repeated notifications.
7. Publish approved translations in the next release. Structural failures block release checks. All active in-scope entries need a valid Finnish draft before release; human approval is optional.

The generator should accept a replaceable model provider. Provider choice, credential and a per-run spending cap are implementation setup items; no subscription is assumed. If generation fails, detection still creates Missing/Needs review entries, retains work and reports the failure.

Ownership: the developer maintains source keys/context, automation proposes Finnish, Henri approves language, and the normal release process publishes it. Human approval is never automated.

## Delivery phases

| Phase | Deliverable | Exit condition |
|---|---|---|
| 1. Inventory and conventions | Text inventory by screen, key/context rules, Finnish glossary, content exclusions | All text categories have a strategy; entry count established |
| 2. Small vertical slice | Helper, language selector, local reviewer, Finnish navigation/settings/timer candidates | Henri can edit, approve, reload and preview; identical English contexts stay independent |
| 3. Whole-app migration | Remaining screens and app-owned explanations/prompts registered, generated and reviewed | All in-scope entries have Finnish drafts; history and data exchange preserved |
| 4. Update workflow | Change checks, incremental generation, durable queue, weekly reconciliation and status | New/changed/removed samples follow the lifecycle; repeat runs preserve edits |
| 5. Release verification | English/Finnish screen review, iPhone checks, offline/update checks, operator instructions | Finnish works offline; later approved edits arrive through app updates |

Planning estimate: approximately 6–10 focused development days, plus Henri's language review time. Re-estimate after the inventory; this is not a commitment. A remotely hosted reviewer expands scope.

## Acceptance checks

- Identical English in distinct contexts supports different Finnish translations and independent approvals.
- Source/context changes reopen review; moving a source file does not.
- Invalid placeholders/plurals cannot be approved or published; special characters render safely.
- Edits survive rescans, regeneration, tool restarts and overlapping stale saves.
- Unreviewed Finnish drafts are usable immediately; incomplete or stale catalogues fail release checks.
- Finnish dates, numbers, decimal input, longer labels and screen-reader labels work on iPhone.
- Language switching preserves workout/timer state; exercise identity, history, sync and import/export remain intact.
- Offline use and translation-only updates use consistent code/catalogue versions.
- New/changed/retired text is detected, duplicate jobs do not duplicate work, and job failures remain visible.
- Existing calculation, validation and weight tests pass; add focused catalogue/lifecycle tests and browser checks for these behaviors.

## Expected project additions and next step

Proposed paths: `locales/source.json`, `locales/fi.review.json`, `locales/glossary.fi.md`, a browser runtime catalogue/helper, `tools/i18n/` for checks/generation/review service, and a review page under `tools/`. Integration touches `app.js`, `index.html`, `styles.css` and `sw.js`. Check generated runtime files into the repo to retain the no-build production deployment model; checks verify they match reviewed sources.

Recommended next step: inventory the text and build the navigation/settings/timer slice so Henri can assess key granularity, Finnish voice and approval workflow before the whole app is migrated. Draft assumptions to revisit: desktop-local review first, publication of automated drafts and human edits, and weekly reconciliation alongside change-triggered checks.
