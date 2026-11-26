/**
 * Cecil's standard wording: sentences he reuses so there are no typos (he used
 * to keep them in a Word document). Kept in settings as `phrases`, edited in
 * Branding & settings, inserted from any description, recommendation, note or
 * summary box, and given to the drafting prompt so drafts reuse his wording.
 * Seeded from his past reports.
 */
export const DEFAULT_PHRASES = [
  ["TPO repairs", "TPO repairs should be per manufacturer specifications to protect the roof warranty. This should include proper materials including cut edge sealant usage."],
  ["Roof ponding", "Proper tapering and cricketing is needed to eliminate roof ponding."],
  ["Roof debris", "Roof debris needs clearing, including vegetation and mechanical parts."],
  ["Roof report", "A roofing report will provide needed information to determine remaining useful life. Then scope and budgets can be made (preferably for a ten year period)."],
  ["Gutters", "Gutters and downspouts need to be cleaned and in some areas reattached. Verify drains flow away from the buildings as designed."],
  ["Roof flashings", "Repair roof flashings. This is best done in conjunction with other roof repairs."],
  ["Efflorescence", "Clean efflorescence from block. If it returns, make corrections to the top of walls where rain is getting into the block system. The wall caps should have slope."],
  ["Windows at PTACs", "Repair windows at PTAC units to prevent rain intrusion."],
  ["Failed window seals", "Replace windows that have failed vacuum seals."],
  ["Ceiling stains", "After leaks have been properly repaired, stained ceiling tiles need to be replaced, and painted ceiling damage repaired."],
  ["Dust at air supply", "Verify proper filter changes are occurring. Inspect ducts as well. Keep ceiling tiles in place to prevent dust from above ceilings getting into conditioned areas."],
  ["Millwork", "Millwork repairs need to be with washable surfaces, especially in wet areas."],
  ["Plumbing leaks", "All plumbing leaks need to be investigated and repaired. Galvanized pipe and cracked cast iron pipe will need to be replaced long term."],
  ["HVAC maintenance", "Maintenance and repair of HVAC components needs improvement. Exhaust fans not operating causes test and balance issues with air pressures. Failure to service units and regularly change air filters allows dust to accumulate on ceilings near air vents."],
  ["LED lighting", "Convert all areas to LED lighting. Research the best companies to partner with and look for tax incentives and rebates."],
  ["Fire alarm", "Repairs should be made and trouble alerts and alarms need to be cleared from the alarm panel."],
  ["Asphalt", "A paving plan would be helpful to schedule crack sealing, seal coating, and striping. Maintenance and annual repairs are needed and seal coating should be scheduled."],
  ["Alligatoring", "Areas with alligatoring asphalt should be cut out, the subbase repaired, and repaved prior to seal coating. It should be a regular annual maintenance item."],
  ["Sidewalks", "Some repair to sidewalk cracks would help prevent further damage."],
  ["Tree pruning", "Prune trees overhanging roof areas. This will aid in keeping roofs clean."],
  ["Landscaping", "A landscaping and maintenance plan should be implemented for the property. Vegetation should be kept away from the buildings and windows."],
].map(([title, text], i) => ({ id: `ph${i + 1}`, title, text }));

/** The library to use: Cecil's saved one, or the seeds if he has never saved settings. */
export const phraseLibrary = (settings) => (Array.isArray(settings?.phrases) ? settings.phrases : DEFAULT_PHRASES);

/** Phrases whose title (or text) matches the search, title matches first. */
export function searchPhrases(phrases, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return phrases;
  const byTitle = phrases.filter((p) => p.title.toLowerCase().includes(q));
  const byText = phrases.filter((p) => !byTitle.includes(p) && p.text.toLowerCase().includes(q));
  return [...byTitle, ...byText];
}

/** A box's text with a phrase added: on its own line after anything already written. */
export function withPhrase(current, phrase) {
  const before = String(current || "").trimEnd();
  return before ? `${before}\n${phrase.text}` : phrase.text;
}

/** A short title for a new phrase: its first few words. */
export const suggestedTitle = (text) => String(text || "").trim().split(/\s+/).slice(0, 4).join(" ").replace(/[.,;:]$/, "");
