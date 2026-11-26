import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool, type Pool } from "../src/db.js";
import { FixtureError, loadFixtures, readOrganizationFixtures } from "../src/fixtures.js";
import { migrate, readMigrations } from "../src/migrate.js";
import { createTestDatabase, type TestDatabase } from "../../../tests/setup/test-database.js";

const SEED = fileURLToPath(new URL("../../../tests/fixtures/seed/", import.meta.url));

describe("test data", () => {
  let db: TestDatabase;
  let pool: Pool;
  beforeAll(async () => {
    db = await createTestDatabase();
    pool = createPool(db.url);
    await migrate(pool, await readMigrations());
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM organization WHERE client_org_id IS NOT NULL; DELETE FROM organization;");
  });

  it("is valid: an assessor firm, a client, and a facility operator of that client", async () => {
    const orgs = await readOrganizationFixtures(SEED);
    expect(orgs.map((o) => o.type).sort()).toEqual(["assessor_firm", "client", "facility_operator"]);
    const client = orgs.find((o) => o.type === "client");
    expect(orgs.find((o) => o.type === "facility_operator")?.clientOrgId).toBe(client?.id);
  });

  it("loads into an empty database, once", async () => {
    expect(await loadFixtures(pool, SEED)).toEqual({ loaded: true, organizations: 3 });
    expect(await loadFixtures(pool, SEED)).toEqual({ loaded: false, organizations: 0 });
    const { rows } = await pool.query("SELECT name, type FROM organization ORDER BY name");
    expect(rows).toEqual([
      { name: "Cecil Ingram Properties LLC", type: "assessor_firm" },
      { name: "Example Operator", type: "facility_operator" },
      { name: "Example Owner LLC", type: "client" },
    ]);
  });

  it("never loads into a database that already has organizations", async () => {
    await pool.query("INSERT INTO organization (name, type) VALUES ('Someone else', 'client')");
    expect(await loadFixtures(pool, SEED)).toEqual({ loaded: false, organizations: 0 });
    expect((await pool.query("SELECT count(*)::int AS n FROM organization")).rows[0].n).toBe(1);
  });

  describe("bad files", () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(path.join(tmpdir(), "crb-fixtures-"));
      return () => rm(dir, { recursive: true, force: true });
    });

    it("says when the file is missing", async () => {
      await expect(loadFixtures(pool, dir)).rejects.toThrow(/Couldn't read test data/);
    });

    it("says what's wrong with an invalid file, and loads nothing", async () => {
      await writeFile(path.join(dir, "organizations.json"), JSON.stringify([{ id: "not-a-uuid", name: "", type: "tenant" }]));
      const error = await loadFixtures(pool, dir).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FixtureError);
      expect((await pool.query("SELECT count(*)::int AS n FROM organization")).rows[0].n).toBe(0);
    });

    it("loads nothing when one organization can't be stored", async () => {
      const id = "11111111-1111-4111-8111-111111111111";
      // A client that points to a client breaks the "only facility operators have a client" rule.
      await writeFile(path.join(dir, "organizations.json"), JSON.stringify([
        { id, name: "Owner", type: "client" },
        { id: "22222222-2222-4222-8222-222222222222", name: "Wrong", type: "client", clientOrgId: id },
      ]));
      await expect(loadFixtures(pool, dir)).rejects.toThrow(/Couldn't load the test data/);
      expect((await pool.query("SELECT count(*)::int AS n FROM organization")).rows[0].n).toBe(0);
    });
  });
});
