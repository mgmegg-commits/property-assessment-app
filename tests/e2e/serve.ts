/**
 * Starts the built server for the browser tests: a fresh "crb_e2e" database
 * on the test server, with the test data, as a development copy.
 */
import { fileURLToPath } from "node:url";
import { recreateDatabase } from "../setup/test-database.js";

const url = await recreateDatabase("crb_e2e");
Object.assign(process.env, {
  DATABASE_URL: url,
  APP_ENV: "development",
  LOAD_FIXTURES: "1",
  FIXTURES_DIR: fileURLToPath(new URL("../fixtures/seed/", import.meta.url)),
  HOST: "127.0.0.1",
  PORT: process.env.PORT ?? "3100",
  LOG_LEVEL: "warn",
});
await import("../../apps/server/dist/main.js");
