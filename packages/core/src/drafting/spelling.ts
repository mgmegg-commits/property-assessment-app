// Ported from v1 src/js/drafting/spellingPrompt.js at 03104a2; the prompt text is v1's word for word.
/**
 * The spelling check's prompt and answer, shared by the website's server and
 * the claude.ai page so both check spelling the same way.
 * Claude only proposes fixes; nothing changes until the assessor applies one.
 */

const INSTRUCTIONS = `You proofread property condition assessment reports written in US English by a professional property assessor. For each numbered text below, find clear spelling mistakes, typing errors, wrong words (for example "form" instead of "from", "overhanding" instead of "overhanging"), doubled words and obviously missing words. Do not change technical terms, trade names, proper names, addresses, parcel IDs, abbreviations, numbers, capitalization style or the writer's wording choices.

For each mistake give: k (the text's number), find (the exact characters copied from that text, 1 to 60 characters, enough to be unique), replace (the corrected characters) and why (3 to 8 words).`;

const OUTPUT_FORMAT = `Answer with JSON only, in exactly this shape (an empty list if nothing needs fixing):
{"fixes": [{"k": 0, "find": "...", "replace": "...", "why": "..."}]}`;

export function buildSpellingPrompt(texts: string[]): string {
  return `${INSTRUCTIONS}\n\n${OUTPUT_FORMAT}\n\nTexts:\n${JSON.stringify(texts.map((text, k) => ({ k, text })))}`;
}

/** Keeps fixes that point at real text and change something. */
export interface SpellingFix {
  k: number;
  find: string;
  replace: string;
  why: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Claude's answer is checked field by field */
export function readFixes(answer: any, texts: string[]): SpellingFix[] {
  const fixes: any[] = Array.isArray(answer?.fixes) ? answer.fixes : [];
  return fixes.filter((fix) => fix && Number.isInteger(fix.k) && typeof texts[fix.k] === "string"
    && typeof fix.find === "string" && typeof fix.replace === "string"
    && fix.find && fix.find !== fix.replace && texts[fix.k]!.includes(fix.find))
    .map(({ k, find, replace, why }) => ({ k, find, replace, why: typeof why === "string" ? why : "" }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */
