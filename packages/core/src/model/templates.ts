/**
 * Assessment templates (FR-TPL-1), ratings, priority schemes, photo states
 * and the standard sentences. Ported from v1 src/js/model/templates.js.
 *
 * The templates, their standard sentences and the priority schemes are data
 * (src/data/*.json), which later steps load into the database. Both templates
 * share six sections and 30 subsections (v1's comment said 32); the healthcare and real estate versions
 * differ only in a few item labels. Sections, items, names and order match
 * Cecil's SafetyCulture reports (The Arbors and St. Martin's in the Pines for
 * Healthcare Master, NCP Solutions / OSG EverView for Real Estate).
 */
import type { Item, ListSection, PriorityScheme, Section, SectionRating } from "./types.js";
import templateSeeds from "../data/templates.json" with { type: "json" };
import prioritySeeds from "../data/priority-schemes.json" with { type: "json" };

/** A template's standard sentences: per rating, a default and the variants v1 used. */
export interface StandardSentences {
  item: Record<string, { default: string; withFindings?: string; noMaterialIssues?: string }>;
  section: Record<string, string>;
}

/** A template as it's seeded into the database (src/data/templates.json): one row per version. */
export interface TemplateSeed {
  key: string;
  name: string;
  version: number;
  sections: ListSection[];
  sentences: StandardSentences;
}

/** Healthcare Master and Real Estate, version 2 (v1's templates), from src/data/templates.json. */
export const TEMPLATE_SEEDS: readonly TemplateSeed[] = templateSeeds as TemplateSeed[];

export const TEMPLATES: Record<string, { name: string; version: number }> = Object.fromEntries(
  TEMPLATE_SEEDS.map((t) => [t.key, { name: t.name, version: t.version }]),
);

/** The standard sentences every template starts with (both of v1's templates share them). */
export const DEFAULT_SENTENCES: StandardSentences = TEMPLATE_SEEDS[0]!.sentences;

export function newItem(key: string, label: string): Item {
  return { key, label, hidden: false, rating: "", noMaterialIssues: false, notes: "", confirmed: false, findings: [] };
}

export function buildSections(templateKey: string): Section[] {
  const template = TEMPLATE_SEEDS.find((t) => t.key === templateKey);
  if (!template) throw new Error(`Unknown template "${templateKey}".`);
  return template.sections.map((def) => ({
    key: def.key,
    title: def.title,
    compliance: Boolean(def.compliance),
    rating: "auto",
    summary: "",
    items: def.items.map((i) => newItem(i.key, i.label)),
  }));
}

export const RATINGS = { G: "Good", F: "Fair", P: "Poor", NA: "N/A" } as const;

/**
 * Priority labels per client. Most reports use High / Medium / Low; MPT's use
 * Required / Recommended. A report's `priorityScheme` picks one; the default for
 * new reports is in the report settings. Codes are stored on each action.
 */
export const PRIORITY_SCHEMES: Record<PriorityScheme, { name: string; labels: Record<string, string> }> = prioritySeeds.schemes;
export const PRIORITIES = PRIORITY_SCHEMES.hml.labels;
const PRIORITY_LABELS: Record<string, string> = { ...PRIORITY_SCHEMES.hml.labels, ...PRIORITY_SCHEMES.rr.labels };
export const PRIORITY_ORDER: Record<string, number> = prioritySeeds.order;
/** Switching a report's scheme converts its actions: High → Required, Medium and Low → Recommended, and back. */
export const PRIORITY_CONVERSION: Record<PriorityScheme, Record<string, string>> = prioritySeeds.conversion;

const isScheme = (value: unknown): value is PriorityScheme => typeof value === "string" && value in PRIORITY_SCHEMES;
export const priorityScheme = (a: { priorityScheme?: unknown } | null | undefined): PriorityScheme => (isScheme(a?.priorityScheme) ? a.priorityScheme : "hml");
/** { code: label } for the report's scheme, in order. */
export const priorityOptions = (a: { priorityScheme?: unknown } | null | undefined): Record<string, string> => PRIORITY_SCHEMES[priorityScheme(a)].labels;
export const priorityLabel = (code: string): string => PRIORITY_LABELS[code] || "";
/** The most urgent code in the report's scheme (High or Required). */
export const topPriority = (a: { priorityScheme?: unknown }): string => Object.keys(priorityOptions(a))[0]!;

/** A draft's "High" / "Medium" / "Low" as a code in the report's scheme. */
export function draftedPriority(a: { priorityScheme?: unknown }, name: string): string {
  const code = ({ High: "H", Medium: "M", Low: "L" } as Record<string, string>)[name] || "M";
  return priorityScheme(a) === "rr" ? PRIORITY_CONVERSION.rr[code]! : code;
}

/** Where a photo prints. Shown as three one-click buttons, with the hint for the chosen one under them. */
export const PHOTO_STATUSES = { report: "In report", appendix: "Appendix only", excluded: "Exclude" } as const;
export const PHOTO_STATUS_HINTS = {
  report: "Prints in the report, with the finding or subsection it's placed in (unplaced photos print under Additional Photos).",
  appendix: "Prints only in the Additional Photos appendix at the end, not with its finding.",
  excluded: "Stays in the app but is left out of the report.",
} as const;

/**
 * The standard condition sentence follows the rating (FR-CAP-3). `sentences`
 * is the report's template's (src/data/templates.json); v1's by default.
 */
/** The section's own sentence, from its rating (set, or worked out from its subsections). */
export function sectionSentence(section: Section, sentences: StandardSentences = DEFAULT_SENTENCES): string {
  return sentences.section[sectionRating(section)] ?? "";
}

export function standardSentence(item: Item, sentences: StandardSentences = DEFAULT_SENTENCES): string {
  const forRating = sentences.item[item.rating];
  if (!forRating) return "";
  if (item.noMaterialIssues && forRating.noMaterialIssues) return forRating.noMaterialIssues;
  if (item.findings.length > 0 && forRating.withFindings) return forRating.withFindings;
  return forRating.default;
}

const RATING_SCORE: Record<string, number> = { G: 3, F: 2, P: 1 };

/** A section's rating: the assessor's override, or the average of its rated items. */
export function sectionRating(section: Section): SectionRating {
  if (section.rating && section.rating !== "auto") return section.rating;
  const scores = section.items
    .filter((item) => !item.hidden && RATING_SCORE[item.rating])
    .map((item) => RATING_SCORE[item.rating]!);
  if (!scores.length) return "";
  const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  if (average >= 2.5) return "G";
  return average >= 1.5 ? "F" : "P";
}
