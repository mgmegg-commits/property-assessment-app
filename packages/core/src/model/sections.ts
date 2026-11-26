/**
 * A report's sections and subsections: editing them, the standard lists new
 * reports start from, and the values a draft filled in. No page, no storage.
 * Ported from v1 src/js/model/sections.js.
 *
 * Keys are for good. A subsection's ref is "sectionKey.itemKey" (itemRef), and
 * photos store it, so renaming never breaks a link. Moving a subsection to
 * another section changes its ref; the functions here repoint its photos.
 *
 * Marks on a subsection or section:
 *   item.suggested            Claude added it because nothing in the list fit
 *   item.drafted.rating/notes and section.drafted.summary
 *                             Claude filled it in and Cecil hasn't accepted it yet
 */
import { buildSections, newItem } from "./templates.js";
import { itemRef, findItem, visibleItems, deleteFinding, removePhotoFrom, type PlacedItem } from "./assessment.js";
import { uid, deepClone } from "../util/ids.js";
import type { Assessment, DraftedMarks, Finding, Item, ListSection, ReportSettings, Section } from "./types.js";

export const newSectionKey = (): string => uid("s");
export const newItemKey = (): string => uid("i");

type SettingsWithLists = Pick<ReportSettings, "sectionLists"> | null | undefined;

/* ---------- Standard lists (report settings) ---------- */

/** A list as stored in settings: [{ key, title, compliance, items: [{ key, label }] }]. */
export const listFromSections = (sections: Section[]): ListSection[] => sections.map((s) => ({
  key: s.key, title: s.title, compliance: Boolean(s.compliance), items: s.items.map((i) => ({ key: i.key, label: i.label })),
}));

export function sectionsFromList(list: ListSection[]): Section[] {
  return list.map((def) => ({
    key: def.key, title: def.title, compliance: Boolean(def.compliance), rating: "auto", summary: "",
    items: def.items.map((i) => newItem(i.key, i.label)),
  }));
}

export const isCustomList = (settings: SettingsWithLists, templateKey: string): boolean => Boolean(settings?.sectionLists?.[templateKey]);

/** The list a template's new reports start from: Cecil's own, or the template's. A copy. */
export function standardList(settings: SettingsWithLists, templateKey: string): ListSection[] {
  return deepClone(settings?.sectionLists?.[templateKey] || listFromSections(buildSections(templateKey)));
}

/** Cecil's list for editing, made from the template's the first time he changes it. */
export function editableList(settings: Pick<ReportSettings, "sectionLists">, templateKey: string): ListSection[] {
  settings.sectionLists ??= {};
  return (settings.sectionLists[templateKey] ??= standardList(settings, templateKey));
}

export function resetStandardList(settings: Pick<ReportSettings, "sectionLists">, templateKey: string): void {
  if (settings.sectionLists) delete settings.sectionLists[templateKey];
}

/** Adds a report's subsection to the standard list's section with the same key. */
export function addToStandardList(settings: Pick<ReportSettings, "sectionLists">, templateKey: string, sectionKey: string, item: { key: string; label: string }): boolean {
  const section = editableList(settings, templateKey).find((s) => s.key === sectionKey);
  if (!section) return false;
  if (!section.items.some((i) => i.key === item.key || i.label.trim().toLowerCase() === item.label.trim().toLowerCase())) {
    section.items.push({ key: item.key, label: item.label });
  }
  return true;
}

/* ---------- Editing ---------- */

/** Moves an entry one place earlier (-1) or later (+1). Returns whether it moved. */
export function moveInList<T>(list: T[], index: number, step: number): boolean {
  const to = index + step;
  if (index < 0 || to < 0 || to >= list.length) return false;
  [list[index], list[to]] = [list[to]!, list[index]!];
  return true;
}

export function newSection(title: string): Section {
  return { key: newSectionKey(), title, compliance: false, rating: "auto", summary: "", items: [] };
}

export function addItem(section: Section, label: string): Item {
  const item: Item = { ...newItem(newItemKey(), label), custom: true };
  section.items.push(item);
  return item;
}

export interface Content {
  findings: number;
  photos: number;
  notes: boolean;
}

/** What deleting a subsection would lose: { findings, photos, notes }. */
export function itemContent(a: Assessment, section: Section, item: Item): Content {
  const ref = itemRef(section, item);
  const photos = a.photos.filter((p) => p.item === ref || p.alsoIn?.includes(`item:${ref}`) || item.findings.some((f) => p.alsoIn?.includes(`finding:${f.id}`)));
  return { findings: item.findings.length, photos: photos.length, notes: Boolean(item.notes?.trim()) };
}

export const hasContent = (c: Content): boolean => Boolean(c.findings || c.photos || c.notes);

export function sectionContent(a: Assessment, section: Section): Content {
  const total: Content = { findings: 0, photos: 0, notes: false };
  for (const item of section.items) {
    const c = itemContent(a, section, item);
    total.findings += c.findings;
    total.photos += c.photos;
    total.notes ||= c.notes;
  }
  return total;
}

