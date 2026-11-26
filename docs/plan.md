# v2 Build Plan: the simplified build

Nov 26, 2026. Cecil has a beta test with a skilled nursing operator that owns 45 sites, so v2 is the simplest version that works end to end: v1's approved screens and workflow, plus follow-up on action items. The full Nov 25 design and milestones are in `docs/archive/plan-2026-11-25.md`; read them only when a "Later, if needed" item is being built.

## 1. The build

### Why

The full plan (`docs/archive/plan-2026-11-25.md`) is too big for what's needed now: Cecil's beta test with a skilled nursing operator that owns 45 sites. This build is the simplest v2 that works end to end. Everything else waits until there's a paying customer who needs it (see "Later, if needed").

### What it is

- **v1's screens, exactly as they are.**
  - v1 already has a website mode: its front end talks to a small JSON API (v1 `server/app.js`).
  - v2 builds v1's front end from a pinned v1 commit and serves that page. Nothing is rebuilt in React.
  - `scripts/refresh-v1.sh <commit>` rebuilds it from a newer v1 commit. The commit in use is recorded in `apps/v1-web/VERSION.json`.
- **v2's server speaks v1's API**, on Fastify and PostgreSQL instead of v1's files:
  - session, sign-in and sign-out;
  - reports, settings and documents (transcripts, training examples, versions);
  - photo files, drafting jobs and the spelling check.
  - Reports, settings and documents are JSONB rows. Photos are files on disk under the data volume.
  - Deleting a photo or a report hides it; nothing is ever removed.
  - Drafting and spelling are v1's, run on the server, with the prompt code in `packages/core`.
  - v1's own server tests (`tests/server.test.mjs`) run against v2 to prove the API matches.
- **One login:** a single password from an environment variable, as in v1. There are no organizations, roles, passkeys, single sign-on, email or row-level security yet.
- **Follow-up**, the only new feature:
  - When a report is issued, each of its action items becomes a follow-up item, with a frozen copy of its text.
  - A Follow-up page, linked from v1's home page, shows items by property, with filters and overdue flags. Facility, assigned person, due date and status are entered there on the client's behalf.
  - Personal update links give one named person at one property a phone page for that property's open items, with no sign-in.
  - An Excel export uses v1's tracker columns.
- **Look and flow:** the clickable prototype in `docs/prototype/`, in v1's colors and fonts.

### How it fits together

| Part | What it is |
| --- | --- |
| `apps/v1-web/` | v1's built page (`index.html`, one file) and `VERSION.json`: the v1 commit, its date and the file's SHA-256. Served at `/` unchanged. The server adds one small script that puts a Follow-up link on v1's home page. |
| `apps/server/` | Fastify. It serves v1's API (`/api/session`, `/api/login`, `/api/assessments…`, `/api/settings`, `/api/docs…`, `/api/files`, `/files/:id`, drafting, spelling), the follow-up API (`/api/follow-up…`, signed in), and the personal-link API (`/api/link/:token…`, no sign-in). |
| `apps/web/` | React pages that v1 doesn't have: the Follow-up page (`/follow-up`), the phone page a personal link opens (`/u/<token>`), and the status page (`/status`). |
| `packages/core/` | The report model and migrations (step 2.2 of the archived plan), and the drafting prompt, reading Claude's answer, training examples and the spelling prompt, now ported for the server. |
| PostgreSQL | `report` (v1 reports as JSONB), `setting`, `doc` (transcripts, training examples, versions), `file`, `job`, `issued_report` (the frozen copy at each issue), `action_item`, `action_update`, `update_link`. |
| Data volume | `/data/files/<id>`: photo files, never removed |

**Report shape.** v1's screens read and write schema 6 reports, so the server stores and serves each report exactly as v1's front end sent it. A stored report is never migrated to a shape v1's screens can't handle.
- Schema 7 (archived plan step 2.2), with assignee and due date out of the report, is used only in memory when issuing. Assignee and due date live in the follow-up tables.
- A test round-trips a report through v1's front end (load, edit, save) and checks nothing else changed.

### Follow-up in detail

- **Statuses:** Open, In progress, Done, Deferred, Withdrawn.
  - Facility contacts can set In progress and Done.
  - On the Follow-up page, any status can be set except Withdrawn, which only a revision sets.
  - The Fixed / Not fixed / Worse check at the next visit is for later.
- **At issue:**
  - When v1's front end saves a report whose status becomes "issued", the server stores a frozen copy of it (`issued_report`).
  - It creates one item per action, using `packages/core`'s `listActions`, numbered A1, A2… in the report's action order. Each item has a frozen copy of its title, description, location, recommendation, priority, section and subsection, plus its photos.
  - If Cecil filled in an assignee or due date, they become the item's starting values.
  - The first entry in each item's history is "Found during the <date> visit", by whoever prepared the report.
  - The issued report itself never changes.
