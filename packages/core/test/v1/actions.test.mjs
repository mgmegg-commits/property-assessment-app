/**
 * Action items: no assignee or due date by default (TBD), and the list order.
 *   Ported from v1 tests/actions.test.mjs at 03104a2
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { newAssessment, newFinding } from "@crb/core";
import { runChecks } from "@crb/core";
import { defaultSettings } from "@crb/core";

export function reportWithActions() {
  const a = newAssessment({ templateKey: "healthcare", propertyName: "The Arbors", date: "2026-11-03" });
  const add = (si, title, priority, due = "") => {
    const f = newFinding();
    Object.assign(f, { description: `${title}.` });
    Object.assign(f.action, { title, priority, due });
    a.sections[si].items[0].findings.push(f);
    return f;
  };
  add(0, "Roof ponding", "M", "2027-02-01");
  add(2, "Ceiling stains", "L");
  add(5, "Asphalt seal coating", "H", "2027-05-01");
  return a;
}

test("a new finding has no assignee or due date", () => {
  const f = newFinding();
  assert.deepEqual([f.action.assignee, f.action.due], ["", ""]);
  assert.equal("defaultAssignee" in defaultSettings(), false, "the default-assignee setting is gone");
});

test("Review doesn't ask for an assignee or due date", () => {
  const text = runChecks(reportWithActions(), defaultSettings()).map((r) => r.text).join("\n");
  assert.doesNotMatch(text, /assignee|due date/i);
});

// Deferred to step 2.9 (exports): "the CSV shows TBD for an empty assignee or due date" (needs export/files.js actionsCsv).

/* ---------- Action list order ---------- */
import { listActions, migrateAssessment, ACTION_ORDERS } from "@crb/core";

const titles = (a) => listActions(a).map((x) => x.finding.action.title);

test("the action list follows the report's chosen order, and so do the numbers", () => {
  const a = reportWithActions();
  assert.deepEqual(Object.keys(ACTION_ORDERS), ["report", "priority", "due"]);
  assert.equal(a.actionOrder, "priority", "new reports start sorted by priority");
  assert.deepEqual(titles(a), ["Asphalt seal coating", "Roof ponding", "Ceiling stains"]);
  a.actionOrder = "report";
  assert.deepEqual(titles(a), ["Roof ponding", "Ceiling stains", "Asphalt seal coating"]);
  a.actionOrder = "due";
  assert.deepEqual(titles(a), ["Roof ponding", "Asphalt seal coating", "Ceiling stains"], "no due date (TBD) last");
  assert.equal(listActions(a)[0].actionNumber, "A1");
});

// Deferred to step 2.9 (exports): "the Excel tracker and the CSV follow the same order" (needs export/tracker.js and export/files.js).

test("earlier reports keep sorting by priority", () => {
  assert.equal(migrateAssessment({ schema: 5, sections: [], photos: [] }).actionOrder, "priority");
});
