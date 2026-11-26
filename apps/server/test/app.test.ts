import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
import { inlineScriptHashes, loadV1Page, type V1Page } from "../src/v1page.js";
import { createTestDatabase, type TestDatabase } from "../../../tests/setup/test-database.js";

const SEED = fileURLToPath(new URL("../../../tests/fixtures/seed/", import.meta.url));
const V1_WEB = fileURLToPath(new URL("../../v1-web/", import.meta.url));

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
  v1Page = loadV1Page(V1_WEB);
});

afterAll(async () => {
  await pool?.end();
  await db?.drop();
  if (webDist) await rm(webDist, { recursive: true, force: true });
});

let v1Page: V1Page;
const app = (env: "production" | "development", overrides: { pool?: Pool; webDist?: string } = {}) =>
  buildApp({ config: { env, webDist: overrides.webDist ?? webDist }, pool: overrides.pool ?? pool, version: "2.0.0-test", v1Page });

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
  // Not "/": v1's page has "Cecil Ingram Properties LLC" in its own code, as the default company name.
  it.each(["/status", "/api/health", "/api/dev/summary", "/api/organizations", "/reports/123"])("GET %s in a real copy names no organization", async (url) => {
    const server = await app("production");
    const response = await server.inject(url);
    for (const name of ["Cecil Ingram Properties LLC", "Example Owner LLC", "Example Operator"]) expect(response.body).not.toContain(name);
    await server.close();
  });
});

describe("v1's front end at /", () => {
  let server: FastifyInstance;
  beforeAll(async () => {
    server = await app("production");
  });
  afterAll(() => server.close());

  it("is v1's built page, byte for byte, from the pinned commit", async () => {
    const response = await server.inject("/");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/html/);
    expect(response.rawPayload.equals(readFileSync(path.join(V1_WEB, "index.html")))).toBe(true);
    expect(createHash("sha256").update(response.rawPayload).digest("hex")).toBe(v1Page.version.sha256);
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect((await server.inject("/index.html")).rawPayload.equals(response.rawPayload)).toBe(true);
  });

  it("says which v1 commit it is", async () => {
    const version = (await server.inject("/api/v1-version")).json();
    expect(version.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(version.repo).toBe("mgmegg-commits/cecil-report-app");
  });

  it("gets a policy that allows its inline script by hash, its CDN libraries and fonts, and nothing else", async () => {
    const csp = String((await server.inject("/")).headers["content-security-policy"]);
    const [hash] = inlineScriptHashes(readFileSync(path.join(V1_WEB, "index.html"), "utf8"));
    expect(csp).toContain(`script-src 'self' ${hash} https://cdnjs.cloudflare.com https://cdn.jsdelivr.net`);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("https://fonts.googleapis.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
  });

  it("refuses to start from a page that doesn't match its VERSION.json", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "crb-v1-"));
    await writeFile(path.join(dir, "index.html"), "<p>changed</p>");
    await writeFile(path.join(dir, "VERSION.json"), readFileSync(path.join(V1_WEB, "VERSION.json")));
    expect(() => loadV1Page(dir)).toThrow(/doesn't match its VERSION\.json/);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("the web app", () => {
  let server: FastifyInstance;
  beforeAll(async () => {
    server = await app("production");
  });
  afterAll(() => server.close());

  it("serves the status page at /status", async () => {
    const response = await server.inject("/status");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/html/);
    expect(response.body).toContain('<div id="root">');
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.headers["content-security-policy"]).toBe(CONTENT_SECURITY_POLICY);
  });

  it("serves built files under /app/ with a long cache, since their names change when they do", async () => {
    const response = await server.inject("/app/assets/index-abc123.js");
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("immutable");
  });

  it("answers paths it doesn't know with a 404, not a page", async () => {
    for (const url of ["/api/nothing-here", "/reports/123", "/app/nothing.js"]) {
      const response = await server.inject(url);
      expect(response.statusCode, url).toBe(404);
      expect(response.json()).toEqual({ error: "Not found." });
    }
  });

  it("doesn't serve a page for other methods", async () => {
    const response = await server.inject({ method: "POST", url: "/status" });
    expect(response.statusCode).toBe(404);
  });

  it("sends the security headers on pages and API answers", async () => {
    for (const url of ["/status", "/api/health", "/app/assets/index-abc123.js", "/api/nothing-here", "/"]) {
      const response = await server.inject(url);
      if (url !== "/") expect(response.headers["content-security-policy"]).toBe(CONTENT_SECURITY_POLICY);
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["x-frame-options"]).toBe("DENY");
      expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
    }
  });

  it("still serves the API when the web app hasn't been built", async () => {
    const apiOnly = await app("production", { webDist: path.join(webDist, "missing") });
    expect((await apiOnly.inject("/api/health")).statusCode).toBe(200);
    expect((await apiOnly.inject("/status")).statusCode).toBe(404);
    await apiOnly.close();
  });
});
