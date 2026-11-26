/**
 * v1's migrateAssessment() and upgradeToSchema2(), copied word for word from
 * v1 src/js/model/assessment.js at 03104a2 (lines 77-122), with SCHEMA_VERSION 6.
 * The reference that v2's migrations 2 to 6 are tested against: they must give
 * the same result for every v1 document. Never edit this file.
 */
const SCHEMA_VERSION = 6;

/** Upgrades documents saved by earlier versions of the app. */
export function migrateAssessment(a) {
  if (!a || a.schema >= SCHEMA_VERSION) return a;
  if (!(a.schema >= 2)) upgradeToSchema2(a);
  for (const section of a.sections || []) {
    for (const item of section.items) {
      // Schema 3: an action's "owner" became its "assignee".
      for (const finding of item.findings) {
        if (!finding.action) continue;
        finding.action.assignee ??= finding.action.owner || "";
        delete finding.action.owner;
      }
      // Schema 4: a subsection a draft added is "suggested" until Cecil keeps it.
      if (item.addedByDraft) item.suggested = true;
      delete item.addedByDraft;
    }
  }
  // Schema 5: the facility contact for the client's follow-up tracker, and priority labels per report.
  a.facilityContact ??= "";
  a.priorityScheme ??= "hml";
  // Schema 6: a photo can also be used in other places ("Also use here"), and the
  // action list order is saved (earlier reports were always sorted by priority).
  a.actionOrder ??= "priority";
  for (const photo of a.photos || []) photo.alsoIn ??= [];
  a.schema = SCHEMA_VERSION;
  return a;
}

/** Schema 2: "issues" became "findings", and photos gained markup. */
function upgradeToSchema2(a) {
  for (const section of a.sections || []) {
    section.summary ??= section.narrative || "";
    delete section.narrative;
    for (const item of section.items) {
      item.findings ??= (item.issues || []).map((f) => ({ ...f, observationOnly: Boolean(f.obsOnly) }));
      item.noMaterialIssues ??= Boolean(item.nmi);
      delete item.issues; delete item.nmi;
      item.findings.forEach((f) => delete f.obsOnly);
    }
  }
  for (const photo of a.photos || []) {
    photo.findings ??= photo.issues || [];
    photo.markup ??= [];
    delete photo.issues;
  }
}

export { migrateAssessment as migrateAssessmentV1 };
