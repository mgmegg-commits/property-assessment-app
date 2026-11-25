# Cecil's Report Builder v2

Property condition assessments from walk-through to verified fix. Cecil Ingram (Cecil Ingram Properties LLC, Birmingham, AL) walks a property, records a voice memo and takes photos; the app drafts the report; he reviews and issues it. After that, the client assigns each action item to a facility and a person, the facility updates status from a phone, and Cecil verifies the fixes at the next visit.

The full spec is `docs/spec.md` (exported from the "v2 Spec" tab of the Requirements doc). Decisions live in its Decisions log. When the spec and this file disagree, the spec wins; tell me about the conflict.

## Who uses it
- **Assessor (Cecil):** not a computer person. His rule: "anything you can do is one less click." He works on iPhone and iPad, and reviews on a desktop. He identifies problems and never assigns them.
- **Client asset team:** assigns items to facilities, sets due dates, watches status, exports to their work-order system.
- **Facility / tenant staff:** see only their facility's items and update them from a phone. Assume no training.
- **Program coordinator:** sees assessments across assessor firms (later).

## v1 is the reference, not the base
v1 is `mgmegg-commits/cecil-report-app` (main, Nov 25, 2026). It works and Cecil approved its screens. Port what's proven; don't copy its single-user storage. Worth reading before designing the matching part:
- `src/js/walkthrough/mediaInfo.js` — reads the transcript iOS Voice Memos stores inside the .m4a (`moov/trak/udta/tsrp`)
- `src/js/drafting/` — transcript to remarks, the drafting prompt, placing photos by time, applying drafts as "drafted" values Cecil accepts
- `src/js/model/templates.js` and `sections.js` — Cecil's sections, subsections, ratings and standard sentences
- `src/js/export/pdf.js` — the PDF layout Cecil approved
- `src/js/photos/markup.js` — arrows, circles, numbered areas, text labels
- The phrase library seed list and the Excel follow-up tracker columns

## Rules
- **Old data always opens.** Every stored shape has a version; changes come with a migration and a migration test. v1 reports must import from v1's backup export.
- **The assessment freezes when issued.** Action items keep changing after that; they never change the issued report.
- **Never delete photo files.** Deleting hides a photo; older versions still show it. Reports and photos are kept forever. Audio is deleted once drafted; transcripts are kept.
- **Each organization sees only its own data.** Tenants see only their facility's items. Test this for every new endpoint.
- **No client data in the repo.** Use the fixtures in `tests/fixtures`. Secrets come from environment variables.
- **Tests for every change.** Keep the full suite passing. Commit after each numbered item in a prompt, and open a PR per milestone.
- **Fewest clicks.** Prefer visible one-tap buttons to menus and dropdowns. Every screen must work at iPhone width.
- **Update `docs/decisions.md`** when you make a design choice the spec doesn't cover, and list it in your summary.

## When you finish a task
Give me a short summary in plain language: what's done, anything you changed from the request and why, decisions I need to make, and a test script I can follow on an iPad and a desktop.
