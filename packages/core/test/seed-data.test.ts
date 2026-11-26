/**
 * Seed data (src/data/*.json): what a new copy starts with, loaded into the
 * database by later steps. Each file holds v1's values exactly (v1 at 03104a2).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  DEFAULT_DISCLAIMER, DEFAULT_PHRASES, DEFAULT_SENTENCES, PRIORITY_CONVERSION, PRIORITY_ORDER, PRIORITY_SCHEMES, TEMPLATE_SEEDS, TRACKER_COLUMNS,
  TRACKER_COLUMN_WIDTHS, buildSections, defaultSettings, newAssessment, runChecks, sectionSentence, standardSentence, newItem, type Item, type Section,
} from "@crb/core";

const DATA = new URL("../src/data/", import.meta.url);

test("every data file is plain JSON", () => {
  for (const name of ["templates", "priority-schemes", "phrases", "disclaimer", "tracker-columns"]) {
    assert.doesNotThrow(() => JSON.parse(readFileSync(new URL(`${name}.json`, DATA), "utf8")), name);
  }
});

test("two templates, Healthcare Master and Real Estate, version 2, six sections and 30 subsections each", () => {
  assert.deepEqual(TEMPLATE_SEEDS.map((t) => [t.key, t.name, t.version]), [["healthcare", "Healthcare Master", 2], ["realestate", "Real Estate", 2]]);
  for (const template of TEMPLATE_SEEDS) {
    assert.deepEqual(template.sections.map((s) => s.title), ["Building Envelope", "Structure", "Interior", "MEP Systems", "Regulatory Compliance", "Site"]);
    assert.equal(template.sections.flatMap((s) => s.items).length, 30);
    assert.deepEqual(template.sections.filter((s) => s.compliance).map((s) => s.key), ["reg"], "one compliance section");
    assert.equal(new Set(template.sections.map((s) => s.key)).size, 6, "section keys are unique");
    for (const section of template.sections) assert.equal(new Set(section.items.map((i) => i.key)).size, section.items.length, `${section.key}: subsection keys are unique`);
  }
});

test("the two templates differ only in five subsection names", () => {
  const [healthcare, realestate] = TEMPLATE_SEEDS;
  const labels = (t: typeof healthcare) => t!.sections.flatMap((s) => s.items.map((i) => [`${s.key}.${i.key}`, i.label]));
  const differ = labels(healthcare).filter(([ref, label], i) => {
    assert.equal(ref, labels(realestate)[i]![0], "same keys in the same order");
    return label !== labels(realestate)[i]![1];
  });
  assert.deepEqual(differ.map(([ref]) => ref), ["int.rooms", "int.dining", "int.special", "reg.lic", "reg.agency"]);
  assert.deepEqual(labels(realestate).filter(([ref]) => differ.some(([d]) => d === ref)).map(([, label]) => label),
    ["Rooms", "Dining / Food Prep", "Special Areas", "Building Licensing", "Regulatory Agencies"]);
});

test("a new report's sections come from the template's data", () => {
  for (const template of TEMPLATE_SEEDS) {
    const sections = buildSections(template.key);
    assert.deepEqual(sections.map((s) => ({ key: s.key, title: s.title, compliance: s.compliance, items: s.items.map((i) => ({ key: i.key, label: i.label })) })), template.sections);
    assert.ok(sections.every((s) => s.rating === "auto" && s.items.every((i) => i.rating === "" && i.findings.length === 0)));
  }
  assert.throws(() => buildSections("nope"), /Unknown template/);
});

test("the standard sentences are v1's, word for word", () => {
  const item = (rating: Item["rating"], extra: Partial<Item> = {}) => standardSentence({ ...newItem("x", "X"), rating, ...extra });
  const finding = newAssessment({ templateKey: "healthcare" }).sections[0]!.items[0]!.findings; // an empty list to fill
  finding.push({ id: "f", description: "", location: "", observationOnly: false, action: { title: "", recommendation: "", priority: "" } });
  assert.equal(item("G"), "Observed in good condition.");
  assert.equal(item("G", { findings: finding }), "Observed in good condition, with minor exceptions noted below.");
  assert.equal(item("G", { noMaterialIssues: true, findings: finding }), "Observed in good condition. No material issues were noted.");
  assert.equal(item("F"), "Observed in fair condition, with exceptions noted below.");
  assert.equal(item("F", { findings: finding }), "Observed in fair condition, with exceptions noted below.");
  assert.equal(item("F", { noMaterialIssues: true }), "Observed in fair condition, consistent with its age and use. No material issues were noted.");
  assert.equal(item("P"), "Observed in poor condition. Deficiencies noted below require attention.");
  assert.equal(item("P", { noMaterialIssues: true }), "Observed in poor condition. Deficiencies noted below require attention.");
  assert.equal(item("NA"), "Not applicable to this property.");
  assert.equal(item(""), "");
  const section = (rating: Section["rating"]) => sectionSentence({ key: "s", title: "S", compliance: false, rating, summary: "", items: [] });
  assert.deepEqual([section("G"), section("F"), section("P"), section("NA"), section("auto")], [
    "Observed in good condition, with minor exceptions noted below.",
    "Observed in fair condition, with exceptions noted below.",
    "Observed in poor condition. Deficiencies noted below require attention.",
    "", "",
  ]);
  assert.deepEqual(TEMPLATE_SEEDS[1]!.sentences, DEFAULT_SENTENCES, "both templates start with the same sentences");
});

test("a template's own sentences can replace the defaults", () => {
  const own = { ...DEFAULT_SENTENCES, item: { ...DEFAULT_SENTENCES.item, NA: { default: "Does not apply." } } };
  assert.equal(standardSentence({ ...newItem("x", "X"), rating: "NA" }, own), "Does not apply.");
});

test("the priority schemes are v1's", () => {
  assert.deepEqual(PRIORITY_SCHEMES, {
    hml: { name: "High / Medium / Low", labels: { H: "High", M: "Medium", L: "Low" } },
    rr: { name: "Required / Recommended", labels: { REQ: "Required", REC: "Recommended" } },
  });
  assert.deepEqual(PRIORITY_ORDER, { H: 0, REQ: 0, M: 1, REC: 1, L: 2 });
  assert.deepEqual(PRIORITY_CONVERSION, { rr: { H: "REQ", M: "REC", L: "REC" }, hml: { REQ: "H", REC: "M" } });
});

test("21 phrases with unique ids ph1 to ph21", () => {
  assert.deepEqual(DEFAULT_PHRASES.map((p) => p.id), Array.from({ length: 21 }, (_, i) => `ph${i + 1}`));
  assert.ok(DEFAULT_PHRASES.every((p) => p.title.trim() && p.text.trim()));
  assert.equal(DEFAULT_PHRASES[0]!.title, "TPO repairs");
  assert.equal(DEFAULT_PHRASES[20]!.title, "Landscaping");
});

test("the disclaimer uses only the placeholders the app fills in", () => {
  const disclaimer = JSON.parse(readFileSync(new URL("disclaimer.json", DATA), "utf8"));
  assert.equal(disclaimer.text, DEFAULT_DISCLAIMER);
  assert.deepEqual([...new Set(DEFAULT_DISCLAIMER.match(/\{[A-Z]+\}/g))].sort(), ["{CLIENT}", "{COMPANY}", "{PROPERTY}"]);
  assert.deepEqual(disclaimer.placeholders, ["COMPANY", "CLIENT", "PROPERTY"]);
  assert.match(DEFAULT_DISCLAIMER, /^This report was prepared by \{COMPANY\} for the exclusive use of \{CLIENT\}/);
  const errors = runChecks(newAssessment({ templateKey: "healthcare" }), defaultSettings()).map((r) => r.text).join("\n");
  assert.doesNotMatch(errors, /placeholder/);
});

test("the follow-up tracker has v1's eight columns", () => {
  assert.deepEqual(TRACKER_COLUMNS, ["Facility Name", "Assessment Date", "Action Item Description", "Q1", "Q2", "Q3", "Q4", "Facility Contact"]);
  assert.deepEqual(TRACKER_COLUMN_WIDTHS, [28, 16, 48, 18, 18, 18, 18, 36]);
});
