# Codebase consistency review — 10 September 2026

Scope: shared workout model, plan normalization and export, library snapshots, desktop plan validation, sync routes, coaching instructions, translations, offline assets, and existing automated coverage.

## Fixed

- The copied coaching schema omitted library entries/snapshots and warm-up fields. It now includes those fields and accurately identifies numeric measurement targets and object load profiles. Both localized prompt variants describe identity preservation and current measurements.
- The plan-only sync route applied model validation only to exercises with library snapshots. All exercises and alternates now receive those checks. Regression tests verify that invalid identities, metrics, targets and load profiles cannot overwrite stored data.
- Forced backup writes skipped JSON parsing entirely. Forced and normal writes now require valid JSON with the backup type; force only bypasses the stale-timestamp guard. Regression tests verify rejected writes preserve stored data.
- Shared coaching documentation described history as universally name-based, omitted newer measurement/library fields and backup aliases, reversed export ordering, and mislabeled the calculated RPE proxy. These descriptions now match the current model.
- App introductions, manifest, coaching confirmations, notes placeholder and development/coaching prose now use generic AI wording. The supported-assistant example sentence retains brand examples. Existing localization identifiers, review history and actual tool-specific paths remain intact.
- Desktop UUID help now points to Settings; the storage key remains `gymtrack_uuid`.

## Verification

All 10 existing test files pass when run separately, with additional backend and localized-prompt regressions. Localization build/check passes for 697 entries. The Edge browser suite passes for English/Finnish UI, workout identities, setups, timed/distance logging, library operations, backup/export/restore, offline reload, sync success/error/retry, and translation reviewer persistence. JavaScript syntax and whitespace checks pass.

## Remaining boundaries

- This is not full strict validation of historical backups. The full-backup endpoint still accepts legacy payloads after checking JSON and the type; the browser normalizes plans on restore. Introducing stricter historical-record validation requires compatibility fixtures and explicit migration rules.
- Browser import, desktop validation and the plan-only endpoint still have different responsibilities: desktop checks loadability and authoring constraints, while the browser applies legacy defaults. They are not interchangeable strict-schema validators.
- The existing KV read/modify/write sync design is not an atomic multi-device transaction. Timestamp checks do not guarantee protection from simultaneous writes. Resolving this requires a separate sync architecture change.

Existing user changes in the weekly-review skill were preserved. Nothing was committed or deployed; the backend fixes require a Worker release when shipping.
