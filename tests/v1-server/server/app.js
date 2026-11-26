/**
 * v1's createApp(config, { claude, log }), backed by the v2 server, so v1's
 * own tests/server.test.mjs (copied unchanged by scripts/refresh-v1.sh) runs
 * against v2. Each app gets a fresh PostgreSQL database on the test server
 * (TEST_DATABASE_URL, or ./scripts/test-db.sh), dropped when its server closes.
 *
 * Uses the built server (npm run build first): npm run test:v1-server.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../../../apps/server/dist/app.js";
import { migrate, readMigrations } from "../../../apps/server/dist/migrate.js";

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:55432/postgres";

async function admin(sql) {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try { await client.query(sql); } finally { await client.end(); }
}

export async function createApp(config, { claude = null, log = console } = {}) {
  const name = `crb_v1test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await admin(`CREATE DATABASE ${name}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), allowExitOnIdle: true });
  await migrate(pool, await readMigrations());

  const app = await buildApp({
    config: {
      env: "production",
      webDist: config.dataDir, // no web app pages needed
      password: config.password,
      sessionSecret: config.sessionSecret,
      secureCookies: false,
      dataDir: config.dataDir,
      draftModel: config.draftModel,
      trainingExamples: config.trainingExamples,
      claudeConfigured: config.claudeConfigured,
      publicUrl: "",
      timeZone: "America/Chicago",
    },
    pool,
    version: "v1-tests",
    claude,
    logger: false,
  });
  await app.ready();
  app.server.on("close", () => {
    pool.end().then(() => admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)).catch((e) => log.error?.(e));
  });
  return { server: app.server, app };
}
