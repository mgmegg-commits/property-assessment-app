/**
 * The client's quarterly follow-up tracker (MPT): its columns, from
 * src/data/tracker-columns.json (v1 src/js/export/tracker.js). The export
 * itself comes with step 2.9.
 */
import trackerSeed from "../data/tracker-columns.json" with { type: "json" };

/** Facility Name, Assessment Date, Action Item Description, Q1–Q4, Facility Contact. */
export const TRACKER_COLUMNS: readonly string[] = trackerSeed.columns;
/** Each column's width in the Excel file, in characters. */
export const TRACKER_COLUMN_WIDTHS: readonly number[] = trackerSeed.widths;
