/**
 * The assessment document and the queries the views and report share.
 * Functions here take the assessment as their first argument and never touch
 * the page, storage or network, so they read the same everywhere they are used.
 * Ported from v1 src/js/model/assessment.js; the document's shape is in ./types.ts.
 */
import { TEMPLATES, buildSections, PRIORITY_ORDER, PRIORITY_CONVERSION, priorityOptions, priorityScheme } from "./templates.js";
import { sectionsFromList } from "./sections.js";
import { uid, deepClone } from "../util/ids.js";
import { todayIso } from "../util/format.js";
import { SCHEMA_VERSION } from "./migrations.js";
import type { ActionOrder, Assessment, Finding, FollowUp, FollowUpLookup, Item, ListSection, Photo, PriorityScheme, Section } from "./types.js";

export { SCHEMA_VERSION, migrateAssessment } from "./migrations.js";

export interface NewAssessmentOptions {
  templateKey: string;
  date?: string;
  propertyName?: string;
  clientName?: string;
  preparedBy?: string;
  /** The last visit's report: property facts, people, parcels and Cecil's own subsections carry over. */
  copyFrom?: CopySource | null;
  /** The list new reports start from (model/sections.ts standardList); the template's by default. */
  standardList?: ListSection[] | null;
  priorityScheme?: PriorityScheme;
}

/** What copying from an earlier report reads. Earlier reports may be in an older shape. */
export interface CopySource {
  id?: string;
  date?: string;
  templateKey?: string;
  templateVersion?: number;
  clientName?: string;
  propertyName?: string;
  useType?: string;
  operator?: string;
  facilityContact?: string;
  address?: string;
  lat?: string;
  lng?: string;
  personnel?: unknown[];
  parcels?: unknown[];
  sections?: { key: string; items: (Partial<Item> & { key: string; [key: string]: unknown })[] }[];
}

/** `standardList` is the list new reports start from (model/sections.ts standardList); the template's by default. */
export function newAssessment({ templateKey, date, propertyName, clientName, preparedBy, copyFrom, standardList, priorityScheme: scheme = "hml" }: NewAssessmentOptions): Assessment {
  const template = TEMPLATES[templateKey];
  if (!template) throw new Error(`Unknown template "${templateKey}".`);
  const now = Date.now();
  const assessment: Assessment = {
    id: uid("a"), kind: "assessment", schema: SCHEMA_VERSION,
    templateKey, templateName: template.name, templateVersion: template.version,
    propertyName: propertyName || "", clientName: clientName || "",
    priorityScheme: scheme, actionOrder: "priority", versionDay: todayIso(), useType: "", operator: "", facilityContact: "", address: "", lat: "", lng: "",
    date: date || todayIso(), time: "", preparedBy: preparedBy || "", weather: "",
    personnel: [], parcels: [], generalComments: "",
    sections: standardList ? sectionsFromList(standardList) : buildSections(templateKey), photos: [], coverPhoto: null,
    status: "draft", revision: 0, history: [],
    createdAt: now, updatedAt: now,
  };
  if (copyFrom) copyPropertyDetails(assessment, copyFrom);
  return assessment;
}

/** Reuse what doesn't change between visits (FR-CAP-2): property facts, people, parcels, item names. */
function copyPropertyDetails(target: Assessment, source: CopySource): void {
  target.clientName ||= source.clientName || "";
  target.propertyName ||= source.propertyName || "";
  for (const key of ["useType", "operator", "facilityContact", "address", "lat", "lng"] as const) target[key] = source[key] || "";
  target.personnel = deepClone((source.personnel || []) as Assessment["personnel"]);
  target.parcels = deepClone((source.parcels || []) as Assessment["parcels"]);
  target.copiedFrom = { id: source.id ?? "", date: source.date ?? "" };

  // Subsection names and "Hide" only carry over from a report on the same template
  // and version; an older list's subsections would otherwise come back under new
  // keys or old names. Subsections Cecil added himself always come along.
  const sameList = source.templateKey === target.templateKey && source.templateVersion === target.templateVersion;
  for (const section of target.sections) {
    const old = source.sections?.find((s) => s.key === section.key);
    if (!old) continue;
    if (sameList) {
      for (const item of section.items) {
        const oldItem = old.items.find((i) => i.key === item.key);
        if (oldItem) Object.assign(item, { label: oldItem.label, hidden: oldItem.hidden });
      }
    }
    for (const oldItem of old.items) {
      if (oldItem.custom && !section.items.some((i) => i.key === oldItem.key)) {
        const kept = deepClone(oldItem) as Record<string, unknown>;
        for (const mark of ["addedByDraft", "suggested", "drafted"]) delete kept[mark]; // kept on that report, so it's Cecil's now
        section.items.push({ ...(kept as unknown as Item), rating: "", noMaterialIssues: false, notes: "", confirmed: false, findings: [] });
      }
    }
  }
}

