/**
 * Assessment templates (FR-TPL-1). Both share six sections and 32 items; the
 * healthcare and real estate versions differ only in a few item labels.
 * Sections, items, names and order match Cecil's SafetyCulture reports
 * (The Arbors and St. Martin's in the Pines for Healthcare Master,
 * NCP Solutions / OSG EverView for Real Estate).
 */
export const TEMPLATES = {
  healthcare: { name: "Healthcare Master", version: 2, variant: "hc" },
  realestate: { name: "Real Estate", version: 2, variant: "re" },
};

const SECTION_DEFINITIONS = [
  {
    key: "env", title: "Building Envelope",
    items: [["roof", "Roof"], ["elevations", "Elevations"], ["openings", "Openings"], ["sealants", "Sealant and Flashings"]],
  },
  {
    key: "str", title: "Structure",
    items: [["horizontal", "Horizontal Structure (Slabs, Floors, Joists and Beams, and Roof Framing)"],
      ["vertical", "Vertical Structure (Columns)"]],
  },
  {
    key: "int", title: "Interior",
    items: [["ceiling", "Ceiling"], ["flooring", "Flooring"], ["walls", "Walls"], ["millwork", "Millwork"],
      ["rooms", { hc: "Patient Rooms", re: "Rooms" }], ["dining", { hc: "Cafeteria", re: "Dining / Food Prep" }],
      ["common", "Common Areas"], ["elevators", "Elevators"], ["special", { hc: "Treatment Areas", re: "Special Areas" }]],
  },
  {
    key: "mep", title: "MEP Systems",
    items: [["plumbing", "Plumbing"], ["hvac", "HVAC"], ["electrical", "Electrical"]],
  },
  {
    // Tenant-confirmed checkboxes; never part of the condition rating (FR-CAP-6).
    key: "reg", title: "Regulatory Compliance", compliance: true,
    items: [["life", "Life Safety"], ["lic", { hc: "Hospital Licensing", re: "Building Licensing" }],
      ["agency", { hc: "TJC / DNV", re: "Regulatory Agencies" }], ["ada", "ADA"], ["elevlic", "Elevator Licensing"],
      ["environmental", "Environmental"], ["capital", "Capital Additions or Improvements"], ["other", "Other"]],
  },
  {
    key: "site", title: "Site",
    items: [["paving", "Parking Surfaces"], ["walks", "Sidewalks and Hardscapes"], ["landscaping", "Landscaping"],
      ["detention", "Water Detention Areas"]],
  },
];

export function newItem(key, label) {
  return { key, label, hidden: false, rating: "", noMaterialIssues: false, notes: "", confirmed: false, findings: [] };
}

export function buildSections(templateKey) {
  const variant = TEMPLATES[templateKey].variant;
  return SECTION_DEFINITIONS.map((def) => ({
    key: def.key,
    title: def.title,
    compliance: Boolean(def.compliance),
    rating: "auto",
    summary: "",
    items: def.items.map(([key, label]) => newItem(key, typeof label === "string" ? label : label[variant])),
  }));
}

export const RATINGS = { G: "Good", F: "Fair", P: "Poor", NA: "N/A" };
/**
 * Priority labels per client. Most reports use High / Medium / Low; MPT's use
 * Required / Recommended. A report's `priorityScheme` picks one; the default for
 * new reports is in Branding & settings. Codes are stored on each action.
 */
export const PRIORITY_SCHEMES = {
  hml: { name: "High / Medium / Low", labels: { H: "High", M: "Medium", L: "Low" } },
  rr: { name: "Required / Recommended", labels: { REQ: "Required", REC: "Recommended" } },
};
export const PRIORITIES = PRIORITY_SCHEMES.hml.labels;
const PRIORITY_LABELS = { ...PRIORITY_SCHEMES.hml.labels, ...PRIORITY_SCHEMES.rr.labels };
export const PRIORITY_ORDER = { H: 0, REQ: 0, M: 1, REC: 1, L: 2 };
/** Switching a report's scheme converts its actions: High → Required, Medium and Low → Recommended, and back. */
export const PRIORITY_CONVERSION = { rr: { H: "REQ", M: "REC", L: "REC" }, hml: { REQ: "H", REC: "M" } };

export const priorityScheme = (a) => (PRIORITY_SCHEMES[a?.priorityScheme] ? a.priorityScheme : "hml");
/** { code: label } for the report's scheme, in order. */
export const priorityOptions = (a) => PRIORITY_SCHEMES[priorityScheme(a)].labels;
export const priorityLabel = (code) => PRIORITY_LABELS[code] || "";
/** The most urgent code in the report's scheme (High or Required). */
export const topPriority = (a) => Object.keys(priorityOptions(a))[0];

/** A draft's "High" / "Medium" / "Low" as a code in the report's scheme. */
export function draftedPriority(a, name) {
  const code = { High: "H", Medium: "M", Low: "L" }[name] || "M";
  return priorityScheme(a) === "rr" ? PRIORITY_CONVERSION.rr[code] : code;
}
/** Where a photo prints. Shown as three one-click buttons, with the hint for the chosen one under them. */
export const PHOTO_STATUSES = { report: "In report", appendix: "Appendix only", excluded: "Exclude" };
export const PHOTO_STATUS_HINTS = {
  report: "Prints in the report, with the finding or subsection it's placed in (unplaced photos print under Additional Photos).",
  appendix: "Prints only in the Additional Photos appendix at the end, not with its finding.",
  excluded: "Stays in the app but is left out of the report.",
};

/** The standard condition sentence follows the rating (FR-CAP-3). */
/** The section's own sentence, from its rating (set, or worked out from its subsections). */
export function sectionSentence(section) {
  switch (sectionRating(section)) {
    case "G": return "Observed in good condition, with minor exceptions noted below.";
    case "F": return "Observed in fair condition, with exceptions noted below.";
    case "P": return "Observed in poor condition. Deficiencies noted below require attention.";
    default: return "";
  }
}

export function standardSentence(item) {
  const hasFindings = item.findings.length > 0;
  switch (item.rating) {
    case "G":
      if (item.noMaterialIssues) return "Observed in good condition. No material issues were noted.";
      return hasFindings ? "Observed in good condition, with minor exceptions noted below." : "Observed in good condition.";
    case "F":
      return item.noMaterialIssues
        ? "Observed in fair condition, consistent with its age and use. No material issues were noted."
        : "Observed in fair condition, with exceptions noted below.";
    case "P": return "Observed in poor condition. Deficiencies noted below require attention.";
    case "NA": return "Not applicable to this property.";
    default: return "";
  }
}

const RATING_SCORE = { G: 3, F: 2, P: 1 };

/** A section's rating: the assessor's override, or the average of its rated items. */
export function sectionRating(section) {
  if (section.rating && section.rating !== "auto") return section.rating;
  const scores = section.items
    .filter((item) => !item.hidden && RATING_SCORE[item.rating])
    .map((item) => RATING_SCORE[item.rating]);
  if (!scores.length) return "";
  const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  if (average >= 2.5) return "G";
  return average >= 1.5 ? "F" : "P";
}
