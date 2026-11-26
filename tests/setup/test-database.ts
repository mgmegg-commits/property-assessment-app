/**
 * Throwaway PostgreSQL databases for tests. Each test file gets its own fresh
 * database on the test server, dropped afterwards, so tests never share data.
 *
 * The server is TEST_DATABASE_URL (a connection to its "postgres" database),
 * or the one ./scripts/test-db.sh starts on port 55432.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:55432/postgres";

export function databaseUrl(name: string, base: string = TEST_DATABASE_URL): string {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

export interface TestDatabase {
  name: string;
  url: string;
  drop(): Promise<void>;
}

async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function createTestDatabase(prefix = "crb_test"): Promise<TestDatabase> {
  const name = `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await withAdmin((client) => client.query(`CREATE DATABASE ${name}`));
  return {
    name,
    url: databaseUrl(name),
    drop: () => withAdmin((client) => client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)).then(() => {}),
  };
}

/** A database with a fixed name, emptied first (used by the browser tests). */
export async function recreateDatabase(name: string): Promise<string> {
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${name}`);
  });
  return databaseUrl(name);
}

export async function checkTestServer(): Promise<void> {
  try {
    await withAdmin((client) => client.query("SELECT 1"));
  } catch (error) {
    throw new Error(
      `The tests need a PostgreSQL server at ${new URL(TEST_DATABASE_URL).host}. Start one with ./scripts/test-db.sh, or set TEST_DATABASE_URL. (${(error as Error).message})`,
      { cause: error },
    );
  }
}
