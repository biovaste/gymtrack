# English and Finnish in GymTrack

The app uses context-specific translation keys. Finnish machine drafts are live
before approval. Saving or approving an edit updates the next release; it does not
change canonical exercise names, workout records, units or cloud credentials.

## Review Finnish

Start the local reviewer from this project:

```powershell
node tools/i18n/cli.mjs review
```

Open the address it prints (normally `http://127.0.0.1:4178`). Search by English,
Finnish, key or context. Filter by screen and status. Edit the Finnish field, then
choose **Save draft** or **Approve and next**. The preview substitutes example
values into the sentence. Details show the key, source revision and history; a
previous wording can be restored as a new draft. The reviewer runs on this
computer and saves to project files, not browser storage.

Each context that can affect wording has an independent record. For example, the
sound, vibration and cloud-sync toggles each have separate “On” entries. A stable
semantic control or controlled vocabulary item can share one entry across
screens when its meaning and grammatical role are the same, such as Cancel,
Save and equipment names. Matching English text alone is not enough to merge
entries.

Automatic suggestions never replace your edits. A source/context change reopens
review and retains the previous wording in history. A conflicting save is refused
with a visible message so it cannot overwrite newer work. Source-file movement
alone does not change the semantic revision.

## Exercise names and instructions

The dictionary translates built-in names, common imported movements, recognized
modifiers and built-in instructions. Display labels are separate from stored
names: switching language cannot split or merge exercise history.

Unknown names and custom coach instructions retain their original text and enter
a deduplicated queue. This avoids silently dropping an unfamiliar qualifier or
replacing a coach's specific instruction with a generic one. In Settings, download
the pending exercise JSON and use **Import exercises** in the reviewer. New entries
can then receive Finnish drafts, be reviewed and join the next app release.

The app cannot invent a reliable offline translation for an arbitrary new name.
Known dictionary entries work entirely offline; unfamiliar content needs this
translation pass. User-written notes and arbitrary imported plan/day names remain
as entered. The technical workout JSON field names and exercise identities stay
unchanged in both languages.

## After changing the app

1. Register new text in `locales/source/ui.json` (or the exercise catalogue). Use a
   stable key for the specific screen, control and purpose; share it only when the
   semantic role and grammar are stable across every use. Supply English, a Finnish draft, meaningful context, screen,
   role and sample values for named placeholders.
2. Translate complete messages. Preserve named placeholders and keep HTML in the
   app code. Context changes require a fresh draft even when the English is the
   same. Keep source file/line references out of semantic context.
3. Rebuild and check:

   ```powershell
   node tools/i18n/cli.mjs build
   node tools/i18n/cli.mjs check
   ```

4. Commit the source and review catalogues, generated `locales/catalog.js`, and
   `sw.js` with the app change. The build derives the offline release version from
   app contents, including translations. The normal release process delivers both
   together through the existing update banner.

Missing or stale Finnish drafts fail the check. Human approval is not required.
The scanner detects registered references and common hardcoded UI text; its
heuristics cannot prove complete coverage, so exercise the changed screen in both
languages. The allowlist is for explained brands/protocol data, not untranslated
interface messages.

## Regular checks and draft generation

The repository workflow checks app changes and includes weekly reconciliation.
It becomes active after the workflow is pushed to the default branch. Configure
the validation job as a required branch check if releases must be blocked on
translation failures. It does not automatically merge or deploy changes.

A Codex follow-up is scheduled for Mondays at 09:30 (Europe/Helsinki) to perform the same check and draft missing translations
without a separate API credential. It should process only changes since the last
successful check, preserve edits and approvals, and notify only about new work or
failures. Automation ID: `gymtrack-finnish-translation-check`. It runs in this task and needs the Codex local environment available.

An optional provider-backed generator supports **New suggestion** and automatic
generation from the reviewer or CI. Credentials and model/cost limits belong in
the server environment or repository secrets, never in the app. See
`tools/i18n/README.md` for configuration, budget limits and command details.
Without a provider, imported missing entries remain visible and editable; the
scheduled Codex pass can draft them. Initial Finnish content needs no API call.

## Verification

```powershell
node --test --test-isolation=none tools/pure.test.mjs tools/i18n-runtime.test.mjs tools/i18n-offline.test.mjs tools/i18n-exercises.test.mjs tools/i18n/*.test.mjs
node tools/weights.test.mjs
node tools/validate.test.mjs
```

An optional browser integration check is `tools/i18n-browser-smoke.mjs`. It uses
an isolated browser profile and a temporary review catalogue, blocks external
requests, and checks language changes, exercise dialogs, active workout/rest
preservation, offline reload, and durable reviewer editing/approval. Supply
`PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` for an existing browser installation
when these are not available through normal module/browser discovery.

Real iPhone keyboard, screen-reader and installed-PWA behavior should also be
checked on the device before release; desktop mobile-size checks do not establish
those device-specific behaviors.
