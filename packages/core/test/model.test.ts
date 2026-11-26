/**
 * Ported functions that v1 had no test of its own for. v1's own tests are in
 * test/v1 (see packages/core/README.md).
 */
import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  actionNumbersById, actionSummary, addItem, arrangePhotos, averagePhotoLocation, countErrors, defaultSettings, findItem, formatDateLong,
  formatDateShort, itemNumber, listActions, listFindings, moveItemToSection, movePhoto, newAssessment, newFinding, photoGroup, photoLocationLabel,
  priorityCounts, runChecks, sectionRating, sectionsFromList, standardList, topPriority, type Assessment, type Finding, type Item, type Photo,
} from "@crb/core";

const item = (a: Assessment, ref: string): Item => findItem(a, ref)!.item;
const photo = (id: string, extra: Partial<Photo> = {}): Photo => ({ id, caption: "", status: "report", item: null, findings: [], alsoIn: [], markup: [], ...extra });
function finding(title: string, priority: string, extra: Partial<Finding> = {}): Finding {
  const f = newFinding();
  Object.assign(f, { description: `${title}.`, ...extra });
  Object.assign(f.action, { title, priority });
  return f;
}

describe("numbering", () => {
  test("subsections number 1.1, 1.2… skipping hidden ones, and findings 1.2.1…", () => {
    const a = newAssessment({ templateKey: "healthcare" });
    const env = a.sections[0]!;
    env.items[1]!.hidden = true;
    assert.equal(itemNumber(0, env, env.items[2]!), "1.2", "Openings moves up when Elevations is hidden");
    assert.equal(itemNumber(0, env, env.items[1]!), "1.–", "a hidden one has no number");
    env.items[2]!.findings.push(finding("Re-caulk windows", "M"), finding("Replace door closer", "L"));
    assert.deepEqual(listFindings(a).map((x) => x.number), ["1.2.1", "1.2.2"]);
    env.items[1]!.findings.push(finding("Hidden", "H"));
    assert.equal(listFindings(a).length, 2, "findings under a hidden subsection don't print");
  });

  test("actions are numbered A1, A2… in the list's order; observations aren't actions", () => {
    const a = newAssessment({ templateKey: "healthcare" });
    const low = finding("Low one", "L"), high = finding("High one", "H"), note = finding("Just a note", "", { observationOnly: true });
    item(a, "env.roof").findings.push(low, note, high);
    assert.deepEqual(actionNumbersById(a), { [high.id]: "A1", [low.id]: "A2" });
    assert.deepEqual(priorityCounts(a), { H: 1, M: 0, L: 1, REQ: 0, REC: 0, observations: 1 });
    assert.equal(actionSummary(a), "2 action items: 1 High, 1 Low");
    assert.equal(actionSummary(newAssessment({ templateKey: "healthcare" })), "No action items");
    assert.equal(actionSummary({ ...a, sections: [{ ...a.sections[0]!, items: [{ ...item(a, "env.roof"), findings: [high] }] }] }), "1 action item: 1 High");
  });

  test("by priority, ties go to the earlier due date, then report order", () => {
    const a = newAssessment({ templateKey: "healthcare" });
    const first = finding("First", "M"), second = finding("Second", "M"), third = finding("Third", "M");
    item(a, "env.roof").findings.push(first, second, third);
    const live = new Map([[third.id, { due: "2027-01-01" }], [second.id, { due: "2027-06-01" }]]);
    assert.deepEqual(listActions(a, live).map((x) => x.finding.action.title), ["Third", "Second", "First"]);
    assert.equal(topPriority(a), "H");
    assert.equal(topPriority({ priorityScheme: "rr" }), "REQ");
  });
});

