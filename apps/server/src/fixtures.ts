/**
 * Test data for a development copy (APP_ENV=development, LOAD_FIXTURES=1).
 * Loaded from tests/fixtures/seed the first time the database has no
 * organizations, so a restart never duplicates it and never touches data
 * someone has added since.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ORGANIZATION_TYPES } from "@crb/core";
import type { Pool } from "./db.js";

const OrganizationFixture = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1),
  type: z.enum(ORGANIZATION_TYPES),
  clientOrgId: z.uuid().optional(),
});
const OrganizationFixtures = z.array(OrganizationFixture).min(1);
type OrganizationFixture = z.infer<typeof OrganizationFixture>;

export class FixtureError extends Error {}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new FixtureError(`Couldn't read test data from ${file}: ${(error as Error).message}`, { cause: error });
  }
}

export async function readOrganizationFixtures(dir: string): Promise<OrganizationFixture[]> {
  const file = path.join(dir, "organizations.json");
  const parsed = OrganizationFixtures.safeParse(await readJson(file));
  if (!parsed.success) throw new FixtureError(`Test data in ${file} isn't valid: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export interface FixtureResult {
  loaded: boolean;
  organizations: number;
}

export async function loadFixtures(pool: Pool, dir: string): Promise<FixtureResult> {
  const organizations = await readOrganizationFixtures(dir);
  // Clients before the facility operators that point to them.
  const ordered = [...organizations].sort((a, b) => Number(Boolean(a.clientOrgId)) - Number(Boolean(b.clientOrgId)));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE organization IN EXCLUSIVE MODE");
    const { rows } = await client.query<{ count: string }>("SELECT count(*) FROM organization");
    if (Number(rows[0]?.count) > 0) {
      await client.query("ROLLBACK");
      return { loaded: false, organizations: 0 };
    }
    for (const org of ordered) {
      await client.query("INSERT INTO organization (id, name, type, client_org_id) VALUES ($1, $2, $3, $4)", [org.id, org.name, org.type, org.clientOrgId ?? null]);
    }
    await client.query("COMMIT");
    return { loaded: true, organizations: ordered.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof FixtureError) throw error;
    throw new FixtureError(`Couldn't load the test data: ${(error as Error).message}`, { cause: error });
  } finally {
    client.release();
  }
}