function repointPhotos(a: Assessment, fromRef: string, toRef: string): void {
  for (const photo of a.photos) {
    if (photo.item === fromRef) photo.item = toRef;
    photo.alsoIn = [...new Set((photo.alsoIn || []).map((place) => (place === `item:${fromRef}` ? `item:${toRef}` : place)))]
      .filter((place) => !(photo.item === toRef && !photo.findings.length && place === `item:${toRef}`));
  }
}

const removeFrom = <T>(list: T[], entry: T): void => {
  list.splice(list.indexOf(entry), 1);
};

type SectionAndItem = Pick<PlacedItem, "section" | "item">;

/**
 * Merges one subsection into another ({ section, item } each): its findings,
 * photos and notes move, then it's removed. The target keeps its own rating.
 */
export function mergeItem(a: Assessment, from: SectionAndItem, into: SectionAndItem): void {
  if (from.item === into.item) return;
  into.item.findings.push(...from.item.findings);
  const fromNotes = from.item.notes?.trim();
  if (fromNotes) {
    into.item.notes = [into.item.notes?.trim(), fromNotes].filter(Boolean).join("\n\n");
    acceptDrafted(into.item, "notes"); // merged by Cecil, so the result is his
  }
  if (from.item.findings.length) into.item.hidden = false;
  repointPhotos(a, itemRef(from.section, from.item), itemRef(into.section, into.item));
  removeFrom(from.section.items, from.item);
}

/** Deletes a subsection. One that holds findings, notes or photos needs `into`, where they go first. */
export function deleteItem(a: Assessment, section: Section, item: Item, into: SectionAndItem | null = null): void {
  if (hasContent(itemContent(a, section, item))) {
    if (!into) throw new Error(`"${item.label}" has findings, notes or photos. Choose where they go first.`);
    mergeItem(a, { section, item }, into);
  } else removeFrom(section.items, item);
}

/**
 * Deletes a subsection outright: its findings go with it, and its photos go
 * back to Unsorted (a photo also used somewhere else stays there).
 */
export function deleteItemToUnsorted(a: Assessment, section: Section, item: Item): void {
  const ref = itemRef(section, item);
  for (const finding of item.findings.slice()) deleteFinding(a, finding.id);
  for (const photo of a.photos) {
    photo.alsoIn = (photo.alsoIn || []).filter((place) => place !== `item:${ref}`);
    if (photo.item === ref) removePhotoFrom(a, photo.id, `item:${ref}`);
  }
  removeFrom(section.items, item);
}

/** Moves a whole subsection, with its photos, to the end of another section. */
export function moveItemToSection(a: Assessment, section: Section, item: Item, target: Section): void {
  const oldRef = itemRef(section, item);
  removeFrom(section.items, item);
  if (target.items.some((i) => i.key === item.key)) item.key = newItemKey();
  target.items.push(item);
  repointPhotos(a, oldRef, itemRef(target, item));
}

/**
 * Deletes a section. Its subsections that hold anything move whole into `into`
 * (keeping their names); empty ones go. Regulatory Compliance can't be deleted.
 */
export function deleteSection(a: Assessment, section: Section, into: Section | null = null): void {
  if (section.compliance) throw new Error(`${section.title} can't be deleted.`);
  const keep = section.items.filter((item) => hasContent(itemContent(a, section, item)));
  if (keep.length && (!into || into === section || into.compliance)) throw new Error(`Choose a section for what's in ${section.title} first.`);
  for (const item of keep) moveItemToSection(a, section, item, into!);
  removeFrom(a.sections, section);
}

/** Moves a finding to another subsection (ref); its photos go with it. */
export function moveFinding(a: Assessment, findingId: string, toRef: string): boolean {
  const target = findItem(a, toRef);
  if (!target || target.section.compliance) return false;
  let finding: Finding | null = null;
  for (const section of a.sections) {
    for (const item of section.items) {
      const index = item.findings.findIndex((f) => f.id === findingId);
      if (index >= 0) [finding] = item.findings.splice(index, 1) as [Finding];
    }
  }
  if (!finding) return false;
  target.item.findings.push(finding);
  target.item.hidden = false;
  // A photo sits on one subsection, so it leaves any findings that stay behind.
  for (const photo of a.photos) {
    if (photo.findings.includes(findingId) && photo.item !== toRef) Object.assign(photo, { item: toRef, findings: [findingId] });
  }
  return true;
}

/* ---------- Drafted values ---------- */

export type DraftedField = keyof DraftedMarks;
export const DRAFTED_FIELDS: Record<DraftedField, string> = { rating: "rating", notes: "note", summary: "summary" };

type Marked = { drafted?: DraftedMarks };

export const isDrafted = (entry: Marked | null | undefined, field: DraftedField): boolean => Boolean(entry?.drafted?.[field]);

export function markDrafted(entry: Marked, field: DraftedField): void {
  entry.drafted = { ...entry.drafted, [field]: true };
}

/** Cecil accepted (or changed) a drafted value: it's his now. Without `field`, all of them. */
export function acceptDrafted(entry: Marked | null | undefined, field?: DraftedField): void {
  if (!entry?.drafted) return;
  if (field) delete entry.drafted[field];
  if (!field || !Object.keys(entry.drafted).length) delete entry.drafted;
}

