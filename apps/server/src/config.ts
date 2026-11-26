/**
 * Server settings, all from environment variables. Secrets (APP_PASSWORD,
 * SESSION_SECRET, ANTHROPIC_API_KEY, the database password) stay on the
 * server and are never logged or sent to a browser.
 */
import path from "node:path";
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
  /** v1's front end, built from a pinned commit (apps/v1-web). */
  v1Web: string;
  logLevel: string;
  /** The one password everyone signs in with (as in v1). */
  password: string;
  /** Signs the sign-in cookie. */
  sessionSecret: string;
  /** Mark the cookie Secure (when every address is HTTPS). */
  secureCookies: boolean;
  /** Photo files live under <dataDir>/files. */
  dataDir: string;
  /** The address personal update links use, e.g. https://reports.example.com. Empty: the address the page was opened at. */
  publicUrl: string;
  /** Where "today" is, for due dates and overdue flags. */
  timeZone: string;
  draftModel: string;
  trainingExamples: number;
  /** Whether a Claude API key is set. Drafting explains itself when it isn't. */
  claudeConfigured: boolean;
}

const Env = z.object({
  DATABASE_URL: z.string({ error: "Set DATABASE_URL to the PostgreSQL connection address." }).min(1, "Set DATABASE_URL to the PostgreSQL connection address."),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  APP_ENV: z.enum(["production", "development"], { error: "APP_ENV must be production or development." }).default("production"),
  LOAD_FIXTURES: z.enum(["0", "1"], { error: "LOAD_FIXTURES must be 0 or 1." }).default("0"),
  FIXTURES_DIR: z.string().min(1).optional(),
  WEB_DIST: z.string().min(1).optional(),
  V1_WEB: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  APP_PASSWORD: z.string({ error: "Set APP_PASSWORD, the password to sign in with." }).min(1, "Set APP_PASSWORD, the password to sign in with."),
  SESSION_SECRET: z.string({ error: "Set SESSION_SECRET to a long random string." }).min(16, "SESSION_SECRET must be at least 16 characters."),
  SECURE_COOKIES: z.enum(["0", "1"]).default("0"),
  DATA_DIR: z.string().min(1).default("data"),
  PUBLIC_URL: z.string().default(""),
  TIME_ZONE: z.string().min(1).default("America/Chicago"),
  DRAFT_MODEL: z.string().min(1).default("claude-opus-5-5"),
  TRAINING_EXAMPLES: z.coerce.number().int().min(0).max(10).default(3),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_AUTH_TOKEN: z.string().optional(),
});

export class ConfigError extends Error {}

const DEFAULT_WEB_DIST = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const DEFAULT_V1_WEB = fileURLToPath(new URL("../../v1-web/", import.meta.url));

export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map((issue) => issue.message).join(" "));
  const e = parsed.data;
  const loadFixtures = e.LOAD_FIXTURES === "1";
  if (loadFixtures && e.APP_ENV !== "development") throw new ConfigError("Test data can only be loaded in a development copy (APP_ENV=development).");
  if (loadFixtures && !e.FIXTURES_DIR) throw new ConfigError("Set FIXTURES_DIR to the folder of test data to load.");
  if (!isTimeZone(e.TIME_ZONE)) throw new ConfigError(`TIME_ZONE "${e.TIME_ZONE}" isn't a time zone (try America/Chicago).`);
  if (e.PUBLIC_URL && !/^https?:\/\/[^/]+/.test(e.PUBLIC_URL)) throw new ConfigError("PUBLIC_URL must start with https:// (or http://).");
  return {
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    host: e.HOST,
    env: e.APP_ENV,
    loadFixtures,
    fixturesDir: e.FIXTURES_DIR ?? null,
    webDist: e.WEB_DIST ?? DEFAULT_WEB_DIST,
    v1Web: e.V1_WEB ?? DEFAULT_V1_WEB,
    logLevel: e.LOG_LEVEL,
    password: e.APP_PASSWORD,
    sessionSecret: e.SESSION_SECRET,
    secureCookies: e.SECURE_COOKIES === "1",
    dataDir: path.resolve(e.DATA_DIR),
    publicUrl: e.PUBLIC_URL.replace(/\/+$/, ""),
    timeZone: e.TIME_ZONE,
    draftModel: e.DRAFT_MODEL,
    trainingExamples: e.TRAINING_EXAMPLES,
    claudeConfigured: Boolean(e.ANTHROPIC_API_KEY || e.ANTHROPIC_AUTH_TOKEN),
  };
}
