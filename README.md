# Cecil's Report Builder v2

Property condition assessments from walk-through to verified fix, for Cecil Ingram Properties LLC.

Cecil walks a property with a voice memo and photos; the app drafts the report; he reviews and issues it. The client then assigns each action item to a facility and a person, the facility updates it from a phone, and Cecil verifies the fix at the next visit.

- **Spec:** [`docs/spec.md`](docs/spec.md): requirements, data model, milestones, decisions log, open questions
- **Build plan:** [`docs/plan.md`](docs/plan.md): the simplified build; the full Nov 25 design is in [`docs/archive/`](docs/archive/)
- **Instructions for Claude Code:** [`CLAUDE.md`](CLAUDE.md)
- **Design choices made during the build:** [`docs/decisions.md`](docs/decisions.md)
- **Meeting notes with Cecil:** [`docs/meetings/`](docs/meetings/)
- **v1 (reference):** [`mgmegg-commits/cecil-report-app`](https://github.com/mgmegg-commits/cecil-report-app)

Status: the simplified build (`docs/plan.md`). v1's screens, served unchanged, on a v2 server and database, plus follow-up on action items:

- **Reports:** v1's own screens at `/`, exactly as Cecil approved them, signed in with one password. Drafting and the spelling check run on the server.
- **Follow-up** (button on v1's home page, or `/follow-up`): each issued report's action items by property, with status, overdue flags and filters. The office assigns facility, person and due date, and changes status, on the client's behalf. Export to Excel with v1's tracker columns.
- **Personal update links:** a link for one named person at one property, copied and sent by hand. On a phone it shows only that property's open items: one tap for In progress or Done, a note and a photo. Links can be turned off at any time.
- **Status page** at `/status`: whether the app and database are working.

## Try it on a Mac

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/), open and running.

In Terminal, in this folder:

```bash
./start.sh
```

The first time takes a few minutes. When it's ready it prints the password and three addresses:

- **Password:** made up the first time and kept in `.env` as `APP_PASSWORD`. Change it there and run `./start.sh` again.
- **On the Mac:** http://localhost:8080 (Follow-up: http://localhost:8080/follow-up)
- **On an iPad or iPhone** on the same Wi-Fi: `https://<your Mac's name>.local:8443`
- **Set-up page for each iPad or iPhone**, once per device: `http://<your Mac's name>.local:8081`. It walks you through trusting the Mac's certificate (download, install the profile in Settings, turn on full trust), which the iPad needs before it can open the HTTPS address.

To stop it (your test data is kept):

```bash
./stop.sh
```

Run `./start.sh` again after pulling new code: it rebuilds what changed and keeps your test data. To wipe the test data and start from scratch, stop it and run `docker compose down -v`.

Notes:
- To try drafting, put your own Anthropic API key in `.env` as `ANTHROPIC_API_KEY` and run `./start.sh` again. Without one, everything else works; drafting says no key is set.
- Personal update links use the iPad/iPhone address, so a phone on the same Wi-Fi can open them (after the set-up page, once per phone).
- This copy holds test data only (`tests/fixtures/seed`). Never put real reports or photos in it.
- Its settings are in `.env`, which `./start.sh` creates the first time. `.env` stays on your Mac.
- If your Mac's address on the network changes (another Wi-Fi), run `./start.sh` again so the iPad address works.
- macOS may ask whether Docker can accept incoming network connections. Allow it, or iPads and iPhones can't reach the Mac.

## Working on the code

Needs Node.js 22 (see `.nvmrc`) and Docker.

```bash
npm ci
```

```bash
./scripts/test-db.sh
```

```bash
npm run test:all
```

| Command | What it does |
| --- | --- |
| `npm run build` | Builds `packages/core` and `apps/server` (TypeScript) and `apps/web` (Vite) |
| `npm run check` | Type-checks everything, tests included |
| `npm run lint` | ESLint |
| `npm test` | Unit and database tests (Vitest). Needs the test database from `./scripts/test-db.sh` or `TEST_DATABASE_URL` |
| `npm run test:v1-server` | v1's own server tests (`tests/v1-server`), run against v2's server |
| `npm run test:e2e` | Builds, then browser tests at iPhone, iPad and desktop sizes in Chromium and WebKit (Playwright). `PW_BROWSERS=chromium` runs Chromium only |
| `./scripts/smoke-stack.sh` | Starts the whole stack with `./start.sh` in a temporary copy, checks every address, and removes it |
| `npm run dev:server` / `npm run dev:web` | Server with reload (needs `DATABASE_URL`) and the web app with hot reload at http://localhost:5173 |

CI (`.github/workflows/ci.yml`) runs lint, types, unit tests, v1's server tests, browser tests in both engines, and the stack check on every pull request.

### v1's screens

v1's front end is built from a pinned commit of [`mgmegg-commits/cecil-report-app`](https://github.com/mgmegg-commits/cecil-report-app) into `apps/v1-web/`. `apps/v1-web/VERSION.json` records the commit and the page's checksum; the server refuses to start if the page doesn't match. Don't edit the page by hand. To move to a newer v1:

```bash
./scripts/refresh-v1.sh <commit>
```

It also refreshes v1's server tests in `tests/v1-server`. Run `npm run test:all` afterwards.

### Layout

| Folder | What's in it |
| --- | --- |
| `packages/core` | Pure code shared by server and web app: v1's model, migrations, drafting and spelling prompts. No database, no page |
| `apps/server` | Fastify server: v1's API under `/api`, follow-up under `/api/follow-up` and `/api/u`, v1's page at `/`, migrations in `apps/server/migrations` |
| `apps/v1-web` | v1's built page at a pinned commit (see above) |
| `apps/web` | React pages (Vite): Follow-up, the phone page for personal links, the status page |
| `tests/v1-server` | v1's own server tests, with a small adapter that starts v2's server instead |
| `tests/fixtures` | Test data only: `seed/` is loaded into a development copy; `v1/` holds v1's test photos and documents |
| `tests/e2e` | Playwright browser tests |
| `deploy/caddy` | HTTPS for a copy on a Mac or office computer |

### Settings (environment variables)

| Variable | Needed | What it does |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection address |
| `APP_PASSWORD` | yes | The one password for signing in |
| `SESSION_SECRET` | yes | At least 16 characters; signs the sign-in cookie. Changing it signs everyone out |
| `SECURE_COOKIES` | no | `1` when the app is reached over HTTPS only |
| `DATA_DIR` | no | Where photos are kept (default `data`; `/data` in Docker). Files are never deleted |
| `PUBLIC_URL` | no | The address personal links start with, e.g. `https://office-mac.local:8443`. Empty: the address the page was opened at |
| `TIME_ZONE` | no | For due dates and overdue (default `America/Chicago`) |
| `ANTHROPIC_API_KEY` | no | For drafting and the spelling check |
| `DRAFT_MODEL`, `TRAINING_EXAMPLES` | no | The drafting model, and how many of Cecil's past reports go in the prompt (default 3) |
| `APP_ENV` | no | `production` (default): a real copy. `development`: a test copy |
| `LOAD_FIXTURES`, `FIXTURES_DIR` | no | `1` loads the test data from `FIXTURES_DIR` into an empty database (development copies only) |
| `PORT`, `HOST` | no | Default `3000`, `0.0.0.0` |
| `LOG_LEVEL` | no | Default `info` |

### Database changes

Every change to the database is a new numbered file in `apps/server/migrations` (`0002_short_name.sql`, …), applied in order when the app starts. Files are never edited once merged. The app refuses to start against a database changed by a newer version of itself.
