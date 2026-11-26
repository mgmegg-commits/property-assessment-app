# Cecil's Report Builder v2

Property condition assessments from walk-through to verified fix. Cecil Ingram (assessor) walks a property with a voice memo and photos; the app drafts the report; he reviews and issues it. The client then tracks each action item, and facility staff update items from a phone.

**Read `docs/plan.md`** (the simplified build: what to build, its steps, its risks). The spec is `docs/spec.md`; it wins over this file when they disagree, so tell me about the conflict. Only open `docs/archive/` when building a "Later, if needed" item.

## The build
- **v1's front end is served as is** from a pinned v1 commit in `apps/v1-web/` (`scripts/refresh-v1.sh <commit>`; the commit is in `VERSION.json`). Don't rebuild v1's screens or change the v1 repo (`mgmegg-commits/cecil-report-app`).
- **v2's server implements v1's API** on PostgreSQL; v1's `tests/server.test.mjs` runs against it (`tests/v1-server/`). Store and serve reports exactly as v1 sends them (schema 6).
- **One login:** a single password from `APP_PASSWORD`. No organizations, roles, passkeys, SSO or email yet.
- **Follow-up** is the only new feature. Tenants reach only their property's open items through personal links (one named person, one property, can be turned off).

## Rules
- **Old data always opens.** Every stored shape has a version; changes come with a migration and a migration test.
- **Issued reports freeze.** Action items keep changing; the issued report never does.
- **Never delete photo files.** Deleting hides. Audio is deleted once drafted; transcripts are kept.
- **Everything but sign-in and personal links needs the password.** A link sees only its property's open items, and nothing once off. Test this for every new endpoint.
- **No client data in the repo.** Use `tests/fixtures`. Secrets come from environment variables.
- **Tests for every change**, full suite passing. Commit per numbered item; one PR for the simplified build.
- **Fewest clicks.** Cecil isn't a computer person: visible one-tap buttons over menus; every screen works at iPhone width; facility staff need no training.
- **Record design choices** the spec doesn't cover in `docs/decisions.md`, and list them in your summary.

## When you finish
A short plain-language summary: what's done, anything changed from the request and why, decisions I need to make, and a test script for an iPad and a desktop.
