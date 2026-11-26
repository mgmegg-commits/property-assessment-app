/**
 * Pre-issue checklist (FR-REV-2). Errors block issuing; warnings and notes don't.
 * Each check names the tab where it can be fixed. Ported from v1 src/js/model/checks.js.
 */
import { visibleItems, itemNumber, listFindings, photosOfFinding, isUsedTwice, photoPlaces, placeLabel, type ListedFinding } from "./assessment.js";
import { pendingDrafts, isNotDiscussed, suggestedItems } from "./sections.js";
import { formatDateLong, plural } from "../util/format.js";
import { priorityOptions } from "./templates.js";
import type { Assessment, ReportSettings } from "./types.js";

export type CheckLevel = "error" | "warn" | "info";
/** The tab where a check can be fixed. */
export type CheckTab = "details" | "branding" | "findings" | "photos" | "spelling";

export interface CheckResult {
  level: CheckLevel;
  text: string;
  fixOn: CheckTab;
}

const ALLOWED_PLACEHOLDERS = /\{(CLIENT|COMPANY|PROPERTY)\}/g;
const listOf = (entries: string[], max = 6): string => entries.slice(0, max).join(", ") + (entries.length > max ? "…" : "");

export function runChecks(a: Assessment, settings: Pick<ReportSettings, "disclaimer">): CheckResult[] {
  const results: CheckResult[] = [];
  const add = (level: CheckLevel, text: string, fixOn: CheckTab) => results.push({ level, text, fixOn });

  // Cover and disclaimer details (FR-OUT-4)
  if (!a.clientName.trim()) add("error", "Add the client (property owner). The disclaimer names them.", "details");
  if (!a.propertyName.trim()) add("error", "Add the property name.", "details");
  if (!a.date) add("error", "Add the date of the assessment.", "details");
  if (!a.preparedBy.trim()) add("error", "Add who prepared the report.", "details");
  if (!a.address.trim()) add("warn", "The property has no address.", "details");
  if (/\{[A-Z]+\}/.test(settings.disclaimer.replace(ALLOWED_PLACEHOLDERS, ""))) {
    add("error", "The disclaimer has a placeholder this app does not fill. Use {CLIENT}, {COMPANY} or {PROPERTY}.", "branding");
  }

  // Ratings (FR-CAP-3). A subsection the walk never touched prints as its name only, like Cecil's reports.
  const unrated: string[] = [], notDiscussed: string[] = [], poorButClean: string[] = [], cleanWithFindings: string[] = [];
  a.sections.forEach((section, si) => {
    if (section.compliance) return;
    for (const item of visibleItems(section)) {
      const label = `${itemNumber(si, section, item)} ${item.label}`;
      if (isNotDiscussed(item)) notDiscussed.push(label);
      else if (!item.rating) unrated.push(label);
      if (item.rating === "P" && item.noMaterialIssues) poorButClean.push(item.label);
      if (item.noMaterialIssues && item.findings.length) cleanWithFindings.push(item.label);
    }
  });
  if (unrated.length) add("error", `${plural(unrated.length, "subsection")} with notes or findings but no rating: ${listOf(unrated)}.`, "findings");
  if (notDiscussed.length) add("info", `${plural(notDiscussed.length, "subsection")} not discussed (no rating, notes or findings): ${listOf(notDiscussed)}. ${notDiscussed.length === 1 ? "It prints" : "They print"} as set in Branding & settings.`, "findings");

  // Draft (walk-through drafting): Cecil confirms every value Claude filled in before issuing.
  const pending = pendingDrafts(a);
  if (pending.length) {
    const names = pending.map((p) => (p.item ? `${itemNumber(p.sectionIndex, p.section, p.item)} ${p.item.label} ${p.field === "rating" ? "rating" : "note"}` : `${p.section.title} summary`));
    add("error", `${plural(pending.length, "drafted value")} not accepted yet: ${listOf(names)}. Accept or change ${pending.length === 1 ? "it" : "each one"} on the Findings tab.`, "findings");
  }
  const suggested = suggestedItems(a);
  if (suggested.length) add("error", `${plural(suggested.length, "suggested subsection")} to keep, rename or merge: ${listOf(suggested.map((x) => x.item.label))}.`, "findings");
  if (poorButClean.length) add("error", `Rated Poor but marked "no material issues": ${poorButClean.join(", ")}.`, "findings");
  if (cleanWithFindings.length) add("warn", `Marked "no material issues" but has findings: ${cleanWithFindings.join(", ")}.`, "findings");

  // Findings and actions (FR-ACT-1, FR-ACT-2)
  const findings = listFindings(a);
  const actions = findings.filter((x) => !x.finding.observationOnly);
  const numbers = (list: ListedFinding[]) => list.map((x) => x.number).join(", ");
  const noDescription = findings.filter((x) => !x.finding.description.trim());
  const incomplete = actions.filter((x) => !x.finding.action.title.trim() || !x.finding.action.priority);
  const noPhoto = findings.filter((x) => !photosOfFinding(a, x.finding.id).length);
  if (noDescription.length) add("error", `${plural(noDescription.length, "finding")} without a description: ${numbers(noDescription)}.`, "findings");
  const options = priorityOptions(a);
  const otherScheme = actions.filter((x) => x.finding.action.priority && !(x.finding.action.priority in options));
  if (otherScheme.length) add("error", `${plural(otherScheme.length, "action")} with a priority that isn't ${Object.values(options).join(" / ")}: ${numbers(otherScheme)}. Choose the priority again.`, "findings");
  if (incomplete.length) add("error", `${plural(incomplete.length, "finding")} need an action title and priority, or "observation only": ${numbers(incomplete)}.`, "findings");
  // No check for assignee or due date: the client or tenant decides who fixes it and by when (they print as TBD).
  if (noPhoto.length) add("warn", `${plural(noPhoto.length, "finding")} without a photo: ${numbers(noPhoto)}.`, "findings");

  // Photos (FR-PHO-3)
  const unsorted = a.photos.filter((p) => !p.item && p.status === "report");
  const uncaptioned = a.photos.filter((p) => p.status !== "excluded" && !p.caption.trim());
  if (unsorted.length) add("warn", `${plural(unsorted.length, "photo")} not sorted. ${unsorted.length === 1 ? "It" : "They"} will print under Additional Photos.`, "photos");
  const twice = a.photos.filter((p) => p.status !== "excluded" && isUsedTwice(p));
  if (twice.length) {
    const where = twice.map((p) => `Photo ${a.photos.indexOf(p) + 1} (${photoPlaces(p).map((place) => placeLabel(a, place)).join(" and ")})`);
    add("warn", `${plural(twice.length, "photo")} used in more than one place: ${listOf(where)}. ${twice.length === 1 ? "It prints" : "They print"} in each place.`, "photos");
  }
  if (uncaptioned.length) add("warn", `${plural(uncaptioned.length, "photo")} in the report without a caption.`, "photos");

  // Narrative, compliance, spelling (FR-CAP-9)
  if (!a.generalComments.trim()) add("warn", "General comments are empty.", "details");
  const compliance = a.sections.find((s) => s.compliance);
  const unconfirmed = compliance ? visibleItems(compliance).filter((i) => !i.confirmed) : [];
  if (unconfirmed.length) add("info", `${plural(unconfirmed.length, "compliance item")} not confirmed by the tenant: ${unconfirmed.map((i) => i.label).join(", ")}.`, "findings");
  if (!a.spellCheckedAt) add("warn", "Spelling has not been checked.", "spelling");
  else if ((a.textEditedAt || 0) > a.spellCheckedAt) add("warn", "Text changed since the last spelling check.", "spelling");
  if (a.copiedFrom) add("info", `Property details were copied from the ${formatDateLong(a.copiedFrom.date)} assessment. Confirm personnel and parcels.`, "details");

  return results;
}

export const countErrors = (results: CheckResult[]): number => results.filter((r) => r.level === "error").length;
