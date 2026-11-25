import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool, type Pool } from "../src/db.js";
import { MigrationError, currentVersion, migrate, readMigrations } from "../src/migrate.js";
import { createTestDatabase, type TestDatabase } from "../../../tests/setup/test-database.js";

const m = (version: number, sql: string, name = `step_${version}`) => ({ version, name, sql });

describe("readMigrations", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "crb-migrations-"));
    return () => rm(dir, { recursive: true, force: true });
  });

  it("reads the app's own migrations, numbered from 1 with no gaps", async () => {
    const migrations = await readMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.map((x) => x.version)).toEqual(migrations.map((_, i) => i + 1));
    expect(migrations[0]).toMatchObject({ version: 1, name: "organizations" });
  });

  it("reads files in number order", async () => {
    await writeFile(path.join(dir, "0002_second.sql"), "SELECT 2;");
    await writeFile(path.join(dir, "0001_first.sql"), "SELECT 1;");
    expect((await readMigrations(dir)).map((x) => x.name)).toEqual(["first", "second"]);
  });

  it("rejects a gap in the numbering", async () => {
    await writeFile(path.join(dir, "0001_first.sql"), "SELECT 1;");
    await writeFile(path.join(dir, "0003_third.sql"), "SELECT 3;");
    await expect(readMigrations(dir)).rejects.toThrow(/should be number 0002/);
  });

  it("rejects a badly named file", async () => {
    await writeFile(path.join(dir, "first.sql"), "SELECT 1;");
    await expect(readMigrations(dir)).rejects.toThrow(/0001_short_name\.sql/);
  });
});

describe("migrate", () => {
  let db: TestDatabase;
  let pool: Pool;
  beforeAll(async () => {
    db = await createTestDatabase();
    pool = createPool(db.url);
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });
  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  });

  it("applies every migration once, in order, and records it", async () => {
    const steps = [m(1, "CREATE TABLE a (n int);"), m(2, "INSERT INTO a VALUES (2);")];
    expect(await currentVersion(pool)).toBe(0);
    expect(await migrate(pool, steps)).toEqual({ applied: [1, 2], current: 2 });
    expect(await migrate(pool, steps)).toEqual({ applied: [], current: 2 });
    expect((await pool.query("SELECT n FROM a")).rows).toEqual([{ n: 2 }]);
    expect(await currentVersion(pool)).toBe(2);
  });

  it("applies only the new ones after an update", async () => {
    await migrate(pool, [m(1, "CREATE TABLE a (n int);")]);
    expect(await migrate(pool, [m(1, "CREATE TABLE a (n int);"), m(2, "ALTER TABLE a ADD COLUMN t text;")])).toEqual({ applied: [2], current: 2 });
  });

  it("keeps nothing from a migration that fails, and says which one", async () => {
    const steps = [m(1, "CREATE TABLE a (n int);"), m(2, "CREATE TABLE b (n int); INSERT INTO missing VALUES (1);", "broken")];
    await expect(migrate(pool, steps)).rejects.toThrow(/Migration 2 \(broken\) failed/);
    expect(await currentVersion(pool)).toBe(1);
    expect((await pool.query("SELECT to_regclass('b') AS b")).rows[0].b).toBeNull();
  });

  it("refuses a database updated by a newer version of the app", async () => {
    await migrate(pool, [m(1, "CREATE TABLE a (n int);"), m(2, "SELECT 1;")]);
    const error = await migrate(pool, [m(1, "CREATE TABLE a (n int);")]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MigrationError);
    expect((error as Error).message).toMatch(/newer version of the app \(migration 2\)/);
  });

  it("lets two app instances start at once without migrating twice", async () => {
    const steps = [m(1, "CREATE TABLE a (n int); SELECT pg_sleep(0.2);"), m(2, "INSERT INTO a VALUES (1);")];
    const results = await Promise.all([migrate(pool, steps), migrate(pool, steps)]);
    expect(results.map((r) => r.applied.length).sort()).toEqual([0, 2]);
    expect((await pool.query("SELECT count(*)::int AS n FROM a")).rows[0].n).toBe(1);
  });

  it("applies the app's own migrations to an empty database", async () => {
    const own = await readMigrations();
    expect((await migrate(pool, own)).current).toBe(own.length);
  });
});