/**
 * A new finding. Its action has no assignee or due date: the client or tenant
 * decides those, on the live action item (schema 7).
 */
export function newFinding(): Finding {
  return {
    id: uid("f"), description: "", location: "", observationOnly: false,
    action: { title: "", recommendation: "", priority: "" },
  };
}

const NO_FOLLOW_UP: FollowUpLookup = new Map();

/**
 * Who fixes a finding's action and by when: its live action item's values from
 * `followUp`, or else what a v1 report saved on the finding. Empty when neither.
 */
export const followUpOf = (finding: Finding, followUp: FollowUpLookup = NO_FOLLOW_UP): FollowUp =>
  followUp.get(finding.id) ?? finding.v1FollowUp ?? {};

/* ---------- Items ---------- */

export const itemRef = (section: Section, item: Item): string => `${section.key}.${item.key}`;
export const visibleItems = (section: Section): Item[] => section.items.filter((item) => !item.hidden);

/** "1.3" - numbering skips hidden items so the report reads 1.1, 1.2, 1.3. */
export function itemNumber(sectionIndex: number, section: Section, item: Item): string {
  const position = visibleItems(section).indexOf(item);
  return position < 0 ? `${sectionIndex + 1}.–` : `${sectionIndex + 1}.${position + 1}`;
}

export interface PlacedItem {
  section: Section;
  sectionIndex: number;
  item: Item;
  ref: string;
}

export function findItem(a: Assessment, ref: string | null | undefined): PlacedItem | null {
  if (!ref) return null;
  const [sectionKey, itemKey] = ref.split(".");
  const sectionIndex = a.sections.findIndex((s) => s.key === sectionKey);
  const section = a.sections[sectionIndex];
  const item = section?.items.find((i) => i.key === itemKey);
  return section && item ? { section, sectionIndex, item, ref } : null;
}

/* ---------- Findings and actions ---------- */

export interface ListedFinding {
  finding: Finding;
  item: Item;
  section: Section;
  sectionIndex: number;
  ref: string;
  /** "1.3.2" */
  number: string;
}

/** Every finding on a visible item, with its number ("1.3.2") and where it sits. */
export function listFindings(a: Assessment): ListedFinding[] {
  const out: ListedFinding[] = [];
  a.sections.forEach((section, sectionIndex) => {
    for (const item of visibleItems(section)) {
      item.findings.forEach((finding, k) => out.push({
        finding, item, section, sectionIndex,
        ref: itemRef(section, item),
        number: `${itemNumber(sectionIndex, section, item)}.${k + 1}`,
      }));
    }
  });
  return out;
}

export const findFinding = (a: Assessment, id: string): ListedFinding | null => listFindings(a).find((x) => x.finding.id === id) || null;

export interface ListedAction extends ListedFinding {
  /** Position in report order. */
  order: number;
  /** "A1", "A2"… in the list's order. */
  actionNumber: string;
}

type Ordered = { finding: Finding; order: number };
type Compare = (x: Ordered, y: Ordered) => number;
const comparePriority: Compare = (x, y) => (PRIORITY_ORDER[x.finding.action.priority] ?? 3) - (PRIORITY_ORDER[y.finding.action.priority] ?? 3);

/** How the action list is ordered, chosen on the Report tab and saved with the report. */
export const ACTION_ORDERS: Record<ActionOrder, string> = { report: "Report order", priority: "Priority", due: "Due date" };

function orderCompare(order: ActionOrder, followUp: FollowUpLookup): Compare {
  const due = (x: Ordered) => followUpOf(x.finding, followUp).due || "9999"; // no due date (TBD) last
  const compareDue: Compare = (x, y) => due(x).localeCompare(due(y));
  switch (order) {
    case "report": return (x, y) => x.order - y.order;
    case "due": return (x, y) => compareDue(x, y) || comparePriority(x, y) || x.order - y.order;
    default: return (x, y) => comparePriority(x, y) || compareDue(x, y) || x.order - y.order;
  }
}

