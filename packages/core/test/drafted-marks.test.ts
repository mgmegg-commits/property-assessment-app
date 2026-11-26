/**
 * Drafted values and suggested subsections, marked by hand.
 *
 * v1's tests of these ("Accept all clears a section's drafted marks" and
 * "issuing is blocked until drafted values are accepted…") build their report
 * with the drafting code, which arrives in step 2.8; they're ported there
 * word for word. Until then, these build the same report by hand (what v1's
 * applyDraft produces from its test answer) and make the same assertions.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  acceptAllDrafted, addItem, defaultSettings, findItem, markDrafted, newAssessment, newFinding, pendingDrafts, runChecks,
  type Assessment, type Item,
} from "@crb/core";

const item = (a: Assessment, ref: string): Item => findItem(a, ref)!.item;

/** The report v1's drafting test answer produces: roof, a suggested pool deck, parking, two summaries. */
function draftedReport(): Assessment {
  const a = newAssessment({ templateKey: "realestate" });
  const rate = (target: Item, rating: Item["rating"], notes: string) => {
    Object.assign(target, { rating, notes });
    markDrafted(target, "rating");
    markDrafted(target, "notes");
  };
  const roof = item(a, "env.roof");
  rate(roof, "P", "Storm damage on the west side.");
  const storm = newFinding();
  Object.assign(storm, { description: "Storm damage on the west side of the roof.", location: "West side", drafted: true });
  Object.assign(storm.action, { title: "Repair storm damage", recommendation: "Repair the roof.", priority: "H" });
  roof.findings.push(storm);

  const site = a.sections.find((s) => s.key === "site")!;
  const deck = addItem(site, "Pool Deck");
  deck.suggested = true;
  rate(deck, "F", "Cracked along the edge.");
  const cracks = newFinding();
  Object.assign(cracks, { description: "The pool deck is cracked along the edge.", drafted: true });
  Object.assign(cracks.action, { title: "Repair pool deck", recommendation: "Repair the cracks.", priority: "M" });
  deck.findings.push(cracks);
  rate(item(a, "site.paving"), "G", "In good condition.");

  a.sections[0]!.summary = "The envelope has storm damage at the roof.";
  markDrafted(a.sections[0]!, "summary");
  site.summary = "The site is generally in fair condition.";
  markDrafted(site, "summary");
  return a;
}

test("the hand-marked report has the eight drafted values v1's draft makes", () => {
  assert.equal(pendingDrafts(draftedReport()).length, 8);
});

test("Accept all clears a section's drafted marks", () => {
  const a = draftedReport();
  acceptAllDrafted(a.sections.find((s) => s.key === "site")!);
  assert.ok(pendingDrafts(a).every((p) => p.section.key !== "site"));
});

test("issuing is blocked until drafted values are accepted and suggestions resolved; not-discussed is fine", () => {
  const a = draftedReport();
  const errors = (doc: Assessment) => runChecks(doc, defaultSettings()).filter((r) => r.level === "error").map((r) => r.text).join("\n");
  assert.match(errors(a), /drafted values? not accepted/);
  assert.match(errors(a), /suggested subsection to keep, rename or merge: Pool Deck/);
  assert.doesNotMatch(errors(a), /not rated|no rating/);
  a.sections.forEach(acceptAllDrafted);
  a.sections.forEach((s) => s.items.forEach((i) => delete i.suggested));
  assert.doesNotMatch(errors(a), /drafted|suggested/);
  const info = runChecks(a, defaultSettings()).filter((r) => r.level === "info").map((r) => r.text).join("\n");
  assert.match(info, /not discussed/);
});