describe("section ratings", () => {
  test("worked out as the average of rated, visible subsections", () => {
    const a = newAssessment({ templateKey: "healthcare" });
    const env = a.sections[0]!;
    const rate = (...ratings: Item["rating"][]) => env.items.forEach((i, k) => { i.rating = ratings[k] ?? ""; });
    rate("G", "G", "F");
    assert.equal(sectionRating(env), "G", "2.67 rounds to Good");
    rate("G", "F", "F");
    assert.equal(sectionRating(env), "F", "2.33 is Fair");
    rate("F", "P");
    assert.equal(sectionRating(env), "F", "1.5 is Fair");
    rate("P", "P", "F");
    assert.equal(sectionRating(env), "P", "1.33 is Poor");
    rate("NA", "NA");
    assert.equal(sectionRating(env), "", "N/A doesn't count");
    rate("P", "G");
    env.items[0]!.hidden = true;
    assert.equal(sectionRating(env), "G", "hidden subsections don't count");
    env.rating = "P";
    assert.equal(sectionRating(env), "P", "Cecil's own rating wins");
  });
});

describe("photos", () => {
  test("say where they are", () => {
    const a = newAssessment({ templateKey: "healthcare" });
    const f = finding("Repair roof", "H");
    item(a, "env.roof").findings.push(f, finding("Second", "L"));
    const second = item(a, "env.roof").findings[1]!;
    a.photos = [photo("p1", { item: "env.roof", findings: [f.id] }), photo("p2", { item: "env.roof", findings: [f.id, second.id] }),
      photo("p3", { item: "env.roof" }), photo("p4", { overview: true }), photo("p5")];
    assert.deepEqual(a.photos.map((p) => photoLocationLabel(a, p)), ["Roof · Finding 1.1.1", "Roof · Finding 1.1.1 +1", "Roof", "Overview", "Unsorted"]);
  });

  test("move within their group, keeping the order Cecil gave them", () => {
    const a = newAssessment({ templateKey: "healthcare" });
    a.photos = [photo("p1", { item: "env.roof", takenAt: 3 }), photo("p2", { item: "env.roof", takenAt: 1 }), photo("p3", { item: "env.roof", takenAt: 2 }), photo("x", { overview: true })];
    assert.deepEqual(photoGroup(a, a.photos[0]!)!.photos.map((p) => p.id), ["p2", "p3", "p1"], "in the order taken");
    assert.equal(movePhoto(a, "p2", -1), false, "already first");
    assert.equal(movePhoto(a, "p2", 1), true);
    assert.deepEqual(photoGroup(a, a.photos[0]!)!.photos.map((p) => p.id), ["p3", "p2", "p1"]);
    arrangePhotos(a, ["p1", "p2", "p3", "not-there"]);
    assert.deepEqual(photoGroup(a, a.photos[0]!)!.photos.map((p) => p.id), ["p1", "p2", "p3"]);
    assert.equal(photoGroup(a, photo("loose")), null);
    assert.equal(photoGroup(a, a.photos[3]!)!.key, "overview");
  });

  test("average their GPS for the property's location", () => {
    const a = newAssessment({ templateKey: "healthcare" });
    assert.equal(averagePhotoLocation(a), null);
    a.photos = [photo("p1", { lat: 33.4, lng: -86.8 }), photo("p2", { lat: 33.6, lng: -86.6 }), photo("p3")];
    assert.deepEqual(averagePhotoLocation(a), { lat: "33.500000", lng: "-86.700000", count: 2 });
  });
});

describe("sections", () => {
  test("a subsection moved to a section that already has its key gets a new one, and its photos follow", () => {
    const a = newAssessment({ templateKey: "healthcare" });
    const env = a.sections[0]!, site = a.sections.find((s) => s.key === "site")!;
    const roof = env.items[0]!;
    site.items.push({ ...roof, label: "Other roof", findings: [] });
    a.photos = [photo("p1", { item: "env.roof" })];
    moveItemToSection(a, env, roof, site);
    assert.notEqual(roof.key, "roof");
    assert.equal(a.photos[0]!.item, `site.${roof.key}`);
    assert.equal(findItem(a, a.photos[0]!.item)!.item, roof);
  });

  test("a report made from a standard list gets its own copy of it", () => {
    const list = standardList(defaultSettings(), "realestate");
    const sections = sectionsFromList(list);
    list[0]!.items[0]!.label = "Changed";
    assert.equal(sections[0]!.items[0]!.label, "Roof");
    const added = addItem(sections[0]!, "Canopy");
    assert.equal(added.custom, true);
  });
});

