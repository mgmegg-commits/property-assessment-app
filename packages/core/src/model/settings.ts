/**
 * Report settings: v1's Branding & settings (v1 src/js/state.js
 * defaultSettings), which in v2 belong to an organization.
 *
 * Left out on purpose:
 *   keepOriginals  v2 always keeps original photos (Plan 12.15)
 *   company, preparedBy  start empty: they come from the organization and its
 *                  users (v1 started them as Cecil's own name and firm)
 */
import { DEFAULT_PHRASES } from "./phrases.js";
import { deepClone } from "../util/ids.js";
import type { ReportSettings } from "./types.js";
import disclaimerSeed from "../data/disclaimer.json" with { type: "json" };

/** The cover disclaimer, with {COMPANY}, {CLIENT} and {PROPERTY} filled in when printed. From src/data/disclaimer.json. */
export const DEFAULT_DISCLAIMER: string = disclaimerSeed.text;

export function defaultSettings(): ReportSettings {
  return {
    company: "",
    contact: "",
    preparedBy: "",
    accent: "#1F4B6E",
    logo: null,
    disclaimer: DEFAULT_DISCLAIMER,
    defaultPriorityScheme: "hml", // "hml" (High / Medium / Low) or "rr" (Required / Recommended, MPT)
    phrases: deepClone(DEFAULT_PHRASES), // Cecil's standard wording (model/phrases.ts)
    // How a subsection with no rating, notes or findings prints: "name" (its name only) or "text" (name, then notDiscussedText).
    notDiscussedPrint: "name",
    notDiscussedText: "Not discussed during this visit.",
    // sectionLists: { healthcare: [...], realestate: [...] } once Cecil edits a standard list (model/sections.ts).
  };
}
