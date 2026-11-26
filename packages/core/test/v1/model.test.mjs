/**
 * The assessment document. Ported from v1 tests/model.test.mjs at 03104a2
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { newAssessment } from "@crb/core";
import { buildSections } from "@crb/core";

const labels = (a) => a.sections.map((s) => s.items.map((i) => i.label));
const v1 = JSON.parse(await readFile(new URL("../../../../tests/fixtures/v1/v1-assessment.json", import.meta.url), "utf8"));

test("copying from a report on an older list keeps the new list as it is", () => {
  const blank = newAssessment({ templateKey: "healthcare" });
  const copied = newAssessment({ templateKey: "healthcare", propertyName: "Again", copyFrom: v1 });
  assert.deepEqual(labels(copied), labels(blank), "no old subsections, no old names");
  assert.equal(copied.address, v1.address || "", "property details still copied");
});

test("copying from a report on the same list keeps its names, hidden items and added subsections", () => {
  const earlier = newAssessment({ templateKey: "realestate" });
  earlier.sections[0].items[0].label = "Main Roof";
  earlier.sections[0].items[1].hidden = true;
  earlier.sections[5].items.push({ ...earlier.sections[5].items[0], key: "cpool", label: "Pool", custom: true, addedByDraft: true, rating: "P", findings: [{ id: "f1" }] });
  const copied = newAssessment({ templateKey: "realestate", copyFrom: earlier });
  assert.equal(copied.sections[0].items[0].label, "Main Roof");
  assert.equal(copied.sections[0].items[1].hidden, true);
  const pool = copied.sections[5].items.find((i) => i.key === "cpool");
  assert.deepEqual([pool.label, pool.rating, pool.findings.length, pool.addedByDraft], ["Pool", "", 0, undefined]);
});

test("each template uses its own subsection names", () => {
  const rooms = (key) => buildSections(key).find((s) => s.key === "int").items.find((i) => i.key === "rooms").label;
  assert.deepEqual([rooms("healthcare"), rooms("realestate")], ["Patient Rooms", "Rooms"]);
});
