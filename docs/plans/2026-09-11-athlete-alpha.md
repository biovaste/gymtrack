# Athlete alpha: 5–30 people

Status: proposed launch plan, not a claim that the current deployment is ready.

## Recommendation

Run the first athlete alpha through the existing English/Finnish PWA. Start with
five invited athletes, then expand to 10–15 and finally 30 after the gates below.
Continue native Phase 1 separately. Native framework validation and a useful web
alpha have different exit conditions: an iOS native build is not required to test
plan clarity, exercise logging, workout recovery and coach-authored plans on the web.

Use one primary phone/browser per athlete and curated plans for the first cohort.
Henri's current preference is coach-provided plans, pending confirmation with his
friend, and an estimated 80% iPhone / 20% Android cohort. Recruit approximately four
iPhone users and one Android user for the first five; prioritize physical iPhone
Safari/Home Screen testing before recruitment. These are planning assumptions,
not confirmed participants or a commitment from the coach.
Athletes can receive an importable JSON plan from a human coach; no AI account,
automated plan generation or coach dashboard is required. The athlete imports and
reviews the plan. A coach can review an explicitly shared export during the pilot.
Do not grant coaches the athlete's write credential or use the direct plan-push API
for concurrent editing. That needs a separate permission and revision workflow.

## What exists, and what must be finished

| Area | Repository evidence | Alpha requirement |
|---|---|---|
| Workout experience | PWA already supports warm-ups, supersets, alternates, identities and measurements; native prototype is less complete | Test the exact alpha build on physical Safari/iPhone and Chrome/Android |
| Coach plan handoff | Manual plan editor and import exist; current clipboard export is a full backup | Add a clearly labeled plan-only export from the coach's editor, then athlete preview/apply. Never send the coach's own history in a plan file |
| Local persistence | `app.js` uses localStorage; read errors return defaults and writes can throw | Detect failed/corrupt storage, preserve last good data, and never show a false save confirmation; exercise quota and interrupted-save paths |
| Recovery | JSON backup import/export exists | Verify export → clean browser/profile → restore, including active/finished-workout expectations, sides, setup identities and measurements; explain exactly what backups include |
| Cloud writes | `worker/src/index.js:checkWrite` allows writes when the secret is absent | Fail closed in alpha; test missing/invalid credentials; verify deployed configuration, not only source |
| Cloud privacy | GET access is granted by knowing the UUID URL; those URLs may be shared with AI | Explain and separate sharing from account recovery; implement revocable read access before treating cloud sync as private athlete accounts |
| Conflicts | Whole-backup KV read/modify/write and timestamp comparison; client merge gives remote same-ID records precedence | Serialize client writes and use atomic version/conflict handling for cloud alpha; add concurrent-write, retry and deletion regressions. One phone alone does not eliminate request races |
| Schema consistency | Local fixes and fixture tests exist; complete historical validation is still deferred | Freeze an alpha format, reject unsupported future versions, round-trip representative existing backups; no silent identity merges |
| Updates | Versioned service worker shell exists | Separate alpha URL/build; avoid reload during an active workout; test old cached app → new app with data retained; rehearse rollback |
| Support | No cohort workflow yet | One named support contact, minimal issue template, build/version visible, release notes and incident response |

The code changes prepared in this task are local. No current hosted release or
deployed secret configuration was verified. Do not invite real athletes based on
local tests alone.

## Two valid first-cohort modes

**Recommended initial mode: closely supported web trial with five athletes.**
Use local storage and explicit backup exports if cloud readiness is not yet proven.
This requires a real alpha configuration that disables automatic upload, cloud
restore and data-sharing links; instructions alone are not enough if uploads remain
enabled by default. Tell athletes that browser data is device-local and that clearing
site data/removing the app can lose unexported work. Verify backup/restore before
the first training session. Collect only data needed for the trial.

**Cloud-backed alpha:** close the authentication, privacy, conflict and recovery
gates first. Managed invitations and manual onboarding are acceptable for a small
cohort; an elaborate self-service account UI is not required. Each athlete still
needs isolated access, recovery, revocation and a deletion process. Do not use a
shared cohort UUID or common write token.

