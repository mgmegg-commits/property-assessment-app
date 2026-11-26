import { readFileSync } from "node:fs";

/** The app's version, from apps/server/package.json. */
export function appVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
  return pkg.version ?? "unknown";
}
