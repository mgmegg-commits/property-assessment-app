# Test fixtures

Test data only: no client data, ever (CLAUDE.md). Nothing here is a real property or report.

| Path | What it is | How it was made |
| --- | --- | --- |
| `seed/organizations.json` | The three test organizations a development copy loads | By hand (step 2.1) |
| `v1/IMG_100.jpg` … `IMG_107.jpg`, `v1/walk-photos/` | Generated test photos with camera time and GPS | Copied from v1 `tests/fixtures` at 03104a2 |
| `v1/v1-assessment.json` | A report saved by v1's first version (no schema number, so schema 1) | Copied from v1 `tests/fixtures` at 03104a2 |
| `v1/documents/assessment-schema-6.json` | A full report as v1 saves it today: findings with assignee and due date, an observation, a hidden and a custom subsection, a suggested subsection with drafted values, photos with markup, a numbered area, a photo in two places | Built with v1's own `newAssessment()` and model functions at 03104a2 |
| `v1/documents/assessment-schema-5.json` … `-1.json` | The same report in each older shape | From schema 6, undoing one step at a time: 5 has no `alsoIn` or `actionOrder`; 4 no `facilityContact` or `priorityScheme`; 3 `addedByDraft` instead of `suggested`; 2 `owner` instead of `assignee`; 1 no schema number, `issues`, `nmi`, `narrative`, `obsOnly`, and photos with `issues` and no markup |
| `v1/documents/transcript.json` | A walk-through transcript as v1 saves it (no schema number) | By hand, in the shape v1's `uploadActions.js` saves |
| `v2/assessment-schema-7.json` | A report made and issued in v2 (Required / Recommended, no assignee or due date) | Built with v2's `@crb/core` |

Fixture documents are never edited once committed: a new shape gets a new fixture (CLAUDE.md, "Old data always opens"). `packages/core/test/migrations.test.ts` upgrades every one.
