/**
 * Document migrations: every older report opens (CLAUDE.md, "Old data always opens").
 *
 * One fixture per schema:
 *   1  tests/fixtures/v1/v1-assessment.json            saved by v1's first version (real)
 *   1  tests/fixtures/v1/documents/assessment-schema-1.json  a full report in schema 1's shape
 *   2-6 tests/fixtures/v1/documents/assessment-schema-N.json
 *   7  tests/fixtures/v2/assessment-schema-7.json      made and issued in v2
 * (tests/fixtures/README.md says how each was made.)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "vitest";
import {
  ASSESSMENT_MIGRATIONS, SCHEMA_VERSION, TRANSCRIPT_SCHEMA_VERSION, actionSummary, documentSchema, findItem, listActions, listFindings,
  migrateAssessment, migrateTranscript, newAssessment, newFinding, photosOfFinding, restoredReport, runChecks, defaultSettings, sectionRating,
  standardSentence, type Assessment,
} from "@crb/core";
import { migrateAssessmentV1 } from "./v1-reference/migrateAssessment.v1.mjs";

const FIXTURES = new URL("../../../tests/fixtures/", import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, FIXTURES), "utf8"));
const clone = <T>(x: T): T => structuredClone(x);
/** migrateAssessment, typed: the result is in today's shape. */
const upgrade = (doc: unknown, options?: { to?: number }): Assessment => migrateAssessment(doc, options) as Assessment;

const V1_FIXTURES: [schema: number, path: string][] = [
  [1, "v1/v1-assessment.json"],
  [1, "v1/documents/assessment-schema-1.json"],
  [2, "v1/documents/assessment-schema-2.json"],
  [3, "v1/documents/assessment-schema-3.json"],
  [4, "v1/documents/assessment-schema-4.json"],
  [5, "v1/documents/assessment-schema-5.json"],
  [6, "v1/documents/assessment-schema-6.json"],
];

