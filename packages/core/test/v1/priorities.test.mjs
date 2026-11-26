/**
 * Priority labels per client. Ported from v1 tests/priorities.test.mjs at 03104a2
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { newAssessment, newFinding, listActions, actionSummary, setPriorityScheme, migrateAssessment } from "@crb/core";
import { priorityOptions, draftedPriority, priorityLabel } from "@crb/core";
import { runChecks } from "@crb/core";
import { defaultSettings } from "@crb/core";

function report(scheme, priorities) {
  const a = newAssessment({ templateKey: "healthcare", propertyName: "X", priorityScheme: scheme });
  priorities.forEach((priority, i) => {
    const f = newFinding();
    Object.assign(f, { description: `Finding ${i}` });
    Object.assign(f.action, { title: `Action ${i}`, priority });
    a.sections[0].items[0].findings.push(f);
  });
  return a;
}

test("a report on Required / Recommended counts, sorts and labels in that scheme", () => {
  const a = report("rr", ["REC", "REQ", "REQ"]);
  assert.deepEqual(priorityOptions(a), { REQ: "Required", REC: "Recommended" });
  assert.equal(actionSummary(a), "3 action items: 2 Required, 1 Recommended");
  assert.deepEqual(listActions(a).map((x) => priorityLabel(x.finding.action.priority)), ["Required", "Required", "Recommended"], "Required first");
  assert.equal(draftedPriority(a, "High"), "REQ");
  assert.equal(draftedPriority(a, "Low"), "REC");
});

test("switching a report's scheme converts its actions, and back", () => {
  const a = report("hml", ["H", "M", "L"]);
  setPriorityScheme(a, "rr");
  assert.deepEqual(listActions(a).map((x) => x.finding.action.priority), ["REQ", "REC", "REC"]);
  setPriorityScheme(a, "hml");
  assert.deepEqual(listActions(a).map((x) => x.finding.action.priority), ["H", "M", "M"]);
  assert.equal(actionSummary(a), "3 action items: 1 High, 2 Medium");
});

test("the checks flag a priority from the other scheme", () => {
  const a = report("rr", ["H"]);
  const errors = runChecks(a, defaultSettings()).filter((r) => r.level === "error").map((r) => r.text).join("\n");
  assert.match(errors, /priority that isn't Required \/ Recommended/);
});

test("existing reports keep High / Medium / Low", () => {
  const a = migrateAssessment({ schema: 4, sections: [], photos: [] });
  assert.equal(a.priorityScheme, "hml");
});
