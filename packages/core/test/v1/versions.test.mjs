/**
 * Versions of a report. Ported from v1 tests/versions.test.mjs at 03104a2
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { newAssessment, newFinding } from "@crb/core";
import { needsDailyVersion, versionEntry, versionLabel, restoredReport } from "@crb/core";
import { todayIso } from "@crb/core";

test("one automatic version a day, and none on the day a report is made", () => {
  const a = newAssessment({ templateKey: "healthcare" });
  assert.equal(needsDailyVersion(a, todayIso()), false, "made today");
  a.versionDay = "2026-11-21";
  assert.equal(needsDailyVersion(a, "2026-11-23"), true, "first change on Monday");
});

test("list entries say what each version is", () => {
  const a = newAssessment({ templateKey: "healthcare" });
  a.revision = 2;
  assert.equal(versionLabel(versionEntry("v1", a, { reason: "daily" })), "Start of the day, before the first change");
  assert.equal(versionLabel(versionEntry("v2", { ...a, status: "issued" }, { reason: "issued" })), "Issued revision 2");
  assert.equal(versionLabel(versionEntry("v3", a, { reason: "manual", note: " Before Saturday's changes " })), "Before Saturday's changes");
});

test("restoring brings back the content but keeps the report's id, revision and status", () => {
  const saturday = newAssessment({ templateKey: "healthcare", propertyName: "The Arbors" });
  saturday.sections[0].items[0].rating = "F";
  const today = JSON.parse(JSON.stringify(saturday));
  Object.assign(today, { propertyName: "The Arbors (bad edit)", revision: 3, status: "draft", history: [{ rev: 1 }, { rev: 2 }], versionDay: "2026-11-23" });
  today.sections[0].items[0].rating = "P";
  today.sections[0].items[0].findings.push(newFinding());
  const old = { ...JSON.parse(JSON.stringify(saturday)), schema: 4, status: "issued", revision: 1 };
  const restored = restoredReport(today, old);
  assert.equal(restored.propertyName, "The Arbors");
  assert.equal(restored.sections[0].items[0].rating, "F");
  assert.equal(restored.sections[0].items[0].findings.length, 0);
  assert.deepEqual([restored.id, restored.revision, restored.status, restored.history.length, restored.versionDay], [today.id, 3, "draft", 2, "2026-11-23"]);
  assert.equal(restored.actionOrder, "priority", "an older snapshot is upgraded");
});
