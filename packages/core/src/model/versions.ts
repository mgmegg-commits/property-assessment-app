/**
 * Versions of a report: snapshots of the whole report document, so Cecil can
 * "go back to where I was Saturday". Snapshots refer to photos by id; photo
 * files are kept for good, so an older version still shows its photos.
 *
 * Saved automatically the first time a report is changed each day (the state
 * before that change), every time it's issued, before a restore, and when
 * Cecil taps Save a version. All of them are kept. Nothing here stores them;
 * the server does. Ported from v1 src/js/model/versions.js.
 */
import { deepClone } from "../util/ids.js";
import { migrateAssessment } from "./assessment.js";
import type { Assessment, ReportStatus } from "./types.js";

export const VERSION_REASONS = {
  daily: "Start of the day, before the first change",
  issued: "Issued",
  manual: "Saved by you",
  restore: "Before a restore",
} as const;

export type VersionReason = keyof typeof VERSION_REASONS;

export interface VersionEntry {
  id: string;
  at: number;
  reason: VersionReason;
  note: string;
  status: ReportStatus;
  revision: number;
}

/** Was the report already saved as a version today? (`today` as "2026-11-21") */
export const needsDailyVersion = (a: Pick<Assessment, "versionDay">, today: string): boolean => a.versionDay !== today;

/** A small list entry for the Versions list (the snapshot itself is stored separately). */
export function versionEntry(id: string, doc: Pick<Assessment, "status" | "revision">, { reason, note = "", at = Date.now() }: { reason: VersionReason; note?: string; at?: number }): VersionEntry {
  return { id, at, reason, note: String(note || "").trim(), status: doc.status, revision: doc.revision };
}

/** The label for a list entry. */
export function versionLabel(entry: Pick<VersionEntry, "reason" | "note" | "revision">): string {
  if (entry.reason === "issued") return `Issued revision ${entry.revision}`;
  return entry.note || VERSION_REASONS[entry.reason] || "Saved";
}

/**
 * The report as it was in `snapshot`, kept as the same report: its id, its
 * revision and issue history, and its current draft status stay as they are now.
 */
export function restoredReport(current: Assessment, snapshot: unknown): Assessment {
  const old = migrateAssessment(deepClone(snapshot)) as Record<string, unknown>;
  const keep = ["id", "kind", "status", "revision", "history", "issuedAt", "versionDay", "createdAt"] as const;
  for (const key of keep) {
    if (current[key] === undefined) delete old[key];
    else old[key] = deepClone(current[key]);
  }
  return old as unknown as Assessment;
}
