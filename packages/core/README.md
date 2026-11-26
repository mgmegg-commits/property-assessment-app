# @crb/core

The report model, shared by the server and the web app. Pure code: no database, no web page, no network. Functions take the assessment document as their first argument and change it in place, as in v1.

## Ported from v1

| | |
| --- | --- |
| Repository | `mgmegg-commits/cecil-report-app` |
| Branch | `main` |
| Commit | **`03104a233742cccaaea3af99c1c6d554fd27fdf5`** (`03104a2`, Nov 25, 2026, "Merge pull request #5 from mgmegg-commits/cecil-feedback-2") |
| Ported in | v2 step 2.2 |

To see what has changed in v1 since this port, run this in a v1 checkout. It covers the files ported here and their tests:

```bash
git fetch origin main && git diff 03104a2 origin/main -- src/js/model src/js/util/format.js src/js/util/ids.js src/js/state.js src/js/export/tracker.js tests/model.test.mjs tests/sections.test.mjs tests/phrases.test.mjs tests/priorities.test.mjs tests/versions.test.mjs tests/photos.test.mjs tests/actions.test.mjs tests/tracker.test.mjs tests/fixtures
```

When porting a later v1 fix, update the commit above.

## Where each v1 file went

| v1 (`src/js/…`) | v2 (`packages/core/src/…`) | Notes |
| --- | --- | --- |
| `model/assessment.js` | `model/assessment.ts`, `model/migrations.ts`, `model/types.ts` | The document's shape is now TypeScript types. `migrateAssessment()` became numbered steps (below) |
| `model/sections.js` | `model/sections.ts` | |
| `model/templates.js` | `model/templates.ts`, `data/templates.json`, `data/priority-schemes.json` | Template lists, standard sentences and priority schemes are data |
| `model/checks.js` | `model/checks.ts` | |
| `model/phrases.js` | `model/phrases.ts`, `data/phrases.json` | The 21 seed phrases are data |
| `model/versions.js` | `model/versions.ts` | |
| `state.js` `defaultSettings()`, `DEFAULT_DISCLAIMER` | `model/settings.ts`, `data/disclaimer.json` | Only the report settings; the rest of `state.js` is screen state |
| `export/tracker.js` `TRACKER_COLUMNS` and widths | `model/tracker.ts`, `data/tracker-columns.json` | Only the columns; the export comes in step 2.9 |
| `util/format.js` | `util/format.ts` | The date helpers the model uses; display helpers come with the screens |
| `util/ids.js` | `util/ids.ts` | `SESSION_ID` left behind |
| `drafting/*` (transcript shape) | `model/transcripts.ts` | The transcript document and its migration |
| `drafting/prompt.js`, `claudeDraft.js` (`readIssues`, `readDraft`), `training.js`, `spellingPrompt.js` | `drafting/prompt.ts`, `read.ts`, `training.ts`, `spelling.ts` | Ported in the simplified build for the server's drafting and spelling check; the prompt text is v1's word for word. Applying a draft stays in v1's page, which v2 serves unchanged |

## What's different from v1, on purpose

Each of these is also in `docs/decisions.md`.

1. **Schema 7: assignee and due date leave the report.** The assessor never sets them; the client and facility do, on the live action item (plan section 4, A-12).
   - `newFinding()` makes an action with only a title, recommendation and priority.
   - A v1 report's saved values move to `finding.v1FollowUp`, so nothing is lost.
   - `listActions(a, followUp)` and `actionNumbersById(a, followUp)` take the live due dates by finding id. Without them they use a v1 report's saved dates, so a migrated v1 report still sorts as it did in v1.
   - `mergeFindings` combines `v1FollowUp` the way v1 combined `assignee` and `due`: the earliest due date, and the first assignee.
2. **Migrations are numbered steps** (`ASSESSMENT_MIGRATIONS`, 2 to 7).
   - Steps 2 to 6 are v1's `migrateAssessment()` split one per schema. On every fixture they give exactly what v1's function gives, which `test/migrations.test.ts` checks against a word-for-word copy of it.
   - The one difference is in theory only: v1 re-ran its schema 3 and 4 clean-ups on documents already past them. Those clean-ups change nothing on any document v1 saved.
   - `migrateAssessment(doc, { to })` can stop early, for the tests.
3. **Transcripts have their own schema.** It's 2 in v2: each remark gets `leftOut` (A-16). v1 saved none, which counts as 1.
4. **Seed data is data.** The templates (sections, subsections and standard sentences), priority schemes, phrases, disclaimer and tracker columns are JSON files in `src/data`, also exported as `@crb/core/data/*.json`, for later steps to load into the database.
   - `standardSentence(item, sentences?)` and `sectionSentence(section, sentences?)` take a template's own sentences, and use v1's by default.
   - `TEMPLATES` no longer has v1's `variant`, because the data holds each template's labels directly.
