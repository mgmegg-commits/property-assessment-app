/**
 * Cecil's standard wording: sentences he reuses so there are no typos (he used
 * to keep them in a Word document). Kept in the report settings as `phrases`,
 * inserted from any description, recommendation, note or summary box, and given
 * to the drafting prompt so drafts reuse his wording. Seeded from his past
 * reports. Ported from v1 src/js/model/phrases.js.
 */
import type { Phrase, ReportSettings } from "./types.js";
import phraseSeeds from "../data/phrases.json" with { type: "json" };

/** Cecil's 21 phrases from his past reports, from src/data/phrases.json. */
export const DEFAULT_PHRASES: Phrase[] = phraseSeeds;

/** The library to use: Cecil's saved one, or the seeds if he has never saved settings. */
export const phraseLibrary = (settings: Partial<Pick<ReportSettings, "phrases">> | null | undefined): Phrase[] =>
  Array.isArray(settings?.phrases) ? settings.phrases : DEFAULT_PHRASES;

/** Phrases whose title (or text) matches the search, title matches first. */
export function searchPhrases(phrases: Phrase[], query: string | null | undefined): Phrase[] {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return phrases;
  const byTitle = phrases.filter((p) => p.title.toLowerCase().includes(q));
  const byText = phrases.filter((p) => !byTitle.includes(p) && p.text.toLowerCase().includes(q));
  return [...byTitle, ...byText];
}

/** A box's text with a phrase added: on its own line after anything already written. */
export function withPhrase(current: string | null | undefined, phrase: Pick<Phrase, "text">): string {
  const before = String(current || "").trimEnd();
  return before ? `${before}\n${phrase.text}` : phrase.text;
}

/** A short title for a new phrase: its first few words. */
export const suggestedTitle = (text: string | null | undefined): string =>
  String(text || "").trim().split(/\s+/).slice(0, 4).join(" ").replace(/[.,;:]$/, "");
