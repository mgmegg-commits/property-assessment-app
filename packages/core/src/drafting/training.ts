/**
 * Training examples: when a report is finalized, its transcript and the report
 * as Cecil finally wrote it (issues, subsection ratings and notes, section
 * summaries) are saved, and the most recent few go into the drafting prompt so
 * new drafts read, and rate, like his reports. Ported from v1
 * src/js/drafting/training.js at 03104a2 (v1's page saves them; the server reads them).
 */
import { visibleItems } from "../model/assessment.js";
import type { Assessment } from "../model/types.js";
import type { PromptSegment } from "./prompt.js";

// Examples use the prompt's High / Medium / Low, whatever the report's labels were.
const PRIORITY_NAMES: Record<string, string> = { H: "High", M: "Medium", L: "Low", REQ: "High", REC: "Medium" };

export interface TrainingExample {
  assessmentId: string;
  propertyName?: string;
  finalizedAt: number;
  revision?: number;
  transcript: PromptSegment[];
  issues?: unknown[];
  conditions?: { path: string; rating: string; note: string }[];
  summaries?: { section: string; summary: string }[];
}

export function trainingExample(assessment: Assessment, transcript: { segments: PromptSegment[] }): TrainingExample {
  const issues: unknown[] = [], conditions: { path: string; rating: string; note: string }[] = [], summaries: { section: string; summary: string }[] = [];
  for (const section of assessment.sections.filter((s) => !s.compliance)) {
    if (section.summary?.trim()) summaries.push({ section: section.title, summary: section.summary.trim() });
    for (const item of visibleItems(section)) {
      if (item.rating || item.notes?.trim()) conditions.push({ path: `${section.title} / ${item.label}`, rating: item.rating || "", note: item.notes?.trim() || "" });
      for (const finding of item.findings) {
        if (finding.observationOnly) continue;
        issues.push({
          categoryPath: `${section.title} / ${item.label}`,
          title: finding.action.title,
          description: finding.description,
          location: finding.location,
          recommendation: finding.action.recommendation,
          priority: PRIORITY_NAMES[finding.action.priority] || "Medium",
          sourceSegmentIds: (finding.sources || []).map((s) => s.segmentId),
        });
      }
    }
  }
  return {
    assessmentId: assessment.id,
    propertyName: assessment.propertyName,
    finalizedAt: Date.now(),
    revision: assessment.revision,
    transcript: transcript.segments.map(({ id, start, end, text }) => ({ id, start, end, text })),
    issues,
    conditions,
    summaries,
  };
}

/** The newest examples first, skipping the report being drafted. */
export function recentExamples(examples: (TrainingExample | null | undefined)[], { limit, excludeAssessmentId }: { limit: number; excludeAssessmentId?: string }): TrainingExample[] {
  return examples
    .filter((e): e is TrainingExample => Boolean(e) && e!.assessmentId !== excludeAssessmentId && Boolean(e!.issues?.length || e!.conditions?.length))
    .sort((a, b) => b.finalizedAt - a.finalizedAt)
    .slice(0, limit);
}