export interface PendingDraft {
  section: Section;
  sectionIndex: number;
  item?: Item;
  field: DraftedField;
}

/** Every value still waiting to be accepted: [{ section, sectionIndex, item?, field }]. */
export function pendingDrafts(a: Assessment): PendingDraft[] {
  const out: PendingDraft[] = [];
  a.sections.forEach((section, sectionIndex) => {
    if (isDrafted(section, "summary")) out.push({ section, sectionIndex, field: "summary" });
    for (const item of section.items) {
      for (const field of ["rating", "notes"] as const) if (isDrafted(item, field)) out.push({ section, sectionIndex, item, field });
    }
  });
  return out;
}

export function acceptAllDrafted(section: Section): void {
  acceptDrafted(section);
  for (const item of section.items) acceptDrafted(item);
}

/** A subsection the walk never touched: no rating, notes or findings. It still prints, as its name. */
export const isNotDiscussed = (item: Item): boolean => !item.rating && !item.notes?.trim() && !item.findings.length;

export const suggestedItems = (a: Assessment): SectionAndItem[] =>
  a.sections.flatMap((section) => visibleItems(section).filter((i) => i.suggested).map((item) => ({ section, item })));

/* ---------- Merging findings ---------- */

const appendText = (first: string | undefined, more: (string | undefined)[]): string => {
  // Each distinct text once: identical write-ups (11 "TPO Repairs") collapse into one.
  return [...new Set([first, ...more].map((t) => t?.trim()).filter(Boolean))].join("\n\n");
};

/**
 * Combines two or more findings in one subsection into the first (in report
 * order): its title and text lead, the others' text is added below so nothing
 * is lost, places are listed together, and every photo moves to it, in order.
 * Keeps the most urgent priority. A v1 report's saved assignee and due date
 * (v1FollowUp) combine as v1 combined them: the earliest due date, and the
 * first assignee. Returns the kept finding.
 */
export function mergeFindings(a: Assessment, findingIds: string[], priorityOrder: Record<string, number> = {}): Finding {
  const located = findingIds.map((id) => {
    for (const section of a.sections) for (const item of section.items) {
      const finding = item.findings.find((f) => f.id === id);
      if (finding) return { section, item, finding };
    }
    return null;
  });
  if (located.some((x) => !x) || located.length < 2) throw new Error("Choose two or more findings to merge.");
  const item = located[0]!.item;
  if (located.some((x) => x!.item !== item)) throw new Error("Only findings in the same subsection can be merged.");
  const [keep, ...rest] = item.findings.filter((f) => findingIds.includes(f.id)) as [Finding, ...Finding[]]; // report order
  const all = [keep, ...rest];

  keep.description = appendText(keep.description, rest.map((f) => f.description));
  keep.location = [...new Set(all.map((f) => f.location?.trim()).filter(Boolean))].join("; ");
  keep.sources = all.flatMap((f) => f.sources || []);
  if (!keep.sources.length) delete keep.sources;
  const actions = all.filter((f) => !f.observationOnly).map((f) => f.action);
  if (actions.length) {
    keep.observationOnly = false;
    keep.action.title ||= actions.find((x) => x.title)?.title || "";
    keep.action.recommendation = appendText(keep.action.recommendation, rest.map((f) => f.action.recommendation));
    const ranked = actions.filter((x) => x.priority).sort((x, y) => (priorityOrder[x.priority] ?? 9) - (priorityOrder[y.priority] ?? 9));
    keep.action.priority = ranked[0]?.priority || keep.action.priority;
    const saved = all.filter((f) => !f.observationOnly).map((f) => f.v1FollowUp || {});
    const due = saved.map((x) => x.due).filter(Boolean).sort()[0];
    const assignee = keep.v1FollowUp?.assignee || saved.find((x) => x.assignee)?.assignee;
    if (due || assignee) keep.v1FollowUp = { ...(assignee ? { assignee } : {}), ...(due ? { due } : {}) };
    else delete keep.v1FollowUp;
  }

  // Photos: the kept finding's first, then each other finding's, in their own order.
  const restIds = new Set(rest.map((f) => f.id));
  const ordered = all.flatMap((f) => a.photos.filter((p) => p.findings.includes(f.id) || p.alsoIn?.includes(`finding:${f.id}`)).sort((x, y) => (x.order ?? x.takenAt ?? 0) - (y.order ?? y.takenAt ?? 0)));
  [...new Set(ordered)].forEach((photo, i) => {
    photo.findings = [...new Set(photo.findings.map((id) => (restIds.has(id) ? keep.id : id)))];
    photo.alsoIn = [...new Set((photo.alsoIn || []).map((place) => (restIds.has(place.slice(8)) ? `finding:${keep.id}` : place)))]
      .filter((place) => !(place === `finding:${keep.id}` && photo.findings.includes(keep.id)));
    photo.order = i;
  });
  item.findings = item.findings.filter((f) => !restIds.has(f.id));
  return keep;
}