5. **`defaultSettings()`:**
   - Starts with an empty `company` and `preparedBy`; in v2 they come from the organization and its users, where v1 started with Cecil's own.
   - Has no `keepOriginals`, because v2 always keeps originals (Plan 12.15).
6. **New reports don't carry `_by`** (v1's browser-tab id). v2 detects edits from another device with the database row's version.
7. **Small fixes:**
   - `buildSections()` and `newAssessment()` name an unknown template in their error.
   - `photosByTimeTaken()` no longer compares `undefined` when a photo has no `addedAt`.
   - `copiedFrom` holds `""` rather than `undefined` when the earlier report had no id or date.

## v1's tests

The ported tests are in `test/v1`, kept as JavaScript (`.test.mjs`) so their bodies stay v1's text.
- Each file differs from v1 only in its header line, its import lines and the fixture path.
- Tests that need code from a later step are taken out, with a comment where each was.
- Four tests change with schema 7; each is marked `Changed in v2` with the reason.

| v1 file | v1 tests | Pass in v2 | Changed in v2 | Not yet ported (step) |
| --- | --- | --- | --- | --- |
| `model.test.mjs` | 3 | 3 | — | — |
| `priorities.test.mjs` | 4 | 4 | — | — |
| `versions.test.mjs` | 3 | 3 | — | — |
| `phrases.test.mjs` | 4 | 4 | — | — |
| `sections.test.mjs` | 17 | 12 | 1 | 5 (2.8) |
| `photos.test.mjs` | 7 | 7 | 1 | — |
| `actions.test.mjs` | 6 | 4 | 2 | 2 (2.9) |
| `tracker.test.mjs` | 3 | 1 | — | 2 (2.9) |
| **Total** | **47** | **38** | **4** | **9** |

v1 has no `checks.test.mjs`. Its checks are tested inside `priorities`, `sections` and `actions`, and here also in `test/model.test.ts`.

**Changed in v2 (schema 7):**
- `actions` "a new finding has no assignee or due date" now checks the fields don't exist (v1: both `""`).
- `actions` "the action list follows the report's chosen order…" gives the due dates to `listActions` by finding id (v1: on `f.action.due`). Its assertions are unchanged.
- `sections` "merging findings keeps the first's text…" puts the due dates in `v1FollowUp` and checks the earliest is kept there (v1: `f.action.due`).
- `photos` "schema 6: older photos get an empty list of extra places" expects `SCHEMA_VERSION` 7 (v1: 6). The rest is unchanged.

**Not yet ported, because the code they test isn't in `packages/core`.** In the simplified build, v1's page (served unchanged) applies drafts and makes the exports itself, so these stay covered by v1's own tests on v1's code:

| Test | v1 file | Needs | Step |
| --- | --- | --- | --- |
| the draft fills in the report's own subsections, ratings, notes and summaries | `sections` | `drafting/applyDraft.js`, `claudeDraft.js` | 2.8 |
| the draft never overwrites what Cecil set, and re-draft replaces only drafted values | `sections` | the same | 2.8 |
| Accept all clears a section's drafted marks | `sections` | the same (stand-in now in `test/drafted-marks.test.ts`) | 2.8 |
| issuing is blocked until drafted values are accepted and suggestions resolved; not-discussed is fine | `sections` | the same (stand-in now in `test/drafted-marks.test.ts`) | 2.8 |
| training examples keep the final ratings, notes and summaries | `sections` | `drafting/training.js` | 2.8 |
| the CSV shows TBD for an empty assignee or due date | `actions` | `export/files.js` | 2.9 |
| the Excel tracker and the CSV follow the same order | `actions` | `export/tracker.js`, `export/files.js` | 2.9 |
| one row per action in report order, with the exact columns | `tracker` | `export/tracker.js` | 2.9 |
| the workbook has a bold, wrapped header and readable columns | `tracker` | `export/tracker.js`, `xlsx-js-style` | 2.9 |

v1's other test files belong to later steps: `markup.test.mjs` and `rotate.test.mjs` (photos, 2.7), `media.test.mjs` (walk-through upload, 2.8), and `server.test.mjs` (v1's server, replaced by `apps/server`).

## v2's own tests here

| File | What it covers |
| --- | --- |
| `test/migrations.test.ts` | Every fixture schema 1 to 7: matches v1's function for steps 2 to 6, upgrades to schema 7, opens, keeps everything, and is idempotent; what each step does; transcripts |
| `test/seed-data.test.ts` | The data files hold v1's values: templates, sentences, priority schemes, phrases, disclaimer, tracker columns |
| `test/model.test.ts` | Ported functions v1 had no test for: numbering, action counts, section ratings, photo labels and order, each pre-issue check |
| `test/drafted-marks.test.ts` | Drafted values and suggestions, marked by hand, until drafting arrives in 2.8 |
| `test/organizations.test.ts` | Organization types (step 2.1) |

The fixtures are described in `tests/fixtures/README.md`.
