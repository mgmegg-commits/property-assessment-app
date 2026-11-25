/**
 * Database migrations: numbered SQL files in apps/server/migrations
 * (0001_organizations.sql, 0002_…), applied in order when the app starts,
 * each in its own transaction. They only go forward.
 *
 * The app refuses to start against a database that has a migration this
 * version doesn't know, so an older copy of the app can't damage newer data.
 * An advisory lock lets two app instances start at once without both migrating.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "./db.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

/** Any fixed number; it only has to be the same for every instance of this app. */
const MIGRATION_LOCK = 72_440_117;
const FILE_NAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export class MigrationError extends Error {}

/** Reads the migration files, checking they're numbered 1, 2, 3… with no gaps. */
export async function readMigrations(dir: string = MIGRATIONS_DIR): Promise<Migration[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const migrations: Migration[] = [];
  for (const [index, file] of names.entries()) {
    const match = FILE_NAME.exec(file);
    if (!match) throw new MigrationError(`Migration file ${file} should be named like 0001_short_name.sql.`);
    const version = Number(match[1]);
    if (version !== index + 1) throw new MigrationError(`Migration ${file} should be number ${String(index + 1).padStart(4, "0")}.`);
    migrations.push({ version, name: match[2]!, sql: await readFile(path.join(dir, file), "utf8") });
  }
  return migrations;
}

export interface MigrationResult {
  /** Versions applied by this run. */
  applied: number[];
  /** The database's version afterwards. */
  current: number;
}

export async function migrate(pool: Pool, migrations: Migration[]): Promise<MigrationResult> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version");
    const known = new Set(migrations.map((m) => m.version));
    const unknown = rows.map((r) => r.version).filter((v) => !known.has(v));
    if (unknown.length) {
      throw new MigrationError(`This database has been updated by a newer version of the app (migration ${unknown.join(", ")}). Install that version or newer; this one won't start, so it can't damage newer data.`);
    }
    const done = new Set(rows.map((r) => r.version));
    const applied: number[] = [];
    for (const migration of migrations) {
      if (done.has(migration.version)) continue;
      try {
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [migration.version, migration.name]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new MigrationError(`Migration ${migration.version} (${migration.name}) failed, and nothing from it was kept: ${(error as Error).message}`, { cause: error });
      }
      applied.push(migration.version);
      done.add(migration.version);
    }
    return { applied, current: Math.max(0, ...done) };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
}

/** The database's current migration version (0 when none has run). */
export async function currentVersion(pool: Pool): Promise<number> {
  const exists = await pool.query<{ table: string | null }>("SELECT to_regclass('schema_migrations')::text AS table");
  if (!exists.rows[0]?.table) return 0;
  const { rows } = await pool.query<{ version: number | null }>("SELECT max(version) AS version FROM schema_migrations");
  return rows[0]?.version ?? 0;
}
