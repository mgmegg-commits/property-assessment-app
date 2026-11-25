/**
 * Server settings, all from environment variables. Secrets (the database
 * password inside DATABASE_URL) stay on the server and are never logged.
 */
import { fileURLToPath } from "node:url";
import { z } from "zod";

export type AppEnv = "production" | "development";

export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  /** "development" is a test copy with test data; "production" is a real copy. */
  env: AppEnv;
  /** Load the test organizations from `fixturesDir` the first time the database is empty. */
  loadFixtures: boolean;
  fixturesDir: string | null;
  /** The built web app (apps/web/dist). */
  webDist: string;
  logLevel: string;
}

const Env = z.object({
  DATABASE_URL: z.string({ error: "Set DATABASE_URL to the PostgreSQL connection address." }).min(1, "Set DATABASE_URL to the PostgreSQL connection address."),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  APP_ENV: z.enum(["production", "development"], { error: "APP_ENV must be production or development." }).default("production"),
  LOAD_FIXTURES: z.enum(["0", "1"], { error: "LOAD_FIXTURES must be 0 or 1." }).default("0"),
  FIXTURES_DIR: z.string().min(1).optional(),
  WEB_DIST: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export class ConfigError extends Error {}

const DEFAULT_WEB_DIST = fileURLToPath(new URL("../../web/dist/", import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map((issue) => issue.message).join(" "));
  const e = parsed.data;
  const loadFixtures = e.LOAD_FIXTURES === "1";
  if (loadFixtures && e.APP_ENV !== "development") throw new ConfigError("Test data can only be loaded in a development copy (APP_ENV=development).");
  if (loadFixtures && !e.FIXTURES_DIR) throw new ConfigError("Set FIXTURES_DIR to the folder of test data to load.");
  return {
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    host: e.HOST,
    env: e.APP_ENV,
    loadFixtures,
    fixturesDir: e.FIXTURES_DIR ?? null,
    webDist: e.WEB_DIST ?? DEFAULT_WEB_DIST,
    logLevel: e.LOG_LEVEL,
  };
}