/* eslint-disable @typescript-eslint/no-explicit-any -- the checks below look at raw JSON */
/** A document in today's shape: every field the model reads, and none of the older ones. */
function assertCurrentShape(doc: any): asserts doc is Assessment {
  assert.equal(doc.schema, SCHEMA_VERSION);
  for (const key of ["id", "templateKey", "propertyName", "clientName", "facilityContact", "address", "date", "preparedBy", "generalComments"]) {
    assert.equal(typeof doc[key], "string", `${key} is text`);
  }
  assert.ok(["hml", "rr"].includes(doc.priorityScheme), "a priority scheme");
  assert.ok(["report", "priority", "due"].includes(doc.actionOrder), "an action order");
  assert.ok(Array.isArray(doc.photos) && Array.isArray(doc.sections) && Array.isArray(doc.personnel) && Array.isArray(doc.parcels));
  for (const section of doc.sections) {
    assert.equal(typeof section.summary, "string", `${section.key} has a summary`);
    assert.equal("narrative" in section, false);
    for (const item of section.items) {
      assert.ok(Array.isArray(item.findings), `${section.key}.${item.key} has findings`);
      assert.equal(typeof item.noMaterialIssues, "boolean");
      for (const old of ["issues", "nmi", "addedByDraft"]) assert.equal(old in item, false, `no ${old} on ${item.key}`);
      for (const finding of item.findings) {
        assert.equal(typeof finding.observationOnly, "boolean");
        assert.equal("obsOnly" in finding, false);
        for (const old of ["owner", "assignee", "due"]) assert.equal(old in finding.action, false, `no ${old} on a finding's action`);
        for (const key of ["title", "recommendation", "priority"]) assert.equal(typeof finding.action[key], "string");
      }
    }
  }
  for (const photo of doc.photos) {
    assert.ok(Array.isArray(photo.findings) && Array.isArray(photo.alsoIn) && Array.isArray(photo.markup), `photo ${photo.id} is complete`);
    assert.equal("issues" in photo, false);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The model's everyday reads work on it: the report opens. */
function opens(a: Assessment): void {
  listFindings(a);
  listActions(a);
  actionSummary(a);
  runChecks(a, defaultSettings());
  for (const section of a.sections) {
    sectionRating(section);
    for (const item of section.items) standardSentence(item);
  }
}

describe("the steps", () => {
  test("are numbered 2 to 7 with no gaps, and new reports are saved in the last", () => {
    assert.deepEqual(ASSESSMENT_MIGRATIONS.map((m) => m.to), [2, 3, 4, 5, 6, 7]);
    assert.equal(SCHEMA_VERSION, 7);
    assert.equal(newAssessment({ templateKey: "healthcare" }).schema, 7);
  });

  test("v1's first version saved no schema number, which counts as 1", () => {
    assert.equal(documentSchema(read("v1/v1-assessment.json")), 1);
    assert.equal(documentSchema({ schema: 4 }), 4);
  });
});

describe.each(V1_FIXTURES)("a schema %i report (%s)", (schema, path) => {
  test("is in that schema", () => {
    assert.equal(documentSchema(read(path)), schema);
  });

  test("steps 2 to 6 give exactly what v1's own upgrade() gives", () => {
    const v2 = upgrade(read(path), { to: 6 });
    const v1 = migrateAssessmentV1(read(path));
    assert.deepEqual(v2, v1);
  });

  test("upgrades to schema 7 and opens", () => {
    const a = upgrade(read(path));
    assertCurrentShape(a);
    opens(a);
  });

  test("upgrading twice changes nothing more", () => {
    const once = upgrade(read(path));
    assert.deepEqual(upgrade(clone(once)), once);
  });

  test("keeps every section, subsection, finding and photo", () => {
    const before = read(path);
    const a = upgrade(clone(before));
    const findings = (doc: { sections: { items: { findings?: unknown[]; issues?: unknown[] }[] }[] }) =>
      doc.sections.flatMap((s) => s.items.flatMap((i) => i.findings ?? i.issues ?? []));
    assert.deepEqual(a.sections.map((s) => s.items.map((i) => i.key)), before.sections.map((s: { items: { key: string }[] }) => s.items.map((i) => i.key)));
    assert.equal(findings(a).length, findings(before).length);
    assert.deepEqual(a.photos.map((p) => p.id), before.photos.map((p: { id: string }) => p.id));
    assert.equal(a.id, before.id);
  });
});

describe("what each step does", () => {
  test("schema 1 → 2: issues become findings, nmi and narrative are renamed, photos gain markup", () => {
    const old = read("v1/v1-assessment.json");
    const a = upgrade(clone(old));
    const roof = a.sections[0]!.items[0]!;
    assert.equal(roof.findings[0]!.description, "Old-format finding");
    assert.equal(roof.findings[0]!.observationOnly, false);
    assert.equal(roof.noMaterialIssues, false);
    assert.equal(a.sections[0]!.summary, "");
    const full = upgrade(read("v1/documents/assessment-schema-1.json"));
    assert.deepEqual(full.photos.find((p) => p.id === "p1")!.findings, ["f-tpo"]);
    assert.deepEqual(full.photos.find((p) => p.id === "p1")!.markup, []);
    assert.equal(findItem(full, "env.roof")!.item.findings.find((f) => f.id === "f-wear")!.observationOnly, true);
  });

  test("schema 2 → 3: an action's owner becomes its assignee (and then moves to v1FollowUp in 7)", () => {
    const a = upgrade(read("v1/documents/assessment-schema-2.json"));
    const tpo = findItem(a, "env.roof")!.item.findings.find((f) => f.id === "f-tpo")!;
    assert.deepEqual(tpo.v1FollowUp, { assignee: "Facility maintenance", due: "2027-03-01" });
  });

  test("schema 3 → 4: a subsection a draft added becomes suggested", () => {
    const a = upgrade(read("v1/documents/assessment-schema-3.json"));
    const deck = findItem(a, "site.i-deck")!.item;
    assert.deepEqual([deck.suggested, "addedByDraft" in deck], [true, false]);
  });

  test("schema 4 → 5: an empty facility contact and High / Medium / Low", () => {
    const a = upgrade(read("v1/documents/assessment-schema-4.json"));
    assert.deepEqual([a.facilityContact, a.priorityScheme], ["", "hml"]);
  });

  test("schema 5 → 6: photos in one place each, and the action list by priority", () => {
    const a = upgrade(read("v1/documents/assessment-schema-5.json"));
    assert.ok(a.photos.every((p) => p.alsoIn.length === 0));
    assert.equal(a.actionOrder, "priority");
  });

  test("schema 6 → 7: assignee and due date leave the report; saved values move to v1FollowUp", () => {
    const before = read("v1/documents/assessment-schema-6.json");
    const a = upgrade(clone(before));
    const findings = listFindings(a).map((x) => x.finding);
    assert.deepEqual(findings.filter((f) => f.v1FollowUp).map((f) => [f.id, f.v1FollowUp]), [["f-tpo", { assignee: "Facility maintenance", due: "2027-03-01" }]]);
    assert.ok(findings.every((f) => !("assignee" in f.action) && !("due" in f.action)));
    // Nothing else changes.
    const strip = (doc: Assessment & { schema: number }) => {
      const copy = clone(doc);
      copy.schema = 0;
      for (const s of copy.sections) for (const i of s.items) for (const f of i.findings) {
        delete (f.action as { assignee?: string }).assignee;
        delete (f.action as { due?: string }).due;
        delete f.v1FollowUp;
      }
      return copy;
    };
    assert.deepEqual(strip(a), strip(before));
  });

  test("a v1 report's saved due dates still sort and merge as they did in v1", () => {
    const a = upgrade(read("v1/documents/assessment-schema-6.json"));
    assert.equal(a.actionOrder, "due");
    assert.equal(listActions(a)[0]!.finding.id, "f-tpo", "the one action with a saved due date comes first");
    // The live action item's due date wins over what v1 saved.
    const live = new Map([["f-stains", { due: "2027-01-01" }], ["f-tpo", { due: "2027-06-01" }]]);
    assert.deepEqual(listActions(a, live).map((x) => x.finding.id), ["f-stains", "f-tpo", "f-deck"]);
  });

  test("photos and their extra places survive the upgrade", () => {
    const a = upgrade(read("v1/documents/assessment-schema-6.json"));
    assert.deepEqual(photosOfFinding(a, "f-tpo").map((p) => p.id), ["p1", "p3"], "p3 is also used for the TPO finding");
    assert.equal(a.photos.find((p) => p.id === "p2")!.markup[0]!.photoId, "p1", "the numbered area still points at its close-up");
  });
});

describe("a schema 7 report (made and issued in v2)", () => {
  test("is already current: upgrading changes nothing", () => {
    const doc = read("v2/assessment-schema-7.json");
    assert.deepEqual(upgrade(clone(doc)), doc);
    assertCurrentShape(doc);
    opens(doc);
    assert.equal(doc.status, "issued");
    assert.equal(actionSummary(doc), "2 action items: 1 Required, 1 Recommended");
  });

  test("a report from a newer version of the app is left as it is", () => {
    const newer = { ...read("v2/assessment-schema-7.json"), schema: 99, somethingNew: true };
    assert.deepEqual(upgrade(clone(newer)), newer);
  });
});

test("restoring an old version upgrades it to schema 7", () => {
  const today = newAssessment({ templateKey: "healthcare" });
  const restored = restoredReport(today, read("v1/documents/assessment-schema-2.json"));
  assertCurrentShape(restored);
  assert.equal(restored.id, today.id);
  const tpo = findItem(restored, "env.roof")!.item.findings.find((f) => f.id === "f-tpo")!;
  assert.deepEqual(tpo.v1FollowUp, { assignee: "Facility maintenance", due: "2027-03-01" });
});

test("a finding made in v2 never has a v1FollowUp", () => {
  assert.equal("v1FollowUp" in newFinding(), false);
});

describe("transcripts", () => {
  test("a v1 transcript (no schema) upgrades to schema 2: every remark can be left out", () => {
    const t = migrateTranscript(read("v1/documents/transcript.json"));
    assert.equal(t.schema, TRANSCRIPT_SCHEMA_VERSION);
    assert.equal(TRANSCRIPT_SCHEMA_VERSION, 2);
    assert.deepEqual(t.segments.map((s: { leftOut: boolean }) => s.leftOut), [false, false, false]);
    assert.equal(t.segments[0].text, "Roof has storm damage on the west side.");
  });

  test("a remark already left out stays left out, and upgrading twice changes nothing", () => {
    const t = migrateTranscript(read("v1/documents/transcript.json"));
    t.segments[1].leftOut = true;
    const again = migrateTranscript(clone(t));
    assert.deepEqual(again, t);
  });
});