/**
 * Actions in the report's chosen order (report order, priority, or due date),
 * numbered A1, A2… in that order (FR-OUT-2). The screen, PDF and exports all use it.
 * Due dates live on the action items, so `followUp` gives them by finding id;
 * without it, only due dates a v1 report saved count, and the rest are TBD.
 */
export function listActions(a: Assessment, followUp: FollowUpLookup = NO_FOLLOW_UP): ListedAction[] {
  const actions: ListedAction[] = listFindings(a)
    .filter((x) => !x.finding.observationOnly)
    .map((x, order) => ({ ...x, order, actionNumber: "" }));
  actions.sort(orderCompare(a.actionOrder, followUp));
  actions.forEach((x, i) => { x.actionNumber = `A${i + 1}`; });
  return actions;
}

export function actionNumbersById(a: Assessment, followUp: FollowUpLookup = NO_FOLLOW_UP): Record<string, string> {
  return Object.fromEntries(listActions(a, followUp).map((x) => [x.finding.id, x.actionNumber]));
}

export interface PriorityCounts {
  H: number; M: number; L: number; REQ: number; REC: number;
  observations: number;
}

/** Action counts by priority code (both schemes), plus observation-only findings. */
export function priorityCounts(a: Assessment): PriorityCounts {
  const counts: PriorityCounts = { H: 0, M: 0, L: 0, REQ: 0, REC: 0, observations: 0 };
  for (const { finding } of listFindings(a)) {
    if (finding.observationOnly) counts.observations++;
    else if (finding.action.priority in counts) counts[finding.action.priority as keyof PriorityCounts]++;
  }
  return counts;
}

/** "33 action items: 25 Required, 8 Recommended" in the report's scheme. */
export function actionSummary(a: Assessment): string {
  const counts = priorityCounts(a);
  const count = (code: string) => counts[code as keyof PriorityCounts] ?? 0;
  const total = Object.keys(priorityOptions(a)).reduce((n, code) => n + count(code), 0);
  if (!total) return "No action items";
  const parts = Object.entries(priorityOptions(a)).filter(([code]) => count(code)).map(([code, label]) => `${count(code)} ${label}`);
  return `${total} action item${total === 1 ? "" : "s"}: ${parts.join(", ")}`;
}

/** Switches a report to another priority scheme, converting each action's priority. */
export function setPriorityScheme(a: Assessment, scheme: PriorityScheme): void {
  if (priorityScheme(a) === scheme) return;
  const conversion = PRIORITY_CONVERSION[scheme];
  for (const section of a.sections) {
    for (const item of section.items) {
      for (const finding of item.findings) {
        const converted = finding.action ? conversion[finding.action.priority] : undefined;
        if (converted) finding.action.priority = converted;
      }
    }
  }
  a.priorityScheme = scheme;
}

export function deleteFinding(a: Assessment, findingId: string): void {
  for (const section of a.sections) {
    for (const item of section.items) item.findings = item.findings.filter((f) => f.id !== findingId);
  }
  for (const photo of a.photos) {
    photo.findings = photo.findings.filter((id) => id !== findingId);
    photo.alsoIn = (photo.alsoIn || []).filter((place) => place !== `finding:${findingId}`);
  }
}

/* ---------- Photos ---------- */

export const isUnsorted = (photo: Photo): boolean => !photo.item && !photo.overview && photo.status !== "excluded";

/** Photos keep the order Cecil arranged them in; otherwise the order they were taken. */
const photoSortKey = (p: Photo): number => p.order ?? p.takenAt ?? p.addedAt ?? 0;
export const byPhotoOrder = (x: Photo, y: Photo): number => photoSortKey(x) - photoSortKey(y);

