# GymTrack — Next Session Brief
_Last updated: 2026-09-08_

## Current state

Exercise library v1 was committed as `5803407`, pushed to main and deployed on
2026-09-08, after Henri authorized release. App assets at gymtrack.hithitpull.fi
were verified against the local release; GitHub build/deploy and localization
checks all succeeded. Worker deployment succeeded (version
`19a423a5-56a6-4cee-a4db-6fd02ad2959f`); the API responded with its expected JSON
404 at the root route. No workout data was changed during verification.
The deferred import/mid-workout entry gap is recorded in BACKLOG.md.

The plan add-exercise flow now offers 30 curated reusable entries, bilingual
search and existing dictionary aliases, movement/muscle filters, structured
variants, and explicit custom-entry versus library-alias selection. The existing
editor handles prescriptions, independent sides, machine/setup identities,
custom loads, ordering and supersets. Legacy exercises/history are not migrated.

`exercise-library.js` holds discovery and retention rules; `workout-model.js`
validates and snapshots entries. `plan.library` retains custom entries/aliases;
exercise `libraryEntry` snapshots preserve inherited instructions, while nonempty
exercise `description` overrides them. App/desktop/server plan-only imports and
cloud reconciliation retain saved library entries. Backups restore the full state.
See README.md, Exercise library v1, for the exact data contract and limitations.

Localization reuses existing names/instructions, adds five instruction entries
and library UI text. Build/check passes with 697 bilingual entries. New Finnish
text is draft; existing human review records are preserved. Review through
`Review Finnish.cmd` / the established localization workflow.

## Verification

- 67 model/pure/library/localization cases passed across the relevant suites,
  including the new Worker endpoint regression. Existing standalone weight and
  plan-validator checks passed.
- Isolated Edge/Playwright browser checks passed for the existing workout flows
  and library variants, custom entries, aliases, inheritance/overrides, backup,
  export, intercepted sync, cloud reconciliation and offline Finnish browsing.
- `node tools/i18n/cli.mjs build` and `check` passed.
- Windows: TEMP/TMP under repo `tmp`; Node tests use `--test-isolation=none`.
  Edge requires execution outside the process sandbox. The smoke test waits for
  installation navigation to settle before interacting with the app.

## Next action

The next product follow-up is the imported/mid-workout unknown-exercise choice
in BACKLOG.md. Review new Finnish wording as needed. Do not include the pre-existing
`.claude/skills/weekly-review/SKILL.md` edit; it remains untouched.

V1 has no library-wide editing/deletion or alias-removal screen. Custom text uses
the existing translation-review queue. The library picker is for plan authoring;
mid-session free-text entry is unchanged. Physical iPhone checks remain useful.

Later work stays outside this release: true whole-session RPE; pre-session energy
and soreness/location; symptoms and next-day follow-up; injury recovery;
conservative comparable-history weight suggestions; update snooze, external
activity context and upper-body readiness. Earlier compound-set support remains
unimplemented. Do not infer or backfill historical ratings or identity mappings.