- **A revision:** issuing the next revision updates each item's frozen text from the new revision. A finding that's gone marks its item Withdrawn. New findings add items. Live fields (facility, person, due date, status) carry over.
- **The Follow-up page** (signed in):
  - **Header and choice:** the property is chosen with one-tap buttons.
  - **Counts:** Open, In progress, Done and Overdue.
  - **Filter chips:** All, Open, In progress, Done, Overdue.
  - **The item table:** No., action item, priority, assigned to, due, status, last update.
  - **Each item:** tapping a row opens it to set its facility, assigned person, due date and status, with a note. Every change records who (the name the person enters once on that device) and when.
  - **Update links** are listed for the property; there's also the Export to Excel button.
- **Overdue:** a due date before today (in the copy's time zone) while the item is Open or In progress.
- **Personal update links:**
  - **Creating one:** "+ New link" takes a name and role for the chosen property and makes a link. Copy link puts it on the clipboard to paste into a text or email by hand. Nothing is sent by the app.
  - **What it opens:** a phone-sized page for that property's open items (Open and In progress), with nothing else.
  - **The update:** In progress and Done are one tap each, plus a note and an optional photo. Every update records the person's name and the time.
  - **Turning it off:** a link can be turned off (and on again) at any time. A turned-off link shows "This link has been turned off".
  - **Address:** links use the copy's public address (`PUBLIC_URL`), so a link made on the Mac works on a phone.
- **Excel export:** one row per item, in action order, with v1's tracker columns (Facility Name, Assessment Date, Action Item Description, Q1 to Q4, Facility Contact). After them come Status, Assigned To, Due Date, Facility and Last Update. The current quarter's column holds the latest update.

### Steps (one PR for this build)

| Step | What | Tested by | How you check it |
| --- | --- | --- | --- |
| 1 | These docs: the plan, spec, `CLAUDE.md`, decisions | — | Read this plan |
| 2 | v1's front end at a pinned commit, with `scripts/refresh-v1.sh` | The built page's SHA-256 matches `VERSION.json`; a test that the server serves it unchanged | `./start.sh`, open http://localhost:8080: v1's sign-in page |
| 3 | v1's API on PostgreSQL: reports, settings, documents, photos (hidden, never removed), drafting and spelling | v1's own `tests/server.test.mjs` against v2; v2 API tests; a round-trip of a report through v1's front end | Sign in, make a test report, add photos, issue it |
| 4 | Follow-up: items at issue, the Follow-up page, personal links, the phone page, overdue flags, Excel export | API tests, including that a link sees only its own property's items and stops working when turned off | Open Follow-up, make a link, open it on the iPhone, mark an item Done |
| 5 | Browser tests | Playwright: v1's page against v2, the Follow-up page, and the phone page at iPhone size | CI green |

### Later, if needed

Each of these waits for a paying customer who needs it. Sections 2 to 9 of the archived plan describe how each would be done.
- Install-anywhere packaging, client copies and licensing
- Organizations and roles, and row-level security
- Passkeys and single sign-on; email (sign-in links, reminders)
- S3 or other object storage; resumable photo uploads; offline work
- The next-visit check (Fixed / Not fixed / Worse); the program coordinator view
- The AI provider switch (Bedrock, Vertex, Foundry)
- Rebuilding v1's screens in React

## 2. Risks

| Risk | How it's reduced |
| --- | --- |
| v2 drifts from v1's API and a v1 screen breaks | v1's own server tests run against v2 in CI; a browser test drives v1's page against v2; the v1 build is pinned and refreshed only on purpose |
| A stored report is changed into a shape v1 can't read | The server stores and serves the report exactly as sent; schema 7 is used only in memory; a round-trip test |
| A personal link reaches another property's items | Every link request is scoped to its property in the query; tests try another property's item ids and a turned-off link |
| A link is forwarded | It shows only one property's open items and can be turned off at once; every update shows the name it was made for |
| Photos lost | Never removed: deleting hides; files live on the data volume, which the backup must include |
| One shared password | Fine for Cecil and Michael during the beta; organizations and roles are "later, if needed" |


## 3. Decisions

Decisions for this build are in `docs/decisions.md` (Nov 26, 2026 rows). The Nov 25 decisions (Plan 12.1 to 12.20) are in section 12 of `docs/archive/plan-2026-11-25.md`; those for parts this build leaves out wait with them.
