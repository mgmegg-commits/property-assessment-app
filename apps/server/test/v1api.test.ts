/**
 * v1's API on v2, beyond what v1's own tests (tests/v1-server) check:
 * reports come back exactly as saved, deleting hides, every route but sign-in
 * needs the password, and the quirks of v1's page (empty JSON bodies) work.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool, type Pool } from "../src/db.js";
import { migrate, readMigrations } from "../src/migrate.js";
import { createTestDatabase, type TestDatabase } from "../../../tests/setup/test-database.js";
import { PASSWORD, testConfig } from "./helpers.js";

const FIXTURES = new URL("../../../tests/fixtures/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"));
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);

let db: TestDatabase;
let pool: Pool;
let app: FastifyInstance;
let cookie: string;
let dataDir: string;

beforeAll(async () => {
  db = await createTestDatabase();
  pool = createPool(db.url);
  await migrate(pool, await readMigrations());
  const config = testConfig();
  dataDir = config.dataDir;
  app = await buildApp({ config, pool, version: "test" });
  const login = await app.inject({ method: "POST", url: "/api/login", payload: { password: PASSWORD } });
  cookie = String(login.headers["set-cookie"]).split(";")[0]!;
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await db?.drop();
});

const call = (method: "GET" | "PUT" | "POST" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url, headers: { cookie, ...headers }, ...(payload === undefined ? {} : { payload: payload as never }) });

describe("signing in", () => {
  it("every route but sign-in, health and v1's page needs the password", async () => {
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).toContain("/api/assessments");
    const closed: [string, string][] = [
      ["GET", "/api/assessments"], ["GET", "/api/assessments/version"], ["GET", "/api/assessments/x"], ["PUT", "/api/assessments/x"], ["DELETE", "/api/assessments/x"],
      ["GET", "/api/settings"], ["PUT", "/api/settings"], ["GET", "/api/docs/transcripts"], ["GET", "/api/docs/transcripts/x"], ["PUT", "/api/docs/transcripts/x"],
      ["POST", "/api/files"], ["GET", "/files/x"], ["DELETE", "/api/files/x"], ["POST", "/api/assessments/x/draft"], ["GET", "/api/jobs/x"], ["POST", "/api/spelling"],
    ];
    for (const [method, url] of closed) {
      const response = await app.inject({ method: method as "GET", url });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
      expect(response.json()).toEqual({ error: "Sign in first." });
    }
    for (const url of ["/api/session", "/api/health"]) expect((await app.inject(url)).statusCode, url).toBe(200);
  });

  it("the wrong password is refused, with v1's words", async () => {
    const response = await app.inject({ method: "POST", url: "/api/login", payload: { password: "nope" } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "That password isn't right." });
  });

  it("the cookie is v1's: HttpOnly, SameSite=Lax, 30 days", async () => {
    const response = await app.inject({ method: "POST", url: "/api/login", payload: { password: PASSWORD } });
    expect(response.headers["set-cookie"]).toMatch(/^crb_session=\d+\.[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  });

  it("signing out works the way v1's page sends it: JSON content type, no body", async () => {
    const response = await app.inject({ method: "POST", url: "/api/logout", headers: { cookie, "content-type": "application/json" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toMatch(/Max-Age=0/);
  });

  it("a forged or expired cookie doesn't sign in", async () => {
    for (const forged of ["crb_session=99999999999999.abc", `crb_session=1.${cookie.split(".")[1]}`]) {
      expect((await app.inject({ url: "/api/assessments", headers: { cookie: forged } })).statusCode).toBe(401);
    }
  });
});

describe("reports", () => {
  it("come back exactly as v1's page saved them, in v1's shape (schema 6)", async () => {
    const report = fixture("v1/documents/assessment-schema-6.json");
    expect((await call("PUT", `/api/assessments/${report.id}`, report)).statusCode).toBe(200);
    const back = (await call("GET", `/api/assessments/${report.id}`)).json();
    expect(back).toEqual(report);
    expect(back.schema).toBe(6);
    const tpo = back.sections[0].items[0].findings.find((f: { id: string }) => f.id === "f-tpo");
    expect([tpo.action.assignee, tpo.action.due]).toEqual(["Facility maintenance", "2027-03-01"]);
    expect((await call("GET", "/api/assessments")).json().assessments).toContainEqual(report);
  });

  it("even a report v1's first version saved (no schema number) is kept as it was", async () => {
    const old = fixture("v1/v1-assessment.json");
    await call("PUT", `/api/assessments/${old.id}`, old);
    expect((await call("GET", `/api/assessments/${old.id}`)).json()).toEqual(old);
  });

  it("the version number changes whenever a report does", async () => {
    const before = (await call("GET", "/api/assessments/version")).json().version;
    const report = { ...fixture("v2/assessment-schema-7.json"), id: "a-version-check", status: "draft" };
    const saved = (await call("PUT", "/api/assessments/a-version-check", report)).json();
    expect(saved.version).toBeGreaterThan(before);
    expect((await call("GET", "/api/assessments/version")).json().version).toBe(saved.version);
  });

  it("a document that isn't this report is refused", async () => {
    const report = fixture("v1/documents/assessment-schema-6.json");
    expect((await call("PUT", "/api/assessments/someone-else", report)).statusCode).toBe(400);
    expect((await call("PUT", `/api/assessments/${report.id}`, { ...report, kind: "photo" })).statusCode).toBe(400);
    expect((await call("PUT", "/api/assessments/bad%20id", { ...report, id: "bad id" })).statusCode).toBe(400);
  });

  it("deleting hides a report but keeps it", async () => {
    const report = { ...fixture("v1/documents/assessment-schema-6.json"), id: "a-to-delete" };
    await call("PUT", "/api/assessments/a-to-delete", report);
    const before = (await call("GET", "/api/assessments/version")).json().version;
    expect((await call("DELETE", "/api/assessments/a-to-delete")).statusCode).toBe(200);
    expect((await call("GET", "/api/assessments/a-to-delete")).statusCode).toBe(404);
    expect((await call("GET", "/api/assessments")).json().assessments.map((a: { id: string }) => a.id)).not.toContain("a-to-delete");
    expect((await call("GET", "/api/assessments/version")).json().version).toBeGreaterThan(before);
    const { rows } = await pool.query("SELECT doc, deleted_at FROM report WHERE id = 'a-to-delete'");
    expect(rows[0].deleted_at).not.toBeNull();
    expect(rows[0].doc).toEqual(report);
  });
});

describe("photos", () => {
  it("are stored on the data volume and served with their type", async () => {
    const upload = await call("POST", "/api/files", JPEG, { "content-type": "image/jpeg" });
    expect(upload.statusCode).toBe(201);
    const { id } = upload.json();
    expect(readFileSync(path.join(dataDir, "files", id)).equals(JPEG)).toBe(true);
    const back = await call("GET", `/files/${id}`);
    expect(back.headers["content-type"]).toBe("image/jpeg");
    expect(back.rawPayload.equals(JPEG)).toBe(true);
    for (const type of ["image/png", "image/webp"]) expect((await call("POST", "/api/files", JPEG, { "content-type": type })).statusCode).toBe(201);
  });

  it("deleting hides a photo: the file stays, and an older version can still show it", async () => {
    const { id } = (await call("POST", "/api/files", JPEG, { "content-type": "image/jpeg" })).json();
    expect((await call("DELETE", `/api/files/${id}`)).statusCode).toBe(200);
    expect(existsSync(path.join(dataDir, "files", id))).toBe(true);
    expect((await call("GET", `/files/${id}`)).statusCode).toBe(200);
    const { rows } = await pool.query("SELECT hidden_at FROM file WHERE id = $1", [id]);
    expect(rows[0].hidden_at).not.toBeNull();
  });

  it("only JPEG, PNG and WebP, with v1's words", async () => {
    const response = await call("POST", "/api/files", Buffer.from("<svg/>"), { "content-type": "image/svg+xml" });
    expect(response.statusCode).toBe(415);
    expect(response.json()).toEqual({ error: "Only JPEG, PNG and WebP images can be stored." });
  });

  it("an unknown file is a 404", async () => {
    expect((await call("GET", "/files/nothere")).statusCode).toBe(404);
  });
});

describe("settings and documents", () => {
  it("settings come back as saved, and start empty", async () => {
    const fresh = await createTestDatabase();
    const freshPool = createPool(fresh.url);
    await migrate(freshPool, await readMigrations());
    const other = await buildApp({ config: testConfig(), pool: freshPool, version: "t" });
    const login = await other.inject({ method: "POST", url: "/api/login", payload: { password: PASSWORD } });
    const c = String(login.headers["set-cookie"]).split(";")[0]!;
    expect((await other.inject({ url: "/api/settings", headers: { cookie: c } })).json()).toEqual({});
    await other.close();
    await freshPool.end();
    await fresh.drop();

    const settings = { company: "Cecil Ingram Properties LLC", preparedBy: "Cecil Ingram", phrases: [{ id: "p1", title: "T", text: "X" }] };
    await call("PUT", "/api/settings", settings);
    expect((await call("GET", "/api/settings")).json()).toEqual(settings);
  });

  it("versions and their index are kept per report", async () => {
    await call("PUT", "/api/docs/versionIndex/a1", { versions: [{ id: "v1", reason: "issued" }] });
    expect((await call("GET", "/api/docs/versionIndex/a1")).json()).toEqual({ versions: [{ id: "v1", reason: "issued" }] });
    expect((await call("GET", "/api/docs/versionIndex")).json()).toContainEqual({ versions: [{ id: "v1", reason: "issued" }] });
  });
});
