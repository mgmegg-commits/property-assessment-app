# Cecil's Report Builder v2

Property condition assessments from walk-through to verified fix. Cecil Ingram (Cecil Ingram Properties LLC, Birmingham, AL) walks a property, records a voice memo and takes photos; the app drafts the report; he reviews and issues it. After that, the client assigns each action item to a facility and a person, the facility updates status from a phone, and Cecil verifies the fixes at the next visit.

The full spec is `docs/spec.md` (exported from the "v2 Spec" tab of the Requirements doc). Decisions live in its Decisions log. When the spec and this file disagree, the spec wins; tell me about the conflict.

## Who uses it
- **Assessor (Cecil):** not a computer person. His rule: "anything you can do is one less click." He works on iPhone and iPad, and reviews on a desktop. He identifies problems and never assigns them.
- **Client asset team:** assigns items to facilities, sets due dates, watches status, exports to their work-order system.
- **Facility / tenant staff:** reach only their property's open items, through a personal update link (no sign-in), and update them from a phone. Assume no training.
- **Program coordinator:** sees assessments across assessor firms (later).

## The simplified build (Nov 26, 2026)
v2 is now the simplest version that works end to end (`docs/plan.md` section 10): v1's screens, served unchanged, plus follow-up on action items. Everything in the plan's "Later, if needed" waits for a paying customer who needs it.
- **v1's front end is served as is.** It's built from a pinned v1 commit into `apps/v1-web/` (`scripts/refresh-v1.sh <commit>`; the commit is in `apps/v1-web/VERSION.json`). Don't rebuild v1's screens; don't change the v1 repo.
- **v2's server implements v1's API** on PostgreSQL. v1's own `tests/server.test.mjs` runs against it (`tests/v1-server/`). Reports are stored and served exactly as v1's front end sends them (schema 6); never migrate a stored report to a shape v1 can't handle.
- **One login for now:** a single password from `APP_PASSWORD`, as in v1. No organizations, roles, passkeys, single sign-on or email yet.
- **Tenants reach only their property's items through personal links.** A link belongs to one named person and one property, and can be turned off at any time.

## v1 is the reference
v1 is `mgmegg-commits/cecil-report-app` (main, Nov 25, 2026). It works and Cecil approved its screens. Worth reading before designing the matching part:
- `src/js/walkthrough/mediaInfo.js` — reads the transcript iOS Voice Memos stores inside the .m4a (`moov/trak/udta/tsrp`)
- `src/js/drafting/` — transcript to remarks, the drafting prompt, placing photos by time, applying drafts as "drafted" values Cecil accepts
- `src/js/model/templates.js` and `sections.js` — Cecil's sections, subsections, ratings and standard sentences
- `src/js/export/pdf.js` — the PDF layout Cecil approved
- `src/js/photos/markup.js` — arrows, circles, numbered areas, text labels
- The phrase library seed list and the Excel follow-up tracker columns

## Rules
- **Old data always opens.** Every stored shape has a version; changes come with a migration and a migration test. There's no v1 import (Cecil has no real reports in v1); a plain JSON import loads test data, so v1's document migrations still matter.
- **The assessment freezes when issued.** Action items keep changing after that; they never change the issued report.
- **Never delete photo files.** Deleting hides a photo; older versions still show it. Reports and photos are kept forever. Audio is deleted once drafted; transcripts are kept.
- **Everything but sign-in and personal links needs the password.** A personal link sees only its own property's open items, and nothing once turned off. Test this for every new endpoint.
- **No client data in the repo.** Use the fixtures in `tests/fixtures`. Secrets come from environment variables.
- **Tests for every change.** Keep the full suite passing. Commit after each numbered item in a prompt, and open one PR for the simplified build (its steps are in `docs/plan.md` section 10).
- **Fewest clicks.** Prefer visible one-tap buttons to menus and dropdowns. Every screen must work at iPhone width.
- **Update `docs/decisions.md`** when you make a design choice the spec doesn't cover, and list it in your summary.

## When you finish a task
Give me a short summary in plain language: what's done, anything you changed from the request and why, decisions I need to make, and a test script I can follow on an iPad and a desktop.