const alsoUsedIn = (photo: Photo, place: string): boolean => Boolean(photo.alsoIn?.includes(place));
export const photosOfItem = (a: Assessment, ref: string): Photo[] => a.photos.filter((p) => (p.item === ref && !p.findings.length) || alsoUsedIn(p, `item:${ref}`)).sort(byPhotoOrder);
export const photosOfFinding = (a: Assessment, findingId: string): Photo[] => a.photos.filter((p) => p.findings.includes(findingId) || alsoUsedIn(p, `finding:${findingId}`)).sort(byPhotoOrder);
export const overviewPhotos = (a: Assessment): Photo[] => a.photos.filter((p) => p.overview && !p.item && p.status !== "excluded").sort(byPhotoOrder);

/** The photos a photo is arranged with: its finding's, its item's, or the overview photos. */
export function photoGroup(a: Assessment, photo: Photo): { key: string; photos: Photo[] } | null {
  const firstFinding = photo.findings[0];
  if (firstFinding) return { key: `finding:${firstFinding}`, photos: photosOfFinding(a, firstFinding) };
  if (photo.item) return { key: `item:${photo.item}`, photos: photosOfItem(a, photo.item) };
  if (photo.overview) return { key: "overview", photos: overviewPhotos(a) };
  return null;
}

/** Puts a group's photos in the given order (ids not in the group are ignored). */
export function arrangePhotos(a: Assessment, orderedIds: string[]): void {
  const byId = new Map(a.photos.map((p) => [p.id, p]));
  orderedIds.forEach((id, i) => { const p = byId.get(id); if (p) p.order = i; });
}

/** Moves a photo one place earlier (-1) or later (+1) within its group. */
export function movePhoto(a: Assessment, photoId: string, step: number): boolean {
  const photo = a.photos.find((p) => p.id === photoId);
  const group = photo && photoGroup(a, photo);
  if (!group) return false;
  const ids = group.photos.map((p) => p.id);
  const from = ids.indexOf(photoId), to = from + step;
  if (to < 0 || to >= ids.length) return false;
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  arrangePhotos(a, ids);
  return true;
}
export const photoNumber = (a: Assessment, photo: Photo): number => a.photos.indexOf(photo) + 1;

export function photosByTimeTaken(a: Assessment): Photo[] {
  return a.photos.slice().sort((x, y) => (x.takenAt || 0) - (y.takenAt || 0) || (x.addedAt ?? 0) - (y.addedAt ?? 0));
}

/** "Roof · Finding 1.1.2" */
export function photoLocationLabel(a: Assessment, photo: Photo): string {
  if (photo.overview && !photo.item) return "Overview";
  const placed = findItem(a, photo.item);
  if (!placed) return "Unsorted";
  const first = photo.findings[0] ? findFinding(a, photo.findings[0]) : null;
  if (!first) return placed.item.label;
  const more = photo.findings.length > 1 ? ` +${photo.findings.length - 1}` : "";
  return `${placed.item.label} · Finding ${first.number}${more}`;
}

/**
 * Moves photos to a target: "none", "overview", "item:<ref>" or "finding:<id>".
 * A photo belongs to one item; it can support several findings on that item (FR-PHO-5).
 * Returns a label for the destination.
 */
export function assignPhotos(a: Assessment, photoIds: string[], target: string): string {
  const ids = new Set(photoIds);
  let label = "Unsorted";
  for (const photo of a.photos.filter((p) => ids.has(p.id))) {
    if (target === "none" || target === "overview") {
      Object.assign(photo, { item: null, findings: [], overview: target === "overview", alsoIn: [] });
      if (target === "overview") label = "Overview photos";
      continue;
    }
    photo.overview = false;
    let ref: string;
    if (target.startsWith("item:")) {
      ref = target.slice(5);
      label = findItem(a, ref)?.item.label || label;
    } else {
      const found = findFinding(a, target.slice(8));
      if (!found) continue;
      ref = found.ref;
      label = `Finding ${found.number}`;
    }
    if (photo.item !== ref) photo.findings = [];
    photo.item = ref;
    if (target.startsWith("finding:") && !photo.findings.includes(target.slice(8))) photo.findings.push(target.slice(8));
    photo.alsoIn = (photo.alsoIn || []).filter((place) => place !== target && place !== `item:${ref}`);
    if (photo.status === "excluded") photo.status = "report";
  }
  return label;
}

/* ---------- One photo in two places ("Also use here") ---------- */

/** Every place a photo appears, as targets: its own subsection or findings, then its extra places. */
export function photoPlaces(photo: Photo): string[] {
  const own = photo.findings.length ? photo.findings.map((id) => `finding:${id}`) : photo.item ? [`item:${photo.item}`] : [];
  return [...own, ...(photo.alsoIn || [])];
}

