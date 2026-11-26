/** The PostgreSQL connection pool. */
import pg from "pg";

export type Pool = pg.Pool;

export function createPool(connectionString: string, options: pg.PoolConfig = {}): Pool {
  return new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, ...options });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until the database answers. On a fresh install the database can take
 * a few seconds longer to start than the app.
 */
export async function waitForDatabase(pool: Pool, { timeoutMs = 60_000, onWait = (_error: unknown) => {} } = {}): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw new Error(`The database didn't answer within ${Math.round(timeoutMs / 1000)} seconds. Check DATABASE_URL and that PostgreSQL is running.`, { cause: error });
      onWait(error);
      await sleep(1000);
    }
  }
}
