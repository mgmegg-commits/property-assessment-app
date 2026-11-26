/** Shared pieces for the server tests. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../src/app.js";

export const V1_WEB = fileURLToPath(new URL("../../v1-web/", import.meta.url));
export const SEED = fileURLToPath(new URL("../../../tests/fixtures/seed/", import.meta.url));
export const PASSWORD = "test-password";

/** A whole app configuration for tests: a fresh data folder each time. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    env: "production",
    webDist: path.join(tmpdir(), "crb-no-web-app"),
    password: PASSWORD,
    sessionSecret: "a-test-session-secret-0123456789",
    secureCookies: false,
    dataDir: mkdtempSync(path.join(tmpdir(), "crb-data-")),
    draftModel: "claude-opus-5-5",
    trainingExamples: 3,
    claudeConfigured: false,
    publicUrl: "",
    timeZone: "America/Chicago",
    ...overrides,
  };
}
