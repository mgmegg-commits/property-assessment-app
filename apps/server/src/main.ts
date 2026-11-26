/**
 * Starts the server: npm start (or node apps/server/dist/main.js).
 * Settings come from environment variables; see .env.example and README.
 *
 * On start it waits for the database, applies any new migrations, loads test
 * data in a development copy when asked, then listens.
 */
import { buildApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { createPool, waitForDatabase } from "./db.js";
import { FixtureError, loadFixtures } from "./fixtures.js";
import { MigrationError, migrate, readMigrations } from "./migrate.js";
import { appVersion } from "./version.js";
import { loadV1Page } from "./v1page.js";

const log = (message: string) => console.log(JSON.stringify({ level: 30, time: Date.now(), msg: message }));

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const version = appVersion();
  const v1Page = loadV1Page(config.v1Web);

  log(`Cecil's Report Builder ${version} (${config.env}), v1 front end ${v1Page.version.commit.slice(0, 7)}`);
  await waitForDatabase(pool, { onWait: () => log("Waiting for the database…") });
  const { applied, current } = await migrate(pool, await readMigrations());
  log(applied.length ? `Database updated to version ${current} (applied ${applied.join(", ")})` : `Database at version ${current}`);

  if (config.loadFixtures && config.fixturesDir) {
    const fixtures = await loadFixtures(pool, config.fixturesDir);
    log(fixtures.loaded ? `Loaded test data: ${fixtures.organizations} organizations` : "Test data already loaded");
  }
  if (!config.claudeConfigured) log("Drafting is off until ANTHROPIC_API_KEY is set; everything else works.");

  const app = await buildApp({ config, pool, version, v1Page, logger: { level: config.logLevel } });

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log.info(`${signal}: stopping`);
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  const expected = error instanceof ConfigError || error instanceof MigrationError || error instanceof FixtureError;
  // Plain words for problems someone installing the app can fix; the full error otherwise.
  console.error(expected ? `Couldn't start: ${(error as Error).message}` : error);
  process.exit(1);
});
