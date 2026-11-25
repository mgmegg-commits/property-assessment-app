/** Vitest global setup: stop early, with a clear message, when there's no test database server. */
import { checkTestServer } from "./test-database.js";

export default async function setup(): Promise<void> {
  await checkTestServer();
}
