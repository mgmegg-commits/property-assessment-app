/**
 * Versions of a report: snapshots of the whole report document, so Cecil can
 * "go back to where I was Saturday". Snapshots refer to photos by id; photo
 * files are kept for good, so an older version still shows its photos.
 *
 * Saved automatically the first time a report is changed each day (the state
 * before that change), every time it's issued, before a restore, and when
 * Cecil taps Save a version. All of them are kept. No DOM, no storage here;
 * src/js/versions.js stores them.
 */
import { deepClone } from "../util/ids.js";
import { migrateAssessment } from "./assessment.js";

export const VERSION_REASONS = {
  daily: "Start of the day, before the first change",
  issued: "Issued",
  manual: "Saved by you",
  restore: "Before a restore",
};

/** Was the report already saved as a version today? (`today` as "2026-11-21") */
export const needsDailyVersion = (a, today) => a.versionDay !== today;

/** A small list entry for the Versions list (the snapshot itself is stored separately). */
export function versionEntry(id, doc, { reason, note = "", at = Date.now() }) {
  return { id, at, reason, note: String(note || "").trim(), status: doc.status, revision: doc.revision };
}

/** The label for a list entry. */
export function versionLabel(entry) {
  if (entry.reason === "issued") return `Issued revision ${entry.revision}`;
  return entry.note || VERSION_REASONS[entry.reason] || "Saved";
}

/**
 * The report as it was in `snapshot`, kept as the same report: its id, its
 * revision and issue history, and its current draft status stay as they are now.
 */
export function restoredReport(current, snapshot) {
  const old = migrateAssessment(deepClone(snapshot));
  const keep = ["id", "kind", "status", "revision", "history", "issuedAt", "versionDay", "createdAt"];
  for (const key of keep) {
    if (current[key] === undefined) delete old[key];
    else old[key] = deepClone(current[key]);
  }
  return old;
}
