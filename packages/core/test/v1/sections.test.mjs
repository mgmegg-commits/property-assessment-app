/**
 * Editable sections, standard lists and drafted values. Ported from v1 tests/sections.test.mjs at 03104a2
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { newAssessment, migrateAssessment, findItem, itemRef, newFinding, listFindings, SCHEMA_VERSION } from "@crb/core";
import {
  standardList, editableList, resetStandardList, isCustomList, addToStandardList, moveInList, newSection, addItem,
  deleteItem, deleteSection, mergeItem, moveFinding, itemContent,
} from "@crb/core";
import { defaultSettings } from "@crb/core";

const photo = (id, item = null, findings = []) => ({ id, item, findings, overview: false, status: "report", markup: [], caption: "" });
const item = (a, ref) => findItem(a, ref).item;

/* ---------- Standard lists ---------- */

test("the standard list starts as the template's, and new reports copy it", () => {
  const settings = defaultSettings();
  assert.equal(isCustomList(settings, "healthcare"), false);
  const list = editableList(settings, "healthcare");
  list[0].title = "Envelope";
  list[0].items[0].label = "Roofing";
  moveInList(list[0].items, 0, 1);
  list[2].items.splice(0, 1);
  list.push({ key: "sx", title: "Amenities", compliance: false, items: [{ key: "ipool", label: "Pool" }] });
  assert.equal(isCustomList(settings, "healthcare"), true);
  assert.equal(isCustomList(settings, "realestate"), false, "one list per template");

  const a = newAssessment({ templateKey: "healthcare", standardList: standardList(settings, "healthcare") });
  assert.equal(a.sections[0].title, "Envelope");
  assert.deepEqual(a.sections[0].items.slice(0, 2).map((i) => i.label), ["Elevations", "Roofing"]);
  assert.equal(a.sections.at(-1).items[0].key, "ipool");
  assert.ok(a.sections.find((s) => s.compliance), "Regulatory Compliance comes along");

  list[0].title = "Changed later";
  assert.equal(a.sections[0].title, "Envelope", "an existing report keeps its own copy");

  resetStandardList(settings, "healthcare");
  assert.equal(standardList(settings, "healthcare")[0].title, "Building Envelope", "reset to standard");
});

test("a kept suggested subsection can join the standard list", () => {
  const settings = defaultSettings();
  assert.equal(addToStandardList(settings, "realestate", "site", { key: "cdumpster", label: "Dumpster Enclosure" }), true);
  addToStandardList(settings, "realestate", "site", { key: "other", label: "dumpster enclosure" });
  assert.equal(standardList(settings, "realestate").find((s) => s.key === "site").items.filter((i) => /dumpster/i.test(i.label)).length, 1, "no duplicates");
  assert.equal(addToStandardList(settings, "realestate", "nope", { key: "x", label: "X" }), false);
});

/* ---------- Editing a report ---------- */

test("deleting a subsection with findings, notes or photos needs a place for them", () => {
  const a = newAssessment({ templateKey: "healthcare" });
  const env = a.sections[0];
  const roof = env.items[0];
  const finding = newFinding();
  roof.findings.push(finding);
  roof.notes = "Membrane worn.";
  item(a, "env.elevations").notes = "Brick in fair shape.";
  a.photos = [photo("p1", "env.roof", [finding.id]), photo("p2", "env.roof")];

  assert.throws(() => deleteItem(a, env, roof), /Choose where/);
  deleteItem(a, env, roof, findItem(a, "env.elevations"));
  const elevations = item(a, "env.elevations");
  assert.equal(findItem(a, "env.roof"), null);
  assert.deepEqual(elevations.findings.map((f) => f.id), [finding.id]);
  assert.equal(elevations.notes, "Brick in fair shape.\n\nMembrane worn.");
  assert.deepEqual(a.photos.map((p) => p.item), ["env.elevations", "env.elevations"], "photos follow");

  const empty = addItem(env, "Canopy");
  deleteItem(a, env, empty);
  assert.ok(!env.items.includes(empty), "empty subsections delete straight away");
});

