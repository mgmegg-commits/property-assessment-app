/**
 * Checking Claude's draft before it's used. Ported from v1
 * src/js/drafting/claudeDraft.js (readIssues, readDraft) at 03104a2; the parts
 * that ask Claude from the claude.ai page stay in v1. The server asks Claude
 * (apps/server/src/claude.ts) and returns readDraft's result to v1's page,
 * which applies it.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Claude's answer is checked field by field */

const PRIORITIES = new Set(["High", "Medium", "Low"]);
const RATING_CODES = new Set(["G", "F", "P", "NA"]);

const asText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Only segment ids the transcript has, once each. */
const segmentIds = (value: unknown, known: Set<string>): string[] => [...new Set((Array.isArray(value) ? value : []).filter((id) => known.has(id)))];

export interface Placement {
  sectionId: string;
  subsectionId: string;
  newSubsectionName: string;
}

/** Where an entry goes: a listed subsection id, or a new subsection's name under a section. */
const placement = (entry: any): Placement => ({
  sectionId: asText(entry?.sectionId),
  subsectionId: asText(entry?.subsectionId),
  newSubsectionName: asText(entry?.newSubsectionName),
});

export interface DraftIssue extends Placement {
  /** The first answer format; still understood. */
  categoryPath: string;
  title: string;
  description: string;
  location: string;
  recommendation: string;
  priority: "High" | "Medium" | "Low";
  sourceSegmentIds: string[];
}

export interface DraftSubsection extends Placement {
  rating: "G" | "F" | "P" | "NA" | "";
  note: string;
  sourceSegmentIds: string[];
}

export interface Draft {
  issues: DraftIssue[];
  subsections: DraftSubsection[];
  sections: { sectionId: string; summary: string }[];
}

/** Keeps well-formed issues, and only segment ids the transcript has. */
export function readIssues(answer: any, segments: { id: string }[]): DraftIssue[] {
  const known = new Set(segments.map((s) => s.id));
  const issues: any[] = Array.isArray(answer?.issues) ? answer.issues : [];
  return issues
    .map((issue) => ({
      ...placement(issue),
      categoryPath: asText(issue?.categoryPath),
      title: asText(issue?.title),
      description: asText(issue?.description),
      location: asText(issue?.location),
      recommendation: asText(issue?.recommendation),
      priority: PRIORITIES.has(issue?.priority) ? issue.priority : "Medium",
      sourceSegmentIds: segmentIds(issue?.sourceSegmentIds, known),
    }))
    .filter((issue) => issue.title || issue.description);
}

/**
 * The whole draft, checked: { issues, subsections (rating and note for each one
 * discussed), sections (summaries) }. Unknown ratings are dropped.
 */
export function readDraft(answer: any, segments: { id: string }[]): Draft {
  const known = new Set(segments.map((s) => s.id));
  const subsections = (Array.isArray(answer?.subsections) ? answer.subsections as any[] : [])
    .map((entry) => ({
      ...placement(entry),
      rating: RATING_CODES.has(entry?.rating) ? entry.rating : "",
      note: asText(entry?.note),
      sourceSegmentIds: segmentIds(entry?.sourceSegmentIds, known),
    }))
    .filter((entry) => (entry.subsectionId || entry.newSubsectionName) && (entry.rating || entry.note));
  const sections = (Array.isArray(answer?.sections) ? answer.sections as any[] : [])
    .map((entry) => ({ sectionId: asText(entry?.sectionId), summary: asText(entry?.summary) }))
    .filter((entry) => entry.sectionId && entry.summary);
  return { issues: readIssues(answer, segments), subsections, sections };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
