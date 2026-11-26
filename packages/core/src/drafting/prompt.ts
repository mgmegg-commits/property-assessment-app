// Ported from v1 src/js/drafting/prompt.js at 03104a2; the prompt text is v1's word for word.
/**
 * The drafting prompt. The prototype's draftWithClaude() prompt wasn't available,
 * so this was written from the requirements; adjust the wording here.
 *
 * Claude sees only this one prompt (no separate system prompt), so it carries
 * the rules, Cecil's recent finalized reports as examples, the report's own
 * list of sections and subsections, the transcript, and the exact JSON to
 * answer with. Both drafting paths use it: the artifact (claudeDraft.js) and
 * the website (server/drafting.js).
 */
import { itemRef } from "../model/assessment.js";
import { RATINGS } from "../model/templates.js";
import type { Assessment, Phrase } from "../model/types.js";
import type { TrainingExample } from "./training.js";

/** A transcript remark as the prompt shows it. */
export interface PromptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export const DRAFTING_RULES = `You draft property condition assessment reports for Cecil Ingram of Cecil Ingram Properties LLC. Cecil walks a property, talks through what he sees, and takes photos as he goes. You receive the timestamped transcript of one walk-through and fill in this report: its issues, the condition of each subsection he talked about, and a summary of each section.

Rules:
- Use only what he said. Do not add causes, quantities, measurements, locations, costs, code references or brands he did not state. If he gave no recommendation, write the plain corrective step his observation implies, without specifics he did not give.
- Skip remarks that are not observations about the property: greetings, conversation with staff, directions, thinking aloud, and remarks about taking photos.
- Correct obvious speech-to-text mistakes only when the intended word is clear from context.
- The report's list of sections and subsections is given below, each with an id in square brackets. Put everything under the subsection it belongs to, using its id exactly. When nothing in the list fits, leave subsectionId empty and name a new subsection in newSubsectionName (short, in the style of the list, such as "Pool Deck"), under the section that fits best. Use the same newSubsectionName every time you refer to the same new subsection.

Issues: one for each distinct deficiency or condition he describes.
- Each distinct problem in a subsection is ONE issue, even when he mentions it in several places, comes back to it later, or takes many photos of it. For example, TPO roof repairs not done to specification on five buildings is one issue, not five. Cite every segment it comes from, and list the places in its location ("West wing; Building C; Building D"). The client tracks every issue as a separate action item, so duplicates make the report harder to use.
- sectionId: the id of the section.
- subsectionId: the id of the subsection, or "" with newSubsectionName set.
- newSubsectionName: "" unless subsectionId is "".
- title: a short action title, under 10 words, such as "Clear and repair roof drain".
- description: what he observed, in complete sentences, in the professional third-person voice of a written report.
- location: where on the property, if he said; every place, separated by semicolons, when he mentioned the problem in several; otherwise an empty string.
- recommendation: the corrective action.
- priority: "High" for safety hazards or active damage (active leaks, trip hazards, exposed wiring, fire and life safety deficiencies, ongoing structural movement); "Medium" for deficiencies to repair within about a year; "Low" for minor, cosmetic or monitor items.
- sourceSegmentIds: the ids of every transcript segment the issue comes from.

Subsections: one entry for each subsection he talked about, including new ones you named. Leave out subsections he did not mention; never guess at a condition he did not describe.
- sectionId, subsectionId, newSubsectionName: as for issues.
- rating: judge it from what he describes. "P" (Poor) for active damage, failures or safety hazards; "F" (Fair) for wear or deficiencies that need repair or maintenance; "G" (Good) when he describes it as in good condition or mentions only minor items; "NA" when he says it doesn't apply to this property.
- note: one or two sentences on its general condition, from what he said, in the report's voice.
- sourceSegmentIds: the segments it comes from.

Sections: one entry for each section he talked about, with a summary of one to three sentences on its overall condition, from what he said. Leave out sections he did not mention.

Write in US English. Return empty lists if the transcript has no observations.`;

const clock = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The report's own list, condition sections only, with ids:
 *   [env] Building Envelope
 *     [env.roof] Roof
 */
