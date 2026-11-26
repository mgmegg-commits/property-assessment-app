/**
 * The assessment document and the queries the views and report share.
 * Functions here take the assessment as their first argument and never touch
 * the DOM or storage, so they read the same everywhere they are used.
 *
 * Shape (schema 4):
 *   assessment.sections[]                     - the report's own list, copied from the standard list
 *                                               when it was made; `key` never changes (model/sections.js)
 *   assessment.sections[].items[]             - subsections: `key`, `label`, `rating`, `notes`, `hidden`,
 *                                               `suggested` (added by a draft), `drafted` (values not yet accepted)
 *   assessment.sections[].items[].findings[]  - each finding has an `action` (title, recommendation,
 *                                               priority, assignee, due) unless `observationOnly`
 *   assessment.photos[]                       - `item` (ref "sectionKey.itemKey"), `findings` (ids), `markup` (shapes),
 *                                               `alsoIn` (extra places: "item:<ref>" / "finding:<id>", see "Also use here"),
 *                                               `overview` (a general property photo), `order` (position within its group)
 *   assessment.walkthrough                    - the recorded walk-through, when there is one (server mode)
 *   finding.sources                           - transcript remarks a drafted finding came from
 */
import { TEMPLATES, buildSections, PRIORITY_ORDER, PRIORITY_CONVERSION, priorityOptions, priorityScheme } from "./templates.js";
import { sectionsFromList } from "./sections.js";
import { uid, deepClone, SESSION_ID } from "../util/ids.js";
import { todayIso } from "../util/format.js";

export const SCHEMA_VERSION = 6;

/** `standardList` is the list new reports start from (model/sections.js standardList); the template's by default. */
export function newAssessment({ templateKey, date, propertyName, clientName, preparedBy, copyFrom, standardList, priorityScheme: scheme = "hml" }) {
  const template = TEMPLATES[templateKey];
  const now = Date.now();
  const assessment = {
    id: uid("a"), kind: "assessment", schema: SCHEMA_VERSION,
    templateKey, templateName: template.name, templateVersion: template.version,
    propertyName: propertyName || "", clientName: clientName || "",
    priorityScheme: scheme, actionOrder: "priority", versionDay: todayIso(), useType: "", operator: "", facilityContact: "", address: "", lat: "", lng: "",
    date: date || todayIso(), time: "", preparedBy: preparedBy || "", weather: "",
    personnel: [], parcels: [], generalComments: "",
    sections: standardList ? sectionsFromList(standardList) : buildSections(templateKey), photos: [], coverPhoto: null,
    status: "draft", revision: 0, history: [],
    createdAt: now, updatedAt: now, _by: SESSION_ID,
  };
  if (copyFrom) copyPropertyDetails(assessment, copyFrom);
  return assessment;
}

/** Reuse what doesn't change between visits (FR-CAP-2): property facts, people, parcels, item names. */
function copyPropertyDetails(target, source) {
  target.clientName ||= source.clientName || "";
  target.propertyName ||= source.propertyName || "";
  for (const key of ["useType", "operator", "facilityContact", "address", "lat", "lng"]) target[key] = source[key] || "";
  target.personnel = deepClone(source.personnel || []);
  target.parcels = deepClone(source.parcels || []);
  target.copiedFrom = { id: source.id, date: source.date };

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
        const kept = deepClone(oldItem);
        for (const mark of ["addedByDraft", "suggested", "drafted"]) delete kept[mark]; // kept on that report, so it's Cecil's now
        section.items.push({ ...kept, rating: "", noMaterialIssues: false, notes: "", confirmed: false, findings: [] });
      }
    }
  }
}

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

/** A new finding. Its action has no assignee or due date: the client or tenant decides those. */
export function newFinding({ assignee = "" } = {}) {
  return {
    id: uid("f"), description: "", location: "", observationOnly: false,
    action: { title: "", recommendation: "", priority: "", assignee, due: "" },
  };
}

/* ---------- Items ---------- */

export const itemRef = (section, item) => `${section.key}.${item.key}`;
export const visibleItems = (section) => section.items.filter((item) => !item.hidden);

/** "1.3" - numbering skips hidden items so the report reads 1.1, 1.2, 1.3. */
export function itemNumber(sectionIndex, section, item) {
  const position = visibleItems(section).indexOf(item);
  return position < 0 ? `${sectionIndex + 1}.–` : `${sectionIndex + 1}.${position + 1}`;
}

export function findItem(a, ref) {
  if (!ref) return null;
  const [sectionKey, itemKey] = ref.split(".");
  const sectionIndex = a.sections.findIndex((s) => s.key === sectionKey);
  const section = a.sections[sectionIndex];
  const item = section?.items.find((i) => i.key === itemKey);
  return item ? { section, sectionIndex, item, ref } : null;
}

/* ---------- Findings and actions ---------- */