describe("the pre-issue checks", () => {
  const ready = () => {
    const a = newAssessment({ templateKey: "healthcare", propertyName: "Example Medical Office", clientName: "Example Owner LLC", preparedBy: "Cecil Ingram" });
    Object.assign(a, { address: "100 Example Ave", generalComments: "Overall fair.", spellCheckedAt: 2 });
    return a;
  };
  const texts = (a: Assessment, level: string) => runChecks(a, defaultSettings()).filter((r) => r.level === level).map((r) => r.text).join("\n");

  test("a report with its details filled in has no errors", () => {
    assert.equal(countErrors(runChecks(ready(), defaultSettings())), 0);
  });

  test("missing details block issuing; a missing address only warns", () => {
    const a = newAssessment({ templateKey: "healthcare" });
    assert.match(texts(a, "error"), /Add the client[\s\S]*Add the property name[\s\S]*Add who prepared the report/);
    assert.match(texts(a, "warn"), /no address/);
  });

  test("rated Poor with no material issues is an error; no material issues with findings is a warning", () => {
    const a = ready();
    Object.assign(item(a, "env.roof"), { rating: "P", noMaterialIssues: true });
    Object.assign(item(a, "env.openings"), { rating: "G", noMaterialIssues: true });
    item(a, "env.openings").findings.push(finding("Re-caulk", "L"));
    assert.match(texts(a, "error"), /Rated Poor but marked "no material issues": Roof/);
    assert.match(texts(a, "warn"), /Marked "no material issues" but has findings: Openings/);
  });

  test("a finding needs a description, and an action needs a title and priority", () => {
    const a = ready();
    item(a, "env.roof").rating = "F";
    item(a, "env.roof").findings.push(Object.assign(newFinding(), { description: "" }));
    assert.match(texts(a, "error"), /finding without a description: 1\.1\.1/);
    assert.match(texts(a, "error"), /need an action title and priority, or "observation only": 1\.1\.1/);
    assert.match(texts(a, "warn"), /finding without a photo: 1\.1\.1/);
  });

  test("photos: unsorted, uncaptioned, used twice", () => {
    const a = ready();
    const f = finding("Repair", "H");
    item(a, "int.ceiling").rating = "F";
    item(a, "int.ceiling").findings.push(f);
    a.photos = [photo("p1"), photo("p2", { item: "int.ceiling", findings: [f.id], caption: "Stains", alsoIn: ["item:env.roof"] }), photo("p3", { status: "excluded" })];
    assert.match(texts(a, "warn"), /1 photo not sorted/);
    assert.match(texts(a, "warn"), /1 photo in the report without a caption/);
    assert.match(texts(a, "warn"), /used in more than one place: Photo 2 \(3\.1\.1 Ceiling and 1\.1 Roof\)/);
  });

  test("spelling, compliance and copied details", () => {
    const a = ready();
    a.textEditedAt = 5;
    a.copiedFrom = { id: "old", date: "2025-11-03" };
    item(a, "reg.life").confirmed = true;
    assert.match(texts(a, "warn"), /Text changed since the last spelling check/);
    assert.match(texts(a, "info"), /compliance items? not confirmed by the tenant: Hospital Licensing/);
    assert.doesNotMatch(texts(a, "info"), /Life Safety/);
    assert.match(texts(a, "info"), /copied from the Nov 3, 2025 assessment/);
    assert.match(texts({ ...a, spellCheckedAt: undefined }, "warn"), /Spelling has not been checked/);
  });

  test("a disclaimer placeholder the app can't fill is an error", () => {
    const errors = runChecks(ready(), { disclaimer: "Prepared for {CLIENT} by {FIRM}." }).filter((r) => r.level === "error");
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.fixOn, "branding");
  });
});

test("US date formats", () => {
  assert.equal(formatDateLong("2026-11-03"), "Nov 3, 2026");
  assert.equal(formatDateShort("2026-11-03"), "11/03/2026");
  assert.equal(formatDateLong(""), "");
});