At 10–30 athletes, prefer the cloud-backed mode after these controls pass. Local-only
testing can remain an explicitly limited usability study, but must not be presented
as a reliable multi-device training service.

## Release gates and rollout

1. **Internal rehearsal:** test the exact hosted alpha build with synthetic data on
   at least one physical iPhone and one Android phone. Cover installation, human-plan
   import, all intended measurement types, swaps, grouped sets, keyboard edits,
   lock/resume, offline completion, reopening, backup/restore and application update.
   Inject storage/network failures. No known data-loss or cross-athlete-access bug.
2. **Five athletes:** individually onboard, observe their first workout, and ask each
   to complete at least two workouts plus one offline/recovery exercise. Record
   phone/OS/browser, build, outcome and any assistance. Confirm a recoverable export
   or verified backup for each athlete.
3. **10–15 athletes:** expand only after all five can finish and recover a workout,
   every logged data-loss/security incident is resolved, and blocking UX problems
   have fixes. Include different phone sizes and the supported languages.
4. **Up to 30:** expand after another stable cycle, successful update/rollback and
   recovery rehearsals, and demonstrated capacity to respond to reports within one
   working day. These are proposed operating targets, not existing guarantees.

Pause onboarding for any reproducible lost workout, incorrect exercise identity or
cross-athlete exposure. Preserve logs/backups with athlete permission, reproduce
using synthetic data, fix and retest before resuming. Do not log full workout notes,
credentials or share URLs in analytics by default.

Track completion attempts versus successful saves, recoveries, sync errors, support
requests and repeated usability problems. Record a small agreed usability target
(for example at least 90% unassisted workout completion); a percentage never excuses
a known data-loss or access-control defect in a small sample.

## Onboarding and feedback kit

- Stable alpha URL and Add to Home Screen instructions for each supported platform.
- Brief scope/limitations note: experimental build, backup responsibility, supported
  devices, and foreground-only web rest audio until separately validated.
- Plain-language notice covering collected data, who can access it, optional coach
  sharing, retention, export/deletion and contact. Resolve applicable privacy
  requirements before collecting real athlete data; this document is not a legal assessment.
- A starter plan per athlete, prepared by themselves or a human coach and tested
  against the alpha schema. Avoid a requirement to use any AI tool.
- Rehearse coach editor → plan-only export → athlete import/preview → first workout.
  The coach may receive schema assistance during the trial; athletes should not need
  to construct JSON or receive anyone else's full backup.
- Feedback fields: build, device/OS/browser, action, expected/actual result, whether
  data was retained, reproducibility, optional redacted screenshot. Do not request
  full personal backups as the default bug report.

## Needed from Henri

- First five invitees and approximate iPhone/Android split; target training types,
  kg/lb needs and English/Finnish preferences.
- Confirm the friend's coach role and whether coach history review is essential in
  the first trial. Preferred: coach supplies JSON; athlete explicitly shares exports
  if desired.
- Access to at least one real device per supported platform for the rehearsal
  (testers can perform a guided checklist); no Mac is required for the web alpha.
- Alpha hosting/account access when ready to publish, chosen support contact and
  approval of the concrete release/onboarding package. No invitations or uploads
  have been sent by this task.

Native iOS Phase 1 additionally needs a signed build path and an iPhone. Cloud builds
can supply the build machine; TestFlight external distribution has Apple review
requirements. Those steps can run alongside a web alpha.

## Work order

1. Finish portable/native Phase 1 tests and record unresolved device gates honestly.
2. Implement the chosen alpha mode and storage/recovery safeguards; freeze scope.
3. Complete physical web rehearsal, prepare onboarding/privacy/support materials.
4. Publish a reviewed alpha build and onboard five people; then expand by evidence.
5. Continue native release/device validation and shared schema/account foundations.

## Source checks

- [Cloudflare KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/):
  KV is eventually consistent and is not a transaction mechanism for competing writes.
- [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/):
  storage can be evicted; persistent-storage requests use heuristics, including Home
  Screen use. Installation does not replace a tested backup and recovery path.
- [Apple external TestFlight testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers):
  external beta distribution requires the TestFlight review flow for the first build.
