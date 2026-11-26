/**
 * Ported from v1 src/js/util/ids.js. v1's SESSION_ID (which browser tab saved
 * a report) is left behind: v2 detects edits from another device with the
 * database row's version instead.
 */

/** Short unique id with a readable prefix, e.g. "a" for assessments, "p" for photos. */
export const uid = (prefix = ""): string => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** A deep copy of plain JSON data. */
export const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
