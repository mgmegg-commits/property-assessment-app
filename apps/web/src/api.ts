/** Calls to the server's API. Shapes match apps/server/src/app.ts. */
import type { OrganizationType } from "@crb/core";

export interface Health {
  status: "ok" | "error";
  name: string;
  version: string;
  database: "ok" | "unreachable";
}

export interface DevSummary {
  environment: "development";
  migrations: number;
  organizations: { name: string; type: OrganizationType }[];
}

/** The health check. A 503 still carries a body that says what's wrong. */
export async function getHealth(signal?: AbortSignal): Promise<Health> {
  const response = await fetch("/api/health", { signal, headers: { accept: "application/json" } });
  return (await response.json()) as Health;
}

/** The test data in a development copy; null in a real copy, which doesn't have this route. */
export async function getDevSummary(signal?: AbortSignal): Promise<DevSummary | null> {
  const response = await fetch("/api/dev/summary", { signal, headers: { accept: "application/json" } });
  return response.ok ? ((await response.json()) as DevSummary) : null;
}
