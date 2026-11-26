/**
 * Follow-up tracker export. Ported from v1 tests/tracker.test.mjs at 03104a2
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { migrateAssessment, SCHEMA_VERSION } from "@crb/core";

// Deferred to step 2.9 (exports): "one row per action in report order, with the exact columns" and
// "the workbook has a bold, wrapped header and readable columns" (need export/tracker.js and xlsx-js-style).

test("older reports gain an empty facility contact", () => {
  const a = migrateAssessment({ schema: 4, sections: [], photos: [] });
  assert.deepEqual([a.schema, a.facilityContact], [SCHEMA_VERSION, ""]);
  assert.ok(SCHEMA_VERSION >= 5);
});