test("deleting a section moves its subsections with content to another section", () => {
  const a = newAssessment({ templateKey: "healthcare" });
  const structure = a.sections.find((s) => s.key === "str");
  const site = a.sections.find((s) => s.key === "site");
  const horizontal = structure.items[0];
  horizontal.findings.push(newFinding());
  a.photos = [photo("p1", "str.horizontal")];

  assert.throws(() => deleteSection(a, a.sections.find((s) => s.compliance)), /can't be deleted/);
  assert.throws(() => deleteSection(a, structure), /Choose a section/);
  deleteSection(a, structure, site);
  assert.ok(!a.sections.includes(structure));
  assert.equal(site.items.at(-1), horizontal, "moved whole, keeping its name");
  assert.equal(a.photos[0].item, itemRef(site, horizontal));
  assert.equal(site.items.filter((i) => i.label.startsWith("Vertical")).length, 0, "empty subsections go");
});

test("subsections and sections can be added, renamed and reordered without breaking photo links", () => {
  const a = newAssessment({ templateKey: "realestate" });
  const section = newSection("Amenities");
  a.sections.push(section);
  const pool = addItem(section, "Pool");
  a.photos = [photo("p1", itemRef(section, pool))];
  pool.label = "Pool & Deck";
  moveInList(section.items, 0, 1);
  moveInList(a.sections[0].items, 0, 1);
  assert.equal(findItem(a, a.photos[0].item).item.label, "Pool & Deck");
  assert.equal(listFindings(a).length, 0);
});

test("a finding moves to another subsection with its photos", () => {
  const a = newAssessment({ templateKey: "healthcare" });
  const finding = newFinding();
  item(a, "env.roof").findings.push(finding);
  a.photos = [photo("p1", "env.roof", [finding.id]), photo("p2", "env.roof")];
  assert.equal(moveFinding(a, finding.id, "int.ceiling"), true);
  assert.deepEqual(item(a, "int.ceiling").findings, [finding]);
  assert.equal(item(a, "env.roof").findings.length, 0);
  assert.deepEqual([a.photos[0].item, a.photos[1].item], ["int.ceiling", "env.roof"], "only the finding's photos move");
  assert.equal(moveFinding(a, finding.id, "reg.life"), false, "not into the compliance section");
});

test("merging a subsection keeps the target's name and rating", () => {
  const a = newAssessment({ templateKey: "healthcare" });
  const env = a.sections[0];
  const deck = { ...addItem(env, "Deck"), suggested: true };
  env.items[env.items.length - 1] = deck;
  deck.findings.push(newFinding());
  item(a, "env.roof").rating = "F";
  mergeItem(a, { section: env, item: deck }, findItem(a, "env.roof"));
  assert.equal(item(a, "env.roof").rating, "F");
  assert.equal(item(a, "env.roof").findings.length, 1);
  assert.ok(!env.items.includes(deck));
  assert.deepEqual(itemContent(a, env, item(a, "env.roof")), { findings: 1, photos: 0, notes: false });
});

/* ---------- Drafting into the report's own list ---------- */

// Deferred to step 2.8 (drafting): these five need drafting/applyDraft.js, claudeDraft.js and training.js.
//   "the draft fills in the report's own subsections, ratings, notes and summaries"
//   "the draft never overwrites what Cecil set, and re-draft replaces only drafted values"
//   "Accept all clears a section's drafted marks"
//   "issuing is blocked until drafted values are accepted and suggestions resolved; not-discussed is fine"
//   "training examples keep the final ratings, notes and summaries"
// The checks and Accept all are covered meanwhile by test/drafted-marks.test.ts, with drafted values marked by hand.

/* ---------- Older reports ---------- */

test("older reports upgrade: a draft's added items become suggested subsections", async () => {
  const v1 = JSON.parse(await readFile(new URL("../../../../tests/fixtures/v1/v1-assessment.json", import.meta.url), "utf8"));
  v1.sections[0].items.push({ key: "cold", label: "Dumpster", addedByDraft: true, custom: true, hidden: false, rating: "", notes: "", issues: [] });
  const a = migrateAssessment(v1);
  assert.equal(a.schema, SCHEMA_VERSION);
  const old = a.sections[0].items.find((i) => i.key === "cold");
  assert.deepEqual([old.suggested, old.addedByDraft], [true, undefined]);
  assert.equal(a.sections[0].items[0].label, v1.sections[0].items[0].label, "its own list is kept as it was");
});

/* ---------- Merging findings ---------- */

test("merging findings keeps the first's text, appends the rest, and combines photos in order", async () => {
  const { mergeFindings } = await import("@crb/core");
  const { PRIORITY_ORDER } = await import("@crb/core");
  const a = newAssessment({ templateKey: "healthcare" });
  const roof = item(a, "env.roof");
  const make = (description, location, title, priority, due) => {
    const f = newFinding();
    Object.assign(f, { description, location });
    Object.assign(f.action, { title, recommendation: "TPO repairs should be per manufacturer specifications.", priority, due });
    roof.findings.push(f);
    return f;
  };
  const f1 = make("TPO repairs not per specs at the west wing.", "West wing", "TPO repairs not per specs", "M", "2027-03-01");
  const f2 = make("Same at Building C.", "Building C", "TPO repairs", "H", "2027-01-15");
  const f3 = make("Same at Building C.", "Building C", "TPO repairs", "L", "");
  a.photos = [photo("p3", "env.roof", [f2.id]), photo("p1", "env.roof", [f1.id]), photo("p4", "env.roof", [f3.id]), photo("p2", "env.roof", [f1.id])];
  a.photos.forEach((p, i) => { p.order = { p1: 0, p2: 1, p3: 0, p4: 0 }[p.id]; p.takenAt = i; });

  assert.throws(() => mergeFindings(a, [f1.id]), /two or more/);
  const kept = mergeFindings(a, [f3.id, f2.id, f1.id], PRIORITY_ORDER);
  assert.equal(kept, f1, "the first in report order is kept");
  assert.deepEqual(roof.findings, [f1]);
  assert.equal(kept.action.title, "TPO repairs not per specs");
  assert.equal(kept.description, "TPO repairs not per specs at the west wing.\n\nSame at Building C.", "others' text appended, duplicates once");
  assert.equal(kept.location, "West wing; Building C");
  assert.equal(kept.action.recommendation, "TPO repairs should be per manufacturer specifications.");
  assert.deepEqual([kept.action.priority, kept.action.due], ["H", "2027-01-15"], "most urgent priority, earliest due date");
  const ordered = a.photos.filter((p) => p.findings.includes(f1.id)).sort((x, y) => x.order - y.order).map((p) => p.id);
  assert.deepEqual(ordered, ["p1", "p2", "p3", "p4"], "every photo, the first finding's first");
});

test("findings in different subsections can't be merged", async () => {
  const { mergeFindings } = await import("@crb/core");
  const a = newAssessment({ templateKey: "healthcare" });
  const f1 = newFinding(), f2 = newFinding();
  item(a, "env.roof").findings.push(f1);
  item(a, "env.openings").findings.push(f2);
  assert.throws(() => mergeFindings(a, [f1.id, f2.id]), /same subsection/);
});

/* ---------- Delete outright; section sentence ---------- */

test("deleting a subsection outright drops its findings and sends its photos back to Unsorted", async () => {
  const { deleteItemToUnsorted } = await import("@crb/core");
  const { alsoUsePhotos } = await import("@crb/core");
  const a = newAssessment({ templateKey: "healthcare" });
  const env = a.sections[0];
  const roof = item(a, "env.roof");
  const finding = newFinding();
  roof.findings.push(finding);
  a.photos = [photo("p1", "env.roof", [finding.id]), photo("p2", "env.roof"), photo("p3", "int.ceiling")];
  a.photos.forEach((p) => { p.alsoIn = []; });
  alsoUsePhotos(a, ["p3"], "item:env.roof");
  alsoUsePhotos(a, ["p2"], "item:int.walls");
  deleteItemToUnsorted(a, env, roof);
  assert.equal(findItem(a, "env.roof"), null);
  assert.equal(listFindings(a).length, 0, "its findings went with it");
  const byId = Object.fromEntries(a.photos.map((p) => [p.id, p]));
  assert.deepEqual([byId.p1.item, byId.p1.findings], [null, []], "back to Unsorted");
  assert.deepEqual([byId.p2.item, byId.p2.alsoIn], ["int.walls", []], "a photo also used elsewhere stays there");
  assert.deepEqual([byId.p3.item, byId.p3.alsoIn], ["int.ceiling", []], "and loses only the deleted place");
});

test("a section's sentence follows its rating, set or worked out", async () => {
  const { sectionSentence } = await import("@crb/core");
  const a = newAssessment({ templateKey: "healthcare" });
  const env = a.sections[0];
  assert.equal(sectionSentence(env), "", "nothing rated yet");
  env.items[0].rating = "F";
  assert.equal(sectionSentence(env), "Observed in fair condition, with exceptions noted below.", "worked out from subsections");
  env.rating = "P";
  assert.match(sectionSentence(env), /poor condition/);
});
