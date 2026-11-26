import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool, type Pool } from "../src/db.js";
import { loadFixtures } from "../src/fixtures.js";
import { migrate, readMigrations } from "../src/migrate.js";
import { CONTENT_SECURITY_POLICY } from "../src/security.js";
import { createTestDatabase, type TestDatabase } from "../../../tests/setup/test-database.js";

const SEED = fileURLToPath(new URL("../../../tests/fixtures/seed/", import.meta.url));

let db: TestDatabase;
let pool: Pool;
let webDist: string;

beforeAll(async () => {
  db = await createTestDatabase();
  pool = createPool(db.url);
  await migrate(pool, await readMigrations());
  await loadFixtures(pool, SEED);
  // A stand-in for the built web app.
  webDist = await mkdtemp(path.join(tmpdir(), "crb-web-"));
  await mkdir(path.join(webDist, "assets"));
  await writeFile(path.join(webDist, "index.html"), "<!doctype html><title>Cecil's Report Builder</title><div id=\"root\"></div>");
  await writeFile(path.join(webDist, "assets", "index-abc123.js"), "console.log('app');");
});

afterAll(async () => {
  await pool?.end();
  await db?.drop();
  if (webDist) await rm(webDist, { recursive: true, force: true });
});

const app = (env: "production" | "development", overrides: { pool?: Pool; webDist?: string } = {}) =>
  buildApp({ config: { env, webDist: overrides.webDist ?? webDist }, pool: overrides.pool ?? pool, version: "2.0.0-test" });

describe("GET /api/health", () => {
  it("says the app and database are working, with no data in it", async () => {
    const server = await app("production");
    const response = await server.inject("/api/health");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", app: "cecils-report-builder", name: "Cecil's Report Builder", version: "2.0.0-test", database: "ok" });
    expect(response.headers["cache-control"]).toBe("no-store");
    await server.close();
  });

  it("answers 503 when the database can't be reached", async () => {
    const unreachable = createPool("postgres://nobody:nothing@127.0.0.1:1/none", { connectionTimeoutMillis: 500 });
    const server = await app("production", { pool: unreachable });
    const response = await server.inject("/api/health");
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "error", database: "unreachable" });
    await server.close();
    await unreachable.end();
  });
});

describe("GET /api/dev/summary", () => {
  it("lists the test data in a development copy", async () => {
    const server = await app("development");
    const response = await server.inject("/api/dev/summary");
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.environment).toBe("development");
    expect(body.migrations).toBeGreaterThanOrEqual(1);
    expect(body.organizations).toEqual(expect.arrayContaining([{ name: "Cecil Ingram Properties LLC", type: "assessor_firm" }]));
    await server.close();
  });

  it("doesn't exist in a real copy", async () => {
    const server = await app("production");
    const response = await server.inject("/api/dev/summary");
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Not found." });
    await server.close();
  });
});

describe("no organization data without signing in", () => {
  // There are no accounts until step 2.3, so a real copy must not show any organization's data on any route.
  it.each(["/", "/api/health", "/api/dev/summary", "/api/organizations", "/reports/123"])("GET %s in a real copy names no organization", async (url) => {
    const server = await app("production");
    const response = await server.inject(url);
    for (const name of ["Cecil Ingram Properties LLC", "Example Owner LLC", "Example Operator"]) expect(response.body).not.toContain(name);
    await server.close();
  });
});

describe("the web app", () => {
  let server: FastifyInstance;
  beforeAll(async () => {
    server = await app("production");
  });
  afterAll(() => server.close());

  it("serves the start page at /", async () => {
    const response = await server.inject("/");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/html/);
    expect(response.body).toContain('<div id="root">');
    expect(response.headers["cache-control"]).toBe("no-cache");
  });

  it("serves the start page for the web app's own paths, so a bookmarked page opens", async () => {
    const response = await server.inject("/reports/123/findings");
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<div id="root">');
  });

  it("serves built files with a long cache, since their names change when they do", async () => {
    const response = await server.inject("/assets/index-abc123.js");
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("immutable");
  });

  it("answers unknown API paths with a 404 in JSON, not the page", async () => {
    const response = await server.inject("/api/nothing-here");
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Not found." });
  });

  it("doesn't serve the page for other methods", async () => {
    const response = await server.inject({ method: "POST", url: "/reports" });
    expect(response.statusCode).toBe(404);
  });

  it("sends the security headers on pages and API answers", async () => {
    for (const url of ["/", "/api/health", "/assets/index-abc123.js", "/api/nothing-here"]) {
      const response = await server.inject(url);
      expect(response.headers["content-security-policy"]).toBe(CONTENT_SECURITY_POLICY);
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["x-frame-options"]).toBe("DENY");
      expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
    }
  });

  it("still serves the API when the web app hasn't been built", async () => {
    const apiOnly = await app("production", { webDist: path.join(webDist, "missing") });
    expect((await apiOnly.inject("/api/health")).statusCode).toBe(200);
    expect((await apiOnly.inject("/")).statusCode).toBe(404);
    await apiOnly.close();
  });
});
