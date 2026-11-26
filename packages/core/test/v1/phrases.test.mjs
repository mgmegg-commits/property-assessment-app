/**
 * The phrase library. Ported from v1 tests/phrases.test.mjs at 03104a2
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { DEFAULT_PHRASES, phraseLibrary, searchPhrases, withPhrase, suggestedTitle } from "@crb/core";
import { buildDraftPrompt } from "@crb/core";
import { newAssessment } from "@crb/core";
import { defaultSettings } from "@crb/core";

test("seeded with Cecil's 21 phrases", () => {
  assert.equal(DEFAULT_PHRASES.length, 21);
  assert.equal(DEFAULT_PHRASES[1].title, "Roof ponding");
  assert.equal(DEFAULT_PHRASES[1].text, "Proper tapering and cricketing is needed to eliminate roof ponding.");
  assert.equal(new Set(DEFAULT_PHRASES.map((p) => p.id)).size, 21, "unique ids");
  assert.equal(phraseLibrary(defaultSettings()).length, 21, "new settings start with them");
  assert.deepEqual(phraseLibrary({ phrases: [] }), [], "an emptied library stays empty");
});

test("search by title first, then text", () => {
  assert.deepEqual(searchPhrases(DEFAULT_PHRASES, "ponding").map((p) => p.title), ["Roof ponding"]);
  assert.equal(searchPhrases(DEFAULT_PHRASES, "ROOF")[0].title, "Roof ponding", "any case, titles first");
  assert.ok(searchPhrases(DEFAULT_PHRASES, "warranty").some((p) => p.title === "TPO repairs"), "text matches too");
  assert.equal(searchPhrases(DEFAULT_PHRASES, "").length, 21);
});

test("inserting adds the phrase after what's there; saving suggests a title", () => {
  const ponding = DEFAULT_PHRASES[1];
  assert.equal(withPhrase("", ponding), ponding.text);
  assert.equal(withPhrase("Ponding at the west wing. ", ponding), `Ponding at the west wing.\n${ponding.text}`);
  assert.equal(suggestedTitle("Seal coating is due this spring."), "Seal coating is due");
});

test("drafts are asked to reuse his wording", () => {
  const prompt = buildDraftPrompt(newAssessment({ templateKey: "healthcare" }), [{ id: "s1", start: 0, end: 1, text: "Roof." }], [], DEFAULT_PHRASES);
  assert.match(prompt, /Cecil's standard wording/);
  assert.match(prompt, /- Roof ponding: Proper tapering and cricketing is needed to eliminate roof ponding\./);
  assert.doesNotMatch(buildDraftPrompt(newAssessment({ templateKey: "healthcare" }), []), /standard wording/, "no block without phrases");
});
