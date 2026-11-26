/**
 * Document migrations: how a report saved by an earlier version of the app is
 * upgraded to today's shape. Every stored assessment document carries `schema`.
 *
 * Steps 2 to 6 are v1's migrateAssessment() (v1 src/js/model/assessment.js at
 * 03104a2), split into one step per schema with the same effect on every
 * document v1 saved. A test checks them against a word-for-word copy of v1's
 * function (test/v1-reference). Step 7 is v2's first change.
 *
 * Rules: a step is never edited once released; a change is a new step with a
 * fixture document in tests/fixtures and a test. Upgrading happens when a
 * document is read. A report frozen at issue is never rewritten: it is
 * upgraded in memory each time it's opened.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- a document saved by an earlier version has no fixed shape */

export interface DocumentMigration {
  /** The schema this step upgrades to. */
  to: number;
  name: string;
  /** Changes the document in place. */
  up(doc: any): void;
}

/** Schema 2: "issues" became "findings", and photos gained markup. */
function issuesBecomeFindings(a: any): void {
  for (const section of a.sections || []) {
    section.summary ??= section.narrative || "";
    delete section.narrative;
    for (const item of section.items) {
      item.findings ??= (item.issues || []).map((f: any) => ({ ...f, observationOnly: Boolean(f.obsOnly) }));
      item.noMaterialIssues ??= Boolean(item.nmi);
      delete item.issues; delete item.nmi;
      item.findings.forEach((f: any) => delete f.obsOnly);
    }
  }
  for (const photo of a.photos || []) {
    photo.findings ??= photo.issues || [];
    photo.markup ??= [];
    delete photo.issues;
  }
}

/** Schema 3: an action's "owner" became its "assignee". */
function ownerBecomesAssignee(a: any): void {
  for (const section of a.sections || []) {
    for (const item of section.items) {
      for (const finding of item.findings) {
        if (!finding.action) continue;
        finding.action.assignee ??= finding.action.owner || "";
        delete finding.action.owner;
      }
    }
  }
}

/** Schema 4: a subsection a draft added is "suggested" until Cecil keeps it. */
function addedByDraftBecomesSuggested(a: any): void {
  for (const section of a.sections || []) {
    for (const item of section.items) {
      if (item.addedByDraft) item.suggested = true;
      delete item.addedByDraft;
    }
  }
}

/** Schema 5: the facility contact for the client's follow-up tracker, and priority labels per report. */
function facilityContactAndPriorityScheme(a: any): void {
  a.facilityContact ??= "";
  a.priorityScheme ??= "hml";
}

/**
 * Schema 6: a photo can also be used in other places ("Also use here"), and the
 * action list order is saved (earlier reports were always sorted by priority).
 */
function photosInTwoPlacesAndActionOrder(a: any): void {
  a.actionOrder ??= "priority";
  for (const photo of a.photos || []) photo.alsoIn ??= [];
}

/**
 * Schema 7 (v2): the assessor never sets an assignee or due date; the client
 * and facility do, on the live action item (Plan 4, A-12). They leave the
 * report. A value an earlier version stored isn't lost: it moves to
 * `finding.v1FollowUp`, where importing the report makes it the action item's
 * starting value, and where sorting and merging still read it until then.
 */
function followUpLeavesTheReport(a: any): void {
  for (const section of a.sections || []) {
    for (const item of section.items || []) {
      for (const finding of item.findings || []) {
        const action = finding.action;
        if (!action || typeof action !== "object") continue;
        const kept: { assignee?: string; due?: string } = {};
        if (typeof action.assignee === "string" && action.assignee) kept.assignee = action.assignee;
        if (typeof action.due === "string" && action.due) kept.due = action.due;
        if (kept.assignee || kept.due) finding.v1FollowUp = kept;
        delete action.assignee;
        delete action.due;
      }
    }
  }
}

export const ASSESSMENT_MIGRATIONS: readonly DocumentMigration[] = [
  { to: 2, name: "Issues become findings; photos gain markup", up: issuesBecomeFindings },
  { to: 3, name: "An action's owner becomes its assignee", up: ownerBecomesAssignee },
  { to: 4, name: "A subsection a draft added is suggested", up: addedByDraftBecomesSuggested },
  { to: 5, name: "Facility contact and priority scheme per report", up: facilityContactAndPriorityScheme },
  { to: 6, name: "One photo in two places; the action list order is saved", up: photosInTwoPlacesAndActionOrder },
  { to: 7, name: "Assignee and due date leave the report", up: followUpLeavesTheReport },
];

/** The schema new assessment documents are saved in. */
export const SCHEMA_VERSION = ASSESSMENT_MIGRATIONS[ASSESSMENT_MIGRATIONS.length - 1]!.to;

/** The schema a document says it's in. v1's first version saved none, which counts as 1. */
export const documentSchema = (doc: any): number => (typeof doc?.schema === "number" && doc.schema >= 2 ? doc.schema : 1);

/**
 * Upgrades an assessment document saved by an earlier version, in place, and
 * returns it. `to` stops at an earlier schema (tests compare steps 2 to 6
 * with v1's own function). A document already at `to` or newer is returned
 * unchanged, as v1 did.
 */
export function migrateAssessment(a: any, { to = SCHEMA_VERSION }: { to?: number } = {}): any {
  if (!a || a.schema >= to) return a;
  const from = documentSchema(a);
  for (const step of ASSESSMENT_MIGRATIONS) {
    if (step.to > from && step.to <= to) step.up(a);
  }
  a.schema = to;
  return a;
}

/* eslint-enable @typescript-eslint/no-explicit-any */
