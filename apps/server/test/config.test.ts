import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/reports", APP_PASSWORD: "pw", SESSION_SECRET: "0123456789abcdef0123" };

describe("loadConfig", () => {
  it("defaults to a real (production) copy with no test data", () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({ env: "production", loadFixtures: false, port: 3000, host: "0.0.0.0", fixturesDir: null, logLevel: "info",
      password: "pw", secureCookies: false, publicUrl: "", timeZone: "America/Chicago", draftModel: "claude-opus-5-5", trainingExamples: 3, claudeConfigured: false });
    expect(config.dataDir).toMatch(/data$/);
    expect(config.webDist).toMatch(/web[/\\]dist[/\\]?$/);
  });

  it("needs the password and session secret", () => {
    expect(() => loadConfig({ ...base, APP_PASSWORD: "" })).toThrow(/APP_PASSWORD/);
    expect(() => loadConfig({ ...base, SESSION_SECRET: undefined })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ ...base, SESSION_SECRET: "short" })).toThrow(/at least 16/);
  });

  it("reads drafting, the public address and the time zone", () => {
    const config = loadConfig({ ...base, ANTHROPIC_API_KEY: "sk-test", PUBLIC_URL: "https://reports.example.com/", TIME_ZONE: "America/New_York", SECURE_COOKIES: "1", DATA_DIR: "/data" });
    expect(config).toMatchObject({ claudeConfigured: true, publicUrl: "https://reports.example.com", timeZone: "America/New_York", secureCookies: true, dataDir: "/data" });
    expect(() => loadConfig({ ...base, TIME_ZONE: "Mars/Olympus" })).toThrow(/isn't a time zone/);
    expect(() => loadConfig({ ...base, PUBLIC_URL: "reports.example.com" })).toThrow(/PUBLIC_URL/);
  });

  it("needs the database address", () => {
    expect(() => loadConfig({ APP_PASSWORD: "pw", SESSION_SECRET: "0123456789abcdef0123" })).toThrow(ConfigError);
    expect(() => loadConfig({ APP_PASSWORD: "pw", SESSION_SECRET: "0123456789abcdef0123" })).toThrow(/DATABASE_URL/);
  });

  it("reads a development copy that loads test data", () => {
    const config = loadConfig({ ...base, APP_ENV: "development", LOAD_FIXTURES: "1", FIXTURES_DIR: "/fixtures", PORT: "3100" });
    expect(config).toMatchObject({ env: "development", loadFixtures: true, fixturesDir: "/fixtures", port: 3100 });
  });

  it("refuses to load test data into a real copy", () => {
    expect(() => loadConfig({ ...base, LOAD_FIXTURES: "1", FIXTURES_DIR: "/fixtures" })).toThrow(/only be loaded in a development copy/);
  });

  it("needs the test data folder when loading test data", () => {
    expect(() => loadConfig({ ...base, APP_ENV: "development", LOAD_FIXTURES: "1" })).toThrow(/FIXTURES_DIR/);
  });

  it("rejects values it doesn't know, in words", () => {
    expect(() => loadConfig({ ...base, APP_ENV: "staging" })).toThrow(/APP_ENV must be production or development/);
    expect(() => loadConfig({ ...base, PORT: "eighty" })).toThrow(ConfigError);
  });
});