/** The subsection ref a place is in. */
export function placeRef(a: Assessment, place: string): string | null {
  if (place.startsWith("item:")) return place.slice(5);
  return findFinding(a, place.slice(8))?.ref || null;
}

/** "2.3 Roof" for a subsection, "2.3.1 Roof" for a finding in it. */
export function placeLabel(a: Assessment, place: string): string {
  if (place.startsWith("finding:")) {
    const found = findFinding(a, place.slice(8));
    return found ? `${found.number} ${found.item.label}` : "a deleted finding";
  }
  const placed = findItem(a, place.slice(5));
  return placed ? `${itemNumber(placed.sectionIndex, placed.section, placed.item)} ${placed.item.label}` : "a deleted subsection";
}

/** Is it in more than one place? */
export const isUsedTwice = (photo: Photo): boolean => Boolean(photo.alsoIn?.length);

/** Where else the photo is used, seen from `here` (a place, or a subsection ref): labels. */
export function otherPlaces(a: Assessment, photo: Photo, here: string | null = null): string[] {
  if (!isUsedTwice(photo)) return [];
  const hereRef = here && (here.includes(":") ? placeRef(a, here) : here);
  return photoPlaces(photo).filter((place) => place !== here && placeRef(a, place) !== hereRef).map((place) => placeLabel(a, place));
}

/** Is the photo already placed somewhere other than `target`? (Then "Also use here" makes sense.) */
export function placedElsewhere(a: Assessment, photo: Photo, target: string): boolean {
  if (!photo.item) return false;
  return !photoPlaces(photo).includes(target) && placeRef(a, target) !== photo.item;
}

/**
 * "Also use here": photos already placed keep their place and gain `target`;
 * photos not placed yet are simply placed there.
 */
export function alsoUsePhotos(a: Assessment, photoIds: string[], target: string): string {
  const ids = new Set(photoIds);
  let label = "";
  for (const photo of a.photos.filter((p) => ids.has(p.id))) {
    if (photoPlaces(photo).includes(target)) { label = placeLabel(a, target); continue; } // already there
    if (!placedElsewhere(a, photo, target)) { label = assignPhotos(a, [photo.id], target); continue; }
    photo.alsoIn = [...new Set([...(photo.alsoIn || []), target])];
    if (photo.status === "excluded") photo.status = "report";
    label = placeLabel(a, target);
  }
  return label;
}

/** Takes a photo out of one place. If that was its own place, the next extra place becomes its own. */
export function removePhotoFrom(a: Assessment, photoId: string, place: string): void {
  const photo = a.photos.find((p) => p.id === photoId);
  if (!photo) return;
  if (photo.alsoIn?.includes(place)) { photo.alsoIn = photo.alsoIn.filter((x) => x !== place); return; }
  if (place.startsWith("finding:") && photo.findings.length > 1) { photo.findings = photo.findings.filter((id) => id !== place.slice(8)); return; }
  const [next, ...rest] = photo.alsoIn || [];
  if (next) {
    assignPhotos(a, [photo.id], next);
    photo.alsoIn = rest;
  } else Object.assign(photo, { item: null, findings: [], overview: false });
}

/**
 * Deletes photos from the report: they leave their findings and subsections,
 * the cover, and any numbered area that pointed to them. The files are kept,
 * so an earlier version of the report can still show them.
 */
export function deletePhotos(a: Assessment, photoIds: string[]): void {
  const ids = new Set(photoIds);
  a.photos = a.photos.filter((p) => !ids.has(p.id));
  if (a.coverPhoto && ids.has(a.coverPhoto)) a.coverPhoto = null;
  for (const photo of a.photos) {
    for (const shape of photo.markup || []) if (shape.photoId && ids.has(shape.photoId)) shape.photoId = null;
  }
}

export function averagePhotoLocation(a: Assessment): { lat: string; lng: string; count: number } | null {
  const located = a.photos.filter((p) => p.lat != null && p.lng != null);
  if (!located.length) return null;
  const mean = (key: "lat" | "lng") => (located.reduce((sum, p) => sum + Number(p[key]), 0) / located.length).toFixed(6);
  return { lat: mean("lat"), lng: mean("lng"), count: located.length };
}
