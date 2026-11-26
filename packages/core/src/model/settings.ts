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

export const DEFAULT_DISCLAIMER = "This report was prepared by {COMPANY} for the exclusive use of {CLIENT} in connection with {PROPERTY}. It is based on a visual, non-invasive walk-through of accessible areas on the date of the assessment, on information provided by site personnel, and on the conditions observed at that time. It is not an engineering study, a code-compliance review, or a warranty of the condition of the property, and concealed or latent conditions may exist that were not observed. Regulatory compliance items reflect information confirmed by the tenant or operator and were not independently verified. Any cost or timing references are opinions for planning purposes only. No other party may rely on this report without the written consent of {COMPANY} and {CLIENT}.";

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
