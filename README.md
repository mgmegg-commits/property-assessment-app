# Cecil's Report Builder v2

Property condition assessments from walk-through to verified fix, for Cecil Ingram Properties LLC.

Cecil walks a property with a voice memo and photos; the app drafts the report; he reviews and issues it. The client then assigns each action item to a facility and a person, the facility updates it from a phone, and Cecil verifies the fix at the next visit.

- **Spec:** [`docs/spec.md`](docs/spec.md): requirements, data model, milestones, decisions log, open questions
- **Build plan:** [`docs/plan.md`](docs/plan.md): architecture, data model, milestone steps
- **Instructions for Claude Code:** [`CLAUDE.md`](CLAUDE.md)
- **Design choices made during the build:** [`docs/decisions.md`](docs/decisions.md)
- **Meeting notes with Cecil:** [`docs/meetings/`](docs/meetings/)
- **v1 (reference):** [`mgmegg-commits/cecil-report-app`](https://github.com/mgmegg-commits/cecil-report-app)

Status: Milestone 2, step 2.1 (the foundation). The app starts, talks to its database and loads test data; the assessment screens come in the next steps.

## Try it on a Mac

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/), open and running.

In Terminal, in this folder:

```bash
./start.sh
```

The first time takes a few minutes. When it's ready it prints three addresses:

- **On the Mac:** http://localhost:8080
- **On an iPad or iPhone** on the same Wi-Fi: `https://<your Mac's name>.local:8443`
- **Set-up page for each iPad or iPhone**, once per device: `http://<your Mac's name>.local:8081`. It walks you through trusting the Mac's certificate (download, install the profile in Settings, turn on full trust), which the iPad needs before it can open the HTTPS address.

To stop it (your test data is kept):

```bash
./stop.sh
```

Run `./start.sh` again after pulling new code: it rebuilds what changed and keeps your test data. To wipe the test data and start from scratch, stop it and run `docker compose down -v`.

Notes:
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
| `npm run test:e2e` | Builds, then browser tests at iPhone, iPad and desktop sizes in Chromium and WebKit (Playwright). `PW_BROWSERS=chromium` runs Chromium only |
| `./scripts/smoke-stack.sh` | Starts the whole stack with `./start.sh` in a temporary copy, checks every address, and removes it |
| `npm run dev:server` / `npm run dev:web` | Server with reload (needs `DATABASE_URL`) and the web app with hot reload at http://localhost:5173 |

CI (`.github/workflows/ci.yml`) runs lint, types, unit tests, browser tests in both engines, and the stack check on every pull request.

### Layout

| Folder | What's in it |
| --- | --- |
| `packages/core` | Pure code shared by server and web app: no database, no page. v1's model moves here in step 2.2 |
| `apps/server` | Fastify server: the API under `/api`, the built web app for every other path, migrations in `apps/server/migrations` |
| `apps/web` | React screens (Vite) |
| `tests/fixtures` | Test data only: `seed/` is loaded into a development copy; `v1/` holds v1's test photos and documents |
| `tests/e2e` | Playwright browser tests |
| `deploy/caddy` | HTTPS for a copy on a Mac or office computer |

### Settings (environment variables)

| Variable | Needed | What it does |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection address |
| `APP_ENV` | no | `production` (default): a real copy. `development`: a test copy |
| `LOAD_FIXTURES`, `FIXTURES_DIR` | no | `1` loads the test data from `FIXTURES_DIR` into an empty database (development copies only) |
| `PORT`, `HOST` | no | Default `3000`, `0.0.0.0` |
| `LOG_LEVEL` | no | Default `info` |

### Database changes

Every change to the database is a new numbered file in `apps/server/migrations` (`0002_short_name.sql`, …), applied in order when the app starts. Files are never edited once merged. The app refuses to start against a database changed by a newer version of itself.
