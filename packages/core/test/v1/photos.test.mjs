/**
 * Photos in the report: states, deleting, and one photo in two places.
 *   Ported from v1 tests/photos.test.mjs at 03104a2
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { newAssessment, newFinding, deletePhotos, findItem } from "@crb/core";
import { PHOTO_STATUSES, PHOTO_STATUS_HINTS } from "@crb/core";

export const photo = (id, item = null, findings = []) => ({ id, item, findings, overview: false, status: "report", markup: [], caption: "", alsoIn: [] });
const itemOf = (a, ref) => findItem(a, ref).item;

test("photo states read In report / Appendix only / Exclude, each with a hint", () => {
  assert.deepEqual(Object.values(PHOTO_STATUSES), ["In report", "Appendix only", "Exclude"]);
  assert.deepEqual(Object.keys(PHOTO_STATUS_HINTS), Object.keys(PHOTO_STATUSES));
});

test("deleting photos removes them from findings, the cover and numbered areas", () => {
  const a = newAssessment({ templateKey: "healthcare" });
  const finding = newFinding();
  itemOf(a, "env.roof").findings.push(finding);
  a.photos = [photo("p1", "env.roof", [finding.id]), photo("p2", "env.roof"), photo("wide")];
  a.photos[2].markup = [{ type: "area", color: "#E8372C", x1: 0, y1: 0, x2: 0.5, y2: 0.5, photoId: "p1" }];
  a.coverPhoto = "p1";
  deletePhotos(a, ["p1"]);
  assert.deepEqual(a.photos.map((p) => p.id), ["p2", "wide"]);
  assert.equal(a.coverPhoto, null);
  assert.equal(a.photos[1].markup[0].photoId, null, "the area no longer points at it");
});

/* ---------- One photo in two places ---------- */
import { alsoUsePhotos, removePhotoFrom, photosOfFinding, photosOfItem, otherPlaces, isUsedTwice, assignPhotos, deleteFinding, migrateAssessment, SCHEMA_VERSION } from "@crb/core";
import { mergeFindings, deleteItem } from "@crb/core";

function twoPlaces() {
  const a = newAssessment({ templateKey: "healthcare" });
  const sealant = newFinding(), damage = newFinding();
  itemOf(a, "env.sealants").findings.push(sealant);
  itemOf(a, "int.ceiling").findings.push(damage);
  a.photos = [photo("p1", "env.sealants", [sealant.id])];
  return { a, sealant, damage };
}

test("Also use here keeps the photo where it was and adds it to the second place", () => {
  const { a, sealant, damage } = twoPlaces();
  alsoUsePhotos(a, ["p1"], `finding:${damage.id}`);
  assert.deepEqual(photosOfFinding(a, sealant.id).map((p) => p.id), ["p1"]);
  assert.deepEqual(photosOfFinding(a, damage.id).map((p) => p.id), ["p1"]);
  assert.equal(isUsedTwice(a.photos[0]), true);
  assert.deepEqual(otherPlaces(a, a.photos[0], `finding:${sealant.id}`), [`3.1.1 Ceiling`]);
  assert.deepEqual(otherPlaces(a, a.photos[0], `finding:${damage.id}`), [`1.4.1 Sealant and Flashings`]);
  alsoUsePhotos(a, ["p1"], `finding:${damage.id}`);
  assert.equal(a.photos[0].alsoIn.length, 1, "not added twice");
});

test("moving is still the default", () => {
  const { a, sealant, damage } = twoPlaces();
  assignPhotos(a, ["p1"], `finding:${damage.id}`);
  assert.deepEqual(photosOfFinding(a, sealant.id), []);
  assert.equal(isUsedTwice(a.photos[0]), false);
});

test("removing it from one place leaves the other, either way round", () => {
  let { a, sealant, damage } = twoPlaces();
  alsoUsePhotos(a, ["p1"], `finding:${damage.id}`);
  removePhotoFrom(a, "p1", `finding:${damage.id}`);
  assert.deepEqual([photosOfFinding(a, sealant.id).length, photosOfFinding(a, damage.id).length], [1, 0]);

  ({ a, sealant, damage } = twoPlaces());
  alsoUsePhotos(a, ["p1"], `finding:${damage.id}`);
  removePhotoFrom(a, "p1", `finding:${sealant.id}`);
  assert.deepEqual([photosOfFinding(a, sealant.id).length, photosOfFinding(a, damage.id).length], [0, 1], "the second place becomes its own");
  assert.equal(a.photos[0].item, "int.ceiling");
  assert.equal(isUsedTwice(a.photos[0]), false);
});

test("extra places follow deleted, merged and moved findings and subsections", () => {
  const { a, damage } = twoPlaces();
  alsoUsePhotos(a, ["p1"], "item:int.flooring");
  alsoUsePhotos(a, ["p1"], `finding:${damage.id}`);
  const other = newFinding();
  itemOf(a, "int.ceiling").findings.push(other);
  mergeFindings(a, [damage.id, other.id]);
  assert.ok(a.photos[0].alsoIn.includes(`finding:${damage.id}`));
  deleteFinding(a, damage.id);
  assert.deepEqual(a.photos[0].alsoIn, ["item:int.flooring"]);
  const interior = a.sections.find((s) => s.key === "int");
  deleteItem(a, interior, itemOf(a, "int.flooring"), findItem(a, "int.walls"));
  assert.deepEqual(a.photos[0].alsoIn, ["item:int.walls"], "repointed when its subsection is merged away");
  assert.deepEqual(photosOfItem(a, "int.walls").map((p) => p.id), ["p1"]);
});

test("schema 6: older photos get an empty list of extra places", () => {
  const a = migrateAssessment({ schema: 5, sections: [], photos: [{ id: "p", item: null, findings: [] }] });
  assert.equal(SCHEMA_VERSION, 7); // Changed in v2: schema 7 is v2's first step (v1: 6)
  assert.deepEqual(a.photos[0].alsoIn, []);
});
