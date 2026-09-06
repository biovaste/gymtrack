# Context-specific Finnish translations

Requires Node.js 24. No packages or production build server are needed.

```
node tools/i18n/cli.mjs build
node tools/i18n/cli.mjs check
node tools/i18n/cli.mjs review
node tools/i18n/cli.mjs pending > finnish-pending.json
node tools/i18n/cli.mjs apply-drafts finnish-drafts.json
node --test tools/i18n/*.test.mjs
```

Open the localhost address printed by `review`. Search by English, Finnish or
context, filter by screen/status, edit, then save a draft or approve and advance.
Sample placeholders preview as text. History restores old wording as a new draft.
Backups import as drafts with source and concurrent-edit checks. Save before
switching items. A second review server is prevented by `locales/.review.lock`;
after a crashed process only, remove that file. Do not expose this server remotely.
Saved edits rebuild the runtime catalogue. Publishing follows the normal app
release process; review approval does not gate whether Finnish is displayed.

## Adding or changing text

Add one entry per meaning/context to `locales/source/*.json`. Identical wording in
different controls requires separate keys. Use `screen.component.purpose` keys:

```json
{
  "settings.sound.enabled": {
    "en": "On", "fi": "Käytössä", "screen": "Settings", "role": "option",
    "context": "Rest timer sound is enabled", "examples": {}
  }
}
```

Use whole messages and named `{count}` placeholders, with separate grammatical
variant keys where needed. Never put HTML in translations. `fi` is the initial
machine draft; human work lives in `locales/fi.review.json`. Source revision hashes
cover English, context, screen, role and placeholder contracts, independently of
file placement. Changed semantics reopen review. An unchanged source `fi` is
considered stale after such a change, and generation must produce fresh Finnish.
Never overwrite human drafts to refresh machine suggestions: regenerate stores a
separate suggestion. Removed keys remain retired with history. Generated runtime
assets include every active current draft, regardless of approval. Missing/invalid
Finnish blocks checks and build, keeping incomplete changes out of releases.

Run `build` after app shell or catalogue changes; it also updates the offline cache
version from app content. Commit `locales/catalog.js`, `locales/fi.review.json` and
`sw.js` together. `check` is read-only and verifies generated files are current.

`scan` flags literal translation references and a documented heuristic set of
visible HTML text/attributes, alert/confirm/prompt/toast literals, and narrow
`.textContent`, modal-title, and button-label assignments. It is not a
JavaScript parser and does not prove every dynamic string is translated. Dynamic
keys require runtime tests; complete a screen walkthrough for both languages.
`literal-allowlist.json` maps reported hashes to explicit reasons for legitimate
brand/protocol/data text. Do not baseline untranslated UI strings to bypass checks.

## Automatic generation

Configure these in your local shell or GitHub repository settings:

- `I18N_API_KEY`: provider credential (GitHub **secret**).
- `I18N_MODEL`: explicitly selected provider model.
- `I18N_API_URL`: optional HTTPS OpenAI-compatible Chat Completions URL.
- `I18N_INPUT_USD_PER_MILLION`, `I18N_OUTPUT_USD_PER_MILLION`: current provider rates.
- `I18N_MAX_USD`: conservative per-run budget, default 1 USD.
- `I18N_MAX_ENTRIES`: maximum entries per run, default 100.
- `I18N_MAX_REQUESTS`: maximum calls including retries, default 10.
- `I18N_MAX_OUTPUT_TOKENS`: per-call output cap, default 3000.

Run `node tools/i18n/cli.mjs generate`, or **Check now** in the reviewer. No call is
made when all current entries already have Finnish. Batches contain at most 10
entries, two attempts each, with 45-second request timeouts. Each attempt reserves
an input estimate based on UTF-8 bytes and the full output cap against the budget;
configure rates accurately. Provider billing remains authoritative. Invalid output
or unavailable credentials fail visibly; no English fallback draft is fabricated.
Only text/context/glossary are sent, never workouts or credentials in browser code.

An API-free scheduled agent can use `pending` to export missing entries and
`apply-drafts` to apply a `{translations:[{key,fi,sourceRevision}]}` response.
Revisions, keys, placeholders and duplicates are checked before any save;
current manual or approved wording is preserved and receives a suggestion for
human review. Applying drafts never approves an entry.

Use **Import exercises** with the app's pending-exercise JSON export (an array of
`{name, description?, reason?}` records). The reviewer sends it to
`/api/import-exercises`, which creates the durable source file
`locales/source/imported-exercises.json`. This generates
contextual catalogue entries for previously unknown exercise names/descriptions;
credentials are required when new drafts are needed; without them, missing entries
remain visible for manual drafting. Review and release them like other entries.
Stored exercise identities remain unchanged.

The workflow validates pull requests without provider secrets. Default-branch
updates, Monday 06:20 UTC, and manual runs reconcile drafts and maintain one
`codex/finnish-translations` pull request. Enable repository workflow write access
and creation of pull requests. Unchanged runs create no proposal or extra notice;
failed runs are visible in GitHub Actions. The workflow file becomes active only
after being pushed to the default branch. Configure branch protection to require
the validation job if release blocking is desired. Automated merges/deploys are
not enabled.
