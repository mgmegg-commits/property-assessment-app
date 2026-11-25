import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/reports" };

describe("loadConfig", () => {
  it("defaults to a real (production) copy with no test data", () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({ env: "production", loadFixtures: false, port: 3000, host: "0.0.0.0", fixturesDir: null, logLevel: "info" });
    expect(config.webDist).toMatch(/web[/\\]dist[/\\]?$/);
  });

  it("needs the database address", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
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