/** Every finding on a visible item, with its number ("1.3.2") and where it sits. */
export function listFindings(a) {
  const out = [];
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

export const findFinding = (a, id) => listFindings(a).find((x) => x.finding.id === id) || null;

const compareDue = (x, y) => (x.finding.action.due || "9999").localeCompare(y.finding.action.due || "9999");
const comparePriority = (x, y) => (PRIORITY_ORDER[x.finding.action.priority] ?? 3) - (PRIORITY_ORDER[y.finding.action.priority] ?? 3);

/** How the action list is ordered, chosen on the Report tab and saved with the report. */
export const ACTION_ORDERS = { report: "Report order", priority: "Priority", due: "Due date" };
const ORDER_COMPARE = {
  report: (x, y) => x.order - y.order,
  priority: (x, y) => comparePriority(x, y) || compareDue(x, y) || x.order - y.order,
  due: (x, y) => compareDue(x, y) || comparePriority(x, y) || x.order - y.order, // no due date (TBD) last
};

/**
 * Actions in the report's chosen order (report order, priority, or due date),
 * numbered A1, A2… in that order (FR-OUT-2). The screen, PDF and exports all use it.
 */
export function listActions(a) {
  const actions = listFindings(a)
    .filter((x) => !x.finding.observationOnly)
    .map((x, order) => ({ ...x, order }));
  actions.sort(ORDER_COMPARE[a.actionOrder] || ORDER_COMPARE.priority);
  actions.forEach((x, i) => { x.actionNumber = `A${i + 1}`; });
  return actions;
}

export function actionNumbersById(a) {
  return Object.fromEntries(listActions(a).map((x) => [x.finding.id, x.actionNumber]));
}

/** Action counts by priority code (both schemes), plus observation-only findings. */
export function priorityCounts(a) {
  const counts = { H: 0, M: 0, L: 0, REQ: 0, REC: 0, observations: 0 };
  for (const { finding } of listFindings(a)) {
    if (finding.observationOnly) counts.observations++;
    else if (finding.action.priority in counts) counts[finding.action.priority]++;
  }
  return counts;
}

/** "33 action items: 25 Required, 8 Recommended" in the report's scheme. */
export function actionSummary(a) {
  const counts = priorityCounts(a);
  const total = Object.keys(priorityOptions(a)).reduce((n, code) => n + counts[code], 0);
  if (!total) return "No action items";
  const parts = Object.entries(priorityOptions(a)).filter(([code]) => counts[code]).map(([code, label]) => `${counts[code]} ${label}`);
  return `${total} action item${total === 1 ? "" : "s"}: ${parts.join(", ")}`;
}

/** Switches a report to another priority scheme, converting each action's priority. */
export function setPriorityScheme(a, scheme) {
  if (priorityScheme(a) === scheme) return;
  const conversion = PRIORITY_CONVERSION[scheme];
  for (const section of a.sections) {
    for (const item of section.items) {
      for (const finding of item.findings) {
        if (finding.action?.priority in conversion) finding.action.priority = conversion[finding.action.priority];
      }
    }
  }
  a.priorityScheme = scheme;
}

export function deleteFinding(a, findingId) {
  for (const section of a.sections) {
    for (const item of section.items) item.findings = item.findings.filter((f) => f.id !== findingId);
  }
  for (const photo of a.photos) {
    photo.findings = photo.findings.filter((id) => id !== findingId);
    photo.alsoIn = (photo.alsoIn || []).filter((place) => place !== `finding:${findingId}`);
  }
}

/* ---------- Photos ---------- */

export const isUnsorted = (photo) => !photo.item && !photo.overview && photo.status !== "excluded";

/** Photos keep the order Cecil arranged them in; otherwise the order they were taken. */
const photoSortKey = (p) => p.order ?? p.takenAt ?? p.addedAt ?? 0;
export const byPhotoOrder = (x, y) => photoSortKey(x) - photoSortKey(y);

const alsoUsedIn = (photo, place) => Boolean(photo.alsoIn?.includes(place));
export const photosOfItem = (a, ref) => a.photos.filter((p) => (p.item === ref && !p.findings.length) || alsoUsedIn(p, `item:${ref}`)).sort(byPhotoOrder);
export const photosOfFinding = (a, findingId) => a.photos.filter((p) => p.findings.includes(findingId) || alsoUsedIn(p, `finding:${findingId}`)).sort(byPhotoOrder);
export const overviewPhotos = (a) => a.photos.filter((p) => p.overview && !p.item && p.status !== "excluded").sort(byPhotoOrder);

/** The photos a photo is arranged with: its finding's, its item's, or the overview photos. */
export function photoGroup(a, photo) {
  if (photo.findings.length) return { key: `finding:${photo.findings[0]}`, photos: photosOfFinding(a, photo.findings[0]) };
  if (photo.item) return { key: `item:${photo.item}`, photos: photosOfItem(a, photo.item) };
  if (photo.overview) return { key: "overview", photos: overviewPhotos(a) };
  return null;
}

/** Puts a group's photos in the given order (ids not in the group are ignored). */
export function arrangePhotos(a, orderedIds) {
  const byId = new Map(a.photos.map((p) => [p.id, p]));
  orderedIds.forEach((id, i) => { const p = byId.get(id); if (p) p.order = i; });
}

/** Moves a photo one place earlier (-1) or later (+1) within its group. */
export function movePhoto(a, photoId, step) {
  const photo = a.photos.find((p) => p.id === photoId);
  const group = photo && photoGroup(a, photo);
  if (!group) return false;
  const ids = group.photos.map((p) => p.id);
  const from = ids.indexOf(photoId), to = from + step;
  if (to < 0 || to >= ids.length) return false;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  arrangePhotos(a, ids);
  return true;
}
export const photoNumber = (a, photo) => a.photos.indexOf(photo) + 1;

export function photosByTimeTaken(a) {
  return a.photos.slice().sort((x, y) => (x.takenAt || 0) - (y.takenAt || 0) || x.addedAt - y.addedAt);
}

/** "Roof · Finding 1.1.2" */
export function photoLocationLabel(a, photo) {
  if (photo.overview && !photo.item) return "Overview";
  const placed = findItem(a, photo.item);
  if (!placed) return "Unsorted";
  const first = photo.findings.length ? findFinding(a, photo.findings[0]) : null;
  if (!first) return placed.item.label;
  const more = photo.findings.length > 1 ? ` +${photo.findings.length - 1}` : "";
  return `${placed.item.label} · Finding ${first.number}${more}`;
}

/**
 * Moves photos to a target: "none", "overview", "item:<ref>" or "finding:<id>".
 * A photo belongs to one item; it can support several findings on that item (FR-PHO-5).
 * Returns a label for the destination.
 */
export function assignPhotos(a, photoIds, target) {
  const ids = new Set(photoIds);
  let label = "Unsorted";
  for (const photo of a.photos.filter((p) => ids.has(p.id))) {
    if (target === "none" || target === "overview") {
      Object.assign(photo, { item: null, findings: [], overview: target === "overview", alsoIn: [] });
      if (target === "overview") label = "Overview photos";
      continue;
    }
    photo.overview = false;
    let ref;
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
export function photoPlaces(photo) {
  const own = photo.findings.length ? photo.findings.map((id) => `finding:${id}`) : photo.item ? [`item:${photo.item}`] : [];
  return [...own, ...(photo.alsoIn || [])];
}

/** The subsection ref a place is in. */
export function placeRef(a, place) {
  if (place.startsWith("item:")) return place.slice(5);
  return findFinding(a, place.slice(8))?.ref || null;
}

/** "2.3 Roof" for a subsection, "2.3.1 Roof" for a finding in it. */
export function placeLabel(a, place) {
  if (place.startsWith("finding:")) {
    const found = findFinding(a, place.slice(8));
    return found ? `${found.number} ${found.item.label}` : "a deleted finding";
  }
  const placed = findItem(a, place.slice(5));
  return placed ? `${itemNumber(placed.sectionIndex, placed.section, placed.item)} ${placed.item.label}` : "a deleted subsection";
}

/** Is it in more than one place? */
export const isUsedTwice = (photo) => Boolean(photo.alsoIn?.length);

/** Where else the photo is used, seen from `here` (a place, or a subsection ref): labels. */
export function otherPlaces(a, photo, here = null) {
  if (!isUsedTwice(photo)) return [];
  const hereRef = here && (here.includes(":") ? placeRef(a, here) : here);
  return photoPlaces(photo).filter((place) => place !== here && placeRef(a, place) !== hereRef).map((place) => placeLabel(a, place));
}

/** Is the photo already placed somewhere other than `target`? (Then "Also use here" makes sense.) */
export function placedElsewhere(a, photo, target) {
  if (!photo.item) return false;
  return !photoPlaces(photo).includes(target) && placeRef(a, target) !== photo.item;
}

/**
 * "Also use here": photos already placed keep their place and gain `target`;
 * photos not placed yet are simply placed there.
 */
export function alsoUsePhotos(a, photoIds, target) {
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
export function removePhotoFrom(a, photoId, place) {
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
export function deletePhotos(a, photoIds) {
  const ids = new Set(photoIds);
  a.photos = a.photos.filter((p) => !ids.has(p.id));
  if (ids.has(a.coverPhoto)) a.coverPhoto = null;
  for (const photo of a.photos) {
    for (const shape of photo.markup || []) if (ids.has(shape.photoId)) shape.photoId = null;
  }
}

export function averagePhotoLocation(a) {
  const located = a.photos.filter((p) => p.lat != null && p.lng != null);
  if (!located.length) return null;
  const mean = (key) => (located.reduce((sum, p) => sum + Number(p[key]), 0) / located.length).toFixed(6);
  return { lat: mean("lat"), lng: mean("lng"), count: located.length };
}
