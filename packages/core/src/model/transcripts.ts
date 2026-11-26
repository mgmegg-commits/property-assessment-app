/**
 * A walk-through's transcript: the voice memo's words grouped into timed
 * remarks ("segments"), kept for good as drafting examples. Its own document,
 * next to the assessment, as in v1 (v1 saved it at transcripts/<assessmentId>,
 * from src/js/actions/uploadActions.js, with no schema number).
 *
 * Schema 2 (v2) adds `leftOut` to each remark: Cecil can mark something he said
 * aloud "Leave out", so it never reaches a draft or the report (A-16).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- a document saved by an earlier version has no fixed shape */
import type { DocumentMigration } from "./migrations.js";

export interface Segment {
  id: string;
  /** Seconds from the start of the recording. */
  start: number;
  end: number;
  text: string;
  /** Marked "Leave out": never sent to Claude, never in a draft. */
  leftOut: boolean;
}

export interface Transcript {
  schema: number;
  assessmentId: string;
  walkId: string;
  source: string;
  fileName: string;
  /** When the recording started (epoch ms). */
  startedAt: number;
  durationMs: number;
  segments: Segment[];
  createdAt: number;
}

export const TRANSCRIPT_MIGRATIONS: readonly DocumentMigration[] = [
  {
    to: 2,
    name: "A remark can be left out",
    up(t: any) {
      for (const segment of t.segments || []) segment.leftOut ??= false;
    },
  },
];

export const TRANSCRIPT_SCHEMA_VERSION = TRANSCRIPT_MIGRATIONS[TRANSCRIPT_MIGRATIONS.length - 1]!.to;

/** Upgrades a transcript saved by an earlier version, in place, and returns it. v1's (no schema) count as 1. */
export function migrateTranscript(t: any): any {
  if (!t || t.schema >= TRANSCRIPT_SCHEMA_VERSION) return t;
  const from = typeof t.schema === "number" && t.schema >= 1 ? t.schema : 1;
  for (const step of TRANSCRIPT_MIGRATIONS) if (step.to > from) step.up(t);
  t.schema = TRANSCRIPT_SCHEMA_VERSION;
  return t;
}

/* eslint-enable @typescript-eslint/no-explicit-any */