export function templateOutline(assessment: Pick<Assessment, "sections">): string {
  return assessment.sections
    .filter((s) => !s.compliance)
    .map((s) => [`[${s.key}] ${s.title}`, ...s.items.map((item) => `  [${itemRef(s, item)}] ${item.label}${item.hidden ? " (hidden; use only if he talks about it)" : ""}`)].join("\n"))
    .join("\n");
}

export const transcriptLines = (segments: PromptSegment[]): string =>
  segments.map((s) => `[${s.id} ${clock(s.start)}-${clock(s.end)}] ${s.text}`).join("\n");

const EXAMPLE_TRANSCRIPT_CHARS = 12000;

function formatExample(example: TrainingExample, n: number): string {
  let transcript = transcriptLines(example.transcript);
  if (transcript.length > EXAMPLE_TRANSCRIPT_CHARS) transcript = `${transcript.slice(0, EXAMPLE_TRANSCRIPT_CHARS)}\n[transcript shortened]`;
  const conditions = (example.conditions || []).map((c) => ({ subsection: c.path, rating: c.rating ? `${c.rating} (${(RATINGS as Record<string, string>)[c.rating] || c.rating})` : "", note: c.note }));
  return `<example number="${n}" property="${example.propertyName || ""}">
<transcript>
${transcript}
</transcript>
<final_issues>
${JSON.stringify(example.issues || [], null, 1)}
</final_issues>${conditions.length ? `
<final_subsection_conditions>
${JSON.stringify(conditions, null, 1)}
</final_subsection_conditions>` : ""}${example.summaries?.length ? `
<final_section_summaries>
${JSON.stringify(example.summaries, null, 1)}
</final_section_summaries>` : ""}
</example>`;
}

const OUTPUT_FORMAT = `Answer with JSON only, no other text, in exactly this shape:
{"issues": [{"sectionId": "env", "subsectionId": "env.roof", "newSubsectionName": "", "title": "...", "description": "...", "location": "...", "recommendation": "...", "priority": "High" | "Medium" | "Low", "sourceSegmentIds": ["s1"]}],
 "subsections": [{"sectionId": "env", "subsectionId": "env.roof", "newSubsectionName": "", "rating": "G" | "F" | "P" | "NA", "note": "...", "sourceSegmentIds": ["s1"]}],
 "sections": [{"sectionId": "env", "summary": "..."}]}`;

function examplesBlock(examples: TrainingExample[]): string {
  if (!examples.length) return "";
  return `Below are recent reports Cecil finalized: what he said on the walk, then the issues, subsection ratings and notes, and section summaries as he finally wrote them. Match his wording, level of detail, ratings and priorities. Their subsection names may differ from this report's list; always use this report's ids. They are examples only; never copy their content into a new report.

${examples.map((e, i) => formatExample(e, i + 1)).join("\n\n")}`;
}

/** Cecil's standard wording: drafts reuse it word for word where it fits what he said. */
function phrasesBlock(phrases: Pick<Phrase, "title" | "text">[] | null | undefined): string {
  const usable = (phrases || []).filter((p) => p.text?.trim());
  if (!usable.length) return "";
  return `Cecil's standard wording. When a recommendation, description or note says what one of these says, use his sentence word for word instead of writing your own; never use one that doesn't fit what he said on this walk:
${usable.map((p) => `- ${p.title}: ${p.text.trim()}`).join("\n")}`;
}

/** The whole prompt for one draft. */
export function buildDraftPrompt(assessment: Pick<Assessment, "sections" | "propertyName" | "useType">, segments: PromptSegment[], examples: TrainingExample[] = [], phrases: Pick<Phrase, "title" | "text">[] = []): string {
  return [
    DRAFTING_RULES,
    phrasesBlock(phrases),
    examplesBlock(examples),
    `Property: ${assessment.propertyName || "Unnamed property"}${assessment.useType ? ` (${assessment.useType})` : ""}`,
    `This report's sections and subsections (use these ids):\n${templateOutline(assessment)}`,
    `Walk-through transcript (segment id, start-end as minutes:seconds from the start of the recording):\n${transcriptLines(segments)}`,
    OUTPUT_FORMAT,
  ].filter(Boolean).join("\n\n");
}
