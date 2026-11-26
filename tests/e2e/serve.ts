/**
 * Starts the built server for the browser tests: a fresh "crb_e2e" database
 * on the test server, with the test data, as a development copy.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
  APP_PASSWORD: "e2e-password",
  SESSION_SECRET: "e2e-session-secret-0123456789abcdef",
  DATA_DIR: mkdtempSync(path.join(tmpdir(), "crb-e2e-data-")),
  TIME_ZONE: "America/Chicago",
  PUBLIC_URL: "",
  ANTHROPIC_API_KEY: "",
});
await import("../../apps/server/dist/main.js");
